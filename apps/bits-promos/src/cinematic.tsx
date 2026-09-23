/**
 * The premium dressing for a single match clip: the cold-open title, the
 * brand mark, the broadcast lower third, and the developer sign-off that
 * closes it. Typography does the work — Cinzel in tracked gold for the
 * game's voice, Inter for the words — over scrims rather than boxes, so
 * the footage stays the hero. Every piece lays itself out from useStage()
 * (the footage rectangle) and useFormat(), so the same grammar holds in
 * 9:16, 1:1 and 16:9.
 */
import type * as React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CINZEL, SANS, palette } from "./brand";
import { Backdrop, RecDot, useFormat } from "./components";
import { DEV } from "./data/copy";
import roster from "./data/roster.json";
import { useStage } from "./stage";

/** Where the corner chrome sits: clear of the game's own HUD row. */
export const CHROME_TOP = { vertical: 44, other: 40 } as const;
export const chromeTop = (format: string) => (format === "vertical" ? CHROME_TOP.vertical : CHROME_TOP.other);

/**
 * Cinzel Bold caps run about 0.74em per glyph. The title's tracking animates
 * wide→set, so if the browser wrapped it live the lines would reflow
 * mid-animation; instead the wrap is decided once, at the final tracking,
 * and each line is held nowrap (a line briefly wider than the frame while
 * the letters gather is the effect, not a bug).
 */
export const wrapTitle = (title: string, fontSize: number, tracking: number, maxWidth: number): string[] => {
  const w = (s: string) => s.length * (fontSize * 0.74 + tracking);
  const lines: string[] = [];
  let cur = "";
  for (const word of title.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && w(next) > maxWidth) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
};

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Type sizes scale with the shape: vertical is the design surface. */
export const useType = () => {
  const { format } = useFormat();
  return format === "vertical" ? 1 : format === "square" ? 0.72 : 0.82;
};

/** Gold that catches the light: a gradient clipped to the glyphs, swept
 * across once as the text lands. */
export const goldText = (sweep: number): React.CSSProperties => ({
  backgroundImage: `linear-gradient(100deg, #a8843a 0%, ${palette.sand} 32%, ${palette.bone} 50%, ${palette.sand} 68%, #a8843a 100%)`,
  backgroundSize: "300% 100%",
  backgroundPosition: `${100 - sweep * 100}% 50%`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  WebkitTextFillColor: "transparent",
});

/** The eyebrow: a small tracked line with the live dot. */
export const Eyebrow: React.FC<{ text: string; opacity: number; dot?: boolean; size: number; color?: string; style?: React.CSSProperties }> = ({ text, opacity, dot, size, color, style }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: Math.round(size * 0.6),
      opacity,
      fontFamily: SANS,
      fontWeight: 600,
      fontSize: size,
      letterSpacing: size * 0.22,
      color: color ?? palette.sand,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {dot ? <RecDot size={Math.round(size * 0.55)} /> : null}
    {text}
  </div>
);

/** A gold hairline that draws itself out. */
export const Rule: React.FC<{ progress: number; width: number; align?: "center" | "left"; style?: React.CSSProperties }> = ({ progress, width, align = "center", style }) => (
  <div
    style={{
      width: Math.round(width * progress),
      height: 2,
      background: `linear-gradient(90deg, ${palette.sand}, rgba(220,185,111,0.2))`,
      alignSelf: align === "center" ? "center" : "flex-start",
      opacity: 0.9,
      ...style,
    }}
  />
);

/**
 * The cold-open title. The footage is already playing underneath; the
 * title lands on it in tracked gold — letters gathering from wide to set —
 * with the eyebrow saying it's real, then lifts off by `until`. Vertical
 * and square: centred in the upper part of the footage. Landscape: the
 * column beside the play.
 */
export const TitleReveal: React.FC<{ title: string; until: number }> = ({ title, until }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { format, width, height } = useFormat();
  const { box, column } = useStage();
  const k = useType();
  const inA = interpolate(frame, [0, 26], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const eyebrow = interpolate(frame, [10, 24], [0, 1], clamp);
  const rule = interpolate(frame, [14, 40], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const sweep = interpolate(frame, [12, 60], [0, 1], { easing: Easing.inOut(Easing.quad), ...clamp });
  const out = interpolate(frame, [until, until + 12], [0, 1], { easing: Easing.in(Easing.cubic), ...clamp });
  const size = Math.round(96 * k);
  const trackingSet = size * 0.06;
  const tracking = interpolate(inA, [0, 1], [size * 0.5, trackingSet]) + out * size * 0.1;
  const show = inA * (1 - out);
  const long = title.length > 14;
  const fontSize = long ? Math.round(size * 0.72) : size;
  const lines = wrapTitle(title.toUpperCase(), fontSize, trackingSet, column ? box.x - 120 : width - 80);

  const block = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: column ? "flex-start" : "center",
        gap: Math.round(22 * k),
        opacity: show,
        transform: `translateY(${(1 - inA) * 18 - out * 26}px)`,
      }}
    >
      <Eyebrow text={DEV.matchClip.real} opacity={eyebrow} dot size={Math.round(24 * k)} />
      <div
        style={{
          fontFamily: CINZEL,
          fontWeight: 700,
          fontSize,
          lineHeight: 1.04,
          letterSpacing: tracking,
          textAlign: column ? "left" : "center",
          paddingLeft: column ? 0 : tracking, // centre the glyphs, not the trailing tracking
          whiteSpace: "nowrap",
          ...goldText(sweep),
        }}
      >
        {lines.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      <Rule progress={rule} width={Math.round(220 * k)} align={column ? "left" : "center"} />
    </div>
  );

  if (column) {
    return (
      <div style={{ position: "absolute", left: 90, top: 0, bottom: 0, width: box.x - 120, display: "flex", alignItems: "center" }}>
        {block}
      </div>
    );
  }
  const top = format === "vertical" ? Math.round(height * 0.16) : box.y + Math.round(box.h * 0.13);
  return (
    <div style={{ position: "absolute", left: 0, width, top, display: "flex", justifyContent: "center" }}>
      {/* a soft scrim so gold reads on a busy frame */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: box.w * 1.1,
          height: Math.round(360 * k),
          transform: "translate(-50%, -50%)",
          background: "radial-gradient(ellipse at 50% 50%, rgba(20,10,4,0.62) 0%, rgba(20,10,4,0.35) 45%, rgba(20,10,4,0) 72%)",
          opacity: show,
        }}
      />
      {block}
    </div>
  );
};

/** The corner brand: icon + name, always on, quiet. */
export const BrandMark: React.FC<{ from?: number }> = ({ from = 0 }) => {
  const frame = useCurrentFrame();
  const { format } = useFormat();
  const k = useType();
  const o = interpolate(frame, [from, from + 14], [0, 1], clamp);
  const icon = Math.round(54 * k);
  return (
    <div
      style={{
        position: "absolute",
        top: chromeTop(format),
        left: 44,
        display: "flex",
        alignItems: "center",
        gap: Math.round(16 * k),
        opacity: o * 0.92,
        transform: `translateY(${(1 - o) * -8}px)`,
      }}
    >
      <Img src={staticFile("assets/app-icon.png")} style={{ width: icon, height: icon, borderRadius: icon * 0.22, boxShadow: "0 8px 20px rgba(0,0,0,0.5)" }} />
      <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: Math.round(26 * k), letterSpacing: 3, color: palette.bone, textShadow: "0 2px 10px rgba(0,0,0,0.7)" }}>
        {DEV.game}
      </div>
    </div>
  );
};

/**
 * The broadcast lower third: the hook sentence on a scrim band that fades
 * off to the right, a crimson rule at its left, revealed with a wipe.
 * Portrait shapes: across the footage, above the platform's own UI.
 * Landscape: in the column, where the title was.
 */
export const LowerThird: React.FC<{ kicker: string; line: string; at: number; until: number; icon?: string }> = ({ kicker, line, at, until, icon }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { format, height } = useFormat();
  const { box, column } = useStage();
  const k = useType();
  const s = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 120 } });
  const gone = interpolate(frame, [until, until + 12], [0, 1], { easing: Easing.in(Easing.cubic), ...clamp });
  const show = Math.min(s, 1 - gone);
  const wipe = interpolate(s, [0, 1], [100, 0]);
  const pad = Math.round(40 * k);
  const iconSize = Math.round(120 * k);
  const inner = (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(28 * k), padding: `${pad}px ${pad * 1.4}px ${pad}px ${pad}px` }}>
      {icon ? (
        <Img src={staticFile(icon)} style={{ width: iconSize, height: iconSize, flexShrink: 0, imageRendering: "pixelated", filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.6))" }} />
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: Math.round(12 * k) }}>
        <Eyebrow text={kicker} opacity={1} size={Math.round(22 * k)} />
        <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: Math.round(46 * k), lineHeight: 1.15, color: palette.bone, textShadow: "0 2px 12px rgba(0,0,0,0.5)" }}>{line}</div>
      </div>
    </div>
  );
  const band: React.CSSProperties = {
    position: "relative",
    borderLeft: `${Math.round(5 * k)}px solid ${palette.crimson}`,
    background: "linear-gradient(90deg, rgba(20,10,4,0.86) 0%, rgba(20,10,4,0.7) 55%, rgba(20,10,4,0) 100%)",
    clipPath: `inset(0 ${wipe}% 0 0)`,
    opacity: show,
    transform: `translateX(${(1 - s) * -30 - gone * 40}px)`,
  };
  if (column) {
    return (
      <div style={{ position: "absolute", left: 60, top: 0, bottom: 0, width: box.x - 60, display: "flex", alignItems: "center" }}>
        <div style={{ ...band, width: "100%" }}>{inner}</div>
      </div>
    );
  }
  const bottom = format === "vertical" ? 440 : Math.round(height * 0.16);
  return (
    <div style={{ position: "absolute", left: box.x, width: box.w, bottom, display: "flex" }}>
      <div style={{ ...band, width: "100%" }}>{inner}</div>
    </div>
  );
};

/** Sand-gold embers drifting up: the arena at night, cheap and deterministic. */
export const Embers: React.FC<{ count?: number }> = ({ count = 34 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useFormat();
  const rnd = (i: number, salt: number) => {
    const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }, (_, i) => {
        const speed = 0.6 + rnd(i, 1) * 1.1;
        const size = 3 + rnd(i, 2) * 5;
        const x0 = rnd(i, 3) * width;
        const phase = rnd(i, 4) * height;
        const y = height + 20 - ((frame * speed + phase) % (height + 60));
        const x = x0 + Math.sin((frame + i * 20) / 40) * 22;
        const o = (0.35 + rnd(i, 5) * 0.5) * (0.6 + 0.4 * Math.sin(frame / 9 + i));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: "50%",
              background: palette.sand,
              opacity: o,
              boxShadow: `0 0 ${size * 2}px rgba(220,185,111,0.7)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * The icon field: the game's item, deed and rank art popping into the
 * space around the sign-off — the "there's a lot in here" without a
 * feature list. Slots are a grid over the frame minus a keep-out box where
 * the words sit; each icon springs in on its own beat, then floats.
 * Deterministic: the same frame always draws the same field.
 */
const KEEP_OUT: Record<string, { x: number; y: number; w: number; h: number; spacing: number; size: number; bottom: number }> = {
  vertical: { x: 30, y: 410, w: 1020, h: 930, spacing: 196, size: 132, bottom: 1760 },
  square: { x: 170, y: 140, w: 740, h: 780, spacing: 150, size: 92, bottom: 990 },
  landscape: { x: 220, y: 250, w: 1480, h: 620, spacing: 190, size: 116, bottom: 970 },
};
const hash = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const IconField: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { format } = useFormat();
  const k = KEEP_OUT[format] ?? KEEP_OUT.vertical!;
  const slots: { x: number; y: number }[] = [];
  const margin = k.size * 0.6;
  for (let y = k.spacing * 0.6; y < k.bottom - k.size * 0.5; y += k.spacing) {
    for (let x = k.spacing * 0.6; x < width - k.spacing * 0.4; x += k.spacing) {
      const inside = x > k.x - margin && x < k.x + k.w + margin && y > k.y - margin && y < k.y + k.h + margin;
      if (!inside) slots.push({ x, y });
    }
  }
  // Deterministic shuffle of both slots and art, so every render agrees.
  const order = slots.map((s, i) => ({ s, r: hash(i, 7) })).sort((a, b) => a.r - b.r);
  const art = roster.gallery.map((src, i) => ({ src, r: hash(i, 11) })).sort((a, b) => a.r - b.r);
  const n = Math.min(order.length, art.length);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {order.slice(0, n).map(({ s }, i) => {
        const src = art[i]!.src;
        const at = 8 + (i / n) * 100 + hash(i, 3) * 6;
        const pop = spring({ frame: frame - at, fps, config: { damping: 9, stiffness: 170 } });
        const flash = interpolate(frame - at, [0, 14], [1, 0], clamp);
        const jx = (hash(i, 4) - 0.5) * k.spacing * 0.45;
        const jy = (hash(i, 5) - 0.5) * k.spacing * 0.35;
        const tilt = (hash(i, 6) - 0.5) * 18;
        const float = Math.sin((frame + i * 17) / 26) * 5;
        const size = k.size * (0.8 + hash(i, 8) * 0.4);
        return (
          <div
            key={src}
            style={{
              position: "absolute",
              left: s.x + jx - size / 2,
              top: s.y + jy - size / 2 + float,
              width: size,
              height: size,
              opacity: Math.min(1, pop) * 0.92,
              transform: `scale(${pop}) rotate(${tilt * (1 - pop) - tilt * 0.35}deg)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: -size * 0.3,
                borderRadius: "50%",
                background: `radial-gradient(circle, rgba(220,185,111,${0.55 * flash}) 0%, rgba(220,185,111,0) 60%)`,
              }}
            />
            <Img src={staticFile(src)} style={{ width: "100%", height: "100%", imageRendering: "pixelated", filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.55))" }} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** The sign-off's beats, shared by the stacked and wide layouts. */
const useSignOffBeats = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const icon = spring({ frame: frame - 2, fps, config: { damping: 13, stiffness: 140 } });
  const at = (f: number, len = 12) => interpolate(frame, [f, f + len], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const sweep = interpolate(frame, [10, 70], [0, 1], { easing: Easing.inOut(Easing.quad), ...clamp });
  const ask = spring({ frame: frame - 78, fps, config: { damping: 12, stiffness: 150 } });
  return { icon, at, sweep, ask };
};

const Rise: React.FC<{ p: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ p, children, style }) => (
  <div style={{ opacity: p, transform: `translateY(${(1 - p) * 16}px)`, ...style }}>{children}</div>
);

/**
 * The sign-off: the calm end card for a match clip. Icon, the name in gold,
 * a rule, and then Tom talking — one person, it's free, come and fight me —
 * and where to find him. No feature list, no badge; the spectacle was the
 * clip, this is the handshake. Words in copy.ts (DEV.signoff).
 */
export const SignOff: React.FC = () => {
  const { format, height } = useFormat();
  const { icon, at, sweep, ask } = useSignOffBeats();
  const k = format === "vertical" ? 1.1 : format === "square" ? 0.7 : 0.8;
  const wide = format === "landscape";
  const iconSize = Math.round(210 * k);

  const identity = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: Math.round(26 * k) }}>
      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: iconSize * 2.6,
            height: iconSize * 2.6,
            transform: "translate(-50%, -50%)",
            background: "radial-gradient(circle, rgba(220,185,111,0.28) 0%, rgba(220,185,111,0) 60%)",
            opacity: icon,
          }}
        />
        <Img
          src={staticFile("assets/app-icon.png")}
          style={{ position: "relative", width: iconSize, height: iconSize, borderRadius: iconSize * 0.22, transform: `scale(${icon})`, boxShadow: "0 30px 70px rgba(0,0,0,0.6), 0 0 0 1px rgba(242,233,212,0.12)" }}
        />
      </div>
      <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: Math.round(64 * k), letterSpacing: 4, textAlign: "center", lineHeight: 1.1, whiteSpace: "nowrap", opacity: at(8), ...goldText(sweep) }}>{DEV.game}</div>
      <Rule progress={at(16, 20)} width={Math.round(180 * k)} />
    </div>
  );

  const note = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: wide ? "flex-start" : "center", gap: Math.round(20 * k), maxWidth: wide ? 760 : Math.round(900 * k) }}>
      {DEV.signoff.lines.map((l, i) => (
        <Rise key={l} p={at(30 + i * 14)}>
          <div style={{ fontFamily: SANS, fontWeight: i === 0 ? 600 : 500, fontSize: Math.round((i === 0 ? 40 : 34) * k), lineHeight: 1.3, color: i === 0 ? palette.bone : palette.sand, textAlign: wide ? "left" : "center" }}>{l}</div>
        </Rise>
      ))}
      <Rise p={at(60)} style={{ marginTop: Math.round(10 * k) }}>
        <Eyebrow text={DEV.signoff.eyebrow} opacity={1} size={Math.round(22 * k)} />
      </Rise>
      <div
        style={{
          marginTop: Math.round(18 * k),
          fontFamily: CINZEL,
          fontWeight: 700,
          fontSize: Math.round(54 * k),
          letterSpacing: 2,
          color: palette.bone,
          textAlign: wide ? "left" : "center",
          textShadow: `0 4px 0 ${palette.umber}`,
          opacity: ask,
          transform: `scale(${0.92 + ask * 0.08})`,
          transformOrigin: wide ? "left center" : "center",
        }}
      >
        {DEV.signoff.ask}
      </div>
      <Rise p={at(96)}>
        <div style={{ fontFamily: SANS, fontWeight: 500, fontStyle: "italic", fontSize: Math.round(26 * k), color: palette.steel, letterSpacing: 1, textAlign: wide ? "left" : "center" }}>{DEV.signoff.signature}</div>
      </Rise>
    </div>
  );

  const handles = (
    <Rise p={at(104)} style={{ position: "absolute", bottom: format === "vertical" ? 120 : 52, left: 0, right: 0, fontFamily: SANS, fontWeight: 500, fontSize: Math.round(28 * k), color: palette.steel, textAlign: "center", letterSpacing: 1 }}>
      {DEV.handles.join("   ·   ")}
    </Rise>
  );

  return (
    <AbsoluteFill>
      <Backdrop glow={0.55} />
      <Embers />
      <IconField />
      {wide ? (
        <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 110, paddingBottom: 40 }}>
          <div style={{ display: "flex", justifyContent: "center" }}>{identity}</div>
          {note}
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: Math.round(height * 0.08), gap: Math.round(70 * k) }}>
          {identity}
          {note}
        </AbsoluteFill>
      )}
      {handles}
    </AbsoluteFill>
  );
};
