import { useEffect, useRef } from "react";
import { loadZone, type Zone, type ZoneFile } from "@heroic/core";
import sampleZone from "../sample-zone.json";
import { drawZone, type View } from "./zoneRenderer";

// M1 bundles realm-00 to prove the viewport renders the real zone identically to
// the game. M2 replaces this with loading a zone the user opens via the File
// System Access API (see docs/design/realmsmith.md). loadZone is the SAME core
// function the game runs, so the geometry here is the game's geometry.
const ZONE: Zone = loadZone(sampleZone as unknown as ZoneFile);

export const Viewport = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ camX: ZONE.size.x / 2, camY: ZONE.size.y / 2, zoom: 1 });
  const fittedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
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
      // Fit the whole zone in view on first paint.
      if (!fittedRef.current) {
        const fit = 0.92 * Math.min(cssW / ZONE.size.x, cssH / ZONE.size.y);
        viewRef.current = { camX: ZONE.size.x / 2, camY: ZONE.size.y / 2, zoom: fit };
        fittedRef.current = true;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawZone(ctx, ZONE, viewRef.current, cssW, cssH);
    };

    const requestDraw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };

    // Pan with a drag.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const v = viewRef.current;
      v.camX -= (e.clientX - lastX) / v.zoom;
      v.camY -= (e.clientY - lastY) / v.zoom;
      lastX = e.clientX;
      lastY = e.clientY;
      requestDraw();
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
    };

    // Zoom with the wheel, anchored under the cursor.
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
    canvas.addEventListener("wheel", onWheel, { passive: false });
    requestDraw();

    return () => {
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="viewport">
      <canvas ref={canvasRef} />
      <div className="hint">drag to pan · scroll to zoom</div>
    </div>
  );
};
