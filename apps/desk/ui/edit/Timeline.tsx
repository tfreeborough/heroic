/**
 * The timeline: the ruler with the markers, the cards row (text, sketches,
 * b-roll slots: docs/design/desk-scripts.md), the video tracks (highest on
 * top), the audio tracks, the words of the captions and the music lane.
 *
 * Everything is placed at its own time. Click a clip to pick it (shift-click
 * adds to the selection), drag to move it (the whole selection moves
 * together; one clip on its own can also change track), drag its edges to
 * trim. Edges snap to other clips' edges, to a slide's length before a
 * clip's end, to markers and to the playhead (the magnet turns that off;
 * ⌥ while dragging skips it for one drag). Click or drag the empty lane to
 * move the playhead. Footage and takes dragged out of the library drop onto
 * a track at the time under the pointer.
 *
 * The scale is pixels per second (`pps`) and only the zoom changes it: a
 * clip moved past the end makes the lane longer, not everything smaller.
 * The edits themselves are @heroic/voiceover's pure functions; this file
 * turns mouse movement into them and shows the result.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { type AudioClip, type Card, type Clip, type PlacedWord, type Sequence, cardEnd, cardLabel, clipEnd, findAudio, findCard, findClip, moveAudio, moveCard, moveMarker, moveVideo, pieceEnd, pieceSeconds, shiftClips, snapPoints, snapTo, timeTrack, trimAudioEnd, trimAudioStart, trimCardEnd, trimCardStart, trimVideoEnd, trimVideoStart } from "@heroic/voiceover";
import type { GameApi, GameInfo } from "../api";
import { fmtSeconds } from "../api";
import { ROW, Wave, dragPayload, stem } from "./widgets";

/** `overlay` is the one row of cards. */
export type Kind = "video" | "audio" | "overlay";
export type Focus = { kind: Kind; track: number };
export type Picked = { clips: string[]; marker?: string; word?: { take: number; word: number } };
export type Context = { kind: Kind | "ruler" | "music"; track: number; at: number; x: number; y: number };
export type RecState = { state: "idle" } | { state: "count"; n: number; at: number; track: number } | { state: "on"; at: number; track: number } | { state: "saving" } | { state: "words" };

type Drag =
  | { on: "move"; kind: Kind; ids: string[]; primary: string; x0: number; base: Sequence; moved: boolean; track: number }
  | { on: "trim"; kind: Kind; id: string; edge: "start" | "end"; x0: number; base: Sequence; moved: boolean }
  | { on: "marker"; id: string; x0: number; at0: number; base: Sequence; moved: boolean };

/** Something from the library held over a track. */
type Ghost = { kind: Kind; track: number; at: number; seconds: number };

/** How close (px) an edge has to come to snap. */
const SNAP_PX = 10;
/** Where to draw the snap guide: the edge that landed on a point, or nothing if none did. */
const snappedEdge = (want: number, snapped: number, seconds: number, points: number[]): number | null => {
  if (Math.abs(snapped - want) < 1e-6) return null;
  const on = (x: number) => points.some((p) => Math.abs(p - x) < 1e-3);
  return on(snapped) ? snapped : on(snapped + seconds) ? snapped + seconds : null;
};

export const Timeline: React.FC<{
  game: GameInfo;
  api: GameApi;
  seq: Sequence;
  /** Seconds the lane is long (the edit, room after it, and anything hanging past). */
  laneSeconds: number;
  /** Where the edit ends. */
  total: number;
  t: number;
  playing: boolean;
  /** Pixels per second. */
  pps: number;
  /** How far the wheel may zoom: [out, in]. */
  ppsRange: [number, number];
  locked: boolean;
  snap: boolean;
  picked: Picked;
  focus: Focus;
  rec: RecState;
  words: PlacedWord[];
  editing: { take: number; word: number; text: string } | null;
  peaks: Record<string, Float32Array>;
  onPps: (pps: number) => void;
  /** The lane's window is this wide (px). */
  onWidth: (px: number) => void;
  onSeek: (t: number) => void;
  onPause: () => void;
  onPick: (p: Picked) => void;
  onFocus: (f: Focus) => void;
  /** A change while a drag is live (not undoable yet). */
  onLive: (next: Sequence) => void;
  /** A drag let go: `base` is what to put back on undo. */
  onDrop: (base: Sequence) => void;
  onContext: (c: Context) => void;
  onEditWord: (e: { take: number; word: number; text: string } | null) => void;
  onRetype: (take: number, word: number, text: string) => void;
  onAddVideoTrack: () => void;
  onAddAudioTrack: () => void;
  onToggleVideoTrack: (track: number) => void;
  onToggleAudioTrack: (track: number) => void;
  onMuteClip: (kind: Kind, id: string, muted: boolean) => void;
  onDropFootage: (file: string, track: number, at: number) => void;
  onDropTake: (take: number, track: number, at: number) => void;
  onDropCard: (card: Card, at: number) => void;
  onMusic: () => void;
}> = ({ game, api, seq, laneSeconds, total, t, playing, pps, ppsRange, locked, snap, picked, focus, rec, words, editing, peaks, onPps, onWidth, onSeek, onPause, onPick, onFocus, onLive, onDrop, onContext, onEditWord, onRetype, onAddVideoTrack, onAddAudioTrack, onToggleVideoTrack, onToggleAudioTrack, onMuteClip, onDropFootage, onDropTake, onDropCard, onMusic }) => {
  const scroller = useRef<HTMLDivElement>(null);
  const lane = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<Drag | null>(null);
  const scrub = useRef(false);
  const ppsRef = useRef(pps);
  const rangeRef = useRef(ppsRange);
  rangeRef.current = ppsRange;
  const keepUnder = useRef<{ frac: number; x: number } | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [ghost, setGhostState] = useState<Ghost | null>(null);
  const ghostRef = useRef<Ghost | null>(null);
  const seqRef = useRef(seq);
  seqRef.current = seq;
  const tRef = useRef(t);
  tRef.current = t;

  const pxPerSec = pps;
  const px = (s: number) => s * pxPerSec;
  const laneWidthPx = laneSeconds * pxPerSec;
  const prefix = `${game.footagePublic}/`;
  const fileOf = (src: string) => (src.startsWith(prefix) ? src.slice(prefix.length) : src);
  const selected = new Set(picked.clips);
  const setGhost = (g: Ghost | null) => {
    const cur = ghostRef.current;
    if (cur === g || (cur && g && cur.kind === g.kind && cur.track === g.track && Math.abs(cur.at - g.at) < 1e-6)) return;
    ghostRef.current = g;
    setGhostState(g);
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onWidth(Math.max(200, el.clientWidth)));
    onWidth(Math.max(200, el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onWidth]);
  // The wheel zooms, about the point under the cursor; a sideways swipe scrolls.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const x = e.clientX - el.getBoundingClientRect().left;
      const frac = (el.scrollLeft + x) / Math.max(1, el.scrollWidth);
      const [lo, hi] = rangeRef.current;
      const next = Math.max(lo, Math.min(hi, ppsRef.current * Math.exp(-e.deltaY * 0.004)));
      if (next === ppsRef.current) return;
      keepUnder.current = { frac, x };
      ppsRef.current = next;
      onPps(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onPps]);
  useLayoutEffect(() => {
    const el = scroller.current;
    const k = keepUnder.current;
    keepUnder.current = null;
    ppsRef.current = pps;
    if (el && k) el.scrollLeft = k.frac * el.scrollWidth - k.x;
  }, [pps]);
  // Playing: keep the playhead in sight.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = t * pxPerSec;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 80) el.scrollLeft = Math.max(0, x - 120);
  }, [t, playing, pxPerSec]);

  const timeAtX = (clientX: number) => {
    const r = lane.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left) / pxPerSec);
  };
  /** Which track of `kind` the pointer is over, if any. Just above the top video row, or just below the last audio row, means a new track. */
  const trackAtY = (kind: Kind, clientY: number): number | undefined => {
    const mine = [...rows.current].filter(([key]) => key.startsWith(kind === "video" ? "v" : kind === "audio" ? "a" : "o")).map(([key, el]) => ({ track: Number(key.slice(1)), r: el.getBoundingClientRect() }));
    for (const { track, r } of mine) if (clientY >= r.top && clientY <= r.bottom) return track;
    if (kind === "overlay") return undefined;
    const count = kind === "video" ? seqRef.current.video.length : seqRef.current.audio.length;
    const last = mine.find((m) => m.track === count - 1);
    if (!last) return undefined;
    if (kind === "video" && clientY < last.r.top && clientY > last.r.top - last.r.height) return count;
    if (kind === "audio" && clientY > last.r.bottom && clientY < last.r.bottom + last.r.height) return count;
    return undefined;
  };
  const idle = () => !locked;
  const reachFor = (alt: boolean) => (snap && !alt ? SNAP_PX / pxPerSec : 0);

  const onLaneDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !idle()) return;
    scrub.current = true;
    onPause();
    onSeek(timeAtX(e.clientX));
    if (!e.shiftKey) onPick({ clips: [] });
    onEditWord(null);
  };
  const onRowDown = (kind: Kind, track: number) => () => onFocus({ kind, track });
  const onClipDown = (kind: Kind, track: number, id: string) => (e: React.MouseEvent) => {
    if (e.button !== 0 || !idle()) return;
    e.stopPropagation();
    onPause();
    onFocus({ kind, track });
    onEditWord(null);
    if (e.shiftKey) {
      // Add to (or take out of) the selection; no drag.
      onPick({ clips: selected.has(id) ? picked.clips.filter((x) => x !== id) : [...picked.clips, id] });
      return;
    }
    const ids = selected.has(id) ? picked.clips : [id];
    if (!selected.has(id)) onPick({ clips: [id] });
    onSeek(timeAtX(e.clientX));
    drag.current = { on: "move", kind, ids, primary: id, x0: e.clientX, base: seqRef.current, moved: false, track };
  };
  const onEdgeDown = (kind: Kind, track: number, id: string, edge: "start" | "end") => (e: React.MouseEvent) => {
    if (e.button !== 0 || !idle()) return;
    e.stopPropagation();
    onPause();
    onFocus({ kind, track });
    onPick({ clips: [id] });
    drag.current = { on: "trim", kind, id, edge, x0: e.clientX, base: seqRef.current, moved: false };
  };
  const onMarkerDown = (id: string) => (e: React.MouseEvent) => {
    if (e.button !== 0 || !idle()) return;
    e.stopPropagation();
    onPause();
    const m = seqRef.current.markers?.find((x) => x.id === id);
    if (!m) return;
    onSeek(m.at);
    onPick({ clips: [], marker: id });
    onEditWord(null);
    drag.current = { on: "marker", id, x0: e.clientX, at0: m.at, base: seqRef.current, moved: false };
  };
  const onMenu = (kind: Context["kind"], track: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (!idle()) return;
    const at = timeAtX(e.clientX);
    onSeek(at);
    if (kind === "video" || kind === "audio") onFocus({ kind, track });
    onContext({ kind, track, at, x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (scrub.current && lane.current) return onSeek(timeAtX(e.clientX));
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x0;
      if (!d.moved && Math.abs(dx) < 4) return;
      d.moved = true;
      const dt = dx / pxPerSec;
      const reach = reachFor(e.altKey);
      if (d.on === "marker") {
        const next = moveMarker(d.base, d.id, d.at0 + dt);
        onLive(next);
        onSeek(next.markers?.find((m) => m.id === d.id)?.at ?? d.at0);
        return;
      }
      if (d.on === "trim" && d.kind === "overlay") {
        const here = findCard(d.base, d.id);
        if (!here) return;
        const c = here.card;
        const points = snapPoints(d.base, [d.id], tRef.current);
        const want = (d.edge === "start" ? c.at : cardEnd(c)) + dt;
        const edge = snapTo(want, 0, points, reach);
        setSnapLine(Math.abs(edge - want) > 1e-6 ? edge : null);
        const next = d.edge === "start" ? trimCardStart(d.base, d.id, edge) : trimCardEnd(d.base, d.id, edge);
        onLive(next);
        const after = findCard(next, d.id)?.card;
        if (after) onSeek(d.edge === "start" ? after.at : cardEnd(after) - 1 / game.fps);
        return;
      }
      if (d.on === "trim") {
        const here = d.kind === "video" ? findClip(d.base, d.id) : findAudio(d.base, d.id);
        if (!here) return;
        const c = here.clip;
        const end = d.kind === "video" ? clipEnd(c as Clip) : pieceEnd(c as AudioClip);
        const points = snapPoints(d.base, [d.id], tRef.current);
        const want = (d.edge === "start" ? c.at : end) + dt;
        const edge = snapTo(want, 0, points, reach);
        setSnapLine(Math.abs(edge - want) > 1e-6 ? edge : null);
        const next = d.kind === "video" ? (d.edge === "start" ? trimVideoStart(d.base, d.id, edge) : trimVideoEnd(d.base, d.id, edge)) : d.edge === "start" ? trimAudioStart(d.base, d.id, edge) : trimAudioEnd(d.base, d.id, edge);
        onLive(next);
        const after = d.kind === "video" ? findClip(next, d.id)?.clip : findAudio(next, d.id)?.clip;
        if (after) onSeek(d.edge === "start" ? after.at : (d.kind === "video" ? clipEnd(after as Clip) : pieceEnd(after as AudioClip)) - 1 / game.fps);
        return;
      }
      if (d.kind === "overlay") {
        // A card moves along its one row; with others selected, everything goes together.
        const here = findCard(d.base, d.primary);
        if (!here) return;
        const points = snapPoints(d.base, d.ids, tRef.current);
        const want = here.card.at + dt;
        const snapped = snapTo(want, here.card.seconds, points, reach);
        setSnapLine(snappedEdge(want, snapped, here.card.seconds, points));
        onLive(d.ids.length > 1 ? shiftClips(d.base, d.ids, snapped - here.card.at) : moveCard(d.base, d.primary, snapped));
        return;
      }
      // A move: the clip under the pointer leads; everything else selected follows by the same amount.
      const here = d.kind === "video" ? findClip(d.base, d.primary) : findAudio(d.base, d.primary);
      if (!here) return;
      const c = here.clip;
      const seconds = d.kind === "video" ? (c as Clip).end - (c as Clip).start : pieceSeconds(c as AudioClip);
      const points = snapPoints(d.base, d.ids, tRef.current);
      const want = c.at + dt;
      const snapped = snapTo(want, seconds, points, reach);
      setSnapLine(snappedEdge(want, snapped, seconds, points));
      if (d.ids.length > 1) {
        onLive(shiftClips(d.base, d.ids, snapped - c.at));
        return;
      }
      // Dragging past the last track makes a new one: one, however far the pointer goes (the live sequence already shows it).
      const over = trackAtY(d.kind, e.clientY);
      const track = over === undefined ? here.track : Math.min(over, d.kind === "video" ? d.base.video.length : d.base.audio.length);
      const next = d.kind === "video" ? moveVideo(d.base, d.primary, track, snapped) : moveAudio(d.base, d.primary, track, snapped);
      onLive(next);
    };
    const up = () => {
      scrub.current = false;
      const d = drag.current;
      drag.current = null;
      setSnapLine(null);
      if (!d?.moved) return;
      onDrop(d.base);
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
    return () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerSec, onSeek, onLive, onDrop, snap, game.fps]);

  // ── drops out of the library ──
  const onDragOver = (e: React.DragEvent) => {
    const p = dragPayload.current;
    if (!p || locked) return;
    e.preventDefault();
    const kind: Kind = p.kind === "footage" ? "video" : p.kind === "take" ? "audio" : "overlay";
    const track = trackAtY(kind, e.clientY);
    if (track === undefined) {
      e.dataTransfer.dropEffect = "none";
      return setGhost(null);
    }
    e.dataTransfer.dropEffect = "copy";
    const want = timeAtX(e.clientX);
    const at = snapTo(want, p.seconds, snapPoints(seqRef.current, [], tRef.current), reachFor(e.altKey));
    setGhost({ kind, track, at, seconds: p.seconds });
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!lane.current?.contains(e.relatedTarget as Node)) setGhost(null);
  };
  const onLaneDrop = (e: React.DragEvent) => {
    const p = dragPayload.current;
    const g = ghostRef.current;
    e.preventDefault();
    setGhost(null);
    if (!p || !g || locked) return;
    if (p.kind === "footage") onDropFootage(p.file, g.track, g.at);
    else if (p.kind === "take") onDropTake(p.take, g.track, g.at);
    else onDropCard(p.card, g.at);
  };

  /** A clip's filmstrip: its recording's strip, sized so its slice lines up. Zoomed in, a denser one (in doubling steps) is layered over the coarse one. */
  const stripOf = (c: Clip): string => {
    const file = fileOf(c.src);
    const coarse = Math.max(24, Math.min(96, Math.ceil(c.sourceSeconds / 0.75)));
    const want = Math.ceil((c.sourceSeconds * pxPerSec) / (ROW.video * Math.min(4, c.aspect)));
    const dense = Math.min(1024, 2 ** Math.ceil(Math.log2(Math.max(1, want))));
    return [...(dense > coarse ? [dense] : []), coarse].map((n) => `url("${api.clipStrip(file, n)}")`).join(", ");
  };
  const muteButton = (kind: Kind, id: string, muted: boolean, trackMuted: boolean) => (
    <button
      className={`cmute${muted ? " off" : ""}`}
      disabled={locked}
      title={trackMuted ? "The whole track is silent" : muted ? "This clip is silent: click to hear it" : "Silence this clip's sound"}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onMuteClip(kind, id, !muted);
      }}
    >
      {muted || trackMuted ? "🔇" : "🔊"}
    </button>
  );

  // Zoomed out, the words are closer together than they are wide: label the ones there's room for and mark the rest.
  const roomy = new Set<string>();
  {
    let right = -Infinity;
    for (const w of words) {
      const x = w.start * pxPerSec;
      if (x < right + 4) continue;
      roomy.add(`${w.take}:${w.index}`);
      right = x + w.text.length * 7.4 + 10;
    }
  }
  const tickEvery = pxPerSec > 160 ? 0.5 : pxPerSec > 70 ? 1 : pxPerSec > 30 ? 2 : pxPerSec > 12 ? 5 : 10;
  const ticks = Array.from({ length: Math.floor(laneSeconds / tickEvery) + 1 }, (_, i) => i * tickEvery);
  const markers = seq.markers ?? [];
  const cards = [...(seq.overlay?.cards ?? [])].sort((a, b) => a.at - b.at);
  const videoRows = seq.video.map((_, i) => i).reverse();
  const setRow = (key: string) => (el: HTMLDivElement | null) => {
    if (el) rows.current.set(key, el);
    else rows.current.delete(key);
  };
  // A drop above the top video track or below the last audio track lands on a track that doesn't exist yet: draw it where it will be.
  const ghostNewVideo = ghost?.kind === "video" && ghost.track >= seq.video.length;
  const ghostNewAudio = ghost?.kind === "audio" && ghost.track >= seq.audio.length;

  return (
    <div className="vtl">
      <div className="vtl-names">
        <div style={{ height: ROW.ruler }} />
        <div style={{ height: ROW.cards }} className={focus.kind === "overlay" ? "on" : ""} title="The cards: text, sketches and b-roll slots, drawn over the footage (b-roll slots are notes: never drawn)">
          <span className="tname">cards</span>
        </div>
        {ghostNewVideo ? <div style={{ height: ROW.video }}>V{seq.video.length + 1}</div> : null}
        {videoRows.map((i) => {
          const tr = seq.video[i]!;
          return (
            <div key={`vn${i}`} style={{ height: ROW.video }} className={focus.kind === "video" && focus.track === i ? "on" : ""} title={i === 0 ? "The bottom track: it fills the frame when it has picture" : "Plays stacked over the track below where both have picture"}>
              <span className="tname">V{i + 1}</span>
              <button className={`vmute${tr.muted ? " off" : ""}`} disabled={locked} onClick={() => onToggleVideoTrack(i)} title={tr.muted ? "This track's footage is silent: click to hear it" : "Silence the footage on this whole track (the picture still plays)"}>
                {tr.muted ? "🔇" : "🔊"}
              </button>
              {i === seq.video.length - 1 ? (
                <button className="vadd" disabled={locked} onClick={onAddVideoTrack} title="Another video track above this one">
                  +
                </button>
              ) : null}
            </div>
          );
        })}
        {seq.audio.map((a, i) => (
          <div key={`an${i}`} style={{ height: ROW.audio }} className={focus.kind === "audio" && focus.track === i ? "on" : ""}>
            <span className="tname">A{i + 1}</span>
            <button className={`vmute${a.muted ? " off" : ""}`} disabled={locked} onClick={() => onToggleAudioTrack(i)} title={a.muted ? "This track is silent: click to hear it" : "Silence this whole track (an alternative take you want to keep)"}>
              {a.muted ? "🔇" : "🔊"}
            </button>
            {i === seq.audio.length - 1 ? (
              <button className="vadd" disabled={locked} onClick={onAddAudioTrack} title="Another audio track">
                +
              </button>
            ) : null}
          </div>
        ))}
        {ghostNewAudio ? <div style={{ height: ROW.audio }}>A{seq.audio.length + 1}</div> : null}
        <div style={{ height: ROW.words }}>
          <span className="tname">words</span>
        </div>
        <div style={{ height: ROW.music }} title="The song under the whole edit">
          <span className="tname">music</span>
        </div>
      </div>
      <div className="vtl-scroll" ref={scroller}>
        <div className="vtl-lane" ref={lane} style={{ width: laneWidthPx }} onMouseDown={onLaneDown} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onLaneDrop}>
          <div className="vruler" style={{ height: ROW.ruler }} onContextMenu={onMenu("ruler", 0)}>
            {ticks.map((s) => (
              <span key={s} style={{ left: px(s) }}>
                {s % 1 ? s.toFixed(1) : s}s
              </span>
            ))}
            {markers.map((m, i) => (
              <button key={m.id} className={`vmark${picked.marker === m.id ? " on" : ""}`} style={{ left: px(m.at) }} disabled={locked} title={`Marker ${i + 1} at ${fmtSeconds(m.at)}. Drag to move it, click it and press Delete to remove it. A list clip lands one item on each.`} onMouseDown={onMarkerDown(m.id)} onClick={(e) => e.stopPropagation()}>
                {i + 1}
              </button>
            ))}
          </div>
          <div ref={setRow("o0")} className="vrow cards" style={{ height: ROW.cards }} onMouseDown={onRowDown("overlay", 0)} onContextMenu={onMenu("overlay", 0)}>
            {cards.map((c) => (
              <div
                key={c.id}
                className={`cpiece ${c.kind}${c.place === "over" ? " over" : ""}${selected.has(c.id) ? " on" : ""}`}
                style={{ left: px(c.at), width: px(c.seconds) }}
                title={`${cardLabel(c)} · ${fmtSeconds(c.at)} → ${fmtSeconds(cardEnd(c))}${c.place === "over" ? " · over the footage" : " · on the backdrop (footage wins)"}. Drag to move it, its edges to trim.`}
                onMouseDown={onClipDown("overlay", 0, c.id)}
              >
                {(c.kind === "image" || c.kind === "build") && c.src ? <img src={api.publicUrl(c.src)} alt="" /> : null}
                <span className="ctext">{c.kind === "image" || c.kind === "build" ? "" : cardLabel(c)}</span>
                <div className="edge l" onMouseDown={onEdgeDown("overlay", 0, c.id, "start")} />
                <div className="edge r" onMouseDown={onEdgeDown("overlay", 0, c.id, "end")} />
              </div>
            ))}
            {ghost?.kind === "overlay" ? <div className="fghost" style={{ left: px(ghost.at), width: px(ghost.seconds) }} /> : null}
            {!cards.length && ghost?.kind !== "overlay" ? <div className="vempty">No cards. Add a text card or a sketch from the library's Cards shelf; organise lays one per beat.</div> : null}
          </div>
          {ghostNewVideo ? (
            <div className="vrow clip upper new" style={{ height: ROW.video }}>
              <div className="fghost" style={{ left: px(ghost!.at), width: px(ghost!.seconds) }} />
            </div>
          ) : null}
          {videoRows.map((i) => {
            const track = seq.video[i]!;
            const timed = timeTrack(track);
            const clips = [...track.clips].sort((a, b) => a.at - b.at);
            return (
              <div key={track.id} ref={setRow(`v${i}`)} className={`vrow clip${i > 0 ? " upper" : ""}${track.muted ? " off" : ""}`} style={{ height: ROW.video }} onMouseDown={onRowDown("video", i)} onContextMenu={onMenu("video", i)}>
                {clips.map((c, k) => {
                  const tm = timed[k]!;
                  return (
                    <div
                      key={c.id}
                      className={`fpiece${selected.has(c.id) ? " on" : ""}${c.muted ? " mute" : ""}`}
                      style={{ left: px(c.at), width: px(c.end - c.start), backgroundImage: stripOf(c), backgroundSize: `${c.sourceSeconds * pxPerSec}px 100%`, backgroundPosition: `${-c.start * pxPerSec}px 0` }}
                      title={`${stem(fileOf(c.src))} · ${fmtSeconds(c.start)} → ${fmtSeconds(c.end)} of the recording, at ${fmtSeconds(c.at)}${c.muted ? " · silenced" : ""}. Drag to move it (shift-click to select several), its edges to take more or less.`}
                      onMouseDown={onClipDown("video", i, c.id)}
                    >
                      <span className="fname">{stem(fileOf(c.src))}</span>
                      {muteButton("video", c.id, Boolean(c.muted), Boolean(track.muted))}
                      {tm.arrive === "slide" ? <span className="fslide" style={{ width: `${(tm.overlap / (c.end - c.start)) * 100}%` }} title={`Slides in over ${tm.overlap.toFixed(2)}s`} /> : null}
                      {tm.arrive === "cut" ? <span className="fcut" title="A hard cut (the clips touch). Drag it over the clip before for a slide." /> : null}
                      <div className="edge l" onMouseDown={onEdgeDown("video", i, c.id, "start")} />
                      <div className="edge r" onMouseDown={onEdgeDown("video", i, c.id, "end")} />
                    </div>
                  );
                })}
                {ghost?.kind === "video" && ghost.track === i ? <div className="fghost" style={{ left: px(ghost.at), width: px(ghost.seconds) }} /> : null}
                {!clips.length && !(ghost?.kind === "video" && ghost.track === i) ? <div className="vempty">{i === 0 ? "Nothing here yet: click a recording in the library, or drag one here." : "An empty track. Drag a clip up here and it plays stacked over the track below."}</div> : null}
              </div>
            );
          })}
          {seq.audio.map((track, i) => {
            const clips = [...track.clips].sort((a, b) => a.at - b.at);
            return (
              <div key={track.id} ref={setRow(`a${i}`)} className={`vrow voice${track.muted ? " off" : ""}`} style={{ height: ROW.audio }} onMouseDown={onRowDown("audio", i)} onContextMenu={onMenu("audio", i)}>
                {clips.map((p) => {
                  const take = seq.takes[p.take];
                  return (
                    <div
                      key={p.id}
                      className={`vpiece${selected.has(p.id) ? " on" : ""}${p.muted ? " mute" : ""}`}
                      style={{ left: px(p.at), width: px(pieceSeconds(p)) }}
                      title={`${fmtSeconds(p.at)} → ${fmtSeconds(pieceEnd(p))} · take ${p.take + 1}${p.muted ? " · silenced" : ""}. Drag to move it, its edges to trim.`}
                      onMouseDown={onClipDown("audio", i, p.id)}
                    >
                      <Wave peaks={peaks[take?.file ?? ""]} start={p.start} end={p.end} width={pieceSeconds(p) * pxPerSec} height={ROW.audio - 4} />
                      <span className="fname">take {p.take + 1}</span>
                      {muteButton("audio", p.id, Boolean(p.muted), Boolean(track.muted))}
                      <div className="edge l" onMouseDown={onEdgeDown("audio", i, p.id, "start")} />
                      <div className="edge r" onMouseDown={onEdgeDown("audio", i, p.id, "end")} />
                    </div>
                  );
                })}
                {rec.state === "on" && rec.track === i ? <div className="vrec" style={{ left: px(rec.at), width: px(Math.max(0, t - rec.at)) }} /> : null}
                {ghost?.kind === "audio" && ghost.track === i ? <div className="fghost" style={{ left: px(ghost.at), width: px(ghost.seconds) }} /> : null}
                {!clips.length && !(rec.state === "on" && rec.track === i) && !(ghost?.kind === "audio" && ghost.track === i) ? <div className="vempty">{i === 0 ? "Nothing said yet. Put the playhead where you want to start talking and press Record." : "An empty audio track."}</div> : null}
              </div>
            );
          })}
          {ghostNewAudio ? (
            <div className="vrow voice new" style={{ height: ROW.audio }}>
              <div className="fghost" style={{ left: px(ghost!.at), width: px(ghost!.seconds) }} />
            </div>
          ) : null}
          <div className="vrow words" style={{ height: ROW.words }}>
            {words.map((w) => {
              const on = picked.word?.take === w.take && picked.word.word === w.index;
              const edit = editing && editing.take === w.take && editing.word === w.index ? editing : null;
              return edit ? (
                <input
                  key={`${w.take}:${w.index}`}
                  className="vword-edit"
                  autoFocus
                  style={{ left: px(w.start), width: Math.max(70, edit.text.length * 8 + 24) }}
                  value={edit.text}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => onEditWord({ ...edit, text: e.target.value })}
                  onBlur={() => onRetype(w.take, w.index, edit.text)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onRetype(w.take, w.index, edit.text);
                    else if (e.key === "Escape") onEditWord(null);
                  }}
                />
              ) : (
                <span
                  key={`${w.take}:${w.index}`}
                  className={`vword${on ? " on" : ""}${w.hidden ? " hidden" : ""}${t >= w.start && t < w.end ? " now" : ""}${roomy.has(`${w.take}:${w.index}`) ? "" : " tick"}`}
                  style={{ left: px(w.start) }}
                  title={`${w.text}${w.hidden ? " (kept off the captions)" : ""} · double-click to fix it`}
                  onMouseDown={(e) => {
                    if (locked) return;
                    e.stopPropagation();
                    onPick({ clips: [], word: { take: w.take, word: w.index } });
                    onSeek(w.start);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onEditWord({ take: w.take, word: w.index, text: w.text });
                  }}
                >
                  {w.text}
                </span>
              );
            })}
            {seq.audio.some((a) => a.clips.length) && !words.length ? <div className="vempty">{rec.state === "words" ? "Listening…" : "No words heard yet."}</div> : null}
          </div>
          <div className="vrow music" style={{ height: ROW.music }} onContextMenu={onMenu("music", 0)} onDoubleClick={onMusic}>
            {seq.music ? (
              <div className="mpiece" style={{ left: 0, width: laneWidthPx }} title={`${seq.music.song} from ${fmtSeconds(seq.music.from)} at ${Math.round(seq.music.level * 100)}%. Double-click to change it.`}>
                ♪ {stem(seq.music.song)} · from {fmtSeconds(seq.music.from)} · {Math.round(seq.music.level * 100)}%
              </div>
            ) : (
              <div className="vempty">No music. Pick a song on the Music tab (or double-click here).</div>
            )}
          </div>
          {markers.map((m) => (
            <div key={m.id} className={`vmark-line${picked.marker === m.id ? " on" : ""}`} style={{ left: px(m.at) }} />
          ))}
          {total > 0 ? <div className="vend" style={{ left: px(total) }} title="Where the edit ends" /> : null}
          {snapLine !== null ? <div className="vsnap" style={{ left: px(snapLine) }} /> : null}
          <div className="vhead" style={{ left: px(t) }} />
        </div>
      </div>
    </div>
  );
};
