/**
 * Small parts the editor's screens share: a drawn waveform, the framing
 * window over a recording, remembered settings.
 */
import { memo, useEffect, useRef } from "react";
import { type Box, boxAspect, fitBox } from "@heroic/voiceover";
import { PEAKS_PER_SECOND } from "../mic";

export const remember = (key: string, value?: string): string => {
  try {
    if (value !== undefined) localStorage.setItem(`desk.voice.${key}`, value);
    return localStorage.getItem(`desk.voice.${key}`) ?? "";
  } catch {
    return "";
  }
};
export const stem = (file: string) => file.replace(/\.[^.]+$/, "");

/** Row heights on the timeline, px. */
export const ROW = { ruler: 22, video: 58, audio: 56, words: 30, music: 24 };

/** What's being dragged out of the library over the timeline (the browser's drag data can't be read until the drop, so it sits here). */
export type DragPayload = { kind: "footage"; file: string; seconds: number } | { kind: "take"; take: number; seconds: number };
export const dragPayload: { current: DragPayload | null } = { current: null };

/** One audio clip's sound, drawn. Re-draws only when its slice or size changes. */
export const Wave = memo<{ peaks?: Float32Array; start: number; end: number; width: number; height: number }>(({ peaks, start, end, width, height }) => {
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

/** A box moved by (dx, dy), kept inside the picture. */
export const moveBox = (b: Box, dx: number, dy: number): Box => ({ ...b, x: Math.max(0, Math.min(1 - b.w, b.x + dx)), y: Math.max(0, Math.min(1 - b.h, b.y + dy)) });
/** A box of shape `want` on screen, `h` tall, about the same centre, kept inside the picture. */
export const sizeBox = (b: Box, h: number, aspect: number, want: number): Box => {
  let hh = Math.max(0.1, Math.min(1, h));
  let w = (want * hh) / aspect;
  if (w > 1) {
    w = 1;
    hh = aspect / want;
  }
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return moveBox({ x: cx - w / 2, y: cy - hh / 2, w, h: hh }, 0, 0);
};

/**
 * Which part of a recording a clip shows: the frame of the recording with a
 * window on it the shape of the video. Drag the window to move it, turn the
 * scroll wheel over it to zoom. Dashed = nothing set yet (what you see is
 * the default: the whole picture, or the middle of a widescreen one).
 */
export const Framer: React.FC<{ img: string; aspect: number; box: Box; set: boolean; want: number; disabled: boolean; onStart: () => void; onChange: (b: Box) => void }> = ({ img, aspect, box, set, want, disabled, onStart, onChange }) => {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef<{ x0: number; y0: number; b0: Box } | null>(null);
  // Something set never has the wrong shape; the default might (a phone's whole picture in a wide video): start from the biggest box of the right shape inside it.
  const start = () => (Math.abs(boxAspect(box, aspect) - want) < 0.01 ? box : fitBox(box, aspect, want));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (disabled) return;
      e.preventDefault();
      onStart();
      const b = start();
      onChange(sizeBox(b, b.h * Math.exp(e.deltaY * 0.003), aspect, want));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = live.current;
      const el = ref.current;
      if (!d || !el) return;
      const r = el.getBoundingClientRect();
      onChange(moveBox(d.b0, (e.clientX - d.x0) / r.width, (e.clientY - d.y0) / r.height));
    };
    const up = () => (live.current = null);
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    return () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
  }, [onChange]);
  return (
    <div ref={ref} className="framer" style={{ aspectRatio: String(aspect), width: `min(100%, ${Math.round(340 * aspect)}px)`, backgroundImage: `url("${img}")` }}>
      <div
        className={`framer-box${set ? "" : " unset"}`}
        style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          onStart();
          const b = start();
          if (b !== box) onChange(b);
          live.current = { x0: e.clientX, y0: e.clientY, b0: b };
        }}
      />
    </div>
  );
};
