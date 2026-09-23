import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CleanupSpec, Segment, Transition } from "../lib/sidecar";
import { type Clip, type GameApi, type GameInfo, fmtSeconds } from "./api";
import { go } from "./App";

/**
 * Clean up a recording the way you'd edit a track in Audacity: one filmstrip
 * of the whole clip. Click to put the playhead down, SPLIT at the playhead
 * (button, right-click or S), click a piece to select it, DELETE to drop it.
 * Dropped pieces are gaps: playback skips them, and the kept pieces become
 * the new clip, joined by a hard cut, a crossfade or a dip to black. Two
 * video layers preview the join. Crop + audio apply to the whole thing.
 * Save = ffmpeg writes a new file next to the original.
 *
 * Opened FROM a cut (Clips → "re-cut"), the track starts with that cut's
 * splits, drops, join, crop and audio, and Save writes over the cut.
 */
type Piece = { start: number; end: number; kept: boolean };

const cutsToPieces = (cuts: number[], removed: number[], total: number): Piece[] => {
  const edges = [0, ...cuts, total];
  return edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1]!, kept: !removed.includes(i) }));
};

/** A saved cut's kept segments → the track's split points + dropped pieces.
 * Cuts from before segments existed carried startFrom/endAt; that's one segment. */
const specToTrack = (spec: Partial<CleanupSpec> & { startFrom?: number; endAt?: number }, total: number): { cuts: number[]; removed: number[] } => {
  const segments: Segment[] = spec.segments?.length ? spec.segments : spec.endAt !== undefined ? [{ start: spec.startFrom ?? 0, end: spec.endAt }] : [];
  const eps = 0.05;
  const cuts = [...new Set(segments.flatMap((s) => [s.start, s.end]))].filter((x) => x > eps && x < total - eps).sort((a, b) => a - b);
  const pieces = cutsToPieces(cuts, [], total);
  const removed = pieces.flatMap((p, i) => (segments.some((s) => s.start - eps <= p.start && p.end <= s.end + eps) ? [] : [i]));
  return { cuts, removed };
};

export const Cleanup: React.FC<{ game: GameInfo; api: GameApi; file: string; from?: string }> = ({ api, file, from }) => {
  const [clip, setClip] = useState<Clip | null>(null);
  const [recut, setRecut] = useState<Clip | null>(null); // the cut we're re-doing, when opened from one
  // The edit: split points + which pieces are dropped. Undo = pop the history.
  const [cuts, setCuts] = useState<number[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const history = useRef<{ cuts: number[]; removed: number[] }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [transition, setTransition] = useState<Transition>("cut");
  const [transitionSeconds, setTransitionSeconds] = useState(0.4);
  const [cropTop, setCropTop] = useState(0.035);
  const [cropBottom, setCropBottom] = useState(0.065);
  const [muted, setMuted] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; piece: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  // Two layers so a join can be previewed: `a` is what you see; `b` fades in over it at a join, then they swap.
  const vA = useRef<HTMLVideoElement>(null);
  const vB = useRef<HTMLVideoElement>(null);
  const [front, setFront] = useState<"a" | "b">("a");
  const [blend, setBlend] = useState(0); // 0..1 through the current join
  const joinRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    api.clips().then((all) => {
      const c = all.find((x) => x.file === file) ?? null;
      setClip(c);
      if (!c) return;
      const prior = from ? all.find((x) => x.file === from && x.source === c.file) : undefined;
      setRecut(prior ?? null);
      if (prior?.cleanup) {
        // Re-cutting: start where that cut left off.
        const spec = prior.cleanup;
        const track = specToTrack(spec, c.facts.seconds);
        setCuts(track.cuts);
        setRemoved(track.removed);
        setTransition(spec.transition ?? "cut");
        setTransitionSeconds(spec.transitionSeconds || 0.4);
        setCropTop(spec.cropTop ?? c.cropTop);
        setCropBottom(spec.cropBottom ?? c.cropBottom);
        setMuted(spec.muted ?? c.muted);
        setNote(prior.note);
        setName(prior.file.replace(/\.[^.]+$/, ""));
      } else {
        setCropTop(c.cropTop);
        setCropBottom(c.cropBottom);
        setMuted(c.muted);
        setNote(c.note);
        setName(`${c.file.replace(/\.[^.]+$/, "")} cut`);
      }
    });
  }, [file, from, api]);

  const total = clip?.facts.seconds ?? 1;
  const pieces = useMemo(() => cutsToPieces(cuts, removed, total), [cuts, removed, total]);
  const segments: Segment[] = useMemo(() => pieces.filter((p) => p.kept).map(({ start, end }) => ({ start, end })), [pieces]);
  const kept = segments.reduce((s, x) => s + (x.end - x.start), 0);
  const joins = Math.max(0, segments.length - 1);
  const d = transition === "cut" ? 0 : Math.max(0.1, Math.min(transitionSeconds, ...segments.map((s) => (s.end - s.start) / 2)));
  const outSeconds = Math.max(0, kept - joins * d);

  const commit = (next: { cuts?: number[]; removed?: number[] }) => {
    history.current.push({ cuts, removed });
    if (next.cuts) setCuts(next.cuts);
    if (next.removed) setRemoved(next.removed);
  };
  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    setCuts(prev.cuts);
    setRemoved(prev.removed);
    setSelected(null);
  }, []);
  const pieceAt = (time: number) => pieces.findIndex((p) => time >= p.start && time < p.end);
  const split = (at = t) => {
    if (at <= 0.05 || at >= total - 0.05 || cuts.some((c) => Math.abs(c - at) < 0.05)) return;
    const next = [...cuts, at].sort((x, y) => x - y);
    const idx = next.indexOf(at); // piece `idx` is the one being split: it becomes idx (left) + idx+1 (right)
    // Pieces after it shift by one; a dropped piece stays dropped on both halves.
    commit({ cuts: next, removed: removed.map((r) => (r > idx ? r + 1 : r)).concat(removed.includes(idx) ? [idx + 1] : []) });
    setSelected(idx + 1);
  };
  const drop = (i: number) => {
    if (i < 0 || removed.includes(i)) return;
    if (pieces.filter((p) => p.kept).length <= 1) return setMsg("that's the last piece — keep something");
    commit({ removed: [...removed, i] });
  };
  const restore = (i: number) => commit({ removed: removed.filter((r) => r !== i) });
  const clear = () => {
    commit({ cuts: [], removed: [] });
    setSelected(null);
  };

  // ── transport ──
  const vid = (which: "a" | "b") => (which === "a" ? vA : vB).current;
  const seek = (to: number) => {
    const v = vid(front);
    if (v) v.currentTime = to;
    setT(to);
    joinRef.current = null;
    setBlend(0);
  };
  const play = () => {
    const v = vid(front);
    if (!v) return;
    const i = pieceAt(v.currentTime);
    if (i === -1 || !pieces[i]!.kept) {
      const nxt = pieces.find((p) => p.kept && p.start >= v.currentTime) ?? pieces.find((p) => p.kept);
      if (nxt) v.currentTime = nxt.start;
    }
    void v.play();
    setPlaying(true);
  };
  const pause = () => {
    vA.current?.pause();
    vB.current?.pause();
    setPlaying(false);
  };

  /** Runs on the FRONT video's timeupdate: skip gaps, and stage the join preview. */
  const onTime = (which: "a" | "b") => () => {
    if (which !== front) return;
    const v = vid(front)!;
    const time = v.currentTime;
    setT(time);
    if (v.paused) return;
    const i = pieceAt(time);
    const piece = i >= 0 ? pieces[i]! : null;
    const nextKept = pieces.find((p, k) => p.kept && k > i);
    if (!piece || !piece.kept) {
      // In a gap (or past the end): jump on, or loop.
      const target = nextKept ?? pieces.find((p) => p.kept);
      if (target) v.currentTime = target.start;
      return;
    }
    const remaining = piece.end - time;
    const back = vid(front === "a" ? "b" : "a")!;
    if (nextKept && d > 0 && remaining <= d) {
      // Inside a join: the back layer plays the next piece; blend = how far through.
      if (!joinRef.current || joinRef.current.from !== i) {
        joinRef.current = { from: i, to: pieces.indexOf(nextKept) };
        back.currentTime = nextKept.start;
        void back.play();
      }
      setBlend(Math.min(1, Math.max(0, 1 - remaining / d)));
    }
    if (remaining <= 0.03) {
      if (!nextKept) {
        // The end: loop from the first kept piece.
        const first = pieces.find((p) => p.kept)!;
        v.currentTime = first.start;
        joinRef.current = null;
        setBlend(0);
        return;
      }
      if (joinRef.current && d > 0) {
        // Hand over to the back layer, which is already mid-piece.
        v.pause();
        setFront(front === "a" ? "b" : "a");
        joinRef.current = null;
        setBlend(0);
      } else {
        v.currentTime = nextKept.start; // hard cut
      }
    }
  };

  // ── track interaction ──
  const timeAtX = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(total, ((clientX - r.left) / r.width) * total));
  };
  const onTrackDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const time = timeAtX(e.clientX);
    seek(time);
    setSelected(pieceAt(time));
    setMenu(null);
  };
  const onCutDown = (k: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    dragging.current = k;
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (dragging.current === null) return;
      const k = dragging.current;
      const lo = (cuts[k - 1] ?? 0) + 0.1;
      const hi = (cuts[k + 1] ?? total) - 0.1;
      const at = Math.max(lo, Math.min(hi, timeAtX(e.clientX)));
      setCuts((cur) => cur.map((c, i) => (i === k ? at : c)));
      setT(at);
    };
    const up = () => {
      if (dragging.current !== null) history.current.push({ cuts, removed });
      dragging.current = null;
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
    return () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuts, removed, total]);

  // Keys: space play/pause · S split · Delete/Backspace drop · ⌘Z undo · ← → nudge
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === " ") {
        e.preventDefault();
        playing ? pause() : play();
      } else if (e.key === "s" || e.key === "S") split();
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (selected !== null) drop(selected);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        seek(Math.max(0, Math.min(total, t + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.1))));
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (!clip) return <div className="muted">loading…</div>;
  const pct = (s: number) => `${(s / total) * 100}%`;
  const keep = Math.max(0.2, 1 - cropTop - cropBottom);

  const save = async () => {
    if (!segments.length) return setMsg("nothing kept");
    setBusy(true);
    setMsg("cutting…");
    pause();
    try {
      const replacing = recut && name.trim() === recut.file.replace(/\.[^.]+$/, "") ? recut.file : undefined;
      const out = await api.cleanup(clip.file, { name, segments, transition, transitionSeconds: d, cropTop, cropBottom, muted, replace: replacing });
      if (note !== (replacing ? recut!.note : clip.note)) await api.saveClip(out.file, { note });
      setMsg(`✔ saved ${out.file} (${fmtSeconds(out.facts.seconds)})`);
      setTimeout(() => go({ name: "make", file: out.file }), 600);
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const layer = (which: "a" | "b") => {
    const isFront = which === front;
    const opacity = transition === "crossfade" ? (isFront ? 1 : blend) : isFront ? 1 : blend >= 0.5 ? 1 : 0;
    return (
      <video
        key={which}
        ref={which === "a" ? vA : vB}
        src={api.clipUrl(clip.file)}
        muted={muted || !isFront}
        preload="auto"
        onTimeUpdate={onTime(which)}
        onLoadedMetadata={which === "a" ? () => seek(0) : undefined}
        style={{ width: "100%", height: `${(1 / keep) * 100}%`, position: "absolute", top: `${(-cropTop / keep) * 100}%`, left: 0, opacity, zIndex: isFront ? 1 : 2 }}
      />
    );
  };
  const dipShade = transition === "dip" && blend > 0 ? 1 - Math.abs(blend * 2 - 1) : 0;

  return (
    <div className="stack" style={{ gap: 20 }} onClick={() => setMenu(null)}>
      <div className="row between">
        <div>
          <h2>{recut ? "Re-cut" : "Clean up"}</h2>
          <div className="muted small">
            {clip.file} · {fmtSeconds(total)} · {clip.facts.width}×{clip.facts.height}
            {recut ? <> · starting from your cut <b>{recut.file.replace(/\.[^.]+$/, "")}</b></> : null}
          </div>
        </div>
        <button className="ghost" onClick={() => go({ name: "clips" })}>
          ‹ Clips
        </button>
      </div>

      {/* ── the track ── */}
      <div className="panel stack">
        <div className="row between">
          <div className="row">
            <button className="small" onClick={playing ? pause : play}>
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <button className="small ghost" onClick={() => split()} title="S">
              Split at playhead
            </button>
            <button className="small ghost" disabled={selected === null || !pieces[selected]?.kept} onClick={() => selected !== null && drop(selected)} title="Delete">
              Delete piece
            </button>
            <button className="small ghost" disabled={selected === null || pieces[selected]?.kept !== false} onClick={() => selected !== null && restore(selected)}>
              Restore piece
            </button>
            <button className="small ghost" disabled={!history.current.length} onClick={undo} title="⌘Z">
              Undo
            </button>
            <button className="small ghost" disabled={!cuts.length && !removed.length} onClick={clear}>
              Start over
            </button>
          </div>
          <span className="small muted mono">
            {fmtSeconds(t)} · keeps {fmtSeconds(outSeconds)} of {fmtSeconds(total)}
          </span>
        </div>
        <div
          ref={trackRef}
          className="track2"
          style={{ backgroundImage: `url("${api.clipStrip(clip.file)}")` }}
          onMouseDown={onTrackDown}
          onContextMenu={(e) => {
            e.preventDefault();
            const time = timeAtX(e.clientX);
            seek(time);
            const i = pieceAt(time);
            setSelected(i);
            setMenu({ x: e.clientX, y: e.clientY, piece: i });
          }}
        >
          {pieces.map((p, i) => (
            <div
              key={i}
              className={`piece${p.kept ? "" : " gap"}${selected === i ? " on" : ""}`}
              style={{ left: pct(p.start), width: pct(p.end - p.start) }}
              title={`${fmtSeconds(p.start)} → ${fmtSeconds(p.end)}${p.kept ? "" : " (dropped)"}`}
            >
              <span className="label">{p.kept ? fmtSeconds(p.end - p.start) : "dropped"}</span>
            </div>
          ))}
          {cuts.map((c, k) => (
            <div key={k} className="cutline" style={{ left: pct(c) }} onMouseDown={onCutDown(k)} title="drag to move the split" />
          ))}
          <div className="head" style={{ left: pct(t) }} />
        </div>
        <div className="small muted">
          Click the track to move the playhead · <b>S</b> splits there · click a piece, <b>Delete</b> drops it · drag a split line to move it · <b>⌘Z</b> undoes · space plays, skipping dropped pieces.
        </div>
        {segments.length > 1 ? (
          <div className="row">
            <div className="field" style={{ width: 220 }}>
              <label>Join the pieces with</label>
              <select value={transition} onChange={(e) => setTransition(e.target.value as Transition)}>
                <option value="cut">a hard cut</option>
                <option value="crossfade">a crossfade</option>
                <option value="dip">a dip to black</option>
              </select>
            </div>
            {transition !== "cut" ? (
              <div className="field" style={{ width: 150 }}>
                <label>over (seconds)</label>
                <input type="number" step={0.1} min={0.1} max={2} value={transitionSeconds} onChange={(e) => setTransitionSeconds(Math.max(0.1, Number(e.target.value) || 0.4))} />
              </div>
            ) : null}
            <span className="small muted">{joins} join{joins === 1 ? "" : "s"} · previewed in the player</span>
          </div>
        ) : null}
      </div>

      <div className="split">
        <div className="stack" style={{ gap: 18 }}>
          <div className="panel stack">
            <h3>The frame</h3>
            <div className="field">
              <label>Shave the top (status bar) · {(cropTop * 100).toFixed(1)}%</label>
              <input type="range" min={0} max={0.2} step={0.005} value={cropTop} onChange={(e) => setCropTop(Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Shave the bottom (nav bar) · {(cropBottom * 100).toFixed(1)}%</label>
              <input type="range" min={0} max={0.2} step={0.005} value={cropBottom} onChange={(e) => setCropBottom(Number(e.target.value))} />
            </div>
            <div className="field inline">
              <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
              <label>Drop the audio</label>
            </div>
          </div>
          <div className="panel stack">
            <h3>Save</h3>
            <div className="field">
              <label>{recut ? "Clip name" : "New clip name"}</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="hint">{recut && name.trim() === recut.file.replace(/\.[^.]+$/, "") ? "Same name: saves over that cut. Change the name to keep both." : "Saved as a new file next to the original; the original stays."}</div>
            </div>
            <div className="field">
              <label>Note (what happens in this recording — for you)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="row">
              <button disabled={busy || !name.trim()} onClick={() => void save()}>
                {busy ? "Cutting…" : recut && name.trim() === recut.file.replace(/\.[^.]+$/, "") ? "Save over the cut" : "Save as new clip"}
              </button>
              <span className="small muted">{msg}</span>
            </div>
          </div>
        </div>
        <div className="preview">
          <div className="vidwrap" style={{ aspectRatio: `${clip.facts.width} / ${clip.facts.height * keep}` }} onClick={() => (playing ? pause() : play())}>
            {layer("a")}
            {layer("b")}
            <div style={{ position: "absolute", inset: 0, background: "#000", opacity: dipShade, zIndex: 3, pointerEvents: "none" }} />
          </div>
          <div className="small muted">Already cropped. Plays the kept pieces in order with the join you chose.</div>
        </div>
      </div>

      {menu ? (
        <div className="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { split(); setMenu(null); }}>Split here</button>
          {menu.piece >= 0 && pieces[menu.piece]?.kept ? <button onClick={() => { drop(menu.piece); setMenu(null); }}>Delete this piece</button> : null}
          {menu.piece >= 0 && pieces[menu.piece]?.kept === false ? <button onClick={() => { restore(menu.piece); setMenu(null); }}>Restore this piece</button> : null}
          <button onClick={() => { undo(); setMenu(null); }}>Undo</button>
        </div>
      ) : null}
    </div>
  );
};
