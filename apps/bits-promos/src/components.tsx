import type * as React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CINZEL, type Format, SANS, ditherOverlay, palette } from "./brand";
import { DEV } from "./data/copy";

/** The music bed's default level (the recording's own audio plays at 1). */
export const MUSIC_LEVEL = 0.8;

/**
 * A song from public/music/ under the whole video. Record with the game's
 * Battle music toggle off, so the footage carries the SFX + crowd and the
 * score comes in clean here. The songs build sparse → relentless over ~2:30,
 * so `from` drops straight into the part you want; a short fade-in keeps a
 * mid-song start from clicking, and it fades out under the end card's tail.
 */
export const MusicBed: React.FC<{ music?: string; from?: number; level?: number }> = ({ music, from = 0, level = MUSIC_LEVEL }) => {
  const { fps, durationInFrames } = useVideoConfig();
  if (!music) return null;
  const volume = (f: number) =>
    level *
    interpolate(f, [0, fps * 0.25, durationInFrames - fps * 1.6, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <Audio src={staticFile(`music/${music}`)} startFrom={Math.round(from * fps)} volume={volume} loop />;
};

/** Which shape we're drawing into, read off the composition itself so every
 * component lays itself out without being told. */
export const useFormat = (): { format: Format; width: number; height: number } => {
  const { width, height } = useVideoConfig();
  const format: Format = width > height ? "landscape" : width === height ? "square" : "vertical";
  return { format, width, height };
};

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

/** The pulsing capture dot — the universal "this is a screen recording". */
export const RecDot: React.FC<{ size?: number }> = ({ size = 18 }) => {
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
 * made before a title card ends). Vertical: 200px down; the short formats
 * hang it at ~10% of the height.
 */
export const PreviewBanner: React.FC<{ kindLabel: string; name: string; until: number }> = ({ kindLabel, name, until }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { format, height } = useFormat();
  const s = spring({ frame: frame - 2, fps, config: { damping: 14, stiffness: 170 } });
  const gone = spring({ frame: frame - until, fps, config: { damping: 16, stiffness: 140 } });
  const show = Math.min(s, 1 - gone);
  return (
    <div
      style={{
        position: "absolute",
        top: format === "vertical" ? 200 : Math.round(height * 0.1),
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
export const RecChip: React.FC<{ from: number; top?: number }> = ({ from, top }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { format } = useFormat();
  const s = spring({ frame: frame - from, fps, config: { damping: 14, stiffness: 150 } });
  return (
    <div
      style={{
        position: "absolute",
        top: top ?? (format === "vertical" ? 120 : 40),
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
 * (fractions of the recording's height). In square and landscape the
 * portrait capture sits centred with the warm Backdrop either side — never
 * black bars. All percentages, so the same maths holds in every format.
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

/** The one card over the footage: icon, name, a line. Lower third in the
 * portrait formats; in landscape it sits beside the footage on the left so
 * the play is never covered. Slides in at `delay`, out at `until`. */
export const Card: React.FC<{ icon?: string; name: string; line: string; delay?: number; until?: number }> = ({ icon, name, line, delay = 0, until }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { format, height } = useFormat();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 150 } });
  const gone = until === undefined ? 0 : spring({ frame: frame - until, fps, config: { damping: 16, stiffness: 140 } });
  const show = Math.min(s, 1 - gone);
  const landscape = format === "landscape";
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: format === "vertical" ? 460 : Math.round(height * 0.24),
        display: "flex",
        justifyContent: landscape ? "flex-start" : "center",
        paddingLeft: landscape ? 90 : 0,
        opacity: show,
        transform: landscape ? `translateX(${(1 - s) * -40 - gone * 60}px)` : `translateY(${(1 - s) * 30 + gone * 60}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 26,
          maxWidth: landscape ? 560 : 960,
          margin: landscape ? 0 : "0 50px",
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

/** The outro's beats, shared by every layout: the same springs on the same frames. */
const useOutroBeats = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const icon = spring({ frame: frame - 2, fps, config: { damping: 12, stiffness: 150 } });
  const line = (at: number) => interpolate(frame, [at, at + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const badge = spring({ frame: frame - 84, fps, config: { damping: 10, stiffness: 180 } });
  const pulse = 1 + Math.sin(Math.max(0, frame - 96) / 6) * 0.025;
  return { icon, line, badge, pulse, featureAt: 34 };
};

const AppIcon: React.FC<{ scale: number; size?: number }> = ({ scale, size = 220 }) => (
  <Img
    src={staticFile("assets/app-icon.png")}
    style={{ width: size, height: size, borderRadius: size * 0.22, transform: `scale(${scale})`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}
  />
);

const GameName: React.FC<{ opacity: number; style?: React.CSSProperties }> = ({ opacity, style }) => (
  <div style={{ opacity, fontFamily: CINZEL, fontWeight: 700, fontSize: 72, color: palette.bone, textAlign: "center", lineHeight: 1.1, textShadow: `0 6px 0 ${palette.umber}`, ...style }}>
    {DEV.game}
  </div>
);

const Headline: React.FC<{ opacity: number; style?: React.CSSProperties }> = ({ opacity, style }) => (
  <div style={{ opacity, fontFamily: CINZEL, fontWeight: 700, fontSize: 40, color: palette.sand, textAlign: "center", letterSpacing: 1, ...style }}>
    {DEV.outro.headline}
  </div>
);

const FeatureList: React.FC<{ featureAt: number; gap?: number; style?: React.CSSProperties }> = ({ featureAt, gap = 26, style }) => (
  <div style={{ display: "flex", flexDirection: "column", gap, alignItems: "flex-start", ...style }}>
    {DEV.outro.features.map((f, i) => (
      <Feature key={f} text={f} delay={featureAt + i * 9} strong={i === DEV.outro.features.length - 1} />
    ))}
  </div>
);

const FreeBadge: React.FC<{ badge: number; pulse: number; style?: React.CSSProperties }> = ({ badge, pulse, style }) => (
  <div
    style={{
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
      ...style,
    }}
  >
    {DEV.outro.free}
  </div>
);

const WhereBadge: React.FC<{ opacity: number; style?: React.CSSProperties }> = ({ opacity, style }) => (
  <div
    style={{
      opacity,
      fontFamily: SANS,
      fontWeight: 800,
      fontSize: 36,
      letterSpacing: 4,
      color: palette.bone,
      background: palette.crimson,
      padding: "20px 46px",
      boxShadow: "0 14px 40px rgba(0,0,0,0.5)",
      ...style,
    }}
  >
    {DEV.outro.where}
  </div>
);

const Support: React.FC<{ opacity: number; style?: React.CSSProperties }> = ({ opacity, style }) => (
  <div style={{ opacity, fontFamily: SANS, fontWeight: 500, fontSize: 30, color: palette.steel, textAlign: "center", fontStyle: "italic", ...style }}>
    {DEV.outro.support}
  </div>
);

const Handles: React.FC<{ opacity: number; style?: React.CSSProperties }> = ({ opacity, style }) => (
  <div style={{ opacity, fontFamily: SANS, fontWeight: 500, fontSize: 28, color: palette.steel, textAlign: "center", lineHeight: 1.6, letterSpacing: 1, ...style }}>
    {DEV.handles.join("   ·   ")}
  </div>
);

/**
 * The vertical outro — Tom's approved look, untouched. Laid out on a
 * 1080×1920 design surface; square renders the same stack scaled down
 * (design surface = frame / scale) so nothing is dropped, just tightened.
 */
const StackOutro: React.FC<{ scale: number; paddingTop: number }> = ({ scale, paddingTop }) => {
  const { width, height } = useFormat();
  const { icon, line, badge, pulse, featureAt } = useOutroBeats();
  return (
    <AbsoluteFill
      style={{
        width: width / scale,
        height: height / scale,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        alignItems: "center",
        paddingTop,
        gap: 0,
      }}
    >
      <AppIcon scale={icon} />
      <GameName opacity={line(6)} style={{ marginTop: 30 }} />
      <Headline opacity={line(16)} style={{ marginTop: 14 }} />
      <FeatureList featureAt={featureAt} style={{ marginTop: 70 }} />
      <FreeBadge badge={badge} pulse={pulse} style={{ marginTop: 70 }} />
      <WhereBadge opacity={line(100)} style={{ marginTop: 34 }} />
      <Support opacity={line(112)} style={{ marginTop: 40 }} />
      <Handles opacity={line(120)} style={{ position: "absolute", bottom: 120 }} />
    </AbsoluteFill>
  );
};

/** Landscape: the identity on the left, the pitch on the right, handles below. */
const WideOutro: React.FC = () => {
  const { icon, line, badge, pulse, featureAt } = useOutroBeats();
  return (
    <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 140, paddingBottom: 60 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 620 }}>
        <AppIcon scale={icon} />
        <GameName opacity={line(6)} style={{ marginTop: 30 }} />
        <Headline opacity={line(16)} style={{ marginTop: 14 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <FeatureList featureAt={featureAt} gap={22} />
        <FreeBadge badge={badge} pulse={pulse} style={{ marginTop: 50, alignSelf: "flex-start" }} />
        <WhereBadge opacity={line(100)} style={{ marginTop: 28, whiteSpace: "nowrap" }} />
        <Support opacity={line(112)} style={{ marginTop: 30, textAlign: "left" }} />
      </div>
      <Handles opacity={line(120)} style={{ position: "absolute", bottom: 60, left: 0, right: 0 }} />
    </AbsoluteFill>
  );
};

/** The outro: the promise, what's in it, free, where it is, who to support. */
export const Outro: React.FC = () => {
  const { format, height } = useFormat();
  return (
    <AbsoluteFill>
      <Backdrop glow={0.6} />
      {format === "landscape" ? (
        <WideOutro />
      ) : format === "square" ? (
        <StackOutro scale={height / 1600} paddingTop={70} />
      ) : (
        <StackOutro scale={1} paddingTop={240} />
      )}
    </AbsoluteFill>
  );
};
