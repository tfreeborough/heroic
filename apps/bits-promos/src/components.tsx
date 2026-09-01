import type * as React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CINZEL, SANS, ditherOverlay, palette } from "./brand";
import { DEV } from "./data/copy";

/** Warm arena backdrop: night→umber gradient, honey glow, dither grain. */
export const Backdrop: React.FC<{ glow?: number }> = ({ glow = 0.5 }) => (
  <AbsoluteFill style={{ backgroundColor: palette.night }}>
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${palette.night} 0%, #3a2812 55%, #241708 100%)`,
      }}
    />
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 42%, ${palette.sand} 0%, transparent 60%)`,
        opacity: glow * 0.35,
      }}
    />
    <AbsoluteFill style={ditherOverlay} />
  </AbsoluteFill>
);

/** A game icon blown up big with the pixel grid kept crisp. */
export const PixelIcon: React.FC<{ src: string; size: number; style?: React.CSSProperties }> = ({
  src,
  size,
  style,
}) => (
  <Img
    src={staticFile(src)}
    style={{
      width: size,
      height: size,
      imageRendering: "pixelated",
      filter: "drop-shadow(0 24px 48px rgba(0,0,0,0.55))",
      ...style,
    }}
  />
);

const useFade = (from: number, to: number) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
};

/** The pulsing capture dot — the universal "this is a screen recording". */
const RecDot: React.FC<{ size?: number }> = ({ size = 18 }) => {
  const frame = useCurrentFrame();
  const on = Math.floor(frame / 16) % 2 === 0;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#e0342a",
        opacity: on ? 1 : 0.25,
        boxShadow: on ? "0 0 12px rgba(224,52,42,0.8)" : "none",
        flexShrink: 0,
      }}
    />
  );
};

/**
 * The cold-open banner: what you're about to see and that it's real. Sits
 * over the ALREADY-PLAYING footage for the first beats, then drops away —
 * no logo screen, no ad grammar (docs/marketing.md: the scroll decision is
 * made before a title card ends).
 */
export const PreviewBanner: React.FC<{ kindLabel: string; name: string; until: number }> = ({ kindLabel, name, until }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 2, fps, config: { damping: 14, stiffness: 170 } });
  const gone = spring({ frame: frame - until, fps, config: { damping: 16, stiffness: 140 } });
  const show = Math.min(s, 1 - gone);
  return (
    <div
      style={{
        position: "absolute",
        top: 200,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity: show,
        transform: `translateY(${(1 - s) * -40 - gone * 50}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          background: palette.ink,
          borderTop: `6px solid ${palette.crimson}`,
          padding: "26px 48px 24px",
          boxShadow: "0 14px 44px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 30, letterSpacing: 8, color: palette.crimson }}>
          {kindLabel}
        </div>
        <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 74, color: palette.bone, lineHeight: 1.05, textAlign: "center" }}>
          {name.toUpperCase()}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: SANS, fontWeight: 600, fontSize: 26, letterSpacing: 2, color: palette.sand }}>
          <RecDot />
          {DEV.preview.real}
        </div>
      </div>
    </div>
  );
};

/** The corner chip that keeps the raw-capture framing while the clip runs. */
export const RecChip: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - from, fps, config: { damping: 14, stiffness: 150 } });
  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        right: 44,
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity: s * 0.9,
        background: "rgba(20,10,4,0.6)",
        padding: "10px 18px",
        borderRadius: 6,
        fontFamily: SANS,
        fontWeight: 800,
        fontSize: 24,
        letterSpacing: 3,
        color: palette.bone,
      }}
    >
      <RecDot size={14} />
      {DEV.preview.rec}
    </div>
  );
};

/**
 * The recording, fitted whole inside the frame (phone captures are taller
 * than 9:16 — cropping to fill would lose the score bar and HUD), with the
 * phone's status strip and nav bar shaved off via cropTop/cropBottom
 * (fractions of the recording's height).
 */
export const Footage: React.FC<{ children: React.ReactNode; cropTop?: number; cropBottom?: number }> = ({ children, cropTop = 0, cropBottom = 0 }) => {
  const keep = Math.max(0.2, 1 - cropTop - cropBottom);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Backdrop glow={0.25} />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${(-cropTop / keep) * 100}%`,
          height: `${(1 / keep) * 100}%`,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** The one card over the footage: icon, name, a line. Lower third. Slides
 * in at `delay`, and back out at `until` so the play is unobstructed. */
export const Card: React.FC<{ icon?: string; name: string; line: string; delay?: number; until?: number }> = ({ icon, name, line, delay = 0, until }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 150 } });
  const gone = until === undefined ? 0 : spring({ frame: frame - until, fps, config: { damping: 16, stiffness: 140 } });
  const show = Math.min(s, 1 - gone);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 460,
        display: "flex",
        justifyContent: "center",
        opacity: show,
        transform: `translateY(${(1 - s) * 30 + gone * 60}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 26,
          maxWidth: 960,
          margin: "0 50px",
          background: palette.ink,
          borderLeft: `6px solid ${palette.crimson}`,
          padding: "20px 34px 20px 22px",
          boxShadow: "0 12px 36px rgba(0,0,0,0.45)",
        }}
      >
        {icon ? <PixelIcon src={icon} size={110} style={{ filter: "none", flexShrink: 0 }} /> : null}
        <div>
          <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 52, color: palette.bone, lineHeight: 1.05 }}>
            {name.toUpperCase()}
          </div>
          <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: 32, color: palette.sand, marginTop: 10, lineHeight: 1.25 }}>
            {line}
          </div>
        </div>
      </div>
    </div>
  );
};

/** A feature row that slides in from the left. */
const Feature: React.FC<{ text: string; delay: number; strong?: boolean }> = ({ text, delay, strong }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 150 } });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 22,
        opacity: s,
        transform: `translateX(${(1 - s) * -60}px)`,
        fontFamily: SANS,
        fontWeight: strong ? 800 : 600,
        fontSize: 40,
        color: strong ? palette.sand : palette.bone,
        letterSpacing: 0.5,
      }}
    >
      <span style={{ width: 16, height: 16, background: strong ? palette.sand : palette.crimson, transform: "rotate(45deg)", flexShrink: 0 }} />
      {text}
    </div>
  );
};

/** The outro: the promise, what's in it, free, where it is, who to support. */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const icon = spring({ frame: frame - 2, fps, config: { damping: 12, stiffness: 150 } });
  const line = (at: number) => interpolate(frame, [at, at + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const badge = spring({ frame: frame - 84, fps, config: { damping: 10, stiffness: 180 } });
  const pulse = 1 + Math.sin(Math.max(0, frame - 96) / 6) * 0.025;
  const featureAt = 34;
  return (
    <AbsoluteFill>
      <Backdrop glow={0.6} />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 240, gap: 0 }}>
        <Img
          src={staticFile("assets/app-icon.png")}
          style={{ width: 220, height: 220, borderRadius: 48, transform: `scale(${icon})`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}
        />
        <div style={{ opacity: line(6), fontFamily: CINZEL, fontWeight: 700, fontSize: 72, color: palette.bone, textAlign: "center", lineHeight: 1.1, textShadow: `0 6px 0 ${palette.umber}`, marginTop: 30 }}>
          {DEV.game}
        </div>
        <div style={{ opacity: line(16), fontFamily: CINZEL, fontWeight: 700, fontSize: 40, color: palette.sand, textAlign: "center", letterSpacing: 1, marginTop: 14 }}>
          {DEV.outro.headline}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 26, marginTop: 70, alignItems: "flex-start" }}>
          {DEV.outro.features.map((f, i) => (
            <Feature key={f} text={f} delay={featureAt + i * 9} strong={i === DEV.outro.features.length - 1} />
          ))}
        </div>
        <div
          style={{
            marginTop: 70,
            transform: `scale(${badge * pulse}) rotate(-3deg)`,
            opacity: badge,
            fontFamily: SANS,
            fontWeight: 800,
            fontSize: 46,
            letterSpacing: 5,
            color: palette.night,
            background: palette.sand,
            padding: "18px 44px",
            boxShadow: "0 12px 0 rgba(0,0,0,0.35)",
          }}
        >
          {DEV.outro.free}
        </div>
        <div
          style={{
            opacity: line(100),
            marginTop: 34,
            fontFamily: SANS,
            fontWeight: 800,
            fontSize: 36,
            letterSpacing: 4,
            color: palette.bone,
            background: palette.crimson,
            padding: "20px 46px",
            boxShadow: "0 14px 40px rgba(0,0,0,0.5)",
          }}
        >
          {DEV.outro.where}
        </div>
        <div style={{ opacity: line(112), fontFamily: SANS, fontWeight: 500, fontSize: 30, color: palette.steel, textAlign: "center", marginTop: 40, fontStyle: "italic" }}>
          {DEV.outro.support}
        </div>
        <div style={{ position: "absolute", bottom: 120, opacity: line(120), fontFamily: SANS, fontWeight: 500, fontSize: 28, color: palette.steel, textAlign: "center", lineHeight: 1.6, letterSpacing: 1 }}>
          {DEV.handles.join("   ·   ")}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
