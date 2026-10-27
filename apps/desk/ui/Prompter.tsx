import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Take } from "@heroic/voiceover";
import { type GameApi, type Script, type WhisperStatus, fmtSeconds } from "./api";
import { go } from "./App";
import { type Mic, type MicDevice, listMics, micPermission, micSupported, openMic, peaksOf } from "./mic";
import { Wave, remember } from "./edit/widgets";
import { type Cover, LONG_PAUSE, type Span, autoTrim, cutRegion, keptSeconds, matchScript, trimRegion } from "../lib/match";
import { type Beat, type Cut, type ScriptTake, plannedBeats } from "../lib/scripts";

/**
 * The Record stage of a script (docs/design/desk-scripts.md § Recording,
 * laid out per docs/design/desk-scripts-ux.md). On the left the prompter:
 * the beats, large, the one you're on in the middle; press Record, 3-2-1,
 * read as many as you like, press again. The take is saved, Whisper writes
 * its words, every beat it reads gets a tick, and the prompter moves on to
 * the next beat still to read. On the right a column that stays put: the
 * take just made (Space plays it), the takes of the beat you're on (each
 * plays just that beat's stretch), and every take. Open one to trim its
 * edges or cut a stretch out, in a panel along the bottom (the file is
 * never touched: the take keeps a list of kept regions, and everything
 * after only sees those). Delete a bad one and read it again.
 */

type Rec = { state: "idle" } | { state: "count"; n: number } | { state: "on"; since: number } | { state: "saving" };

/** Which beats each take covers, by take file. */
export const coversOf = (s: Pick<Script, "takes" | "long" | "shorts">): Map<string, Cover[]> => new Map(s.takes.map((t) => [t.file, matchScript(t, s)]));

/** What's playing: a stretch of a take, through its kept parts. */
type Playing = { file: string; start: number; end: number };

export const Prompter: React.FC<{ api: GameApi; s: Script; id: string; covers: Map<string, Cover[]>; onTakes: (takes: ScriptTake[]) => void; onReplace: (s: Script) => void; onError: (e: string) => void; /** What to read instead of the long cut (the shorts' hooks, desk-shorts.md). */ only?: { cut: Cut; beat: Beat }[] }> = ({ api, s, id, covers, onTakes, onReplace, onError, only }) => {
  const beats = useMemo(() => only ?? plannedBeats(s), [s.long, s.shorts, only]);
  const covered = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [file, cs] of covers) for (const c of cs) m.set(c.beat, [...(m.get(c.beat) ?? []), file]);
    return m;
  }, [covers]);
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<Record<string, Float32Array>>({});
  const [whisper, setWhisper] = useState<WhisperStatus | null>(null);
  const asked = useRef(new Set<string>());
  const list = useRef<HTMLDivElement>(null);
  const [showAll, setShowAll] = useState(() => remember("takes-all") === "open");
  // the mic
  const mic = useRef<Mic | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [device, setDevice] = useState(() => remember("mic"));
  const meter = useRef<HTMLDivElement>(null);
  const meterText = useRef<HTMLSpanElement>(null);
  const [rec, setRecState] = useState<Rec>({ state: "idle" });
  const recRef = useRef<Rec>({ state: "idle" });
  const setRec = (r: Rec) => {
    recRef.current = r;
    setRecState(r);
  };
  const [tick, setTick] = useState(0);
  const file = useRef<HTMLInputElement>(null);

  // The first beat not yet read is the one to read next, unless one was clicked.
  const next = beats.find((b) => !covered.has(b.beat.id));
  const cur = beats.find((b) => b.beat.id === current) ?? next ?? beats[0];
  const curIndex = cur ? beats.findIndex((b) => b.beat.id === cur.beat.id) : -1;
  const after = curIndex >= 0 ? beats[curIndex + 1] : undefined;
  const numberOf = (beat: string) => beats.findIndex((b) => b.beat.id === beat) + 1;

  // The stage fills the window under the stage bar, so nothing on it scrolls away: the prompter and the takes scroll inside it.
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = stage.current;
      if (el) el.style.height = `${Math.max(420, innerHeight - (el.getBoundingClientRect().top + scrollY) - 16)}px`;
    };
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);
  // The beat you're on sits in the middle of the prompter.
  useEffect(() => {
    const box = list.current;
    const el = box?.querySelector<HTMLElement>(".pbeat.on");
    if (!box || !el) return;
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  }, [cur?.beat.id]);

  useEffect(() => void api.whisper().then(setWhisper).catch(() => {}), [api]);
  useEffect(() => {
    for (const tk of s.takes) {
      if (asked.current.has(tk.file)) continue;
      asked.current.add(tk.file);
      peaksOf(api.publicUrl(tk.file))
        .then((p) => setPeaks((c) => ({ ...c, [tk.file]: p })))
        .catch(() => {});
    }
  }, [s.takes, api]);

  // ── the player: one stretch of one take at a time, skipping what's cut ──
  const audio = useRef<HTMLAudioElement | null>(null);
  const head = useRef<HTMLDivElement>(null);
  const [playing, setPlayingState] = useState<Playing | null>(null);
  const playRef = useRef<Playing | null>(null);
  const setPlaying = (p: Playing | null) => {
    playRef.current = p;
    setPlayingState(p);
  };
  useEffect(() => {
    const a = new Audio();
    audio.current = a;
    return () => {
      a.pause();
      a.removeAttribute("src");
    };
  }, []);
  const stopPlay = useCallback(() => {
    audio.current?.pause();
    setPlaying(null);
  }, []);
  const play = (take: ScriptTake, start?: number, end?: number) => {
    const a = audio.current;
    if (!a) return;
    const keep = take.keep?.length ? take.keep : [{ start: 0, end: take.seconds }];
    const from = start ?? keep[0]!.start;
    const to = end ?? keep.at(-1)!.end;
    const was = playRef.current;
    stopPlay();
    // Pressing what's playing stops it.
    if (was?.file === take.file && was.start === from) return;
    const url = new URL(api.publicUrl(take.file), location.href).href;
    if (a.src !== url) a.src = url;
    a.currentTime = from;
    void a.play().catch((e: Error) => onError(`play: ${e.message}`));
    setPlaying({ file: take.file, start: from, end: to });
  };
  useEffect(() => {
    if (!playing) return;
    const take = s.takes.find((t) => t.file === playing.file);
    if (!take) return stopPlay();
    const keep = take.keep?.length ? take.keep : null;
    let raf = 0;
    const loop = () => {
      const a = audio.current;
      if (!a) return;
      let t = a.currentTime;
      if (keep && !keep.some((k) => t >= k.start && t < k.end)) {
        const on = keep.find((k) => k.start > t);
        if (!on || on.start >= playing.end) return stopPlay();
        a.currentTime = t = on.start;
      }
      if (a.ended || t >= playing.end) return stopPlay();
      if (head.current) head.current.style.left = `${(t / take.seconds) * 100}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, s.takes, stopPlay]);

  const turnMicOn = useCallback(
    async (want = device): Promise<Mic | null> => {
      if (!micSupported()) {
        onError("This browser can't record. Use Chrome, Edge or Safari, on localhost.");
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
        onError((e as Error).name === "NotAllowedError" ? "The browser wasn't allowed the microphone. Allow it from the address bar, then press Turn the mic on." : `microphone: ${(e as Error).message}`);
        return null;
      }
    },
    [device, onError],
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
  // The clock on the record button.
  useEffect(() => {
    if (rec.state !== "on") return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [rec.state]);

  // The auto trim: on by default, remembered on this machine (see autoTrim in lib/match.ts).
  const [autoOn, setAutoOn] = useState(() => remember("autotrim") !== "off");
  const [pausesOn, setPausesOn] = useState(() => remember("autotrim-pauses") !== "off");
  const landed = useCallback(
    (take: Take & { error?: string }) => {
      if (take.error) onError(`The take is saved but Whisper couldn't hear it: ${take.error}`);
      const fresh: ScriptTake = { file: take.file, seconds: take.seconds, recordedAt: take.recordedAt, words: take.words, transcribed: take.transcribed };
      const keep = autoOn && take.transcribed ? autoTrim(fresh, pausesOn) : undefined;
      const made: ScriptTake = { ...fresh, ...(keep?.length ? { keep } : {}) };
      onTakes([...s.takes, made]);
      // The prompter moves on: to the first beat after the last one this take read that still needs reading.
      const read = matchScript(made, s).map((c) => beats.findIndex((b) => b.beat.id === c.beat)).filter((i) => i >= 0);
      if (read.length) {
        const heard = new Set([...covered.keys(), ...read.map((i) => beats[i]!.beat.id)]);
        const to = beats.slice(Math.max(...read) + 1).find((b) => !heard.has(b.beat.id)) ?? beats.find((b) => !heard.has(b.beat.id));
        setCurrent(to?.beat.id ?? null);
      }
    },
    [s, beats, covered, onTakes, onError, autoOn, pausesOn],
  );
  /** Every take tidied at once (cuts made by hand stay). */
  const trimAll = () => onTakes(s.takes.map((t) => (t.transcribed ? { ...t, keep: autoTrim(t, pausesOn) ?? t.keep } : t)));
  const start = async () => {
    if (recRef.current.state !== "idle") return;
    stopPlay();
    const m = mic.current ?? (await turnMicOn());
    if (!m) return;
    for (let n = 3; n >= 1; n--) {
      setRec({ state: "count", n });
      await new Promise((r) => setTimeout(r, 650));
      if ((recRef.current as Rec).state !== "count") return;
    }
    m.start();
    setRec({ state: "on", since: Date.now() });
  };
  const stop = useCallback(async () => {
    const r = recRef.current;
    if (r.state === "count") return setRec({ state: "idle" });
    if (r.state !== "on" || !mic.current) return;
    const out = mic.current.stop();
    if (!out || out.seconds < 0.5) {
      setRec({ state: "idle" });
      return onError("That was too short to keep.");
    }
    setRec({ state: "saving" });
    try {
      landed(await api.addScriptTake(id, out.wav, { tidy: true, denoise: 0 }));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setRec({ state: "idle" });
    }
  }, [api, id, landed, onError]);
  const addFile = async (f: File) => {
    setRec({ state: "saving" });
    try {
      const ext = /\.([a-z0-9]+)$/i.exec(f.name)?.[1] ?? "wav";
      landed(await api.addScriptTake(id, f, { tidy: true, denoise: 0, ext }));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setRec({ state: "idle" });
    }
  };
  const remove = async (take: ScriptTake) => {
    if (!confirm(`Delete this take (${fmtSeconds(take.seconds)})? It goes to the voice folder's .trash.`)) return;
    try {
      if (playRef.current?.file === take.file) stopPlay();
      onReplace(await api.removeScriptTake(id, take.file));
      if (open === take.file) setOpen(null);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const openTakeView = (file: string | null) => {
    stopPlay();
    setOpen(file);
  };
  const setKeep = (take: ScriptTake, keep: Span[] | undefined) => onTakes(s.takes.map((t) => (t.file === take.file ? { ...t, keep: keep?.length ? keep : undefined } : t)));
  /** Tom says which beats a take reads ("7", "7-9", "7, 9"; blank = let the matcher decide again). */
  const setAssign = (take: ScriptTake, text: string): string | undefined => {
    const ids: string[] = [];
    for (const part of text.split(/[,\s]+/).filter(Boolean)) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) return `"${part}" isn't a beat number`;
      const a = Number(m[1]);
      const b = Number(m[2] ?? m[1]);
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
        const beat = beats[n - 1];
        if (!beat) return `there's no beat ${n}`;
        ids.push(beat.beat.id);
      }
    }
    onTakes(s.takes.map((t) => (t.file === take.file ? { ...t, assign: ids.length ? ids : undefined } : t)));
    return undefined;
  };

  const last = s.takes.at(-1);
  // Keys: R records / stops, Space plays the last take, Delete bins it, ↓ ↑ move the prompter, Esc closes a take.
  useEffect(() => {
    const typing = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      return Boolean(n?.tagName && (n.tagName === "TEXTAREA" || n.tagName === "SELECT" || (n.tagName === "INPUT" && (n as HTMLInputElement).type !== "range")));
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const r = recRef.current.state;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        if (r === "on" || r === "count") void stop();
        else if (r === "idle") void start();
      } else if (e.key === " ") {
        e.preventDefault();
        // A focused button would take the space as a click too.
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (r !== "idle" || open) return;
        if (playRef.current) stopPlay();
        else if (last) play(last);
      } else if ((e.key === "Delete" || e.key === "Backspace") && r === "idle" && !open && last) {
        e.preventDefault();
        void remove(last);
      } else if (e.key === "Escape") {
        if (r === "on" || r === "count") void stop();
        else if (open) setOpen(null);
        else stopPlay();
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && cur && !open) {
        e.preventDefault();
        const to = beats[curIndex + (e.key === "ArrowDown" ? 1 : -1)];
        if (to) setCurrent(to.beat.id);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const done = beats.filter((b) => covered.has(b.beat.id)).length;
  const recording = rec.state === "on" || rec.state === "count";
  const openTake = open ? s.takes.find((t) => t.file === open) : undefined;
  if (!beats.length) return <div className="small muted">{only ? "Nothing to read yet: pick a hook for a kept short first." : "Rewrite the script first: the prompter reads from the beats."}</div>;
  const beatsOf = (t: ScriptTake) => {
    const cs = covers.get(t.file) ?? [];
    return cs.length ? `beat${cs.length === 1 ? "" : "s"} ${cs.map((c) => numberOf(c.beat)).join(", ")}` : t.transcribed ? "no beat heard" : "listening…";
  };
  const wordsOf = (t: ScriptTake) => t.words.filter((w) => !w.hidden).map((w) => w.text).join(" ") || (t.transcribed ? "no words heard" : "listening…");
  const assignBox = (t: ScriptTake) => <AssignBox take={t} onAssign={(text) => setAssign(t, text)} onError={onError} label={t.assign?.length ? (covers.get(t.file) ?? []).map((c) => `${numberOf(c.beat)}`).join(", ") : ""} />;
  // The takes that read the beat you're on, each with the stretch that reads it.
  const beatTakes = cur ? s.takes.flatMap((take) => (covers.get(take.file) ?? []).filter((c) => c.beat === cur.beat.id).map((cover) => ({ take, cover }))) : [];
  const isPlaying = (file: string, start?: number) => playing?.file === file && (start === undefined || playing.start === start);
  return (
    <div ref={stage} className="rec-stage">
      <div className="rec-main">
        <div className="rec-bar">
          <strong className="small">
            {done} of {beats.length} beats recorded
          </strong>
          {micOn ? (
            <select value={device} disabled={recording} onChange={(e) => (setDevice(e.target.value), void turnMicOn(e.target.value))} style={{ width: "auto", maxWidth: 200 }}>
              {mics.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          ) : (
            <button className="ghost small" onClick={() => void turnMicOn()}>
              Turn the mic on
            </button>
          )}
          <div className="meter" style={{ maxWidth: 160 }}>
            <div ref={meter} />
          </div>
          <span ref={meterText} className="small muted mono" style={{ width: 56 }}>
            {micOn ? "" : "mic off"}
          </span>
          <span className="grow" />
          <input ref={file} type="file" accept="audio/*,.wav,.m4a,.mp3,.aac,.ogg,.flac" style={{ display: "none" }} onChange={(e) => (e.target.files?.[0] && void addFile(e.target.files[0]), (e.target.value = ""))} />
          <button className="link small" disabled={recording || rec.state === "saving"} onClick={() => file.current?.click()} title="A recording made elsewhere (the phone, another app)">
            add a file…
          </button>
          {recording ? (
            <button className="recbtn on" onClick={() => void stop()} title="R or Esc">
              ■ Stop {rec.state === "on" ? fmtSeconds((Date.now() - rec.since) / 1000) : ""}
            </button>
          ) : (
            <button className="recbtn" disabled={rec.state !== "idle"} onClick={() => void start()} title="R. A 3-2-1, then read as many beats as you like; press again to stop.">
              {rec.state === "saving" ? "saving…" : "● Record"}
            </button>
          )}
        </div>
        {whisper && !whisper.ready ? (
          <div className="small warn">
            Whisper isn't set up, so takes can't be matched to the beats. Set it up on the editor's Captions tab (
            <button className="link small" onClick={() => go({ name: "make" })}>
              Make a video → Start a timeline
            </button>
            ), then record.
          </div>
        ) : null}

        {/* ── the prompter ── */}
        <div ref={list} className="prompt-list">
          {beats.map((b) => {
            const files = covered.get(b.beat.id) ?? [];
            const on = cur?.beat.id === b.beat.id;
            const n = b.cut.beats.findIndex((x) => x.id === b.beat.id) + 1;
            return (
              <div key={b.beat.id} className={`pbeat${on ? " on" : ""}${files.length ? " done" : ""}${files.length > 1 ? " twice" : ""}${after?.beat.id === b.beat.id ? " next" : ""}`} onClick={() => setCurrent(b.beat.id)}>
                {b.beat.chapter?.trim() ? <div className="pbeat-chapter">{b.beat.chapter}</div> : null}
                <div className="pbeat-n small muted">
                  {n}
                  {files.length ? <span title={files.length > 1 ? `Read in ${files.length} takes: delete the ones you don't want, or organise will ask.` : "Recorded"}> {files.length > 1 ? "✓✓" : "✓"}</span> : null}
                </div>
                <div className="pbeat-text">{b.beat.text}</div>
              </div>
            );
          })}
        </div>
        <div className="small muted">
          <b>R</b> records and stops · <b>Space</b> plays the last take · <b>Delete</b> bins it · <b>↓ ↑</b> move the prompter · click a beat to read it again
        </div>
      </div>
      {rec.state === "count" ? <div className="countin" style={{ position: "fixed" }}>{rec.n}</div> : null}
      {rec.state === "on" ? <div className="recdot" style={{ position: "fixed", left: 24, bottom: 24, fontSize: 14, padding: "6px 12px" }}>● REC {fmtSeconds((Date.now() - rec.since) / 1000)}</div> : null}

      {/* ── the takes, beside it ── */}
      <aside className="rec-side">
        <div className="rec-card">
          <div className="row between">
            <strong className="small">Just recorded</strong>
            {last && rec.state === "idle" ? <span className="small muted">take {s.takes.length}</span> : null}
          </div>
          {rec.state === "on" || rec.state === "count" ? (
            <div className="small muted">Recording… stop it and it lands here.</div>
          ) : rec.state === "saving" ? (
            <div className="small muted">Saving it and listening for the words…</div>
          ) : last ? (
            <>
              <div className="take-wave big" onClick={() => play(last)} title="Play it (Space)">
                <Wave peaks={peaks[last.file]} start={0} end={last.seconds} width={400} height={56} />
                {(last.keep ?? []).length ? <KeepShade keep={last.keep!} seconds={last.seconds} /> : null}
                {isPlaying(last.file) ? <div ref={head} className="tv-head" /> : null}
              </div>
              <div className="row" style={{ gap: 10 }}>
                <button className="small" onClick={() => play(last)} title="Space">
                  {isPlaying(last.file) ? "■ Stop" : "▶ Play"}
                </button>
                <span className="small">
                  {fmtSeconds(keptSeconds(last))} <span className="muted">· {beatsOf(last)}</span>
                </span>
                <span className="grow" />
                <button className="link small" onClick={() => openTakeView(last.file)} title="Trim its edges or cut a stretch out">
                  trim…
                </button>
                <button className="link small muted" onClick={() => void remove(last)} title="Delete (or Backspace)">
                  delete
                </button>
              </div>
              <div className="small muted words clamp3">{wordsOf(last)}</div>
              {!(covers.get(last.file) ?? []).length && last.transcribed ? <div className="small">{assignBox(last)}</div> : null}
            </>
          ) : (
            <div className="small muted">Nothing yet. Press Record (or R), read, press again.</div>
          )}
        </div>

        {cur ? (
          <div className="rec-card">
            <strong className="small">Beat {curIndex + 1}'s takes</strong>
            {beatTakes.length ? (
              beatTakes.map(({ take, cover }) => (
                <div key={take.file} className={`beat-take${isPlaying(take.file, cover.start) ? " on" : ""}`}>
                  <button className="playbtn" onClick={() => play(take, cover.start, cover.end)} title="Just this beat's stretch of the take">
                    {isPlaying(take.file, cover.start) ? "■" : "▶"}
                  </button>
                  <span className="small">take {s.takes.indexOf(take) + 1}</span>
                  <span className="small muted">
                    {fmtSeconds(cover.end - cover.start)} · {Math.round(cover.score * 100)}% heard
                  </span>
                  <span className="grow" />
                  <button className="link small" onClick={() => openTakeView(take.file)}>
                    trim…
                  </button>
                  <button className="link small muted" onClick={() => void remove(take)} title="Delete this take">
                    ×
                  </button>
                </div>
              ))
            ) : (
              <div className="small muted">Not read yet.</div>
            )}
            {beatTakes.length > 1 ? <div className="small warn">Read in {beatTakes.length} takes: delete the ones you don't want, or organise skips the beat.</div> : null}
          </div>
        ) : null}

        <div className="rec-card">
          <button className="link small" onClick={() => setShowAll((v) => (remember("takes-all", v ? "closed" : "open"), !v))}>
            {showAll ? "▾" : "▸"} Every take {s.takes.length ? `(${s.takes.length})` : ""}
          </button>
          {showAll ? (
            <>
              <div className="row small" style={{ gap: 10 }}>
                <button className="ghost small" disabled={!s.takes.some((t) => t.transcribed)} onClick={trimAll} title={`Every take: the silence off both ends${pausesOn ? `, and pauses over ${LONG_PAUSE}s inside it shortened` : ""}. Cuts you made by hand stay; running it again changes nothing.`}>
                  Trim all
                </button>
                <label className="row muted" style={{ gap: 4 }} title="New takes get the same tidy as they land.">
                  <input type="checkbox" checked={autoOn} onChange={(e) => (setAutoOn(e.target.checked), remember("autotrim", e.target.checked ? "on" : "off"))} />
                  trim as they land
                </label>
                <label className="row muted" style={{ gap: 4 }} title={`Pauses longer than ${LONG_PAUSE}s between words are cut down to about 0.4s.`}>
                  <input type="checkbox" checked={pausesOn} onChange={(e) => (setPausesOn(e.target.checked), remember("autotrim-pauses", e.target.checked ? "on" : "off"))} />
                  shorten pauses
                </label>
              </div>
              {!s.takes.length ? <div className="small muted">Nothing recorded yet.</div> : null}
              {[...s.takes].reverse().map((t) => {
                const i = s.takes.indexOf(t);
                return (
                  <div key={t.file} className={`side-take${open === t.file ? " on" : ""}`}>
                    <button className="playbtn" onClick={() => play(t)}>
                      {isPlaying(t.file) && playing?.start === (t.keep?.[0]?.start ?? 0) ? "■" : "▶"}
                    </button>
                    <div className="what" onClick={() => openTakeView(open === t.file ? null : t.file)} title="Open it to trim">
                      <div className="take-wave">
                        <Wave peaks={peaks[t.file]} start={0} end={t.seconds} width={300} height={28} />
                        {(t.keep ?? []).length ? <KeepShade keep={t.keep!} seconds={t.seconds} /> : null}
                      </div>
                      <div className="small">
                        <span className="muted">#{i + 1} ·</span> {fmtSeconds(keptSeconds(t))} <span className="muted">· {beatsOf(t)}</span>
                        {t.assign?.length ? <span className="muted" title="You said which beats this take reads"> (yours)</span> : null}
                      </div>
                      <div className="small muted words">{wordsOf(t)}</div>
                    </div>
                    <div className="stack" style={{ gap: 2, alignItems: "flex-end" }}>
                      <button className="link small muted" onClick={() => void remove(t)} title="Delete this take">
                        ×
                      </button>
                      {assignBox(t)}
                    </div>
                  </div>
                );
              })}
            </>
          ) : null}
        </div>
      </aside>

      {openTake ? (
        <div className="take-sheet">
          <TakeView take={openTake} peaks={peaks[openTake.file]} covers={covers.get(openTake.file) ?? []} beats={beats} audio={api.publicUrl(openTake.file)} onKeep={(k) => setKeep(openTake, k)} onClose={() => setOpen(null)} />
        </div>
      ) : null}
    </div>
  );
};

/** The parts of a take that are cut, shaded over its waveform. */
const KeepShade: React.FC<{ keep: Span[]; seconds: number }> = ({ keep, seconds }) => {
  const cuts: Span[] = [];
  let at = 0;
  for (const k of keep) {
    if (k.start > at) cuts.push({ start: at, end: k.start });
    at = k.end;
  }
  if (at < seconds) cuts.push({ start: at, end: seconds });
  return (
    <>
      {cuts.map((c, i) => (
        <div key={i} className="tv-cut" style={{ left: `${(c.start / seconds) * 100}%`, width: `${((c.end - c.start) / seconds) * 100}%` }} />
      ))}
    </>
  );
};

/**
 * One take, open: the waveform full width with the words along it and
 * the beats it covers under; the kept regions lit, the cuts shaded. Drag
 * across to select a stretch, then cut it out or keep only it; drag the
 * end handles to trim. The audio plays from a click. Nothing touches the
 * file.
 */
const TakeView: React.FC<{ take: ScriptTake; peaks?: Float32Array; covers: Cover[]; beats: { cut: Cut; beat: Beat }[]; audio: string; onKeep: (k: Span[] | undefined) => void; onClose: () => void }> = ({ take, peaks, covers, beats, audio, onKeep, onClose }) => {
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLAudioElement>(null);
  const [sel, setSel] = useState<Span | null>(null);
  const [t, setT] = useState(0);
  const [width, setWidth] = useState(800);
  const drag = useRef<{ x0: number; moved: boolean } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    setWidth(el.clientWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const timeAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.max(0, Math.min(take.seconds, ((clientX - r.left) / r.width) * take.seconds));
  };
  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    drag.current = { x0: e.clientX, moved: false };
    const at = timeAt(e.clientX);
    setSel({ start: at, end: at });
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
      d.moved = true;
      const a = timeAt(d.x0);
      const b = timeAt(e.clientX);
      setSel({ start: Math.min(a, b), end: Math.max(a, b) });
    };
    const up = (e: MouseEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (!d.moved) {
        // A click: play from there.
        setSel(null);
        const at = timeAt(e.clientX);
        const p = player.current;
        if (p) {
          p.currentTime = at;
          void p.play();
        }
      }
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
    return () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take.seconds]);
  const x = (s: number) => (s / take.seconds) * 100;
  const keep = take.keep?.length ? take.keep : [{ start: 0, end: take.seconds }];
  const words = take.words.filter((w) => !w.hidden);
  // Label the words there's room for; the rest are ticks.
  const roomy = new Set<number>();
  {
    let right = -Infinity;
    const pxPerSec = width / take.seconds;
    words.forEach((w, i) => {
      const px = w.start * pxPerSec;
      if (px < right + 4) return;
      roomy.add(i);
      right = px + w.text.length * 6.5 + 8;
    });
  }
  const speech = words.length ? { start: Math.max(0, words[0]!.start - 0.15), end: Math.min(take.seconds, words[words.length - 1]!.end + 0.2) } : null;
  const hasSel = sel && sel.end - sel.start > 0.05;
  return (
    <div className="take-view stack" style={{ gap: 8 }}>
      <div className="row between">
        <strong className="small">Take {fmtSeconds(take.seconds)} · drag across the sound to select, click to play from there</strong>
        <button className="link small" onClick={onClose}>
          close (Esc)
        </button>
      </div>
      <div ref={box} className="tv-wave" onMouseDown={onDown}>
        <Wave peaks={peaks} start={0} end={take.seconds} width={width} height={90} />
        <KeepShade keep={keep} seconds={take.seconds} />
        {hasSel ? <div className="tv-sel" style={{ left: `${x(sel.start)}%`, width: `${x(sel.end - sel.start)}%` }} /> : null}
        <div className="tv-head" style={{ left: `${x(t)}%` }} />
        <div className="tv-words">
          {words.map((w, i) => (
            <span key={i} className={`tv-word${roomy.has(i) ? "" : " tick"}${t >= w.start && t < w.end ? " now" : ""}`} style={{ left: `${x(w.start)}%` }} title={w.text}>
              {w.text}
            </span>
          ))}
        </div>
      </div>
      <div className="tv-covers">
        {covers.map((c) => {
          const n = beats.findIndex((b) => b.beat.id === c.beat) + 1;
          return (
            <div key={c.beat} className="tv-cover" style={{ left: `${x(c.start)}%`, width: `${x(c.end - c.start)}%` }} title={`Beat ${n}, ${Math.round(c.score * 100)}% of its words heard`}>
              beat {n}
            </div>
          );
        })}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="small ghost" disabled={!hasSel} onClick={() => hasSel && (onKeep(cutRegion(take.keep, take.seconds, sel)), setSel(null))} title="Take the selected stretch out of the take (a false start, a cough).">
          Cut it out
        </button>
        <button className="small ghost" disabled={!hasSel} onClick={() => hasSel && (onKeep(trimRegion(take.keep, take.seconds, sel.start, sel.end)), setSel(null))} title="Keep only the selected stretch: everything either side is out.">
          Keep only this
        </button>
        <button className="small ghost" disabled={!speech} onClick={() => speech && onKeep(trimRegion(take.keep, take.seconds, speech.start, speech.end))} title="Trim the silence off both ends (to just before the first word and just after the last).">
          Trim to the words
        </button>
        <button className="small ghost" disabled={!take.keep} onClick={() => onKeep(undefined)} title="Every cut undone: the whole take again.">
          Reset
        </button>
        <span className="grow" />
        <audio ref={player} src={audio} controls style={{ height: 30 }} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />
      </div>
    </div>
  );
};

/**
 * "It's beat 7": type the beat (or "7-9") a take reads when the matcher
 * didn't hear it. Blank lets the matcher decide again.
 */
const AssignBox: React.FC<{ take: ScriptTake; label: string; onAssign: (text: string) => string | undefined; onError: (e: string) => void }> = ({ take, label, onAssign, onError }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(label);
  const send = () => {
    const err = onAssign(text);
    if (err) return onError(err);
    setEditing(false);
  };
  if (!editing)
    return (
      <button className="link small" onClick={(e) => (e.stopPropagation(), setText(label), setEditing(true))} title="Say which beat(s) this take reads, when it didn't hear them">
        {take.assign?.length ? "change beats" : "set beats…"}
      </button>
    );
  return (
    <span className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="7 or 7-9 (blank: back to the matcher)"
        style={{ width: 200, padding: "2px 6px" }}
      />
      <button className="ghost small" onClick={send}>
        Set
      </button>
    </span>
  );
};
