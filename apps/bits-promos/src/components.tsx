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
import { CINZEL, ditherOverlay, palette } from "./brand";
import { CTA } from "./data/copy";

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

export const StatChip: React.FC<{ label: string; value: string; delay: number }> = ({
  label,
  value,
  delay,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 160 } });
  return (
    <div
      style={{
        transform: `translateY(${(1 - s) * 60}px)`,
        opacity: s,
        border: `3px solid ${palette.umber}`,
        background: "rgba(0,0,0,0.35)",
        padding: "18px 34px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        style={{
          fontFamily: CINZEL,
          fontWeight: 700,
          fontSize: 26,
          letterSpacing: 6,
          color: palette.steel,
        }}
      >
        {label}
      </span>
      <span
        style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 52, color: palette.bone }}
      >
        {value}
      </span>
    </div>
  );
};

/** Shared closing card: app icon, title, tagline, call to action. */
export const EndCard: React.FC<{ action?: string }> = ({ action = CTA.action }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 140 } });
  const fadeIn = interpolate(frame, [6, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulse = 1 + Math.sin(frame / 9) * 0.02;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 44 }}>
      <Img
        src={staticFile("assets/app-icon.png")}
        style={{
          width: 340,
          height: 340,
          borderRadius: 76,
          transform: `scale(${pop})`,
          boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        }}
      />
      <div style={{ opacity: fadeIn, textAlign: "center", padding: "0 80px" }}>
        <div
          style={{
            fontFamily: CINZEL,
            fontWeight: 700,
            fontSize: 92,
            color: palette.bone,
            textShadow: `0 6px 0 ${palette.umber}`,
            lineHeight: 1.1,
          }}
        >
          {CTA.title}
        </div>
        <div
          style={{
            fontFamily: CINZEL,
            fontWeight: 700,
            fontSize: 34,
            color: palette.sand,
            marginTop: 26,
            letterSpacing: 2,
          }}
        >
          {CTA.sub}
        </div>
      </div>
      <div
        style={{
          opacity: fadeIn,
          transform: `scale(${pulse})`,
          background: palette.crimson,
          color: palette.bone,
          fontFamily: CINZEL,
          fontWeight: 700,
          fontSize: 46,
          letterSpacing: 6,
          padding: "26px 64px",
          border: `4px solid ${palette.umber}`,
          boxShadow: "0 18px 48px rgba(0,0,0,0.5)",
        }}
      >
        {action}
      </div>
    </AbsoluteFill>
  );
};
