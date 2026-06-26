import { useEffect, useRef } from "react";
import type { Aabb, Zone } from "@heroic/core";
import { drawZone, type View } from "./zoneRenderer";
import type { Corner, EditPointer, Selection } from "../edit/types";

interface Props {
  /** The runtime zone (derived in App so it can also validate placements). */
  zone: Zone;
  /** Changes only when a different file is opened → triggers a refit. */
  fitToken: number;
  selection: Selection | null;
  /** Show the per-cell grid. */
  showGrid: boolean;
  /** When set (new object each request), centre the camera here. */
  focus: { x: number; y: number } | null;
  /** A free collision rect being dragged out (preview). */
  pending: { box: Aabb; valid: boolean } | null;
  /** The selected breakable's box — draws corner handles + enables resize drags. */
  resizeBox: Aabb | null;
  /** Left/right edit events (down/drag/up). Middle-drag pan is internal. */
  onPointer: (e: EditPointer) => void;
  /** Whether the current tool's action at a cell is valid (drives the hover tint). */
  validateHover: (col: number, row: number) => boolean;
}

export const Viewport = ({
  zone,
  fitToken,
  selection,
  showGrid,
  focus,
  pending,
  resizeBox,
  onPointer,
  validateHover,
}: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ camX: 0, camY: 0, zoom: 1 });
  const fittedRef = useRef(false);

  const live = useRef({
    zone,
    onPointer,
    selection,
    validateHover,
    showGrid,
    pending,
    resizeBox,
    hover: null as { col: number; row: number } | null,
  });
  live.current.zone = zone;
  live.current.onPointer = onPointer;
  live.current.selection = selection;
  live.current.validateHover = validateHover;
  live.current.showGrid = showGrid;
  live.current.pending = pending;
  live.current.resizeBox = resizeBox;

  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    fittedRef.current = false; // a different file → refit
    drawRef.current();
  }, [fitToken]);
  useEffect(() => {
    drawRef.current();
  }, [zone, selection, showGrid, pending, resizeBox]);
  // Centre the camera on a focused point (e.g. clicking a validation issue).
  useEffect(() => {
    if (!focus) return;
    viewRef.current.camX = focus.x;
    viewRef.current.camY = focus.y;
    drawRef.current();
  }, [focus]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      const z = live.current.zone;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      const bw = Math.round(cssW * dpr);
      const bh = Math.round(cssH * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      if (!fittedRef.current) {
        const fit = 0.92 * Math.min(cssW / z.size.x, cssH / z.size.y);
        viewRef.current = { camX: z.size.x / 2, camY: z.size.y / 2, zoom: fit };
        fittedRef.current = true;
      }
      const hv = live.current.hover;
      // Recompute validity each draw so it stays fresh after an edit, not just on move.
      const valid = hv ? live.current.validateHover(hv.col, hv.row) : true;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawZone(ctx, z, viewRef.current, cssW, cssH, {
        grid: live.current.showGrid,
        hover: hv,
        hoverValid: valid,
        selection: live.current.selection,
        pending: live.current.pending,
        resize: live.current.resizeBox,
      });
    };
    drawRef.current = draw;
    const requestDraw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };

    const at = (clientX: number, clientY: number) => {
      const z = live.current.zone;
      const v = viewRef.current;
      const rect = canvas.getBoundingClientRect();
      const wx = v.camX + (clientX - rect.left - rect.width / 2) / v.zoom;
      const wy = v.camY + (clientY - rect.top - rect.height / 2) / v.zoom;
      return { wx, wy, col: Math.floor(wx / z.tileSize), row: Math.floor(wy / z.tileSize) };
    };
    const emit = (
      clientX: number,
      clientY: number,
      phase: EditPointer["phase"],
      button: "left" | "right",
      handle?: Corner,
    ) => {
      const p = at(clientX, clientY);
      live.current.onPointer({ phase, button, wx: p.wx, wy: p.wy, col: p.col, row: p.row, handle });
    };

    /** Which corner handle of the selected box is under the cursor (screen-tolerant), if any. */
    const handleAt = (clientX: number, clientY: number): Corner | undefined => {
      const rb = live.current.resizeBox;
      if (!rb) return undefined;
      const { wx, wy } = at(clientX, clientY);
      const tol = 9 / viewRef.current.zoom;
      const w = rb.x - rb.w / 2;
      const e = rb.x + rb.w / 2;
      const n = rb.y - rb.h / 2;
      const s = rb.y + rb.h / 2;
      const corners: [Corner, number, number][] = [
        ["nw", w, n],
        ["ne", e, n],
        ["sw", w, s],
        ["se", e, s],
      ];
      for (const [c, cx, cy] of corners) {
        if (Math.abs(wx - cx) <= tol && Math.abs(wy - cy) <= tol) return c;
      }
      return undefined;
    };
    const updateHover = (clientX: number, clientY: number) => {
      const p = at(clientX, clientY);
      const h = live.current.hover;
      if (!h || h.col !== p.col || h.row !== p.row) {
        live.current.hover = { col: p.col, row: p.row };
        requestDraw();
      }
    };

    let panning = false;
    let editing: "left" | "right" | null = null;
    let activeHandle: Corner | undefined;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1) {
        panning = true;
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      editing = e.button === 2 ? "right" : "left";
      // A left-drag starting on a corner handle is a resize, not a place/move.
      activeHandle = editing === "left" ? handleAt(e.clientX, e.clientY) : undefined;
      updateHover(e.clientX, e.clientY);
      emit(e.clientX, e.clientY, "down", editing, activeHandle);
    };
    const onMove = (e: PointerEvent) => {
      updateHover(e.clientX, e.clientY);
      if (panning) {
        const v = viewRef.current;
        v.camX -= (e.clientX - lastX) / v.zoom;
        v.camY -= (e.clientY - lastY) / v.zoom;
        lastX = e.clientX;
        lastY = e.clientY;
        requestDraw();
      } else if (editing) {
        emit(e.clientX, e.clientY, "drag", editing, activeHandle);
      }
    };
    const onUp = (e: PointerEvent) => {
      canvas.releasePointerCapture(e.pointerId);
      if (panning) {
        panning = false;
      } else if (editing) {
        emit(e.clientX, e.clientY, "up", editing, activeHandle);
        editing = null;
        activeHandle = undefined;
      }
    };
    const onLeave = () => {
      if (live.current.hover) {
        live.current.hover = null;
        requestDraw();
      }
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left - rect.width / 2;
      const sy = e.clientY - rect.top - rect.height / 2;
      const wx = v.camX + sx / v.zoom;
      const wy = v.camY + sy / v.zoom;
      v.zoom = Math.min(8, Math.max(0.05, v.zoom * Math.exp(-e.deltaY * 0.0015)));
      v.camX = wx - sx / v.zoom;
      v.camY = wy - sy / v.zoom;
      requestDraw();
    };

    const ro = new ResizeObserver(requestDraw);
    ro.observe(canvas);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    requestDraw();

    return () => {
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="viewport">
      <canvas ref={canvasRef} />
      <div className="hint">left apply · right erase/delete · middle-drag pan · scroll zoom</div>
    </div>
  );
};
