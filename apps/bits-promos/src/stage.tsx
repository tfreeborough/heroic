/**
 * The Stage: how a phone recording sits inside the frame.
 *
 * The old Footage component fitted the video with `object-fit: contain`
 * and let the warm gradient show either side. That reads as "screen
 * recording in a box". The Stage works out the recording's *visible*
 * rectangle exactly (aspect ÷ what the crops keep), so it can dress that
 * rectangle like a shot: rounded corners, a hairline, a deep shadow, a soft
 * vignette — and behind it, breathing slowly, in the shapes
 * where the portrait footage leaves room (square, landscape), the same
 * footage blurred and warmed as the fill, the way a broadcast package
 * treats a phone clip. Overlays read the rectangle via useStage() so a
 * lower third can hug the footage instead of the frame.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type * as React from "react";
import { getVideoMetadata } from "@remotion/media-utils";
import { AbsoluteFill, Easing, OffthreadVideo, continueRender, delayRender, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ditherOverlay, palette } from "./brand";
import { Backdrop, useFormat } from "./components";

/** A modern iPhone capture (the dynamic-island era) when nothing better is known. */
export const PHONE_ASPECT = 9 / 19.5;

export type StageBox = { x: number; y: number; w: number; h: number };
export type StageLayout = {
  box: StageBox;
  /** Free width either side of the footage. Landscape with a portrait clip
   * has ~500px a side — enough for text to live beside the play. */
  side: number;
  /** Text beside the footage (landscape) rather than over it. */
  column: boolean;
};
const StageContext = createContext<StageLayout | null>(null);

/** The footage rectangle, for overlays. Outside a Stage: the whole frame. */
export const useStage = (): StageLayout => {
  const ctx = useContext(StageContext);
  const { width, height } = useFormat();
  return ctx ?? { box: { x: 0, y: 0, w: width, h: height }, side: 0, column: false };
};

/**
 * The recording's aspect (w/h): from the prop when the Desk knows it (the
 * sidecar's facts), otherwise read off the file once — a delayRender so a
 * CLI render waits for it — and the phone guess if that fails.
 */
export const useSourceAspect = (src: string | null, given?: number): number => {
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    if (given || !src) return;
    let done = false;
    const handle = delayRender(`stage: measuring ${src}`);
    const finish = (aspect: number | null) => {
      if (done) return;
      done = true;
      if (aspect) setMeasured(aspect);
      continueRender(handle);
    };
    getVideoMetadata(src)
      .then((m) => finish(m.width && m.height ? m.width / m.height : null))
      .catch(() => finish(null));
    return () => finish(null);
  }, [src, given]);
  return given ?? measured ?? PHONE_ASPECT;
};

/** Where the visible footage lands: fitted whole, centred, inset when the
 * shape leaves room for the frame treatment to read. */
export const layoutStage = (
  frame: { width: number; height: number; format: string },
  aspect: number,
  keep: number,
): StageLayout => {
  const shown = aspect / keep;
  const pad = frame.format === "vertical" ? 0 : Math.round(frame.height * 0.06);
  const maxW = frame.width - pad * 2;
  const maxH = frame.height - pad * 2;
  const h = Math.min(maxH, maxW / shown);
  const w = Math.round(h * shown);
  const x = Math.round((frame.width - w) / 2);
  const y = Math.round((frame.height - h) / 2);
  const side = x;
  return { box: { x, y, w, h: Math.round(h) }, side, column: side >= 380 };
};

export const Stage: React.FC<{
  src: string;
  startFrom: number;
  muted: boolean;
  cropTop?: number;
  cropBottom?: number;
  aspect: number;
  /** Clip audio, per frame of the body. */
  volume?: (frame: number) => number;
  /** How far a push-in on the footage gets by the end of the body. Off by
   * default: the game is pixel art, and a continuous zoom over a phone
   * capture crawls a pixel at a time across those hard edges. The fill
   * breathes instead. */
  push?: number;
  children?: React.ReactNode;
}> = ({ src, startFrom, muted, cropTop = 0, cropBottom = 0, aspect, volume, push = 0, children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const shape = useFormat();
  const keep = Math.max(0.2, 1 - cropTop - cropBottom);
  const layout = layoutStage(shape, aspect, keep);
  const { box } = layout;
  // The fill only earns its decode when there's room to see it.
  const fill = box.w < shape.width * 0.9 || box.h < shape.height * 0.9;
  const drift = interpolate(frame, [0, durationInFrames], [0, 1], { easing: Easing.inOut(Easing.quad), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = 1 + push * drift;
  // The blurred fill can move freely — nothing sharp in it to crawl.
  const fillScale = 1.2 + 0.1 * drift;
  const cropStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    width: "100%",
    top: `${(-cropTop / keep) * 100}%`,
    height: `${(1 / keep) * 100}%`,
    objectFit: "cover",
  };

  return (
    <StageContext.Provider value={layout}>
      <AbsoluteFill style={{ overflow: "hidden", backgroundColor: palette.night }}>
        {fill ? (
          <>
            <AbsoluteFill style={{ transform: `scale(${fillScale})`, filter: "blur(42px) saturate(1.35) brightness(0.5)" }}>
              <OffthreadVideo src={src} startFrom={startFrom} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </AbsoluteFill>
            <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(36,23,8,0.35) 0%, rgba(36,23,8,0.55) 100%)` }} />
            <AbsoluteFill style={ditherOverlay} />
          </>
        ) : (
          <Backdrop glow={0.2} />
        )}
        <div
          style={{
            position: "absolute",
            left: box.x,
            top: box.y,
            width: box.w,
            height: box.h,
            borderRadius: shape.format === "vertical" ? 22 : 28,
            overflow: "hidden",
            boxShadow: "0 0 0 1px rgba(242,233,212,0.12), 0 40px 90px rgba(0,0,0,0.6)",
            backgroundColor: palette.night,
          }}
        >
          <div style={{ position: "absolute", inset: 0, transform: push ? `scale3d(${scale}, ${scale}, 1)` : undefined, transformOrigin: "50% 50%", willChange: push ? "transform" : undefined }}>
            <OffthreadVideo src={src} startFrom={startFrom} muted={muted} volume={volume} style={cropStyle} />
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.42) 100%)",
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "absolute", inset: 0, borderRadius: "inherit", boxShadow: "inset 0 0 0 1px rgba(242,233,212,0.06)", pointerEvents: "none" }} />
        </div>
        {children}
      </AbsoluteFill>
    </StageContext.Provider>
  );
};
