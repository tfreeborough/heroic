import { Player, type PlayerRef } from "@remotion/player";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AudioClip,
  type CaptionStyle,
  type Card,
  type Clip,
  type PlacedWord,
  type Sequence,
  type Take,
  addAudioTrack,
  addMarker,
  addVideoTrack,
  appendAt,
  audioAt,
  audioPieces,
  cardOf,
  clipEnd,
  clipOf,
  clipOfTake,
  cropBox,
  findAudio,
  findCard,
  findClip,
  placeAudio,
  placeCard,
  placeVideo,
  placedWords,
  removeAudio,
  removeCards,
  removeMarker,
  removeVideo,
  sequenceSeconds,
  setMusic,
  snapToGap,
  splitAudioAt,
  splitCardAt,
  splitVideoAt,
  stackIntervals,
  timeTrack,
  updateAudio,
  updateAudioTrack,
  updateCard,
  updateVideo,
  updateVideoTrack,
} from "@heroic/voiceover";
import type { VoicePreview } from "../../game";
import { type Clip as LibraryClip, type GameApi, type GameInfo, type SavedSequence, type Script, type ScriptSummary, type WhisperStatus, fmtSeconds } from "../api";
import { go } from "../App";
import { sketchesOf } from "../../lib/scripts";
import { loadTemplates, loadVoicePreview } from "../games";
import { type Mic, type MicDevice, listMics, micPermission, micSupported, openMic, peaksOf } from "../mic";
import { TikTokOverlay } from "../TikTokOverlay";
import { Library, type Sketch } from "./Library";
import { AudioClipPanel, CaptionsPanel, CardPanel, EditPanel, MusicPanel, ScriptPanel, VideoClipPanel, VoicePanel } from "./panels";
import { type Context, type Focus, type Kind, type Picked, type RecState, Timeline } from "./Timeline";
import { remember } from "./widgets";

/**
 * The sequence editor, laid out like a cutting room: the library (the
 * game's recordings, the edit's takes) down the left, the preview of the
 * edit as it renders in the middle, the inspector (what's selected, the
 * voice, captions, music, script, the edit itself) down the right, and the
 * tracks across the bottom, the whole window tall.
 * Design: docs/design/desk-sequence-editor.md.
 *
 * Every clip sits at its own time. Click to pick, shift-click to pick
 * several, drag to move (together), drag edges to trim, S splits the
 * focused track at the playhead, Delete takes the selection out and leaves
 * the gap, M drops a marker, R records from the playhead onto the focused
 * audio track, N turns snapping off and on, ⌘Z undoes. Everything saves
 * itself. Templates play the edit's file directly, so there is nothing to
 * encode.
 */

/**
 * The old address (`#<game>/clean/<file>?from=<cut>`, the Clips screen's
 * Edit): find or start the edit for that clip, then open it.
 */
export const OpenEdit: React.FC<{ api: GameApi; file: string; from?: string; fresh?: boolean }> = ({ api, file, from, fresh }) => {
  const [msg, setMsg] = useState("opening the edit…");
  useEffect(() => {
    let alive = true;
    api
      .sequenceFrom({ file, from, fresh })
      .then((s) => alive && go({ name: "edit", id: s.id }, true))
      .catch((e) => alive && setMsg(`✖ ${(e as Error).message}`));
    return () => {
      alive = false;
    };
  }, [api, file, from, fresh]);
  return <div className="muted">{msg}</div>;
};

/** Seconds of empty lane after the end of the edit, to drag things into. */
const tailFor = (total: number) => Math.max(5, total * 0.25);

export type Tab = "clip" | "voice" | "captions" | "music" | "script" | "edit";
const TABS: { id: Tab; label: string }[] = [
  { id: "clip", label: "Clip" },
  { id: "voice", label: "Voice" },
  { id: "captions", label: "Captions" },
  { id: "music", label: "Music" },
  { id: "script", label: "Script" },
  { id: "edit", label: "Edit" },
];
const isTab = (s: string): s is Tab => TABS.some((t) => t.id === s);
/** The tracks' default height (px), and the least and most of the window they may take. */
const TRACKS_H = { start: 300, min: 160, maxFrac: 0.7 };

export const Editor: React.FC<{ game: GameInfo; api: GameApi; id: string }> = ({ game, api, id }) => {
  const FPS = game.fps;
  const [doc, setDoc] = useState<SavedSequence | null>(null);
  const [clips, setClips] = useState<LibraryClip[]>([]);
  const [preview, setPreview] = useState<VoicePreview | null | undefined>(undefined);
  const [songs, setSongs] = useState<{ value: string; label: string }[]>([]);
  const [snap, setSnapState] = useState<Sequence | null>(null);
  const snapRef = useRef<Sequence | null>(null);
  const history = useRef<Sequence[]>([]);
  const saved = useRef("");
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "failed">("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [idea, setIdea] = useState("");
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [script, setScript] = useState<Script | null>(null);
  // the screen
  const [picked, setPicked] = useState<Picked>({ clips: [] });
  const [focus, setFocus] = useState<Focus>({ kind: "video", track: 0 });
  const [editing, setEditing] = useState<{ take: number; word: number; text: string } | null>(null);
  const [menu, setMenu] = useState<Context | null>(null);
  const [tab, setTab] = useState<Tab>(() => (isTab(remember("tab")) ? (remember("tab") as Tab) : "clip"));
  const [snapOn, setSnapOn] = useState(() => remember("snap") !== "off");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  // The scale: pixels per second. Only zooming changes it, so moving a clip never moves anything else.
  const [laneWidth, setLaneWidth] = useState(0);
  const [pps, setPps] = useState<number | null>(null);
  const [tracksH, setTracksH] = useState(() => Math.max(TRACKS_H.min, Number(remember("tracks")) || TRACKS_H.start));
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const stageBox = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CaptionStyle>(() => (remember("captions") as CaptionStyle) || "tiktok");
  const [overlay, setOverlay] = useState(() => remember("overlay") !== "off");
  const [shape, setShape] = useState(() => (game.formats[remember("shape")] ? remember("shape") : "vertical"));
  const [clipSound, setClipSound] = useState(() => remember("clip") !== "off");
  const [frameMode, setFrameMode] = useState<"alone" | "stacked">("alone");
  const [msg, setMsg] = useState("");
  const [whisper, setWhisper] = useState<WhisperStatus | null>(null);
  const [busy, setBusy] = useState(false);
  // the mic
  const mic = useRef<Mic | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [device, setDevice] = useState(() => remember("mic"));
  const meter = useRef<HTMLDivElement>(null);
  const meterText = useRef<HTMLSpanElement>(null);
  const [rec, setRecState] = useState<RecState>({ state: "idle" });
  const recRef = useRef<RecState>({ state: "idle" });
  const sync = useRef<{ frame0: number; skip: number | null }>({ frame0: 0, skip: null });
  const setRec = (r: RecState) => {
    recRef.current = r;
    setRecState(r);
  };
  const player = useRef<PlayerRef>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<Record<string, Float32Array>>({});
  const asked = useRef(new Set<string>());
  const tRef = useRef(0);
  tRef.current = t;

  const seq = snap;
  const total = seq ? sequenceSeconds(seq) : 0;
  /** What the lane fits across the window at the widest zoom: the edit and room after it. */
  const fitSeconds = Math.max(10, total + tailFor(total));
  const laneSeconds = Math.max(fitSeconds, total + 2);
  // While recording the player must run on past the end: you may be talking first and finding footage later.
  const playSeconds = rec.state === "on" || rec.state === "count" ? Math.max(laneSeconds, rec.at + 1800) : laneSeconds;
  const frames = Math.max(1, Math.round(playSeconds * FPS));
  const maxZoom = Math.max(8, Math.min(80, (fitSeconds * 320) / 1000));
  const fitPps = laneWidth ? laneWidth / fitSeconds : 0;
  const ppsNow = pps ?? (fitPps || 40);
  const ppsRange: [number, number] = [Math.max(1, fitPps * 0.5), Math.max(2, fitPps * maxZoom)];
  /** The zoom slider's position, 0 = fit the window, 1 = as close as it goes. */
  const zoomPos = fitPps ? Math.max(0, Math.min(1, Math.log(ppsNow / fitPps) / Math.log(maxZoom))) : 0;
  const zoomTo = (pos: number) => fitPps && setPps(fitPps * Math.pow(maxZoom, Math.max(0, Math.min(1, pos))));
  useEffect(() => {
    if (pps === null && fitPps) setPps(fitPps);
  }, [pps, fitPps]);
  const pickTab = (next: Tab) => {
    setTab(next);
    remember("tab", next);
  };
  const toggleSnap = () => {
    setSnapOn((on) => {
      remember("snap", on ? "off" : "on");
      return !on;
    });
  };
  /** A click on the timeline picks something: the inspector turns to it. (Picks the editor makes itself, after a split or a take, leave the tab alone.) */
  const pickOnTimeline = useCallback((p: Picked) => {
    setPicked(p);
    if (p.clips.length || p.word) pickTab("clip");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSnap = useCallback((next: Sequence) => {
    snapRef.current = next;
    setSnapState(next);
  }, []);
  /** An edit you can undo. */
  const commit = useCallback(
    (next: Sequence) => {
      if (snapRef.current) history.current.push(snapRef.current);
      if (history.current.length > 200) history.current.shift();
      setSnap(next);
    },
    [setSnap],
  );
  /** Before a run of changes that should undo as one (a slider being dragged). */
  const checkpoint = () => {
    if (snapRef.current) history.current.push(snapRef.current);
  };
  const seek = useCallback(
    (to: number) => {
      const clamped = Math.max(0, to);
      player.current?.seekTo(Math.max(0, Math.round(clamped * FPS)));
      setT(clamped);
    },
    [FPS],
  );
  const undo = useCallback(() => {
    const prev = history.current.pop();
    const now = snapRef.current;
    if (!prev || !now) return;
    // Words that arrived after the snapshot was taken belong to the take, not the edit: keep them.
    setSnap({ ...prev, takes: prev.takes.map((tk) => (tk.transcribed ? tk : (now.takes.find((x) => x.file === tk.file) ?? tk))) });
    setPicked({ clips: [] });
  }, [setSnap]);

  // The editor fills the window: the page under it doesn't scroll.
  useEffect(() => {
    document.documentElement.dataset.screen = "edit";
    return () => {
      delete document.documentElement.dataset.screen;
    };
  }, []);
  // The preview fits the room it has, whatever the shape.
  useEffect(() => {
    const el = stageBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [preview, doc]);

  // ── load ──
  useEffect(() => {
    let alive = true;
    void loadVoicePreview(game.id).then((p) => alive && setPreview(p ?? null));
    void loadTemplates(game.id).then((ts) => alive && setSongs(ts.find((x) => x.options?.music)?.options?.music ?? []));
    void api.whisper().then((w) => alive && setWhisper(w)).catch(() => {});
    void api.clips().then((c) => alive && setClips(c));
    void api.scripts().then((r) => alive && setScripts(r.list)).catch(() => {});
    void api
      .sequence(id)
      .then((s) => {
        if (!alive) return;
        const { path: _p, seconds: _s, ...rest } = s;
        const last = { denoise: Number(remember("denoise")) || 0, volume: Number(remember("volume")) || 1 };
        // A fresh edit takes the noise setting and the level you last used.
        const voice = rest.takes.length ? rest.voice : { ...rest.voice, denoise: Math.max(0, Math.min(3, last.denoise)), ...(last.volume < 1 ? { volume: Math.max(0.1, last.volume) } : {}) };
        const full: Sequence = { ...rest, voice };
        setDoc(s);
        setName(s.name);
        setNote(s.note ?? "");
        setIdea(s.idea ?? "");
        saved.current = JSON.stringify(full);
        history.current = [];
        setSnap(full);
      })
      .catch((e) => alive && setMsg(`✖ ${(e as Error).message}`));
    return () => {
      alive = false;
    };
  }, [api, game.id, id, setSnap]);

  // The picked script's words, to read from.
  useEffect(() => {
    if (!idea) return setScript(null);
    let alive = true;
    void api.script(idea).then((x) => alive && setScript(x)).catch(() => alive && setScript(null));
    return () => {
      alive = false;
    };
  }, [api, idea]);

  // The edit saves itself, a moment after the last change.
  useEffect(() => {
    if (!seq || !doc) return;
    const onDisk: Sequence = { ...seq, id, name: name.trim() || doc.name, note: note || undefined, idea: idea || undefined };
    const body = JSON.stringify(onDisk);
    if (body === saved.current) return;
    setSaveState("saving");
    const timer = setTimeout(() => {
      api
        .saveSequence(onDisk)
        .then(() => {
          saved.current = body;
          setSaveState("saved");
        })
        .catch((e) => {
          setSaveState("failed");
          setMsg(`✖ ${(e as Error).message}`);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [seq, name, note, idea, doc, api, id]);

  // Waveforms, once per take.
  useEffect(() => {
    for (const tk of seq?.takes ?? []) {
      if (asked.current.has(tk.file)) continue;
      asked.current.add(tk.file);
      peaksOf(api.publicUrl(tk.file))
        .then((p) => setPeaks((cur) => ({ ...cur, [tk.file]: p })))
        .catch(() => {});
    }
  }, [seq?.takes, api]);

  // Whisper being installed: watch it.
  useEffect(() => {
    if (!whisper?.installing) return;
    const timer = setInterval(() => void api.whisper().then(setWhisper).catch(() => {}), 1500);
    return () => clearInterval(timer);
  }, [whisper?.installing, api]);

  // ── the player ──
  const inputProps = useMemo(() => {
    if (!doc || !preview || !seq) return null;
    return {
      ...preview.props(doc.path, playSeconds, { width: 1080, height: 1920, cropTop: 0, cropBottom: 0 }),
      sequenceData: seq,
      muted: !clipSound,
      captions: style,
      format: shape,
    };
  }, [doc, preview, seq, playSeconds, clipSound, style, shape]);
  const ready = Boolean(inputProps);

  /** `e` = the click that asked for it: browsers that ration sound (Safari) only let a page play what a gesture started. */
  const play = (e?: React.SyntheticEvent) => {
    const p = player.current;
    if (!p) return;
    if (p.getCurrentFrame() >= frames - 2) p.seekTo(0);
    p.unmute();
    p.play(e);
  };
  const pause = useCallback(() => player.current?.pause(), []);

  const hear = useCallback(
    async (take: Take) => {
      const w = await api.whisper().catch(() => null);
      if (w) setWhisper(w);
      if (!w?.ready) return;
      setRec({ state: "words" });
      const done = await api.transcribeTake(id, take);
      const now = snapRef.current;
      if (now) setSnap({ ...now, takes: now.takes.map((x) => (x.file === done.file ? { ...x, words: done.words, transcribed: true } : x)) });
    },
    [api, id, setSnap],
  );

  /** A new take onto an audio track at `at`: on the focused track if it's free there, else the first with room, else a new one. */
  const layDown = useCallback(
    (take: Take, at: number, track: number, skip = 0) => {
      const cur = snapRef.current;
      if (!cur) return;
      const index = cur.takes.length;
      const clip = clipOfTake(index, take.seconds, skip);
      const placed = placeAudio({ ...cur, takes: [...cur.takes, take] }, track, clip, at);
      commit(placed.seq);
      setPicked({ clips: [clip.id] });
      setFocus({ kind: "audio", track: placed.track });
      seek(at);
    },
    [commit, seek],
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
      const take = await api.addSequenceTake(id, out.wav, { tidy: snapRef.current.voice.tidy, denoise: snapRef.current.voice.denoise ?? 0 });
      layDown(take, r.at, r.track, Math.min(skip, 1));
      await hear(take);
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    } finally {
      setRec({ state: "idle" });
    }
  }, [api, id, layDown, hear]);

  useEffect(() => {
    const p = player.current;
    if (!p || !ready) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      setT(e.detail.frame / FPS);
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

  const recordTrack = () => (focus.kind === "audio" ? focus.track : 0);
  const startRecording = async () => {
    if (recRef.current.state !== "idle" || !snapRef.current) return;
    const m = mic.current ?? (await turnMicOn());
    if (!m || !player.current) return;
    pause();
    const at = tRef.current;
    const track = recordTrack();
    setMsg("");
    for (let n = 3; n >= 1; n--) {
      setRec({ state: "count", n, at, track });
      await new Promise((r) => setTimeout(r, 650));
      if ((recRef.current as RecState).state !== "count") return; // cancelled
    }
    const p = player.current;
    const frame0 = Math.round(at * FPS);
    sync.current = { frame0, skip: null };
    p.seekTo(frame0);
    // Silent clip = a silent room: nothing plays, earlier takes included, so the mic hears only you.
    if (clipSound) p.unmute();
    else p.mute();
    m.start();
    setRec({ state: "on", at, track });
    p.play();
  };

  const addAudioFile = async (f: File) => {
    if (!snapRef.current) return;
    setRec({ state: "saving" });
    setMsg("");
    try {
      const ext = /\.([a-z0-9]+)$/i.exec(f.name)?.[1] ?? "wav";
      const take = await api.addSequenceTake(id, f, { tidy: snapRef.current.voice.tidy, denoise: snapRef.current.voice.denoise ?? 0, ext });
      layDown(take, tRef.current, recordTrack());
      await hear(take);
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    } finally {
      setRec({ state: "idle" });
    }
  };

  // ── edits ──
  /** New footage on `track`: at `where`, or at the playhead (on the end of the track, overlapping by a slide, if the playhead is past it). */
  const addFootage = (file: string, track: number, where?: number) => {
    const cur = snapRef.current;
    const c = clips.find((x) => x.file === file);
    if (!cur || !c) return;
    const tr = cur.video[track] ?? { id: "", clips: [] };
    const at = where ?? appendAt(tr, tRef.current, cur.slide);
    const clip = clipOf(`${game.footagePublic}/${c.file}`, c.facts, { crop: cropBox(c.cropTop, c.cropBottom), muted: c.muted || track > 0, at });
    const next = placeVideo(cur, track, clip, at);
    commit(next);
    setPicked({ clips: [clip.id] });
    setFocus({ kind: "video", track });
    seek(findClip(next, clip.id)?.clip.at ?? at);
  };
  /** A take already in the edit, as a whole clip again, on `track` at `where` (or the playhead). */
  const addTake = (take: number, track: number, where?: number) => {
    const cur = snapRef.current;
    const tk = cur?.takes[take];
    if (!cur || !tk) return;
    const at = where ?? tRef.current;
    const clip = clipOfTake(take, tk.seconds);
    const placed = placeAudio(cur, track, clip, at);
    commit(placed.seq);
    setPicked({ clips: [clip.id] });
    setFocus({ kind: "audio", track: placed.track });
    seek(at);
  };
  /** A card onto the cards row at `where` (or the playhead). */
  const addCard = (card: Card, where?: number) => {
    const cur = snapRef.current;
    if (!cur) return;
    const at = where ?? tRef.current;
    const next = placeCard(cur, card, at);
    if (next === cur) return setMsg("No room for a card there.");
    commit(next);
    setPicked({ clips: [card.id] });
    setFocus({ kind: "overlay", track: 0 });
    seek(findCard(next, card.id)?.card.at ?? at);
    pickTab("clip");
  };
  const muteClip = (kind: Kind, clipId: string, muted: boolean) => {
    const cur = snapRef.current;
    if (!cur || kind === "overlay") return;
    commit(kind === "video" ? updateVideo(cur, clipId, { muted: muted || undefined }) : updateAudio(cur, clipId, { muted: muted || undefined }));
  };
  /** The tracks' height, dragged from the bar above them. */
  const resizeTracks = (e: React.MouseEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = tracksH;
    const move = (ev: MouseEvent) => setTracksH(Math.max(TRACKS_H.min, Math.min(window.innerHeight * TRACKS_H.maxFrac, h0 - (ev.clientY - y0))));
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      setTracksH((h) => {
        remember("tracks", String(Math.round(h)));
        return h;
      });
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  };
  const split = (toGap = false) => {
    const cur = snapRef.current;
    if (!cur) return;
    const at = tRef.current;
    if (focus.kind === "overlay") {
      const next = splitCardAt(cur, at);
      if (next === cur) return setMsg("Put the playhead on a card to split it.");
      commit(next);
      const right = next.overlay?.cards.find((c) => Math.abs(c.at - at) < 0.002 && !cur.overlay?.cards.some((x) => x.id === c.id));
      if (right) setPicked({ clips: [right.id] });
      return;
    }
    if (focus.kind === "video") {
      const next = splitVideoAt(cur, focus.track, at);
      if (next === cur) return setMsg(`Put the playhead on a clip in V${focus.track + 1} to split it.`);
      commit(next);
      const right = next.video[focus.track]!.clips.find((c) => Math.abs(c.at - at) < 0.002 && !cur.video[focus.track]!.clips.some((x) => x.id === c.id));
      if (right) setPicked({ clips: [right.id] });
      return;
    }
    const tr = cur.audio[focus.track];
    const i = tr ? audioAt(tr, at) : -1;
    const p = tr?.clips[i];
    if (!tr || !p) return setMsg(`Put the playhead on a clip in A${focus.track + 1} to split it.`);
    const where = toGap ? snapToGap(p, cur.takes[p.take], at) : at;
    const next = splitAudioAt(cur, focus.track, where);
    if (next === cur) return;
    commit(next);
    const right = next.audio[focus.track]!.clips.find((c) => Math.abs(c.at - where) < 0.002 && c.id !== p.id);
    if (right) setPicked({ clips: [right.id] });
    if (where !== at) seek(where);
  };
  const remove = () => {
    const cur = snapRef.current;
    if (!cur) return;
    if (picked.clips.length) {
      commit(removeCards(removeAudio(removeVideo(cur, picked.clips), picked.clips), picked.clips));
      return setPicked({ clips: [] });
    }
    if (picked.marker) {
      commit(removeMarker(cur, picked.marker));
      return setPicked({ clips: [] });
    }
    if (picked.word) {
      // A word: off the captions (or back on). The sound is untouched.
      const { take, word } = picked.word;
      commit({ ...cur, takes: cur.takes.map((tk, i) => (i === take ? { ...tk, words: tk.words.map((w, k) => (k === word ? { ...w, hidden: !w.hidden } : w)) } : tk)) });
    }
  };
  const markHere = () => {
    const cur = snapRef.current;
    if (!cur) return;
    const next = addMarker(cur, tRef.current);
    if (next === cur) return setMsg("There's already a marker there.");
    commit(next);
    const added = next.markers!.find((m) => !cur.markers?.some((x) => x.id === m.id));
    if (added) setPicked({ clips: [], marker: added.id });
  };
  const retype = (take: number, word: number, text: string) => {
    const cur = snapRef.current;
    const clean = text.trim();
    setEditing(null);
    if (!cur || !clean || cur.takes[take]?.words[word]?.text === clean) return;
    commit({ ...cur, takes: cur.takes.map((tk, i) => (i === take ? { ...tk, words: tk.words.map((w, k) => (k === word ? { ...w, text: clean } : w)) } : tk)) });
  };
  const again = async (take: number) => {
    const cur = snapRef.current;
    const tk = cur?.takes[take];
    if (!cur || !tk) return;
    setRec({ state: "words" });
    try {
      const done = await api.transcribeTake(id, tk);
      const now = snapRef.current;
      // The same words in the same order: the new times, with the fixes you'd made kept.
      const same = done.words.length === tk.words.length;
      const words = same ? done.words.map((w, i) => ({ ...w, text: tk.words[i]!.text, ...(tk.words[i]!.hidden ? { hidden: true } : {}) })) : done.words;
      if (now) commit({ ...now, takes: now.takes.map((x) => (x.file === done.file ? { ...x, words, transcribed: true } : x)) });
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
    const voice = { ...cur.voice, ...want };
    if (!cur.takes.length) return setSnap({ ...cur, voice });
    setRec({ state: "saving" });
    try {
      const takes = await api.sequenceSound(id, cur.takes, { tidy: voice.tidy, denoise: voice.denoise });
      const now = snapRef.current ?? cur;
      setSnap({ ...now, voice, takes: now.takes.map((tk, i) => ({ ...tk, file: takes[i]?.file ?? tk.file })) });
      setMsg("");
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    } finally {
      setRec({ state: "idle" });
    }
  };
  const setVoice = (patch: Partial<Sequence["voice"]>, undoable = false) => {
    const cur = snapRef.current;
    if (!cur) return;
    if (patch.volume !== undefined) remember("volume", String(patch.volume));
    (undoable ? commit : setSnap)({ ...cur, voice: { ...cur.voice, ...patch } });
  };
  const binEdit = async () => {
    if (!confirm(`Bin the edit "${name || id}"?\n\nThe recordings it uses stay in the library. Its takes go to the voice folder's .trash. Videos already rendered from it keep working only until the next render needs it.`)) return;
    setBusy(true);
    try {
      await api.trashSequence(id);
      go({ name: "make" });
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
      setBusy(false);
    }
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
  const patchClip = (clipId: string, patch: Partial<Clip>, undoable = true) => {
    const cur = snapRef.current;
    if (cur) (undoable ? commit : setSnap)(updateVideo(cur, clipId, patch));
  };
  const patchAudioClip = (clipId: string, patch: Partial<AudioClip>, undoable = true) => {
    const cur = snapRef.current;
    if (cur) (undoable ? commit : setSnap)(updateAudio(cur, clipId, patch));
  };
  const patchCard = (cardId: string, patch: Partial<Card>) => {
    const cur = snapRef.current;
    if (cur) commit(updateCard(cur, cardId, patch));
  };
  // The script's sketches, for the library's Cards shelf.
  const sketches: Sketch[] = useMemo(() => (script ? sketchesOf(script) : []), [script]);

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

  // Keys: space play/pause · R record/stop · S split (⌥S: voice between words) · M marker · N snap · Delete · ⌘Z · ← → nudge
  useEffect(() => {
    const typing = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n?.tagName) return false;
      if (n.tagName === "TEXTAREA" || n.tagName === "SELECT") return true;
      return n.tagName === "INPUT" && !["checkbox", "radio", "button", "file", "range"].includes((n as HTMLInputElement).type);
    };
    const onKeyUp = (e: KeyboardEvent) => {
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
      if (e.key === "Escape") {
        setMenu(null);
        setPicked({ clips: [] });
      } else if (e.key === " ") {
        e.preventDefault();
        playing ? pause() : play();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        const cur = snapRef.current;
        if (cur) setPicked({ clips: [...cur.video.flatMap((tr) => tr.clips.map((c) => c.id)), ...cur.audio.flatMap((tr) => tr.clips.map((c) => c.id)), ...(cur.overlay?.cards.map((c) => c.id) ?? [])] });
      } else if (e.metaKey || e.ctrlKey) return;
      else if (e.key === "r" || e.key === "R") void startRecording();
      else if (e.code === "KeyS") split(e.altKey);
      else if (e.code === "KeyM") markHere();
      else if (e.code === "KeyN") toggleSnap();
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        seek(tRef.current + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / FPS));
      }
    };
    addEventListener("keydown", onKey);
    addEventListener("keyup", onKeyUp);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("keyup", onKeyUp);
    };
  });

  const heard = useMemo(() => (seq ? audioPieces(seq) : []), [seq]);
  const words: PlacedWord[] = useMemo(() => (seq ? placedWords({ takes: seq.takes, captionNudgeMs: seq.voice.captionNudgeMs }, heard, { hidden: true }) : []), [seq, heard]);

  if (preview === null) return <div className="panel muted" style={{ margin: 24 }}>This game's templates can't preview an edit yet: its desk.templates.ts needs a VOICE_PREVIEW.</div>;
  if (!doc || !seq || !inputProps || !preview) return <div className="muted" style={{ margin: 24 }}>{msg || "loading…"}</div>;

  const recording = rec.state !== "idle";
  const locked = recording || busy;
  const spoken = heard.reduce((s, p) => s + (p.end - p.start), 0);
  const clipCount = seq.video.reduce((n, tr) => n + tr.clips.length, 0);
  const sources = new Set(seq.video.flatMap((tr) => tr.clips.map((c) => c.src))).size;
  const size = game.formats[shape] ?? { width: 1080, height: 1920, label: "" };
  // The player, as big as fits the stage.
  const fit = Math.max(0.01, Math.min(Math.max(0, stageSize.w - 8) / size.width, Math.max(0, stageSize.h - 8) / size.height));
  const playerW = Math.floor(size.width * fit);
  const playerH = Math.floor(size.height * fit);
  const seqClip = `seq:${id}`;
  // What the panel is about.
  const one = picked.clips.length === 1 ? picked.clips[0]! : null;
  const vsel = one ? findClip(seq, one) : undefined;
  const asel = one && !vsel ? findAudio(seq, one) : undefined;
  const csel = one && !vsel && !asel ? findCard(seq, one) : undefined;
  const stacks = stackIntervals(seq);
  const stackable = Boolean(vsel && stacks.some((s) => s.start < clipEnd(vsel.clip) && s.end > vsel.clip.at));
  const vtimed = vsel ? timeTrack(seq.video[vsel.track]!)[vsel.index] : undefined;
  const vprev = vsel && vsel.index > 0 ? [...seq.video[vsel.track]!.clips].sort((a, b) => a.at - b.at)[vsel.index - 1] : undefined;
  const pickedTake = asel ? asel.clip.take : picked.word ? picked.word.take : undefined;

  const focusLabel = focus.kind === "video" ? `V${focus.track + 1}` : focus.kind === "audio" ? `A${focus.track + 1}` : "cards";
  const inspectorTitle = vsel ? `Clip on V${vsel.track + 1}` : asel ? `Voice on A${asel.track + 1}` : csel ? (csel.card.kind === "text" ? "A text card" : csel.card.kind === "image" ? "A picture" : csel.card.kind === "build" ? "A glyph picture" : csel.card.kind === "chapter" ? "A chapter" : "A b-roll slot") : picked.clips.length > 1 ? `${picked.clips.length} clips selected` : picked.word ? "A word" : picked.marker ? "A marker" : "Nothing selected";

  return (
    <div className="editor" onClick={() => setMenu(null)}>
      {/* ── the bar across the top ── */}
      <div className="ed-bar">
        <button className="ghost small" onClick={() => go({ name: "clips" })}>
          ‹ Clips
        </button>
        <div className="ed-title">
          <input type="text" className="ed-name" value={name} disabled={locked} placeholder={doc.name} onChange={(e) => setName(e.target.value)} title="The edit's name" />
          <span className="small muted">
            {clipCount} clip{clipCount === 1 ? "" : "s"} · {sources} recording{sources === 1 ? "" : "s"} · {seq.video.length}V {seq.audio.length}A · {fmtSeconds(total)}
            {heard.length ? ` · ${fmtSeconds(spoken)} voice` : ""}
            {seq.music ? " · ♪" : ""}
          </span>
        </div>
        <span className={`small ed-save ${saveState}`}>{saveState === "saving" ? "saving…" : saveState === "failed" ? "✖ couldn't save" : saveState === "saved" ? "saved" : ""}</span>
        <button disabled={locked} onClick={() => go({ name: "make", file: seqClip })} title="Back to Make a video with this edit chosen: pick the template, fill in its details, render">
          Done ›
        </button>
      </div>

      {/* ── the room: library · stage · inspector ── */}
      <div className="ed-room">
        <Library
          api={api}
          clips={clips}
          seq={seq}
          focus={focus}
          t={t}
          locked={locked}
          onAddFootage={(f) => addFootage(f, focus.kind === "video" ? focus.track : 0)}
          onAddTake={(i) => addTake(i, focus.kind === "audio" ? focus.track : 0)}
          onAddCard={(c) => addCard(c)}
          onGoCard={(c) => {
            seek(c.at);
            setPicked({ clips: [c.id] });
            setFocus({ kind: "overlay", track: 0 });
            pickTab("clip");
          }}
          sketches={sketches}
        />

        <section className="stage-col">
          <div className="stage-tools">
            <div className="seg">
              {Object.keys(game.formats).map((f) => (
                <button
                  key={f}
                  className={`small ${shape === f ? "" : "ghost"}`}
                  onClick={() => {
                    setShape(f);
                    remember("shape", f);
                  }}
                  title={`${game.formats[f]!.label}. Each shape keeps its own framing for every clip.`}
                >
                  {f}
                </button>
              ))}
            </div>
            <span className="small muted">{size.width}×{size.height}</span>
          </div>
          <div ref={stageBox} className="stage-box">
            <div ref={stage} className="stage-player" style={{ width: playerW, height: playerH }} onClick={(e) => !locked && (playing ? pause() : play(e))}>
              <Player ref={player} component={preview.component} inputProps={inputProps} durationInFrames={frames} fps={FPS} compositionWidth={size.width} compositionHeight={size.height} style={{ width: playerW, height: playerH }} />
              {overlay && shape === "vertical" ? <TikTokOverlay /> : null}
              {rec.state === "count" ? <div className="countin">{rec.n}</div> : null}
              {rec.state === "on" ? <div className="recdot">● REC {fmtSeconds(Math.max(0, t - rec.at))}</div> : null}
            </div>
          </div>
          <div className="transport">
            <button className="small" disabled={locked} onClick={(e) => (playing ? pause() : play(e))} title="Space">
              {playing ? "❚❚" : "▶"}
            </button>
            <span className="mono tcode">
              {fmtSeconds(t)} <span className="muted">/ {fmtSeconds(total)}</span>
            </span>
            <div className="grow" />
            {rec.state === "on" || rec.state === "count" ? (
              <button className="recbtn on small" onClick={() => void stopRecording()} title="R or space">
                ■ Stop
              </button>
            ) : (
              <button className="recbtn small" disabled={locked} onClick={() => void startRecording()} title={`R. A new take at the playhead on A${recordTrack() + 1}, after a 3-2-1. Nothing already there is touched.`}>
                ● Record
              </button>
            )}
            <span className="small muted rec-note">
              {rec.state === "saving" ? "saving the take…" : rec.state === "words" ? "writing the captions…" : rec.state === "on" ? `onto A${rec.track + 1}: the edit is playing${clipSound ? "" : " silently"}, talk over it` : `onto A${recordTrack() + 1} at the playhead`}
            </span>
          </div>
        </section>

        <aside className="inspector">
          <div className="insp-tabs">
            {TABS.map((x) => (
              <button key={x.id} className={tab === x.id ? "on" : ""} onClick={() => pickTab(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
          <div className="insp-body">
            {tab === "clip" ? <h3>{inspectorTitle}</h3> : null}
            {tab === "clip" ? (
              vsel ? (
                <VideoClipPanel
                  game={game}
                  api={api}
                  seq={seq}
                  track={vsel.track}
                  clip={vsel.clip}
                  timed={vtimed}
                  prev={vprev}
                  shape={shape}
                  stackable={stackable}
                  frameMode={frameMode}
                  locked={locked}
                  onFrameMode={setFrameMode}
                  onCheckpoint={checkpoint}
                  onPatch={(p, u) => patchClip(vsel.clip.id, p, u)}
                  onPatchAll={(f) => {
                    const cur = snapRef.current;
                    if (cur) commit({ ...cur, video: cur.video.map((tr) => ({ ...tr, clips: tr.clips.map((c) => (c.src === vsel.clip.src ? { ...c, ...f(c) } : c)) })) });
                  }}
                />
              ) : asel ? (
                <AudioClipPanel seq={seq} track={asel.track} clip={asel.clip} locked={locked} whisperReady={Boolean(whisper?.ready)} onCheckpoint={checkpoint} onPatch={(p, u) => patchAudioClip(asel.clip.id, p, u)} onAgain={(tk) => void again(tk)} />
              ) : csel ? (
                <CardPanel api={api} card={csel.card} locked={locked} onPatch={(p) => patchCard(csel.card.id, p)} />
              ) : picked.clips.length > 1 ? (
                <div className="small muted">Drag any of them and they all move together. Delete takes them all out and leaves the gaps.</div>
              ) : picked.word ? (
                <div className="small muted">Double-click the word on the timeline to fix it; Delete keeps it off the captions (or puts it back).</div>
              ) : picked.marker ? (
                <div className="small muted">Drag it along the ruler to move it; Delete removes it. A list clip lands one item on each marker.</div>
              ) : (
                <div className="small muted">Click a clip on the timeline to frame it, shave it or set its sound. Shift-click to pick several and drag them together. Drag a clip onto another track; where two tracks have picture they share the frame (code on top, gameplay underneath).</div>
              )
            ) : null}
            {tab === "voice" ? (
              <VoicePanel
                seq={seq}
                locked={locked}
                recording={recording}
                micOn={micOn}
                mics={mics}
                device={device}
                meter={meter}
                meterText={meterText}
                clipSound={clipSound}
                onClipSound={(on) => {
                  setClipSound(on);
                  remember("clip", on ? "on" : "off");
                }}
                onMic={(d) => {
                  if (d !== undefined) setDevice(d);
                  void turnMicOn(d);
                }}
                onSound={(w) => void setSound(w)}
                onVoice={setVoice}
                onCheckpoint={checkpoint}
                onAudioFile={(f) => void addAudioFile(f)}
                onBackup={() => void backup()}
              />
            ) : null}
            {tab === "captions" ? (
              <CaptionsPanel
                seq={seq}
                style={style}
                overlay={overlay}
                whisper={whisper}
                locked={locked}
                pickedTake={pickedTake}
                onStyle={(s) => {
                  setStyle(s);
                  remember("captions", s);
                }}
                onOverlay={(on) => {
                  setOverlay(on);
                  remember("overlay", on ? "on" : "off");
                }}
                onVoice={setVoice}
                onInstallWhisper={() => void api.installWhisper().then(setWhisper)}
                onAgain={(tk) => void again(tk)}
              />
            ) : null}
            {tab === "music" ? (
              <MusicPanel
                music={seq.music}
                songs={songs}
                locked={locked}
                onCheckpoint={checkpoint}
                onChange={(m) => {
                  const cur = snapRef.current;
                  if (cur) (m && cur.music && m.song === cur.music.song && m.from === cur.music.from ? setSnap : commit)(setMusic(cur, m));
                }}
              />
            ) : null}
            {tab === "script" ? <ScriptPanel scripts={scripts} script={script} idea={idea} locked={locked} onPick={setIdea} onTick={(sid, done) => void api.updateScript(sid, { done }).then(() => api.scripts()).then((r) => setScripts(r.list)).catch((e: Error) => setMsg(`✖ ${e.message}`))} /> : null}
            {tab === "edit" ? (
              <EditPanel
                name={name}
                note={note}
                slide={seq.slide}
                locked={locked}
                onName={setName}
                onNote={setNote}
                onSlide={(v) => {
                  const cur = snapRef.current;
                  if (cur) commit({ ...cur, slide: v });
                }}
                onBin={() => void binEdit()}
              />
            ) : null}
          </div>
        </aside>
      </div>

      {/* ── the tracks ── */}
      <div className="ed-tracks" style={{ height: tracksH }}>
        <div className="tl-tools" onMouseDown={(e) => e.target === e.currentTarget && resizeTracks(e)} title="Drag this bar to give the tracks more or less room">
          <button className="small ghost" disabled={locked} onClick={() => split()} title={`S. Splits the clip under the playhead on ${focusLabel}, the track you last clicked in (⌥S on a voice clip: at the nearest gap between words).`}>
            Split {focusLabel}
          </button>
          <button className="small ghost" disabled={locked || (!picked.clips.length && !picked.marker && !picked.word)} onClick={remove} title="Delete. Leaves the gap.">
            {picked.word ? (seq.takes[picked.word.take]?.words[picked.word.word]?.hidden ? "Show word" : "Hide word") : picked.marker ? "Delete marker" : picked.clips.length > 1 ? `Delete ${picked.clips.length}` : "Delete"}
          </button>
          <button className="small ghost" disabled={locked || !history.current.length} onClick={undo} title="⌘Z">
            Undo
          </button>
          <button className="small ghost" disabled={locked} onClick={markHere} title="M. A numbered flag on the ruler at the playhead. In a list clip, each item lands on one.">
            + Marker
          </button>
          <button className={`small ${snapOn ? "" : "ghost"} magnet`} onClick={toggleSnap} title={`N. Snapping is ${snapOn ? "on: edges pull onto other clips' edges, a slide's length before a clip's end, the markers and the playhead. Hold ⌥ while dragging to skip it once." : "off: clips go exactly where you drop them."}`}>
            ⌇ Snap {snapOn ? "on" : "off"}
          </button>
          <div className="grow" />
          <span className="small muted">zoom</span>
          <input type="range" min={0} max={1} step={0.005} value={zoomPos} onChange={(e) => zoomTo(Number(e.target.value))} style={{ width: 140 }} title="Or turn the scroll wheel over the timeline" />
          <button className="small ghost" onClick={() => zoomTo(0)} title="Fit the whole edit in the window">
            Fit
          </button>
        </div>
        <div className="tl-body">
          <Timeline
            game={game}
            api={api}
            seq={seq}
            laneSeconds={laneSeconds}
            total={total}
            t={t}
            playing={playing}
            pps={ppsNow}
            ppsRange={ppsRange}
            locked={locked}
            snap={snapOn}
            picked={picked}
            focus={focus}
            rec={rec}
            words={words}
            editing={editing}
            peaks={peaks}
            onPps={setPps}
            onWidth={setLaneWidth}
            onSeek={seek}
            onPause={pause}
            onPick={pickOnTimeline}
            onFocus={setFocus}
            onLive={setSnap}
            onDrop={(base) => {
              history.current.push(base);
              if (history.current.length > 200) history.current.shift();
            }}
            onContext={setMenu}
            onEditWord={setEditing}
            onRetype={retype}
            onAddVideoTrack={() => snapRef.current && commit(addVideoTrack(snapRef.current))}
            onAddAudioTrack={() => snapRef.current && commit(addAudioTrack(snapRef.current))}
            onToggleVideoTrack={(i) => snapRef.current && commit(updateVideoTrack(snapRef.current, i, { muted: !snapRef.current.video[i]?.muted || undefined }))}
            onToggleAudioTrack={(i) => snapRef.current && commit(updateAudioTrack(snapRef.current, i, { muted: !snapRef.current.audio[i]?.muted }))}
            onMuteClip={muteClip}
            onDropFootage={(file, track, at) => addFootage(file, track, at)}
            onDropTake={(take, track, at) => addTake(take, track, at)}
            onDropCard={(card, at) => addCard(card, at)}
            onMusic={() => pickTab("music")}
          />
        </div>
        <div className="tl-help small muted">
          Click or drag the ruler to move the playhead · wheel zooms · click a clip, <b>shift-click</b> for several · drag to move (together), edges to trim · 🔊 on a clip or a track name silences it · cards row: text and sketches over the footage · <b>S</b> split · <b>Delete</b> leaves the gap · <b>M</b> marker · <b>N</b> snap · <b>R</b> record onto A{recordTrack() + 1} · double-click a word to fix it · <b>⌘Z</b> undo
        </div>
      </div>

      {msg ? (
        <div className={`toast${msg.startsWith("✖") ? " bad" : ""}`} onClick={() => setMsg("")} title="Click to dismiss">
          {msg}
        </div>
      ) : null}

      {menu ? (
        <div className="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menu.kind === "video" || menu.kind === "audio" || menu.kind === "overlay" ? (
            <button
              onClick={() => {
                split();
                setMenu(null);
              }}
            >
              Split {menu.kind === "video" ? `V${menu.track + 1}` : menu.kind === "audio" ? `A${menu.track + 1}` : "the card"} here
            </button>
          ) : null}
          {menu.kind === "overlay" ? (
            <button
              onClick={() => {
                addCard(cardOf("text", { text: "A few words" }), menu.at);
                setMenu(null);
              }}
            >
              Add a text card here
            </button>
          ) : null}
          {picked.clips.length ? (
            <>
              <button
                onClick={() => {
                  const cur = snapRef.current;
                  if (!cur) return;
                  const all = [...cur.video.flatMap((tr) => tr.clips), ...cur.audio.flatMap((tr) => tr.clips)].filter((c) => picked.clips.includes(c.id));
                  const silence = all.some((c) => !c.muted);
                  let next = cur;
                  for (const c of all) next = findClip(next, c.id) ? updateVideo(next, c.id, { muted: silence || undefined }) : updateAudio(next, c.id, { muted: silence || undefined });
                  commit(next);
                  setMenu(null);
                }}
              >
                {[...seq.video.flatMap((tr) => tr.clips), ...seq.audio.flatMap((tr) => tr.clips)].filter((c) => picked.clips.includes(c.id)).some((c) => !c.muted) ? "Silence" : "Unsilence"} {picked.clips.length > 1 ? `${picked.clips.length} clips` : "this clip"}
              </button>
              <button
                onClick={() => {
                  remove();
                  setMenu(null);
                }}
              >
                Delete {picked.clips.length > 1 ? `${picked.clips.length} clips` : "this clip"}
              </button>
            </>
          ) : null}
          <button
            onClick={() => {
              markHere();
              setMenu(null);
            }}
          >
            Add a marker here
          </button>
          {menu.kind === "video" ? (
            <button
              onClick={() => {
                const cur = snapRef.current;
                if (cur) commit(updateVideoTrack(cur, menu.track, { muted: !cur.video[menu.track]?.muted || undefined }));
                setMenu(null);
              }}
            >
              {seq.video[menu.track]?.muted ? "Unsilence" : "Silence"} all of V{menu.track + 1}
            </button>
          ) : null}
          {menu.kind === "audio" ? (
            <button
              onClick={() => {
                setFocus({ kind: "audio", track: menu.track });
                setMenu(null);
                void startRecording();
              }}
            >
              Record here on A{menu.track + 1}
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
