import { Player, type PlayerRef } from "@remotion/player";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type CaptionStyle,
  type Cut,
  NOISE_LEVELS,
  type PlacedWord,
  type Segment,
  type VoiceOver,
  cutSeconds,
  dropPiece,
  layTake,
  makeCut,
  movePiece,
  pieceAt,
  pieceEnd,
  pieceSeconds,
  placedWords,
  remapPieces,
  remapTime,
  sameCut,
  snapToGap,
  splitPiece,
  toOutput,
  toSource,
  trimEnd,
  trimStart,
  voiceId,
  wholeCut,
} from "@heroic/voiceover";
import type { VoicePreview } from "../game";
import type { CleanupSpec } from "../lib/sidecar";
import { type Clip, type GameApi, type GameInfo, type VoiceSummary, type WhisperStatus, fmtSeconds } from "./api";
import { go } from "./App";
import { loadVoicePreview } from "./games";
import { type Mic, type MicDevice, PEAKS_PER_SECOND, listMics, micPermission, micSupported, openMic, peaksOf } from "./mic";
import { TikTokOverlay } from "./TikTokOverlay";

/**
 * The editor: one timeline for a clip's footage, the voice over it and the
 * words of the captions.
 *
 * FOOTAGE is edited the way you'd edit a track in Audacity: split at the
 * playhead, click a piece, Delete. What's deleted closes up and leaves a
 * thin hatched marker (click it to put the footage back); the edges either
 * side of a marker drag, to take off more or give some back. The timeline
 * is the CLIP's time: what you see is what plays.
 *
 * VOICE is pinned to the footage under it: cut footage out and the voice
 * after it moves up with it. Record from the playhead, drag pieces, trim,
 * split, delete. Whisper writes the words.
 *
 * The preview is a real template playing the recording's kept pieces, so
 * a cut doesn't have to be made to be seen. Voice and words save
 * themselves; a change to the footage is made real by Save (ffmpeg writes
 * the clip), because Make and the renders play the clip file.
 *
 * Opened FROM a cut (`from`), it starts with that cut's edit and its
 * voice-over, and Save writes over the cut.
 */
const stem = (file: string) => file.replace(/\.[^.]+$/, "");
const remember = (key: string, value?: string): string => {
  try {
    if (value !== undefined) localStorage.setItem(`desk.voice.${key}`, value);
    return localStorage.getItem(`desk.voice.${key}`) ?? "";
  } catch {
    return "";
  }
};

type SrcPiece = { start: number; end: number; kept: boolean };
/** The footage edit: split points in the recording + which pieces are dropped. */
type Track = { cuts: number[]; removed: number[] };
/** Everything undo puts back. */
type Snapshot = { track: Track; slide: number; vo: VoiceOver };

const piecesOf = (tr: Track, total: number): SrcPiece[] => {
  const edges = [0, ...tr.cuts, total];
  return edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1]!, kept: !tr.removed.includes(i) }));
};
const cutOf = (tr: Track, total: number, slide: number): Cut => makeCut(piecesOf(tr, total).filter((p) => p.kept), slide);

/** A saved cut's kept segments → the track's split points + dropped pieces.
 * Cuts from before segments existed carried startFrom/endAt; that's one segment. */
const specToTrack = (spec: Partial<CleanupSpec> & { startFrom?: number; endAt?: number }, total: number): Track => {
  const segments: Segment[] = spec.segments?.length ? spec.segments : spec.endAt !== undefined ? [{ start: spec.startFrom ?? 0, end: spec.endAt }] : [];
  const eps = 0.05;
  const cuts = [...new Set(segments.flatMap((s) => [s.start, s.end]))].filter((x) => x > eps && x < total - eps).sort((a, b) => a - b);
  const pieces = piecesOf({ cuts, removed: [] }, total);
  const removed = segments.length ? pieces.flatMap((p, i) => (segments.some((s) => s.start - eps <= p.start && p.end <= s.end + eps) ? [] : [i])) : [];
  return { cuts, removed };
};

/** One piece's sound, drawn. Re-draws only when its slice or size changes. */
const Wave = memo<{ peaks?: Float32Array; start: number; end: number; width: number; height: number }>(({ peaks, start, end, width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.min(16000, Math.round(width)));
    c.width = Math.round(w * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    if (!peaks) return;
    g.fillStyle = "rgba(242,233,212,0.9)";
    const mid = c.height / 2;
    const span = end - start;
    for (let x = 0; x < c.width; x++) {
      const a = Math.floor((start + (x / c.width) * span) * PEAKS_PER_SECOND);
      const b = Math.max(a + 1, Math.ceil((start + ((x + 1) / c.width) * span) * PEAKS_PER_SECOND));
      let peak = 0;
      for (let i = a; i < b && i < peaks.length; i++) peak = Math.max(peak, peaks[i]!);
      // A square-root scale: quiet speech still shows as speech.
      const h = Math.max(dpr, Math.sqrt(peak) * (c.height - 4 * dpr));
      g.fillRect(x, mid - h / 2, 1, h);
    }
  }, [peaks, start, end, width, height]);
  return <canvas ref={ref} style={{ width: "100%", height, display: "block" }} />;
});

type Rec = { state: "idle" } | { state: "count"; n: number; at: number } | { state: "on"; at: number } | { state: "saving" } | { state: "words" };
type Drag =
  | { on: "voice"; kind: "move" | "start" | "end"; index: number; x0: number; at0: number; end0: number; base: Snapshot; moved: boolean }
  | { on: "footage"; k: number; x0: number; cut0: number; px: number; base: Snapshot; moved: boolean };
type Picked = { footage: number } | { piece: number } | { take: number; word: number } | null;
type Row = "footage" | "voice";

const ROW = { ruler: 22, clip: 64, voice: 76, words: 34 };

export const Edit: React.FC<{ game: GameInfo; api: GameApi; file: string; from?: string; vo?: string }> = ({ game, api, file, from, vo: voParam }) => {
  const FPS = game.fps;
  const [source, setSource] = useState<Clip | null>(null);
  const [recut, setRecut] = useState<Clip | null>(null); // the cut being re-done, when opened from one
  const [preview, setPreview] = useState<VoicePreview | null | undefined>(undefined);
  const [voices, setVoices] = useState<VoiceSummary[]>([]);
  const [snap, setSnapState] = useState<Snapshot | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  const history = useRef<Snapshot[]>([]);
  // What's on disk: the clip file's cut, and the clip the voice-over belongs to.
  const [savedCut, setSavedCut] = useState<Cut | null>(null);
  const [voiceClip, setVoiceClip] = useState("");
  const [voId, setVoId] = useState("");
  const savedVoice = useRef("");
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "failed">("");
  const [touched, setTouched] = useState(false); // footage, frame or sound changed since the clip file was written
  // the frame
  const [cropTop, setCropTop] = useState(0.035);
  const [cropBottom, setCropBottom] = useState(0.065);
  const [muted, setMuted] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // the screen
  const [picked, setPicked] = useState<Picked>(null);
  const [row, setRow] = useState<Row>("footage");
  const [editing, setEditing] = useState<{ take: number; word: number; text: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: Row } | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [style, setStyle] = useState<CaptionStyle>(() => (remember("captions") as CaptionStyle) || "tiktok");
  const [overlay, setOverlay] = useState(() => remember("overlay") !== "off");
  // The clip's own sound in this preview (and so while recording). Not the same as dropping the clip's audio, which is part of the cut.
  const [clipSound, setClipSound] = useState(() => remember("clip") !== "off");
  const [msg, setMsg] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [whisper, setWhisper] = useState<WhisperStatus | null>(null);
  // the mic
  const mic = useRef<Mic | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [device, setDevice] = useState(() => remember("mic"));
  const meter = useRef<HTMLDivElement>(null);
  const meterText = useRef<HTMLSpanElement>(null);
  const [rec, setRecState] = useState<Rec>({ state: "idle" });
  const recRef = useRef<Rec>({ state: "idle" });
  const sync = useRef<{ frame0: number; skip: number | null }>({ frame0: 0, skip: null });
  const setRec = (r: Rec) => {
    recRef.current = r;
    setRecState(r);
  };
  // the timeline
  const player = useRef<PlayerRef>(null);
  const stage = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lane = useRef<HTMLDivElement>(null);
  const [laneWidth, setLaneWidth] = useState(1000);
  const drag = useRef<Drag | null>(null);
  const scrub = useRef(false);
  const zoomRef = useRef(1);
  const keepUnder = useRef<{ frac: number; x: number } | null>(null);
  const [peaks, setPeaks] = useState<Record<string, Float32Array>>({});
  const asked = useRef(new Set<string>());

  const srcTotal = source?.facts.seconds ?? 1;
  const cut = useMemo(() => (snap ? cutOf(snap.track, srcTotal, snap.slide) : wholeCut(srcTotal)), [snap, srcTotal]);
  const total = Math.max(0.1, cutSeconds(cut));
  const frames = Math.max(1, Math.round(total * FPS));
  const pxPerSec = (laneWidth * zoom) / total;
  const maxZoom = Math.max(8, Math.min(80, (total * 320) / laneWidth));
  const vo = snap?.vo ?? null;
  const pieces = vo?.pieces ?? [];

  const setSnap = useCallback((next: Snapshot) => {
    snapRef.current = next;
    setSnapState(next);
  }, []);
  /** An edit you can undo. */
  const commit = useCallback(
    (next: Snapshot) => {
      if (snapRef.current) history.current.push(snapRef.current);
      if (history.current.length > 200) history.current.shift();
      setSnap(next);
    },
    [setSnap],
  );
  const setVo = useCallback((next: VoiceOver, undoable = false) => snapRef.current && (undoable ? commit : setSnap)({ ...snapRef.current, vo: next }), [commit, setSnap]);

  const seek = useCallback(
    (to: number, of = total) => {
      const clamped = Math.max(0, Math.min(of, to));
      player.current?.seekTo(Math.max(0, Math.min(Math.round(of * FPS) - 1, Math.round(clamped * FPS))));
      setT(clamped);
    },
    [total, FPS],
  );
  /** A change to the footage: the voice and the playhead go where their footage went. */
  const recutTo = useCallback(
    (track: Track, slide?: number, base = snapRef.current, undoable = true) => {
      if (!base) return;
      const next = slide ?? base.slide;
      const was = cutOf(base.track, srcTotal, base.slide);
      const now = cutOf(track, srcTotal, next);
      const here = snapRef.current ? cutOf(snapRef.current.track, srcTotal, snapRef.current.slide) : was;
      (undoable ? commit : setSnap)({ track, slide: next, vo: { ...(snapRef.current?.vo ?? base.vo), pieces: remapPieces(base.vo.pieces, was, now) } });
      setTouched(true);
      seek(remapTime(t, here, now), cutSeconds(now));
    },
    [commit, setSnap, seek, srcTotal, t],
  );
  const undo = useCallback(() => {
    const prev = history.current.pop();
    const now = snapRef.current;
    if (!prev || !now) return;
    // Words that arrived after the snapshot was taken belong to the take, not the edit: keep them.
    setSnap({ ...prev, vo: { ...prev.vo, takes: prev.vo.takes.map((tk) => (tk.transcribed ? tk : (now.vo.takes.find((x) => x.file === tk.file) ?? tk))) } });
    if (prev.track !== now.track || prev.slide !== now.slide) {
      setTouched(true);
      seek(remapTime(t, cutOf(now.track, srcTotal, now.slide), cutOf(prev.track, srcTotal, prev.slide)), cutSeconds(cutOf(prev.track, srcTotal, prev.slide)));
    }
    setPicked(null);
  }, [setSnap, seek, srcTotal, t]);

  // ── load ──
  useEffect(() => {
    let alive = true;
    void loadVoicePreview(game.id).then((p) => alive && setPreview(p ?? null));
    void api.voices().then((v) => alive && setVoices(v));
    void api.whisper().then((w) => alive && setWhisper(w)).catch(() => {});
    void api
      .clips()
      .then(async (all) => {
        const c = all.find((x) => x.file === file);
        if (!alive || !c) return alive && setMsg(`✖ ${file} isn't in the library`);
        const prior = from ? all.find((x) => x.file === from && x.source === c.file) : undefined;
        const spec = prior?.cleanup;
        const track = spec ? specToTrack(spec, c.facts.seconds) : { cuts: [], removed: [] };
        const slide = spec?.transitionSeconds || 0.4;
        const clipFile = prior?.file ?? c.file;
        const id = voiceId(voParam || clipFile);
        const voice = await api.voice(id, clipFile);
        if (!alive) return;
        const { path: _path, ...saved } = voice;
        // A voice-over that hasn't been started takes the noise setting and the level you last used.
        const last = { denoise: Number(remember("denoise")) || 0, volume: Number(remember("volume")) || 1 };
        const rest: VoiceOver = saved.takes.length ? saved : { ...saved, denoise: Math.max(0, Math.min(3, last.denoise)), volume: Math.max(0.1, Math.min(1, last.volume)) };
        setSource(c);
        setRecut(prior ?? null);
        setCropTop(spec?.cropTop ?? c.cropTop);
        setCropBottom(spec?.cropBottom ?? c.cropBottom);
        setMuted(spec?.muted ?? c.muted);
        setNote((prior ?? c).note);
        setName(prior ? stem(prior.file) : `${stem(c.file)} cut`);
        setSavedCut(cutOf(track, c.facts.seconds, slide));
        setVoiceClip(clipFile);
        setVoId(id);
        savedVoice.current = JSON.stringify({ ...rest, clip: clipFile });
        history.current = [];
        setSnap({ track, slide, vo: { ...rest, clip: clipFile } });
      })
      .catch((e) => alive && setMsg(`✖ ${(e as Error).message}`));
    return () => {
      alive = false;
    };
  }, [api, game.id, file, from, voParam, setSnap]);

  // The voice-over saves itself, a moment after the last change, timed against
  // the clip file as it is ON DISK: if the footage has been changed since,
  // the pieces are carried back to where that footage sits in the saved clip.
  useEffect(() => {
    if (!vo || !vo.takes.length || !savedCut || !voId) return;
    const onDisk: VoiceOver = { ...vo, id: voId, clip: voiceClip, pieces: sameCut(cut, savedCut) ? vo.pieces : remapPieces(vo.pieces, cut, savedCut) };
    const body = JSON.stringify(onDisk);
    if (body === savedVoice.current) return;
    setSaveState("saving");
    const timer = setTimeout(() => {
      api
        .saveVoice(onDisk)
        .then(() => {
          savedVoice.current = body;
          setSaveState("saved");
        })
        .catch(() => setSaveState("failed"));
    }, 500);
    return () => clearTimeout(timer);
  }, [vo, cut, savedCut, voId, voiceClip, api]);

  // Leaving with footage changes that haven't been made into a clip.
  useEffect(() => {
    if (!touched) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [touched]);

  // Waveforms, once per take.
  useEffect(() => {
    for (const tk of vo?.takes ?? []) {
      if (asked.current.has(tk.file)) continue;
      asked.current.add(tk.file);
      peaksOf(api.publicUrl(tk.file))
        .then((p) => setPeaks((cur) => ({ ...cur, [tk.file]: p })))
        .catch(() => {});
    }
  }, [vo?.takes, api]);

  // Whisper being installed: watch it.
  useEffect(() => {
    if (!whisper?.installing) return;
    const timer = setInterval(() => void api.whisper().then(setWhisper).catch(() => {}), 1500);
    return () => clearInterval(timer);
  }, [whisper?.installing, api]);

  // ── the player ──
  const inputProps = useMemo(() => {
    if (!source || !preview || !vo) return null;
    return {
      ...preview.props(`footage/${source.file}`, total, { width: source.facts.width, height: source.facts.height, cropTop, cropBottom }),
      segments: cut.segments,
      slide: cut.overlap,
      muted: muted || !clipSound,
      voiceData: vo,
      captions: style,
      format: "vertical",
    };
  }, [source, preview, vo, cut, total, cropTop, cropBottom, muted, clipSound, style]);
  const ready = Boolean(inputProps);

  /** `e` = the click that asked for it: browsers that ration sound (Safari) only let a page play what a gesture started. */
  const play = (e?: React.SyntheticEvent) => {
    const p = player.current;
    if (!p) return;
    if (p.getCurrentFrame() >= frames - 2) p.seekTo(0);
    p.unmute();
    p.play(e);
  };
  const pause = () => player.current?.pause();

  const hear = useCallback(
    async (take: VoiceOver["takes"][number], id: string) => {
      const w = await api.whisper().catch(() => null);
      if (w) setWhisper(w);
      if (!w?.ready) return;
      setRec({ state: "words" });
      const done = await api.transcribe(id, take);
      const now = snapRef.current;
      if (now) setSnap({ ...now, vo: { ...now.vo, takes: now.vo.takes.map((x) => (x.file === done.file ? { ...x, words: done.words, transcribed: true } : x)) } });
    },
    [api, setSnap],
  );

  const stopRecording = useCallback(async () => {
    const r = recRef.current;
    if (r.state === "count") return setRec({ state: "idle" });
    if (r.state !== "on" || !mic.current || !snapRef.current) return;
    const out = mic.current.stop();
    const skip = Math.max(0, sync.current.skip ?? 0);
    player.current?.pause();
    player.current?.unmute();
    if (!out || out.seconds - skip < 0.3) {
      setRec({ state: "idle" });
      return setMsg("That was too short to keep.");
    }
    setRec({ state: "saving" });
    setMsg("");
    try {
      const take = await api.addTake(voId, out.wav, { tidy: snapRef.current.vo.tidy, denoise: snapRef.current.vo.denoise ?? 0 });
      const cur = snapRef.current;
      const index = cur.vo.takes.length;
      const laid = layTake(cur.vo.pieces, index, take.seconds, r.at, Math.min(skip, 1));
      commit({ ...cur, vo: { ...cur.vo, takes: [...cur.vo.takes, take], pieces: laid } });
      setPicked({ piece: laid.findIndex((p) => p.take === index) });
      setRow("voice");
      seek(r.at);
      await hear(take, voId);
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    } finally {
      setRec({ state: "idle" });
    }
  }, [api, commit, seek, hear, voId]);

  useEffect(() => {
    const p = player.current;
    if (!p || !ready) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      if (!scrub.current && !drag.current) setT(e.detail.frame / FPS);
      // The first frame the clip actually moves: how long the mic had been live by then.
      const s = sync.current;
      if (recRef.current.state === "on" && s.skip === null && e.detail.frame > s.frame0 && mic.current) s.skip = mic.current.elapsed() - (e.detail.frame - s.frame0) / FPS;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      if (recRef.current.state === "on") void stopRecording();
    };
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    p.addEventListener("ended", onEnded);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
      p.removeEventListener("ended", onEnded);
    };
  }, [ready, FPS, stopRecording]);

  // ── the mic ──
  const turnMicOn = useCallback(
    async (want = device): Promise<Mic | null> => {
      if (!micSupported()) {
        setMsg("This browser can't record. Use Chrome, Edge or Safari, on localhost.");
        return null;
      }
      mic.current?.close();
      mic.current = null;
      try {
        let m: Mic;
        try {
          m = await openMic(want);
        } catch (e) {
          // The remembered mic isn't plugged in: fall back to whatever is.
          if (!want) throw e;
          m = await openMic("");
        }
        mic.current = m;
        setMicOn(true);
        const list = await listMics();
        setMics(list);
        const using = list.find((d) => d.id === m.device)?.id ?? "";
        setDevice(using);
        if (using) remember("mic", using);
        return m;
      } catch (e) {
        setMicOn(false);
        const kind = (e as Error).name;
        setMsg(kind === "NotAllowedError" ? "The browser wasn't allowed the microphone. Allow it from the address bar, then press Turn the mic on." : `✖ microphone: ${(e as Error).message}`);
        return null;
      }
    },
    [device],
  );
  useEffect(() => {
    // Allowed before? Then the meter's live as soon as the screen opens.
    void micPermission().then((p) => p === "granted" && !mic.current && void turnMicOn());
    return () => {
      mic.current?.close();
      mic.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!micOn) return;
    let raf = 0;
    let held = 0;
    const loop = () => {
      const level = mic.current?.level() ?? 0;
      held = Math.max(level, held * 0.93);
      const db = 20 * Math.log10(Math.max(held, 1e-4));
      if (meter.current) {
        meter.current.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
        meter.current.style.background = db > -3 ? "var(--crimson)" : db > -12 ? "#e0b27c" : "#9fe0ad";
      }
      if (meterText.current) meterText.current.textContent = held < 1e-4 ? "silent" : `${db.toFixed(0)} dB`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [micOn]);

  const startRecording = async () => {
    if (recRef.current.state !== "idle" || !snapRef.current) return;
    const m = mic.current ?? (await turnMicOn());
    if (!m || !player.current) return;
    pause();
    const at = t >= total - 0.5 ? 0 : t;
    setMsg("");
    for (let n = 3; n >= 1; n--) {
      setRec({ state: "count", n, at });
      await new Promise((r) => setTimeout(r, 650));
      if ((recRef.current as Rec).state !== "count") return; // cancelled
    }
    const p = player.current;
    const frame0 = Math.round(at * FPS);
    sync.current = { frame0, skip: null };
    p.seekTo(frame0);
    // Silent clip = a silent room: nothing plays, earlier takes included, so the mic hears only you.
    if (clipSound) p.unmute();
    else p.mute();
    m.start();
    setRec({ state: "on", at });
    p.play();
  };

  const addFile = async (f: File) => {
    if (!snapRef.current) return;
    setRec({ state: "saving" });
    setMsg("");
    try {
      const ext = /\.([a-z0-9]+)$/i.exec(f.name)?.[1] ?? "wav";
      const take = await api.addTake(voId, f, { tidy: snapRef.current.vo.tidy, denoise: snapRef.current.vo.denoise ?? 0, ext });
      const cur = snapRef.current;
      const index = cur.vo.takes.length;
      const laid = layTake(cur.vo.pieces, index, take.seconds, t);
      commit({ ...cur, vo: { ...cur.vo, takes: [...cur.vo.takes, take], pieces: laid } });
      setPicked({ piece: laid.findIndex((p) => p.take === index) });
      setRow("voice");
      await hear(take, voId);
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    } finally {
      setRec({ state: "idle" });
    }
  };

  // ── edits: the footage ──
  const srcPieces = useMemo(() => (snap ? piecesOf(snap.track, srcTotal) : []), [snap, srcTotal]);
  /** What the footage row draws: kept pieces where they play, a marker where footage was taken out, the edges that drag. */
  const footage = useMemo(() => {
    const blocks: { index: number; out: number; end: number }[] = [];
    const markers: { at: number; seconds: number; pieces: number[] }[] = [];
    let run: number[] = [];
    const flush = (at: number) => {
      if (run.length) markers.push({ at, seconds: run.reduce((s, i) => s + (srcPieces[i]!.end - srcPieces[i]!.start), 0), pieces: run });
      run = [];
    };
    srcPieces.forEach((p, i) => {
      if (!p.kept) return void run.push(i);
      const out = toOutput(cut, p.start);
      flush(out);
      blocks.push({ index: i, out, end: total });
    });
    flush(total);
    blocks.forEach((b, i) => (b.end = blocks[i + 1]?.out ?? total));
    // Split point k sits between pieces k and k+1.
    const edges = (snap?.track.cuts ?? []).flatMap((c, k) => {
      const left = srcPieces[k]?.kept;
      const right = srcPieces[k + 1]?.kept;
      if (!left && !right) return [];
      const at = left && right ? toOutput(cut, c) : left ? (blocks.find((b) => b.index === k)?.end ?? total) : toOutput(cut, c);
      return [{ k, at, side: left && right ? ("split" as const) : left ? ("before" as const) : ("after" as const) }];
    });
    return { blocks, markers, edges };
  }, [srcPieces, cut, total, snap]);

  const splitFootage = (at = t) => {
    const cur = snapRef.current;
    if (!cur) return;
    const s = toSource(cut, at);
    if (s <= 0.05 || s >= srcTotal - 0.05 || cur.track.cuts.some((c) => Math.abs(c - s) < 0.05)) return;
    const cuts = [...cur.track.cuts, s].sort((x, y) => x - y);
    const idx = cuts.indexOf(s); // piece `idx` is the one being split: it becomes idx (left) + idx+1 (right)
    const removed = cur.track.removed.map((r) => (r > idx ? r + 1 : r)).concat(cur.track.removed.includes(idx) ? [idx + 1] : []);
    recutTo({ cuts, removed });
    setPicked({ footage: idx + 1 });
  };
  const dropFootage = (i: number) => {
    const cur = snapRef.current;
    if (!cur || i < 0 || cur.track.removed.includes(i)) return;
    if (srcPieces.filter((p) => p.kept).length <= 1) return setMsg("That's the last piece of footage: keep something.");
    recutTo({ ...cur.track, removed: [...cur.track.removed, i] });
    setPicked(null);
  };
  const restoreFootage = (which: number[]) => {
    const cur = snapRef.current;
    if (cur) recutTo({ ...cur.track, removed: cur.track.removed.filter((r) => !which.includes(r)) });
  };
  const setSlide = (seconds: number) => snapRef.current && recutTo(snapRef.current.track, Math.max(0.1, seconds || 0.4));

  // ── edits: the voice ──
  const splitVoice = (toGap = false) => {
    const cur = snapRef.current;
    if (!cur) return;
    const i = pieceAt(cur.vo.pieces, t);
    const p = cur.vo.pieces[i];
    if (!p) return setMsg("Put the playhead on a piece of voice to split it.");
    const at = toGap ? snapToGap(p, cur.vo.takes[p.take], t) : t;
    const next = splitPiece(cur.vo.pieces, at);
    if (next === cur.vo.pieces) return;
    commit({ ...cur, vo: { ...cur.vo, pieces: next } });
    setPicked({ piece: i + 1 });
    if (at !== t) seek(at);
  };
  const split = (toGap = false) => (row === "voice" ? splitVoice(toGap) : splitFootage());
  const remove = () => {
    const cur = snapRef.current;
    if (!cur || !picked) return;
    if ("footage" in picked) return dropFootage(picked.footage);
    if ("piece" in picked) {
      if (!cur.vo.pieces[picked.piece]) return;
      commit({ ...cur, vo: { ...cur.vo, pieces: dropPiece(cur.vo.pieces, picked.piece) } });
      return setPicked(null);
    }
    // A word: off the captions (or back on). The sound is untouched.
    const { take, word } = picked;
    commit({ ...cur, vo: { ...cur.vo, takes: cur.vo.takes.map((tk, i) => (i === take ? { ...tk, words: tk.words.map((w, k) => (k === word ? { ...w, hidden: !w.hidden } : w)) } : tk)) } });
  };
  const retype = (take: number, word: number, text: string) => {
    const cur = snapRef.current;
    const clean = text.trim();
    setEditing(null);
    if (!cur || !clean || cur.vo.takes[take]?.words[word]?.text === clean) return;
    commit({ ...cur, vo: { ...cur.vo, takes: cur.vo.takes.map((tk, i) => (i === take ? { ...tk, words: tk.words.map((w, k) => (k === word ? { ...w, text: clean } : w)) } : tk)) } });
  };
  const again = async (take: number) => {
    const cur = snapRef.current;
    const tk = cur?.vo.takes[take];
    if (!cur || !tk) return;
    setRec({ state: "words" });
    try {
      const done = await api.transcribe(voId, tk);
      const now = snapRef.current;
      // The same words in the same order: the new times, with the fixes you'd made kept.
      const same = done.words.length === tk.words.length;
      const words = same ? done.words.map((w, i) => ({ ...w, text: tk.words[i]!.text, ...(tk.words[i]!.hidden ? { hidden: true } : {}) })) : done.words;
      if (now) commit({ ...now, vo: { ...now.vo, takes: now.vo.takes.map((x) => (x.file === done.file ? { ...x, words, transcribed: true } : x)) } });
      setMsg(same ? "✔ Timed again. Your fixes to the words are kept." : "✔ Heard it differently this time, so the words are as Whisper wrote them.");
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    } finally {
      setRec({ state: "idle" });
    }
  };
  /** The takes made another way: tidied or not, the background noise down or not. */
  const setSound = async (want: { tidy?: boolean; denoise?: number }) => {
    const cur = snapRef.current;
    if (!cur) return;
    if (want.denoise !== undefined) remember("denoise", String(want.denoise));
    if (!cur.vo.takes.length) return setVo({ ...cur.vo, ...want });
    setRec({ state: "saving" });
    try {
      // The server swaps each take's file; the pieces are the screen's, so they stay as they are here.
      const next = await api.sound({ ...cur.vo, id: voId, clip: voiceClip }, want);
      const now = snapRef.current ?? cur;
      setVo({ ...now.vo, tidy: next.tidy, denoise: next.denoise, takes: now.vo.takes.map((tk, i) => ({ ...tk, file: next.takes[i]?.file ?? tk.file })) });
      savedVoice.current = "";
      setMsg("");
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    } finally {
      setRec({ state: "idle" });
    }
  };
  const setVolume = (volume: number) => {
    const cur = snapRef.current;
    if (!cur) return;
    remember("volume", String(volume));
    setVo({ ...cur.vo, volume });
  };
  const binVoice = async () => {
    if (!vo?.takes.length) return;
    if (!confirm(`Bin the voice-over "${voId}"?\n\nIts recordings go to the voice folder's .trash, not the void. Videos already rendered keep their sound.`)) return;
    await api.deleteVoice(voId).catch(() => {});
    savedVoice.current = "";
    history.current = [];
    if (snapRef.current) setSnap({ ...snapRef.current, vo: { ...snapRef.current.vo, takes: [], pieces: [] } });
    setVoices(await api.voices());
  };
  const backup = async () => {
    setMsg("copying the recordings to Drive…");
    try {
      const r = await api.backupTakes();
      setMsg(`${r.ok ? "✔" : "✖"} ${r.log}`);
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    }
  };

  // ── save: make the footage edit a clip file, and move the voice-over on to it ──
  const replacing = recut && name.trim() === stem(recut.file) ? recut.file : undefined;
  const save = async () => {
    const cur = snapRef.current;
    if (!source || !cur || !cut.segments.length) return setMsg("nothing kept");
    setBusy(true);
    setMsg("cutting…");
    pause();
    try {
      const out = await api.cleanup(source.file, { name, segments: cut.segments, transition: "slide", transitionSeconds: cut.overlap || cur.slide, cropTop, cropBottom, muted, replace: replacing });
      if (note !== (replacing ? recut!.note : source.note)) await api.saveClip(out.file, { note });
      // Every other voice-over of a clip that's just been cut again: carried to where its footage now is.
      if (replacing && savedCut && !sameCut(cut, savedCut)) {
        for (const v of (await api.voices()).filter((x) => x.clip === out.file && x.id !== voId)) {
          const other = await api.savedVoice(v.id);
          if (other) await api.saveVoice({ ...other, pieces: remapPieces(other.pieces, savedCut, cut) });
        }
      }
      // This one: on to the clip just written, under that clip's name.
      const id = voiceClip === out.file ? voId : voId === voiceId(voiceClip) ? voiceId(out.file) : voiceId(`${stem(out.file)} ${voId}`);
      if (cur.vo.takes.length) {
        const moved: VoiceOver = { ...cur.vo, id, clip: out.file };
        await api.saveVoice(moved);
        savedVoice.current = JSON.stringify(moved);
        // Recorded over the recording itself, before there was a cut: that was only ever the draft of this.
        if (id !== voId && voiceClip === source.file) await api.deleteVoice(voId, true).catch(() => {});
      } else savedVoice.current = "";
      setSnap({ ...cur, vo: { ...cur.vo, id, clip: out.file } });
      setVoId(id);
      setVoiceClip(out.file);
      setSavedCut(cut);
      setRecut(out);
      setTouched(false);
      setSaveState("saved");
      setVoices(await api.voices());
      setMsg(`✔ saved ${out.file} (${fmtSeconds(out.facts.seconds)})`);
      // The address follows the clip, so a reload opens this edit; no hashchange, so nothing reloads now.
      window.history.replaceState(null, "", `#${game.id}/clean/${encodeURIComponent(source.file)}?from=${encodeURIComponent(out.file)}${id !== voiceId(out.file) ? `&vo=${encodeURIComponent(id)}` : ""}`);
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // ── the timeline ──
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLaneWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);
  // The wheel zooms, about the point under the cursor; a sideways swipe scrolls.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const x = e.clientX - el.getBoundingClientRect().left;
      const frac = (el.scrollLeft + x) / Math.max(1, el.scrollWidth);
      const next = Math.max(1, Math.min(maxZoom, zoomRef.current * Math.exp(-e.deltaY * 0.004)));
      if (next === zoomRef.current) return;
      keepUnder.current = { frac, x };
      zoomRef.current = next;
      setZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ready, maxZoom]);
  useLayoutEffect(() => {
    const el = scroller.current;
    const k = keepUnder.current;
    keepUnder.current = null;
    zoomRef.current = zoom;
    if (el && k) el.scrollLeft = k.frac * el.scrollWidth - k.x;
  }, [zoom]);
  // Something the browser couldn't play: say so rather than go quiet.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onError = (e: Event) => {
      const m = e.target as HTMLMediaElement;
      if (!(m instanceof HTMLMediaElement) || !m.error) return;
      const what = decodeURIComponent((m.currentSrc || m.src).split("/").pop()?.split("#")[0] ?? "a file");
      setMsg(`✖ The browser couldn't play ${what} (${m.error.message || `media error ${m.error.code}`}). Reload the page; if it keeps happening, tell me which browser.`);
    };
    el.addEventListener("error", onError, true);
    return () => el.removeEventListener("error", onError, true);
  }, [ready]);
  const timeAtX = (clientX: number) => {
    const r = lane.current!.getBoundingClientRect();
    return Math.max(0, Math.min(total, ((clientX - r.left) / r.width) * total));
  };
  // Playing: keep the playhead in sight.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing || zoom === 1) return;
    const x = t * pxPerSec;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 80) el.scrollLeft = Math.max(0, x - 120);
  }, [t, playing, zoom, pxPerSec]);

  const idle = () => recRef.current.state === "idle" && !busy;
  const onLaneDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !idle()) return;
    // Hold and drag to run the playhead along the clip.
    scrub.current = true;
    pause();
    seek(timeAtX(e.clientX));
    setPicked(null);
    setEditing(null);
    setMenu(null);
  };
  const onFootageDown = (index: number) => (e: React.MouseEvent) => {
    if (e.button !== 0 || !idle()) return;
    e.stopPropagation();
    scrub.current = true;
    pause();
    seek(timeAtX(e.clientX));
    setPicked({ footage: index });
    setRow("footage");
    setEditing(null);
    setMenu(null);
  };
  const onEdgeDown = (k: number) => (e: React.MouseEvent) => {
    if (e.button !== 0 || !idle() || !snapRef.current) return;
    e.stopPropagation();
    pause();
    drag.current = { on: "footage", k, x0: e.clientX, cut0: snapRef.current.track.cuts[k]!, px: pxPerSec, base: snapRef.current, moved: false };
    setRow("footage");
    setMenu(null);
  };
  const onPieceDown = (index: number, kind: "move" | "start" | "end") => (e: React.MouseEvent) => {
    if (e.button !== 0 || !idle() || !snapRef.current) return;
    e.stopPropagation();
    const p = snapRef.current.vo.pieces[index]!;
    drag.current = { on: "voice", kind, index, x0: e.clientX, at0: p.at, end0: pieceEnd(p), base: snapRef.current, moved: false };
    setPicked({ piece: index });
    setRow("voice");
    setEditing(null);
    setMenu(null);
    if (kind === "move") {
      pause();
      seek(timeAtX(e.clientX));
    }
  };
  const onMenu = (which: Row) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (!idle()) return;
    const at = timeAtX(e.clientX);
    seek(at);
    setRow(which);
    if (which === "footage") {
      const b = footage.blocks.find((x) => at >= x.out && at < x.end);
      setPicked(b ? { footage: b.index } : null);
    } else {
      const i = pieceAt(pieces, at);
      setPicked(i >= 0 ? { piece: i } : null);
    }
    setMenu({ x: e.clientX, y: e.clientY, row: which });
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (scrub.current && lane.current) return seek(timeAtX(e.clientX));
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x0;
      if (!d.moved && Math.abs(dx) < 3) return;
      d.moved = true;
      if (d.on === "footage") {
        // An edge of the footage: more of the recording, or less. Everything after it follows.
        const cuts = d.base.track.cuts;
        const lo = (cuts[d.k - 1] ?? 0) + 0.1;
        const hi = (cuts[d.k + 1] ?? srcTotal) - 0.1;
        const at = Math.max(lo, Math.min(hi, d.cut0 + dx / d.px));
        const track = { ...d.base.track, cuts: cuts.map((c, i) => (i === d.k ? at : c)) };
        const was = cutOf(d.base.track, srcTotal, d.base.slide);
        const now = cutOf(track, srcTotal, d.base.slide);
        const cur = snapRef.current ?? d.base;
        setSnap({ ...cur, track, vo: { ...cur.vo, pieces: remapPieces(d.base.vo.pieces, was, now) } });
        // Show the frame the edge now lands on.
        const kept = piecesOf(track, srcTotal);
        seek(toOutput(now, kept[d.k]?.kept ? Math.max(0, at - 1 / FPS) : at), cutSeconds(now));
        return;
      }
      const dt = dx / pxPerSec;
      const base = d.base.vo;
      const next = d.kind === "move" ? movePiece(base.pieces, d.index, d.at0 + dt) : d.kind === "start" ? trimStart(base.pieces, d.index, d.at0 + dt) : trimEnd(base.pieces, d.index, d.end0 + dt, base.takes[base.pieces[d.index]!.take]?.seconds ?? 0);
      const cur = snapRef.current ?? d.base;
      setSnap({ ...cur, vo: { ...cur.vo, pieces: next } });
      const p = next[d.index]!;
      seek(d.kind === "end" ? pieceEnd(p) : p.at);
    };
    const up = () => {
      scrub.current = false;
      const d = drag.current;
      drag.current = null;
      if (!d?.moved) return;
      history.current.push(d.base);
      if (d.on === "footage") setTouched(true);
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
    return () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerSec, seek, setSnap, srcTotal, total, FPS]);

  // Keys: space play/pause · R record/stop · S split (⌥S: voice between words) · Delete · ⌘Z · ← → nudge
  useEffect(() => {
    // Typing somewhere: the keys are the field's. A tick box or a button that
    // happens to have the focus is not typing, and mustn't swallow the space bar.
    const typing = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n?.tagName) return false;
      if (n.tagName === "TEXTAREA" || n.tagName === "SELECT") return true;
      return n.tagName === "INPUT" && !["checkbox", "radio", "button", "file", "range"].includes((n as HTMLInputElement).type);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // A focused button or tick box acts on the space bar's release.
      if (e.key === " " && !typing(e.target)) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || busy) return;
      const r = recRef.current.state;
      if (r === "on" || r === "count") {
        if (e.key === " " || e.key === "r" || e.key === "R" || e.key === "Escape") {
          e.preventDefault();
          void stopRecording();
        }
        return;
      }
      if (r !== "idle") return;
      if (e.key === "Escape") setMenu(null);
      else if (e.key === " ") {
        e.preventDefault();
        playing ? pause() : play();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      } else if (e.metaKey || e.ctrlKey) return;
      else if (e.key === "r" || e.key === "R") void startRecording();
      else if (e.code === "KeyS") split(e.altKey);
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        seek(t + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / FPS));
      }
    };
    addEventListener("keydown", onKey);
    addEventListener("keyup", onKeyUp);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("keyup", onKeyUp);
    };
  });

  const words: PlacedWord[] = useMemo(() => (vo ? placedWords(vo, vo.pieces, { hidden: true }) : []), [vo]);
  // Zoomed out, the words are closer together than they are wide: label the ones there's room for and mark the rest.
  const roomy = useMemo(() => {
    const out = new Set<string>();
    let right = -Infinity;
    for (const w of words) {
      const x = w.start * pxPerSec;
      if (x < right + 4) continue;
      out.add(`${w.piece}:${w.index}`);
      right = x + w.text.length * 7.4 + 10;
    }
    return out;
  }, [words, pxPerSec]);
  const mine = useMemo(() => voices.filter((v) => v.clip === voiceClip), [voices, voiceClip]);
  const stripFrames = Math.max(24, Math.min(96, Math.ceil(srcTotal / 0.75)));
  // Zoomed in, the coarse strip stretches one picture over seconds of footage and you split by a stale frame.
  // Ask for one frame per thumbnail's width (in doubling steps, so the wheel doesn't refetch every tick),
  // layered over the coarse strip so something shows while it's made.
  const aspect = source ? (source.facts.width || 9) / (source.facts.height || 16) : 9 / 16;
  const wantFrames = Math.ceil((srcTotal * pxPerSec) / (ROW.clip * aspect));
  const denseFrames = Math.min(1024, 2 ** Math.ceil(Math.log2(Math.max(1, wantFrames))));
  const stripImage = source ? [...(denseFrames > stripFrames ? [denseFrames] : []), stripFrames].map((n) => `url("${api.clipStrip(source.file, n)}")`).join(", ") : undefined;

  if (preview === null) return <div className="panel muted">This game's templates can't preview an edit yet: its desk.templates.ts needs a VOICE_PREVIEW.</div>;
  if (!source || !snap || !vo || !inputProps || !preview) return <div className="muted">{msg || "loading…"}</div>;

  const recording = rec.state !== "idle";
  const locked = recording || busy;
  const pct = (s: number) => `${(s / total) * 100}%`;
  const spoken = pieces.reduce((s, p) => s + pieceSeconds(p), 0);
  const taken = srcTotal - cut.segments.reduce((s, x) => s + (x.end - x.start), 0);
  const tickEvery = pxPerSec > 160 ? 0.5 : pxPerSec > 70 ? 1 : pxPerSec > 30 ? 2 : pxPerSec > 12 ? 5 : 10;
  const ticks = Array.from({ length: Math.floor(total / tickEvery) + 1 }, (_, i) => i * tickEvery);
  const pickedTake = picked && "piece" in picked ? pieces[picked.piece]?.take : picked && "take" in picked ? picked.take : undefined;
  const pickedFootage = picked && "footage" in picked ? picked.footage : null;
  const pickedVoice = picked && "piece" in picked ? picked.piece : null;
  const pickedWord = picked && "word" in picked ? picked : null;
  const made = Boolean(recut) && !touched; // the clip file is this edit
  const openVoice = (id?: string) => go({ name: "clean", file: source.file, from: recut?.file, vo: id });

  return (
    <div className="stack" style={{ gap: 18 }} onClick={() => setMenu(null)}>
      <div className="row between">
        <div>
          <h2>{recut ? "Edit" : "Edit a recording"}</h2>
          <div className="muted small">
            {source.file} · {fmtSeconds(srcTotal)} · {source.facts.width}×{source.facts.height}
            {recut ? (
              <>
                {" "}
                · your clip <b>{stem(recut.file)}</b>
              </>
            ) : null}
            {" · "}
            plays {fmtSeconds(total)}
            {taken > 0.05 ? `, ${fmtSeconds(taken)} taken out` : ""}
            {pieces.length ? ` · ${fmtSeconds(spoken)} of voice` : ""}
            {saveState === "saving" ? " · saving the voice…" : saveState === "failed" ? " · ✖ couldn't save the voice" : ""}
          </div>
        </div>
        <div className="row">
          {mine.length > 1 || (mine.length === 1 && mine[0]!.id !== voId) ? (
            <select value={voId} onChange={(e) => openVoice(e.target.value === voiceId(voiceClip) ? undefined : e.target.value)} style={{ width: "auto" }} title="The voice-overs recorded over this clip">
              {[...new Set([voId, ...mine.map((v) => v.id)])].map((v) => (
                <option key={v} value={v}>
                  voice: {v}
                </option>
              ))}
            </select>
          ) : null}
          {naming === null ? (
            pieces.length ? (
              <button className="ghost small" onClick={() => setNaming("")} title="A second script for the same clip, to test against this one">
                + Another voice-over
              </button>
            ) : null
          ) : (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (naming.trim()) openVoice(voiceId(naming));
              }}
            >
              <input type="text" autoFocus placeholder="name it" value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNaming(null)} style={{ width: 180 }} />
              <button className="small" disabled={!naming.trim()}>
                Start it
              </button>
            </form>
          )}
          <button className="ghost" onClick={() => go({ name: "clips" })}>
            ‹ Clips
          </button>
          <button className={made ? "" : "ghost"} disabled={locked} onClick={() => go({ name: "make", file: voiceClip })} title={touched ? "Make plays the clip as it was last saved. Save first to take these footage changes with you." : undefined}>
            Make a video ›
          </button>
        </div>
      </div>

      <div className="edit-top">
        <div className="preview">
          <div ref={stage} style={{ position: "relative", width: "min(100%, 300px)", containerType: "inline-size" }} onClick={(e) => !locked && (playing ? pause() : play(e))}>
            <Player ref={player} component={preview.component} inputProps={inputProps} durationInFrames={frames} fps={FPS} compositionWidth={1080} compositionHeight={1920} style={{ width: "100%", aspectRatio: "1080 / 1920" }} />
            {overlay ? <TikTokOverlay /> : null}
            {rec.state === "count" ? <div className="countin">{rec.n}</div> : null}
            {rec.state === "on" ? <div className="recdot">● REC {fmtSeconds(Math.max(0, t - rec.at))}</div> : null}
          </div>
          <div className="small muted" style={{ textAlign: "center" }}>
            The edit as it stands, cuts included.
          </div>
        </div>

        <div className="edit-panels">
          <div className="panel stack">
            <h3>Record</h3>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              {micOn ? (
                <select
                  value={device}
                  style={{ width: 220, flexShrink: 0 }}
                  disabled={locked}
                  onChange={(e) => {
                    setDevice(e.target.value);
                    void turnMicOn(e.target.value);
                  }}
                >
                  {mics.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              ) : (
                <button className="ghost" onClick={() => void turnMicOn()}>
                  Turn the mic on
                </button>
              )}
              <div className="meter" title="Talk normally: aim for the bar to sit in the green and touch amber on loud words. Red is too hot: back off the mic or turn its gain down.">
                <div ref={meter} />
              </div>
              <span ref={meterText} className="small muted mono" style={{ width: 56, flexShrink: 0 }}>
                {micOn ? "" : "mic off"}
              </span>
            </div>
            <div className="row">
              {rec.state === "on" || rec.state === "count" ? (
                <button className="recbtn on" onClick={() => void stopRecording()} title="R or space">
                  ■ Stop
                </button>
              ) : (
                <button className="recbtn" disabled={locked} onClick={() => void startRecording()} title="R">
                  ● Record
                </button>
              )}
              <span className="small muted">
                {rec.state === "saving" ? "saving the take…" : rec.state === "words" ? "writing the captions…" : rec.state === "on" ? `recording: the clip is playing${clipSound ? "" : " silently"}, talk over it` : `starts at the playhead (${fmtSeconds(t)}) after a 3-2-1`}
              </span>
            </div>
            <div className="field inline">
              <input
                id="edit-clip-sound"
                type="checkbox"
                checked={clipSound}
                disabled={locked}
                onChange={(e) => {
                  setClipSound(e.target.checked);
                  remember("clip", e.target.checked ? "on" : "off");
                }}
              />
              <label htmlFor="edit-clip-sound" title="Off: the clip is silent on this screen, and nothing at all plays while you record. On: you hear the clip and your earlier takes while you record, so wear headphones or the mic hears them too. This screen only: it changes nothing in the clip or the video.">
                Play the clip's own sound <span className="muted">(while recording too: headphones on)</span>
              </label>
            </div>
            <div className="field inline">
              <input id="edit-tidy" type="checkbox" checked={vo.tidy} disabled={locked} onChange={(e) => void setSound({ tidy: e.target.checked })} />
              <label htmlFor="edit-tidy" title="Takes out the rumble below your voice and brings every take to the same loudness. The untouched recording is kept, so this can be flipped later.">
                Tidy the sound
              </label>
            </div>
            <div className="field">
              <label title="Turns down what's in the room when you're not speaking: hum, rumble, hiss, a fan. Your voice is left as it is. Learnt from the pauses in each take. The untouched recording is kept, so try each and listen.">Background noise</label>
              <div className="row" style={{ gap: 6 }}>
                {NOISE_LEVELS.map((n) => (
                  <button key={n.level} className={`small ${(vo.denoise ?? 0) === n.level ? "" : "ghost"}`} disabled={locked} onClick={() => void setSound({ denoise: n.level })} title={n.level ? `Cuts the rumble, and turns the rest of the room down by ${n.reduce} dB` : "The takes as they are"}>
                    {n.level ? `${n.label}` : "Leave it"}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="edit-volume" title="How loud your voice is against the clip and the music, in every video made with this voice-over. A video can turn it down further (voiceVolume in Make).">
                Voice level · {Math.round((vo.volume ?? 1) * 100)}%{(vo.volume ?? 1) < 1 ? ` (${(20 * Math.log10(vo.volume ?? 1)).toFixed(1)} dB)` : ""}
              </label>
              <input id="edit-volume" type="range" min={0.1} max={1} step={0.05} value={vo.volume ?? 1} disabled={recording} onChange={(e) => setVolume(Number(e.target.value))} />
            </div>
            <div className="row small muted" style={{ gap: 14 }}>
              <label style={{ cursor: locked ? "default" : "pointer" }}>
                <span style={{ textDecoration: "underline" }}>Add a recording from a file</span>
                <input
                  type="file"
                  accept="audio/*,.wav,.m4a,.mp3,.aiff,.aif"
                  disabled={locked}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void addFile(f);
                  }}
                />
              </label>
              {vo.takes.length ? (
                <>
                  <button className="link small" disabled={locked} onClick={() => void backup()} title="The recordings only exist on this Mac until you do">
                    Back them up to Drive
                  </button>
                  <button className="link small" disabled={locked} onClick={() => void binVoice()}>
                    Bin this voice-over
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className="panel stack">
            <h3>Captions</h3>
            <div className="row">
              {(["tiktok", "regular", "off"] as CaptionStyle[]).map((s) => (
                <button
                  key={s}
                  className={`small ${style === s ? "" : "ghost"}`}
                  onClick={() => {
                    setStyle(s);
                    remember("captions", s);
                  }}
                >
                  {s === "tiktok" ? "TikTok style" : s === "regular" ? "Regular" : "Off"}
                </button>
              ))}
            </div>
            <div className="small muted">For this preview. Each video picks its own in Make.</div>
            {whisper && !whisper.ready ? (
              <div className="small warn">
                {whisper.installing ? (
                  <>Setting Whisper up: {whisper.step === "downloading" ? `downloading the model, ${Math.round((whisper.progress ?? 0) * 100)}%` : "building it (a minute or two)"}…</>
                ) : (
                  <>
                    Captions need Whisper, which isn't set up on this Mac yet (a one-off 1.6 GB download; needs <code>brew install cmake</code>).{" "}
                    <button className="small ghost" onClick={() => void api.installWhisper().then(setWhisper)}>
                      Set it up
                    </button>
                    {whisper.error ? <div>✖ {whisper.error}</div> : null}
                  </>
                )}
              </div>
            ) : null}
            <div className="row">
              <div className="field" style={{ width: 120 }}>
                <label title="Shifts every caption later (+) or earlier (−)">Nudge (ms)</label>
                <input type="number" step={10} value={vo.captionNudgeMs} onChange={(e) => setVo({ ...vo, captionNudgeMs: Math.max(-1000, Math.min(1000, Number(e.target.value) || 0)) }, true)} />
              </div>
              <div className="field inline" style={{ alignSelf: "flex-end", paddingBottom: 8 }}>
                <input
                  id="edit-overlay"
                  type="checkbox"
                  checked={overlay}
                  onChange={(e) => {
                    setOverlay(e.target.checked);
                    remember("overlay", e.target.checked ? "on" : "off");
                  }}
                />
                <label htmlFor="edit-overlay">Show what TikTok covers</label>
              </div>
            </div>
            {pickedTake !== undefined && whisper?.ready ? (
              <div>
                <button className="small ghost" disabled={locked} onClick={() => void again(pickedTake)} title="Runs Whisper over the selected take again. Words you've fixed are kept if it hears the same number of words.">
                  Listen to this take again
                </button>
              </div>
            ) : null}
          </div>

          <div className="panel stack">
            <h3>The frame</h3>
            <div className="field">
              <label>Shave the top (status bar) · {(cropTop * 100).toFixed(1)}%</label>
              <input
                type="range"
                min={0}
                max={0.2}
                step={0.005}
                value={cropTop}
                disabled={locked}
                onChange={(e) => {
                  setCropTop(Number(e.target.value));
                  setTouched(true);
                }}
              />
            </div>
            <div className="field">
              <label>Shave the bottom (nav bar) · {(cropBottom * 100).toFixed(1)}%</label>
              <input
                type="range"
                min={0}
                max={0.2}
                step={0.005}
                value={cropBottom}
                disabled={locked}
                onChange={(e) => {
                  setCropBottom(Number(e.target.value));
                  setTouched(true);
                }}
              />
            </div>
            <div className="row">
              <div className="field inline">
                <input
                  id="edit-muted"
                  type="checkbox"
                  checked={muted}
                  disabled={locked}
                  onChange={(e) => {
                    setMuted(e.target.checked);
                    setTouched(true);
                  }}
                />
                <label htmlFor="edit-muted" title="The clip is saved without its sound, for good. To only silence it on this screen, use Play the clip's own sound.">
                  Drop the clip's audio
                </label>
              </div>
              {cut.segments.length > 1 ? (
                <div className="field inline" style={{ gap: 8 }}>
                  <input type="number" step={0.1} min={0.1} max={2} value={snap.slide} disabled={locked} style={{ width: 76, order: 2 }} onChange={(e) => setSlide(Number(e.target.value))} />
                  <label style={{ order: 1 }} title={`${cut.segments.length - 1} join${cut.segments.length === 2 ? "" : "s"}, each a slide left`}>
                    Slide over (s)
                  </label>
                </div>
              ) : null}
            </div>
          </div>

          <div className="panel stack">
            <h3>Save the clip</h3>
            <div className="field">
              <label>{recut ? "Clip name" : "New clip name"}</label>
              <input type="text" value={name} disabled={locked} onChange={(e) => setName(e.target.value)} />
              <div className="hint">{replacing ? "Same name: saves over that clip. Change the name to keep both." : "Saved as a new file next to the recording; the recording stays."}</div>
            </div>
            <div className="field">
              <label>Note (what happens in it, for you)</label>
              <textarea value={note} disabled={locked} style={{ minHeight: 46 }} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="row">
              <button disabled={locked || !name.trim()} className={made && replacing ? "ghost" : ""} onClick={() => void save()}>
                {busy ? "Cutting…" : replacing ? "Save over the clip" : "Save as new clip"}
              </button>
              <span className="small muted">{touched ? "The footage has changed since the clip was saved." : recut ? "The clip is up to date. The voice and the words save themselves." : "Not a clip yet. The voice and the words save themselves."}</span>
            </div>
          </div>
          {msg ? <div className="small warn edit-msg">{msg}</div> : null}
        </div>
      </div>

      {/* ── the timeline ── */}
      <div className="panel stack">
        <div className="row between">
          <div className="row">
            <button className="small" disabled={locked} onClick={(e) => (playing ? pause() : play(e))}>
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <button className="small ghost" disabled={locked || (row === "voice" && pieceAt(pieces, t) < 0)} onClick={() => split()} title="S. Splits the row you last clicked in. Exactly at the playhead (⌥S on the voice: the nearest gap between words).">
              Split the {row} at the playhead
            </button>
            <button className="small ghost" disabled={locked || !picked} onClick={remove} title="Delete">
              {pickedWord ? (vo.takes[pickedWord.take]?.words[pickedWord.word]?.hidden ? "Show word" : "Hide word") : pickedVoice !== null ? "Delete voice" : pickedFootage !== null ? "Delete footage" : "Delete"}
            </button>
            <button className="small ghost" disabled={locked || !history.current.length} onClick={undo} title="⌘Z">
              Undo
            </button>
            {snap.track.cuts.length || snap.track.removed.length ? (
              <button className="small ghost" disabled={locked} onClick={() => recutTo({ cuts: [], removed: [] })} title="Every piece of footage back, every split gone. The voice goes back with it.">
                Footage: start over
              </button>
            ) : null}
          </div>
          <div className="row">
            <span className="small muted mono">
              {fmtSeconds(t)} / {fmtSeconds(total)}
            </span>
            <span className="small muted">zoom</span>
            <input type="range" min={0} max={1} step={0.005} value={Math.log(zoom) / Math.log(maxZoom)} onChange={(e) => setZoom(Math.pow(maxZoom, Number(e.target.value)))} style={{ width: 140 }} title="Or turn the scroll wheel over the timeline" />
          </div>
        </div>
        <div className="vtl">
          <div className="vtl-names">
            <div style={{ height: ROW.ruler }} />
            <div style={{ height: ROW.clip }} className={row === "footage" ? "on" : ""}>
              clip
            </div>
            <div style={{ height: ROW.voice }} className={row === "voice" ? "on" : ""}>
              voice
            </div>
            <div style={{ height: ROW.words }}>words</div>
          </div>
          <div className="vtl-scroll" ref={scroller}>
            <div className="vtl-lane" ref={lane} style={{ width: `${zoom * 100}%` }} onMouseDown={onLaneDown}>
              <div className="vruler" style={{ height: ROW.ruler }}>
                {ticks.map((s) => (
                  <span key={s} style={{ left: pct(s) }}>
                    {s % 1 ? s.toFixed(1) : s}s
                  </span>
                ))}
              </div>
              <div className="vrow clip" style={{ height: ROW.clip }} onContextMenu={onMenu("footage")}>
                {footage.blocks.map((b) => {
                  const p = srcPieces[b.index]!;
                  return (
                    <div
                      key={b.index}
                      className={`fpiece${pickedFootage === b.index ? " on" : ""}`}
                      style={{
                        left: pct(b.out),
                        width: pct(b.end - b.out),
                        backgroundImage: stripImage,
                        backgroundSize: `${srcTotal * pxPerSec}px 100%`,
                        backgroundPosition: `${-p.start * pxPerSec}px 0`,
                      }}
                      title={`${fmtSeconds(p.start)} → ${fmtSeconds(p.end)} of the recording`}
                      onMouseDown={onFootageDown(b.index)}
                    />
                  );
                })}
                {footage.edges.map((e) => (
                  <div key={`e${e.k}`} className={`fedge ${e.side}`} style={{ left: pct(e.at) }} onMouseDown={onEdgeDown(e.k)} title={e.side === "split" ? "A split. Click a piece either side of it and press Delete." : e.side === "before" ? "Drag: more of the footage before the cut, or less" : "Drag: more of the footage after the cut, or less"} />
                ))}
                {footage.markers.map((m) => (
                  <button
                    key={`m${m.pieces[0]}`}
                    className="fgone"
                    style={{ left: pct(m.at) }}
                    disabled={locked}
                    title={`${fmtSeconds(m.seconds)} taken out here. Click to put it back.`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      restoreFootage(m.pieces);
                    }}
                  />
                ))}
              </div>
              <div className="vrow voice" style={{ height: ROW.voice }} onContextMenu={onMenu("voice")}>
                {pieces.map((p, i) => {
                  const over = pieceEnd(p) > total + 0.01;
                  return (
                    <div
                      key={`${p.take}:${p.start}`}
                      className={`vpiece${pickedVoice === i ? " on" : ""}${over ? " over" : ""}`}
                      style={{ left: pct(p.at), width: pct(pieceSeconds(p)) }}
                      title={`${fmtSeconds(p.at)} → ${fmtSeconds(pieceEnd(p))}${over ? " · runs past the end of the clip: that part won't be heard" : ""}`}
                      onMouseDown={onPieceDown(i, "move")}
                    >
                      <Wave peaks={peaks[vo.takes[p.take]?.file ?? ""]} start={p.start} end={p.end} width={pieceSeconds(p) * pxPerSec} height={ROW.voice - 4} />
                      <div className="edge l" onMouseDown={onPieceDown(i, "start")} />
                      <div className="edge r" onMouseDown={onPieceDown(i, "end")} />
                      {over ? <div className="hang" style={{ width: `${Math.min(100, ((pieceEnd(p) - total) / pieceSeconds(p)) * 100)}%` }} /> : null}
                    </div>
                  );
                })}
                {rec.state === "on" ? <div className="vrec" style={{ left: pct(rec.at), width: pct(Math.max(0, t - rec.at)) }} /> : null}
                {!pieces.length && rec.state === "idle" ? <div className="vempty">Nothing said yet. Put the playhead where you want to start talking and press Record.</div> : null}
              </div>
              <div className="vrow words" style={{ height: ROW.words }}>
                {words.map((w) => {
                  const on = pickedWord !== null && pickedWord.take === w.take && pickedWord.word === w.index;
                  const edit = editing && editing.take === w.take && editing.word === w.index ? editing : null;
                  return edit ? (
                    <input
                      key={`${w.piece}:${w.index}`}
                      className="vword-edit"
                      autoFocus
                      style={{ left: pct(w.start), width: Math.max(70, edit.text.length * 8 + 24) }}
                      value={edit.text}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) => setEditing({ ...edit, text: e.target.value })}
                      onBlur={() => retype(w.take, w.index, edit.text)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") retype(w.take, w.index, edit.text);
                        else if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <span
                      key={`${w.piece}:${w.index}`}
                      className={`vword${on ? " on" : ""}${w.hidden ? " hidden" : ""}${t >= w.start && t < w.end ? " now" : ""}${roomy.has(`${w.piece}:${w.index}`) ? "" : " tick"}`}
                      style={{ left: pct(w.start) }}
                      title={`${w.text}${w.hidden ? " (kept off the captions)" : ""} · double-click to fix it`}
                      onMouseDown={(e) => {
                        if (locked) return;
                        e.stopPropagation();
                        setPicked({ take: w.take, word: w.index });
                        setRow("voice");
                        seek(w.start);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditing({ take: w.take, word: w.index, text: w.text });
                      }}
                    >
                      {w.text}
                    </span>
                  );
                })}
                {pieces.length && !words.length ? <div className="vempty">{rec.state === "words" ? "Listening…" : whisper?.ready === false ? "No captions: Whisper isn't set up." : "No words heard in these takes."}</div> : null}
              </div>
              <div className="vhead" style={{ left: pct(t) }} />
            </div>
          </div>
        </div>
        <div className="small muted">
          Click or drag along the timeline to move the playhead · the scroll wheel zooms · <b>S</b> splits the row you last clicked in, <b>Delete</b> drops the piece you clicked · footage you drop closes up and leaves a hatched marker: click it to put the footage back, drag the edges beside it to take off more or less · the voice stays over its footage · <b>R</b> records from the playhead · drag a piece of voice to move it, its edges to trim · double-click a word to fix it · <b>⌘Z</b> undoes.
        </div>
      </div>

      {menu ? (
        <div className="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              menu.row === "voice" ? splitVoice() : splitFootage();
              setMenu(null);
            }}
          >
            Split the {menu.row} here
          </button>
          {picked && ("footage" in picked || "piece" in picked) ? (
            <button
              onClick={() => {
                remove();
                setMenu(null);
              }}
            >
              Delete this piece
            </button>
          ) : null}
          <button
            onClick={() => {
              undo();
              setMenu(null);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>
  );
};
