/**
 * The spotlights' own flavour. A weapon is forged: its icon slams into the
 * frame with a shockwave, sparks and a shake, and a steel spec plate
 * counts the sim's real numbers up beneath it. An ability is a rite: the
 * icon rises into a gold bloom, a cooldown ring draws itself round it, the
 * charges light up as pips, and the same plate follows. Both then hand
 * over to the shared stage chrome and an icon-led lower third. Numbers on
 * the plate are roster.json — straight from the sim, never typed.
 */
import type * as React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CINZEL, SANS, palette } from "./brand";
import { Eyebrow, Rule, clamp, goldText, useType, wrapTitle } from "./cinematic";
import { useFormat } from "./components";
import type { RosterEntry } from "./Spotlight";
import { useStage } from "./stage";

const hash = (i: number, salt: number) => {
  const x = Math.sin(i * 91.7 + salt * 47.3) * 43758.5453;
  return x - Math.floor(x);
};

/** "0.25s" → 0.25 counting up, "s" kept; "MELEE ARC" → as is. */
const Counted: React.FC<{ value: string; progress: number; style?: React.CSSProperties }> = ({ value, progress, style }) => {
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec(value);
  if (!m) return <span style={style}>{value}</span>;
  const target = Number(m[1]);
  const decimals = (m[1]!.split(".")[1] ?? "").length;
  const n = interpolate(progress, [0, 1], [0, target], { easing: Easing.out(Easing.cubic), ...clamp });
  return (
    <span style={style}>
      {n.toFixed(decimals)}
      {m[2]}
    </span>
  );
};

/** The spec plate: the sim's numbers in cells, each ticking up on its beat. */
const StatPlate: React.FC<{ stats: [string, string][]; at: number; accent: string; align: "center" | "left" }> = ({ stats, at, accent, align }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = useType();
  const s = spring({ frame: frame - at, fps, config: { damping: 16, stiffness: 140 } });
  return (
    <div
      style={{
        display: "flex",
        alignSelf: align === "center" ? "center" : "flex-start",
        opacity: s,
        transform: `translateY(${(1 - s) * 18}px)`,
        background: "linear-gradient(180deg, rgba(20,10,4,0.82) 0%, rgba(20,10,4,0.66) 100%)",
        boxShadow: `0 0 0 1px rgba(242,233,212,0.14), inset 0 1px 0 rgba(242,233,212,0.08), 0 18px 40px rgba(0,0,0,0.45)`,
        borderTop: `${Math.round(3 * k)}px solid ${accent}`,
      }}
    >
      {stats.map(([label, value], i) => {
        const cellAt = at + 6 + i * 5;
        const p = interpolate(frame, [cellAt, cellAt + 22], [0, 1], clamp);
        return (
          <div
            key={label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: Math.round(8 * k),
              padding: `${Math.round(16 * k)}px ${Math.round(30 * k)}px`,
              borderLeft: i ? "1px solid rgba(242,233,212,0.12)" : "none",
              opacity: interpolate(p, [0, 0.3], [0, 1], clamp),
            }}
          >
            <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: Math.round(18 * k), letterSpacing: 4, color: palette.steel }}>{label}</div>
            <Counted value={value} progress={p} style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: Math.round(36 * k), color: palette.bone, whiteSpace: "nowrap" }} />
          </div>
        );
      })}
    </div>
  );
};

/** The forge: sparks flung from the icon as it lands. */
const Sparks: React.FC<{ at: number; size: number }> = ({ at, size }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t > 26) return null;
  return (
    <>
      {Array.from({ length: 18 }, (_, i) => {
        const a = (i / 18) * Math.PI * 2 + (hash(i, 1) - 0.5) * 0.5;
        const v = size * (0.028 + hash(i, 2) * 0.03);
        const x = Math.cos(a) * v * t;
        const y = Math.sin(a) * v * t + 0.32 * t * t;
        const d = 5 + hash(i, 3) * 7;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: d,
              height: d,
              marginLeft: x - d / 2,
              marginTop: y - d / 2,
              borderRadius: 2,
              background: i % 3 === 0 ? palette.crimson : palette.sand,
              boxShadow: `0 0 ${d}px ${i % 3 === 0 ? "rgba(163,44,34,0.8)" : "rgba(220,185,111,0.9)"}`,
              opacity: 1 - t / 26,
              transform: `rotate(${t * 20 + i * 40}deg)`,
            }}
          />
        );
      })}
    </>
  );
};

/** The cooldown ring: draws itself round the icon, then breathes. */
const Ring: React.FC<{ size: number; progress: number; pulse: number }> = ({ size, progress, pulse }) => {
  const r = size * 0.62;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width={size * 1.5}
      height={size * 1.5}
      viewBox={`0 0 ${size * 1.5} ${size * 1.5}`}
      style={{ position: "absolute", left: "50%", top: "50%", transform: `translate(-50%, -50%) rotate(-90deg) scale(${1 + pulse * 0.03})` }}
    >
      <circle cx={size * 0.75} cy={size * 0.75} r={r} fill="none" stroke="rgba(220,185,111,0.16)" strokeWidth={size * 0.018} />
      <circle
        cx={size * 0.75}
        cy={size * 0.75}
        r={r}
        fill="none"
        stroke={palette.sand}
        strokeWidth={size * 0.018}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        style={{ filter: "drop-shadow(0 0 6px rgba(220,185,111,0.8))" }}
      />
    </svg>
  );
};

/** The charges, lit one by one. */
const Pips: React.FC<{ count: number; at: number; size: number }> = ({ count, at, size }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", gap: size * 0.6, justifyContent: "center" }}>
      {Array.from({ length: count }, (_, i) => {
        const on = interpolate(frame, [at + i * 5, at + i * 5 + 8], [0, 1], clamp);
        return (
          <div
            key={i}
            style={{
              width: size,
              height: size,
              transform: `rotate(45deg) scale(${0.6 + on * 0.4})`,
              background: palette.sand,
              opacity: 0.25 + on * 0.75,
              boxShadow: on ? `0 0 ${size}px rgba(220,185,111,${0.7 * on})` : "none",
            }}
          />
        );
      })}
    </div>
  );
};

/**
 * The reveal. Rides the opening beats over the footage (or sits centred
 * when there's no clip), lifts off at `until`. Landscape: the column
 * beside the play; portrait shapes: the upper part of the frame.
 */
export const ItemReveal: React.FC<{ kind: "weapon" | "ability"; entry: RosterEntry; until: number; centred?: boolean }> = ({ kind, entry, until, centred }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { format, width, height } = useFormat();
  const { box, column } = useStage();
  const k = useType();
  const weapon = kind === "weapon";
  const accent = weapon ? palette.crimson : palette.sand;
  const size = Math.round((centred ? 360 : 280) * k);

  // Weapon: the slam. Ability: the rise.
  const land = 9;
  const slam = spring({ frame, fps, config: { damping: 11, stiffness: 130, mass: 1.1 } });
  const rise = spring({ frame, fps, config: { damping: 15, stiffness: 90 } });
  const iconScale = weapon ? interpolate(slam, [0, 1], [2.4, 1]) : interpolate(rise, [0, 1], [0.85, 1]);
  const iconY = weapon ? 0 : (1 - rise) * 70;
  const iconOpacity = weapon ? interpolate(frame, [0, 4], [0, 1], clamp) : rise;
  const shakeT = Math.max(0, frame - land);
  const shake = weapon ? Math.exp(-shakeT / 5) * 14 : 0;
  const sx = shake * Math.sin(shakeT * 2.9);
  const sy = shake * Math.cos(shakeT * 2.3);
  const wave = interpolate(frame, [land, land + 18], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const bloom = interpolate(frame, [2, 30], [0, 1], { easing: Easing.out(Easing.quad), ...clamp });
  const ring = interpolate(frame, [6, 40], [0, 1], { easing: Easing.inOut(Easing.cubic), ...clamp });
  const pulse = Math.sin(Math.max(0, frame - 40) / 7);

  const nameAt = weapon ? land + 2 : 12;
  const nameIn = interpolate(frame, [nameAt, nameAt + 22], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const sweep = interpolate(frame, [nameAt + 4, nameAt + 50], [0, 1], { easing: Easing.inOut(Easing.quad), ...clamp });
  const eyebrow = interpolate(frame, [nameAt + 4, nameAt + 16], [0, 1], clamp);
  const out = interpolate(frame, [until, until + 12], [0, 1], { easing: Easing.in(Easing.cubic), ...clamp });
  const nameSize = Math.round(84 * k);
  const trackingSet = nameSize * 0.06;
  const tracking = interpolate(nameIn, [0, 1], [nameSize * 0.4, trackingSet]) + out * nameSize * 0.1;
  const lines = wrapTitle(entry.name.toUpperCase(), nameSize, trackingSet, column ? box.x - 120 : width - 80);
  const charges = Number(entry.stats.find(([l]) => l === "CHARGES")?.[1] ?? 0);
  const kindLabel = weapon ? "Weapon" : `Ability · ${entry.category ?? ""}`;
  const show = 1 - out;

  const block = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: column ? "flex-start" : "center",
        gap: Math.round(18 * k),
        opacity: show,
        transform: `translate(${sx}px, ${sy - out * 26}px)`,
      }}
    >
      <div style={{ position: "relative", width: size, height: size, alignSelf: column ? "flex-start" : "center" }}>
        {weapon ? (
          <>
            {/* the shockwave */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: size * (0.6 + wave * 1.6),
                height: size * (0.6 + wave * 1.6),
                transform: "translate(-50%, -50%)",
                borderRadius: "50%",
                border: `${Math.max(1, (1 - wave) * 6)}px solid rgba(163,44,34,${(1 - wave) * 0.9})`,
                boxShadow: `0 0 ${30 * (1 - wave)}px rgba(163,44,34,${(1 - wave) * 0.6})`,
              }}
            />
            <Sparks at={land} size={size} />
          </>
        ) : (
          <>
            {/* the bloom */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: size * 2.4,
                height: size * 2.4,
                transform: `translate(-50%, -50%) scale(${0.4 + bloom * 0.6 + pulse * 0.02})`,
                background: "radial-gradient(circle, rgba(220,185,111,0.42) 0%, rgba(220,185,111,0.12) 35%, rgba(220,185,111,0) 62%)",
                opacity: bloom,
              }}
            />
            <Ring size={size} progress={ring} pulse={pulse} />
          </>
        )}
        <Img
          src={staticFile(entry.icon)}
          style={{
            position: "relative",
            width: size,
            height: size,
            imageRendering: "pixelated",
            opacity: iconOpacity,
            transform: `translateY(${iconY}px) scale(${iconScale})`,
            filter: weapon ? "drop-shadow(0 26px 40px rgba(0,0,0,0.65))" : "drop-shadow(0 0 24px rgba(220,185,111,0.35)) drop-shadow(0 18px 30px rgba(0,0,0,0.5))",
          }}
        />
      </div>
      {!weapon && charges > 0 ? (
        <div style={{ marginTop: Math.round(size * 0.2), alignSelf: column ? "flex-start" : "center", paddingLeft: column ? size * 0.5 - Math.round(14 * k) * 0.8 * charges : 0 }}>
          <Pips count={charges} at={26} size={Math.round(14 * k)} />
        </div>
      ) : null}
      <Eyebrow text={kindLabel} opacity={eyebrow} size={Math.round(22 * k)} color={weapon ? "#c9463a" : accent} style={{ textShadow: "0 2px 10px rgba(0,0,0,0.7)" }} />
      <div
        style={{
          fontFamily: CINZEL,
          fontWeight: 700,
          fontSize: nameSize,
          lineHeight: 1.04,
          letterSpacing: tracking,
          textAlign: column ? "left" : "center",
          paddingLeft: column ? 0 : tracking,
          whiteSpace: "nowrap",
          opacity: nameIn,
          ...goldText(sweep),
        }}
      >
        {lines.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      <Rule progress={interpolate(frame, [nameAt + 8, nameAt + 34], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp })} width={Math.round(200 * k)} align={column ? "left" : "center"} />
      <StatPlate stats={entry.stats} at={nameAt + 14} accent={accent} align={column ? "left" : "center"} />
    </div>
  );

  if (column) {
    return (
      <div style={{ position: "absolute", left: 90, top: 0, bottom: 0, width: box.x - 120, display: "flex", alignItems: "center" }}>
        {block}
      </div>
    );
  }
  if (centred) {
    return <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", paddingBottom: format === "vertical" ? 200 : 60 }}>{block}</AbsoluteFill>;
  }
  const top = format === "vertical" ? Math.round(height * 0.12) : box.y + Math.round(box.h * 0.1);
  return (
    <div style={{ position: "absolute", left: 0, width, top, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: width * 1.1,
          height: Math.round(760 * k),
          transform: "translate(-50%, -50%)",
          background: "radial-gradient(ellipse at 50% 50%, rgba(20,10,4,0.66) 0%, rgba(20,10,4,0.4) 45%, rgba(20,10,4,0) 72%)",
          opacity: show,
        }}
      />
      {block}
    </div>
  );
};
