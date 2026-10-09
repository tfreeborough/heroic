/**
 * The canvas and everything the pointer does on it: draw, select, move,
 * resize, pan, zoom, type. Painting is render.ts; this file is input.
 */
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Handle, type Rect, bounds, fitInto, handlePoint, HANDLES, hits, inRect, normalize, rectContains, resizeRect, union } from "../lib/geometry";
import { glyphById } from "../lib/glyphs";
import { type Element, type FormatId, type PenEl, type Point, type Style, type TextEl, type Timeline, FORMATS, seed, uid } from "../lib/scene";
import { type Camera, fontFor, LINE_HEIGHT, measureText, render, setImageListener, toScreen, toWorld } from "./render";

export type Tool = "select" | "hand" | "pen" | "rect" | "ellipse" | "diamond" | "arrow" | "line" | "text" | "stamp" | "frame" | "eraser";
export type PendingStamp = { kind: "image"; src: string; w: number; h: number } | { kind: "glyph"; id: string };
export type Editing = { el: TextEl; isNew: boolean };

export type BoardProps = {
  elements: Element[];
  /** Apply a change (no undo step). */
  update: (fn: (els: Element[]) => Element[]) => void;
  /** The elements as they are right now (for a drag's "before"). */
  current: () => Element[];
  /** Record `before` as an undo step, if anything changed since. */
  commit: (before: Element[]) => void;
  selection: ReadonlySet<string>;
  setSelection: (ids: ReadonlySet<string>) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  toolLocked: boolean;
  style: Style;
  camera: Camera;
  setCamera: (c: Camera | ((c: Camera) => Camera)) => void;
  pendingStamp?: PendingStamp;
  onStampPlaced: () => void;
  frameFormat: FormatId;
  replayTime?: number;
  timeline?: Timeline;
  present: boolean;
  grid: boolean;
  background: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
};

type Drag =
  | { kind: "pan"; start: Point; cam: Camera }
  | { kind: "marquee"; start: Point; cur: Point; before: ReadonlySet<string> }
  | { kind: "move"; start: Point; before: Element[]; orig: Map<string, Element>; moved: boolean }
  | { kind: "resize"; handle: Handle; start: Point; before: Element[]; orig: Map<string, Element>; box: Rect }
  | { kind: "endpoint"; id: string; index: number; before: Element[]; orig: Element }
  | { kind: "create"; start: Point; el: Element; before: Element[] }
  | { kind: "pen"; el: PenEl; t0: number; before: Element[] }
  | { kind: "erase"; before: Element[] };

const SHAPE_TOOLS = new Set<Tool>(["rect", "ellipse", "diamond", "arrow", "line", "frame"]);
const CURSOR: Record<Tool, string> = { select: "default", hand: "grab", pen: "crosshair", rect: "crosshair", ellipse: "crosshair", diamond: "crosshair", arrow: "crosshair", line: "crosshair", text: "text", stamp: "copy", frame: "crosshair", eraser: "cell" };
const HANDLE_CURSOR: Record<Handle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };

const base = (style: Style, x: number, y: number) => ({ ...style, id: uid(), x, y, seed: seed(), t: Date.now(), dur: 0 });

export const Board = (p: BoardProps) => {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = p.canvasRef;
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<Element | undefined>();
  const [marquee, setMarquee] = useState<Rect | undefined>();
  const [size, setSize] = useState({ w: 1, h: 1, dpr: 1 });
  const [cursor, setCursor] = useState("default");
  const spaceHeld = useRef(false);
  const frame = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // ---- sizing + painting -------------------------------------------------
  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height), dpr: window.devicePixelRatio || 1 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paint = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const replaying = p.replayTime !== undefined;
    render(ctx, size, p.camera, p.elements, {
      background: p.background,
      grid: p.grid && !replaying && !p.present,
      selection: replaying || p.editing ? undefined : p.selection,
      skip: p.editing && !p.editing.isNew ? new Set([p.editing.el.id]) : undefined,
      extra: draft ? [draft] : undefined,
      marquee,
      present: p.present,
      time: p.replayTime,
      timeline: p.timeline,
      hideFrame: replaying && p.present,
      frameLabel: FORMATS[p.frameFormat].label,
    });
  }, [canvas, size, p.camera, p.elements, p.background, p.grid, p.selection, p.editing, draft, marquee, p.present, p.replayTime, p.timeline, p.frameFormat]);

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame.current);
  }, [paint]);
  useEffect(() => {
    setImageListener(() => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(paint);
    });
  }, [paint]);

  // ---- helpers -----------------------------------------------------------
  const screenPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const worldPoint = (e: { clientX: number; clientY: number }): Point => toWorld(p.camera, screenPoint(e));
  const tol = () => 7 / p.camera.zoom;

  const topmostAt = (pt: Point, els = p.elements): Element | undefined => {
    for (let i = els.length - 1; i >= 0; i--) if (hits(els[i]!, pt, tol())) return els[i];
    return undefined;
  };
  const selected = () => p.elements.filter((e) => p.selection.has(e.id));
  const selectionBox = (): Rect | undefined => union(selected().map(bounds));

  /** Which handle (if any) of the current selection is under a screen point. */
  const handleAt = (sp: Point): Handle | undefined => {
    const box = selectionBox();
    if (!box) return undefined;
    const only = selected().length === 1 ? selected()[0] : undefined;
    if (only && (only.type === "pen" || only.type === "line" || only.type === "arrow")) return undefined;
    for (const h of HANDLES) {
      const [hx, hy] = toScreen(p.camera, handlePoint(box, h));
      if (Math.abs(sp[0] - hx) <= 7 && Math.abs(sp[1] - hy) <= 7) return h;
    }
    return undefined;
  };
  const endpointAt = (sp: Point): { el: Element; index: number } | undefined => {
    const sel = selected();
    if (sel.length !== 1) return undefined;
    const el = sel[0]!;
    if (el.type !== "line" && el.type !== "arrow") return undefined;
    for (let i = 0; i < el.points.length; i++) {
      const [px, py] = toScreen(p.camera, [el.points[i]![0] + el.x, el.points[i]![1] + el.y]);
      if (Math.hypot(sp[0] - px, sp[1] - py) <= 8) return { el, index: i };
    }
    return undefined;
  };

  const finishTool = () => {
    if (!p.toolLocked && p.tool !== "select") p.setTool("select");
  };

  // ---- text editing --------------------------------------------------------
  const startText = (at: Point, existing?: TextEl) => {
    if (existing) {
      p.setEditing({ el: existing, isNew: false });
      p.setSelection(new Set([existing.id]));
      return;
    }
    const m = measureText("", p.style.font, p.style.fontSize);
    const el: TextEl = { ...base(p.style, at[0], at[1] - (p.style.fontSize * LINE_HEIGHT) / 2), type: "text", text: "", w: m.w, h: m.h };
    p.setEditing({ el, isNew: true });
    p.setSelection(new Set());
  };
  const finishText = useCallback(() => {
    const ed = p.editing;
    if (!ed) return;
    const text = ed.el.text.replace(/\s+$/, "");
    const before = p.current();
    if (!text) {
      if (!ed.isNew) {
        p.update((els) => els.filter((e) => e.id !== ed.el.id));
        p.commit(before);
      }
    } else {
      const m = measureText(text, ed.el.font, ed.el.fontSize);
      const el: TextEl = { ...ed.el, text, w: m.w, h: m.h, ...(ed.isNew ? { t: Date.now(), dur: text.length * 60 } : {}) };
      p.update((els) => (ed.isNew ? [...els, el] : els.map((e) => (e.id === el.id ? el : e))));
      p.commit(before);
      p.setSelection(new Set([el.id]));
    }
    p.setEditing(null);
    finishTool();
  }, [p]);
  useEffect(() => {
    if (p.editing) setTimeout(() => textarea.current?.focus(), 0);
  }, [p.editing?.el.id]);

  // ---- pointer -------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (p.editing) {
      finishText();
      return;
    }
    if (p.replayTime !== undefined) return;
    // The canvas never wants focus; a click on it ends typing in any panel
    // field, and must NOT steal focus from the text box opened below.
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== canvas.current) document.activeElement.blur();
    canvas.current!.setPointerCapture(e.pointerId);
    const sp = screenPoint(e), wp = worldPoint(e);
    const panning = p.tool === "hand" || spaceHeld.current || e.button === 1;
    if (panning) {
      drag.current = { kind: "pan", start: sp, cam: p.camera };
      setCursor("grabbing");
      return;
    }
    if (e.button !== 0) return;
    const before = p.current();
    switch (p.tool) {
      case "select": {
        const h = handleAt(sp);
        if (h) {
          drag.current = { kind: "resize", handle: h, start: wp, before, orig: new Map(selected().map((x) => [x.id, x])), box: selectionBox()! };
          return;
        }
        const ep = endpointAt(sp);
        if (ep) {
          drag.current = { kind: "endpoint", id: ep.el.id, index: ep.index, before, orig: ep.el };
          return;
        }
        const hit = topmostAt(wp);
        if (hit) {
          let sel: Set<string>;
          if (e.shiftKey) {
            sel = new Set(p.selection);
            if (sel.has(hit.id)) sel.delete(hit.id); else sel.add(hit.id);
          } else sel = p.selection.has(hit.id) ? new Set(p.selection) : new Set([hit.id]);
          p.setSelection(sel);
          drag.current = { kind: "move", start: wp, before, orig: new Map(p.elements.filter((x) => sel.has(x.id)).map((x) => [x.id, x])), moved: false };
        } else {
          if (!e.shiftKey) p.setSelection(new Set());
          drag.current = { kind: "marquee", start: wp, cur: wp, before: e.shiftKey ? p.selection : new Set() };
        }
        return;
      }
      case "pen": {
        const el: PenEl = { ...base(p.style, wp[0], wp[1]), type: "pen", points: [[0, 0]] };
        drag.current = { kind: "pen", el, t0: performance.now(), before };
        setDraft(el);
        return;
      }
      case "text":
        startText(wp);
        return;
      case "stamp": {
        const s = p.pendingStamp;
        if (!s) { p.setTool("select"); return; }
        let el: Element;
        if (s.kind === "image") {
          const w = Math.min(s.w, 220), h = (s.h / s.w) * w;
          el = { ...base(p.style, wp[0] - w / 2, wp[1] - h / 2), type: "image", src: s.src, w, h };
        } else {
          const aspect = glyphById(s.id)?.aspect ?? 1;
          const h = 120, w = h * aspect;
          el = { ...base(p.style, wp[0] - w / 2, wp[1] - h / 2), type: "glyph", glyph: s.id, w, h };
        }
        p.update((els) => [...els, el]);
        p.commit(before);
        p.setSelection(new Set([el.id]));
        if (!p.toolLocked) { p.onStampPlaced(); p.setTool("select"); }
        return;
      }
      case "eraser": {
        drag.current = { kind: "erase", before };
        const hit = topmostAt(wp);
        if (hit) p.update((els) => els.filter((x) => x.id !== hit.id));
        return;
      }
      default: {
        if (!SHAPE_TOOLS.has(p.tool)) return;
        let el: Element;
        if (p.tool === "arrow" || p.tool === "line") el = { ...base(p.style, wp[0], wp[1]), type: p.tool, points: [[0, 0], [0, 0]] };
        else if (p.tool === "frame") el = { ...base(p.style, wp[0], wp[1]), type: "frame", w: 0, h: 0, format: p.frameFormat };
        else el = { ...base(p.style, wp[0], wp[1]), type: p.tool as "rect" | "ellipse" | "diamond", w: 0, h: 0 };
        drag.current = { kind: "create", start: wp, el, before };
        setDraft(el);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const sp = screenPoint(e);
    if (!d) {
      if (p.tool === "select") {
        const h = handleAt(sp);
        setCursor(h ? HANDLE_CURSOR[h] : endpointAt(sp) ? "move" : topmostAt(worldPoint(e)) ? "move" : "default");
      } else setCursor(spaceHeld.current ? "grab" : CURSOR[p.tool]);
      return;
    }
    const wp = worldPoint(e);
    switch (d.kind) {
      case "pan":
        p.setCamera({ ...d.cam, x: d.cam.x - (sp[0] - d.start[0]) / d.cam.zoom, y: d.cam.y - (sp[1] - d.start[1]) / d.cam.zoom });
        return;
      case "marquee": {
        d.cur = wp;
        const r = normalize({ x: d.start[0], y: d.start[1], w: wp[0] - d.start[0], h: wp[1] - d.start[1] });
        setMarquee(r);
        const sel = new Set(d.before);
        for (const el of p.elements) if (rectContains(r, bounds(el))) sel.add(el.id);
        p.setSelection(sel);
        return;
      }
      case "move": {
        const dx = wp[0] - d.start[0], dy = wp[1] - d.start[1];
        if (!d.moved && Math.hypot(dx, dy) * p.camera.zoom < 3) return;
        d.moved = true;
        p.update((els) => els.map((el) => {
          const o = d.orig.get(el.id);
          return o ? { ...o, x: o.x + dx, y: o.y + dy } : el;
        }));
        return;
      }
      case "resize": {
        const to = resizeRect(d.box, d.handle, wp[0] - d.start[0], wp[1] - d.start[1], e.shiftKey || [...d.orig.values()].some((o) => o.type === "image" || o.type === "frame" || o.type === "text"));
        p.update((els) => els.map((el) => {
          const o = d.orig.get(el.id);
          return o ? fitInto(o, d.box, to) : el;
        }));
        return;
      }
      case "endpoint": {
        p.update((els) => els.map((el) => {
          if (el.id !== d.id || (el.type !== "line" && el.type !== "arrow")) return el;
          let np: Point = [wp[0] - el.x, wp[1] - el.y];
          if (e.shiftKey) {
            const other = el.points[d.index === 0 ? 1 : 0] ?? [0, 0];
            np = snapAngle(other, np);
          }
          return { ...el, points: el.points.map((q, i) => (i === d.index ? np : q)) };
        }));
        return;
      }
      case "pen": {
        const pt: Point = [wp[0] - d.el.x, wp[1] - d.el.y];
        const last = d.el.points[d.el.points.length - 1]!;
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 1.5 / p.camera.zoom) return;
        d.el = { ...d.el, points: [...d.el.points, pt] };
        setDraft(d.el);
        return;
      }
      case "create": {
        let w = wp[0] - d.start[0], h = wp[1] - d.start[1];
        const el = d.el;
        if (el.type === "arrow" || el.type === "line") {
          let end: Point = [w, h];
          if (e.shiftKey) end = snapAngle([0, 0], end);
          d.el = { ...el, points: [[0, 0], end] };
        } else if (el.type === "frame") {
          const f = FORMATS[el.format];
          const aspect = f.w / f.h;
          const mag = Math.max(Math.abs(w), Math.abs(h) * aspect);
          w = Math.sign(w || 1) * mag;
          h = Math.sign(h || 1) * (mag / aspect);
          d.el = { ...el, w, h };
        } else {
          if (e.shiftKey) {
            const m = Math.max(Math.abs(w), Math.abs(h));
            w = Math.sign(w || 1) * m;
            h = Math.sign(h || 1) * m;
          }
          d.el = { ...el, w, h } as Element;
        }
        setDraft(d.el);
        return;
      }
      case "erase": {
        const hit = topmostAt(wp);
        if (hit) p.update((els) => els.filter((x) => x.id !== hit.id));
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const wp = worldPoint(e);
    setCursor(p.tool === "select" ? "default" : CURSOR[p.tool]);
    switch (d.kind) {
      case "marquee":
        setMarquee(undefined);
        return;
      case "move":
        if (d.moved) p.commit(d.before);
        else if (!e.shiftKey) {
          // A plain click on something inside a multi-selection picks just it.
          const hit = topmostAt(wp);
          if (hit && p.selection.size > 1) p.setSelection(new Set([hit.id]));
        }
        return;
      case "resize":
      case "endpoint":
      case "erase":
        p.commit(d.before);
        return;
      case "pen": {
        setDraft(undefined);
        const el: PenEl = { ...d.el, dur: Math.round(performance.now() - d.t0) };
        p.update((els) => [...els, el]);
        p.commit(d.before);
        finishTool();
        return;
      }
      case "create": {
        setDraft(undefined);
        let el = d.el;
        const tiny = (el.type === "arrow" || el.type === "line") ? Math.hypot(...(el.points[1] ?? [0, 0])) < 4 : Math.abs((el as { w: number }).w) < 4 && Math.abs((el as { h: number }).h) < 4;
        if (tiny) {
          // A click, not a drag: a default-sized one, centred on the click.
          if (el.type === "arrow" || el.type === "line") el = { ...el, x: el.x - 80, points: [[0, 0], [160, 0]] };
          else if (el.type === "frame") {
            const f = FORMATS[el.format];
            const h = Math.min(size.h, size.w / (f.w / f.h)) * 0.8 / p.camera.zoom, w = h * (f.w / f.h);
            el = { ...el, x: p.camera.x + size.w / p.camera.zoom / 2 - w / 2, y: p.camera.y + size.h / p.camera.zoom / 2 - h / 2, w, h };
          } else el = { ...el, x: el.x - 80, y: el.y - 50, w: 160, h: 100 } as Element;
        } else if (el.type !== "arrow" && el.type !== "line") {
          const r = normalize({ x: el.x, y: el.y, w: (el as { w: number }).w, h: (el as { h: number }).h });
          el = { ...el, ...r } as Element;
        }
        if (el.type === "frame") p.update((els) => [...els.filter((x) => x.type !== "frame"), el]);
        else p.update((els) => [...els, el]);
        p.commit(d.before);
        p.setSelection(new Set([el.id]));
        finishTool();
        return;
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (p.replayTime !== undefined) return;
    const wp = worldPoint(e);
    const hit = topmostAt(wp);
    if (hit?.type === "text") startText(wp, hit);
    else if (!hit && p.tool === "select") startText(wp);
  };

  // ---- wheel: pinch/ctrl = zoom about the cursor, else pan ------------------
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const sp: Point = [e.clientX - r.left, e.clientY - r.top];
      if (e.ctrlKey || e.metaKey) {
        p.setCamera((cam) => {
          const zoom = Math.min(8, Math.max(0.1, cam.zoom * Math.exp(-e.deltaY * 0.01)));
          const before = toWorld(cam, sp);
          const next = { ...cam, zoom };
          const after = toWorld(next, sp);
          return { zoom, x: cam.x + (before[0] - after[0]), y: cam.y + (before[1] - after[1]) };
        });
      } else p.setCamera((cam) => ({ ...cam, x: cam.x + e.deltaX / cam.zoom, y: cam.y + e.deltaY / cam.zoom }));
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [canvas, p.setCamera]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
        spaceHeld.current = true;
        if (!drag.current) setCursor("grab");
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld.current = false;
        if (!drag.current) setCursor(p.tool === "select" ? "default" : CURSOR[p.tool]);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [p.tool]);

  // ---- the text editor overlay ---------------------------------------------
  const ed = p.editing;
  const edPos = ed ? toScreen(p.camera, [ed.el.x, ed.el.y]) : undefined;

  return (
    <div ref={wrap} className="board" style={{ cursor }}>
      <canvas
        ref={canvas}
        width={Math.round(size.w * size.dpr)}
        height={Math.round(size.h * size.dpr)}
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      {ed && edPos && (
        <textarea
          ref={textarea}
          autoFocus
          className="textedit"
          value={ed.el.text}
          spellCheck={false}
          style={{
            left: edPos[0], top: edPos[1],
            font: fontFor(ed.el.font, ed.el.fontSize), color: ed.el.stroke, lineHeight: `${ed.el.fontSize * LINE_HEIGHT}px`,
            width: Math.max(ed.el.w, ed.el.fontSize * 2) + ed.el.fontSize, height: ed.el.h + 4,
            transform: `scale(${p.camera.zoom})`, opacity: ed.el.opacity,
          }}
          onChange={(e) => {
            const text = e.target.value;
            const m = measureText(text, ed.el.font, ed.el.fontSize);
            p.setEditing({ ...ed, el: { ...ed.el, text, w: m.w, h: m.h } });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishText(); }
            e.stopPropagation();
          }}
          onBlur={finishText}
        />
      )}
    </div>
  );
};

/** Snap the vector other→pt to the nearest 15°. */
const snapAngle = (other: Point, pt: Point): Point => {
  const dx = pt[0] - other[0], dy = pt[1] - other[1];
  const len = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
  return [other[0] + len * Math.cos(a), other[1] + len * Math.sin(a)];
};

export { inRect };
