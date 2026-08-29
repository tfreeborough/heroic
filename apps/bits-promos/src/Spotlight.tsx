import type * as React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CINZEL, palette } from "./brand";
import { Backdrop, EndCard, PixelIcon, StatChip } from "./components";
import { DEFAULT_TAGLINE, TAGLINES } from "./data/copy";
import roster from "./data/roster.json";

export interface RosterEntry {
  id: string;
  name: string;
  icon: string;
  stats: [string, string][];
  category?: string;
}

export const findEntry = (kind: "weapon" | "ability", id: string): RosterEntry => {
  const list = (kind === "weapon" ? roster.weapons : roster.abilities) as RosterEntry[];
  const entry = list.find((e) => e.id === id) ?? list[0];
  if (!entry) throw new Error(`empty ${kind} roster — run \`bun run sync\``);
  return entry;
};

const KIND_LABEL = { weapon: "WEAPON", ability: "ABILITY" } as const;

export type SpotlightProps = {
  kind: "weapon" | "ability";
  id: string;
};

/**
 * 9s vertical spotlight: category tag → icon slam → name → tagline →
 * stat chips → end card. Everything is driven by the roster entry, so a new
 * video is just a new `--props='{"kind":"ability","id":"sinkhole"}'`.
 */
export const Spotlight: React.FC<SpotlightProps> = ({ kind, id }) => {
  const entry = findEntry(kind, id);
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const endCardFrames = Math.round(fps * 2.6);
  const bodyEnd = durationInFrames - endCardFrames;

  const iconIn = spring({ frame: frame - 6, fps, config: { damping: 11, stiffness: 120 } });
  const nameIn = spring({ frame: frame - 22, fps, config: { damping: 13, stiffness: 170 } });
  const tagOpacity = interpolate(frame, [46, 62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bodyFade = interpolate(frame, [bodyEnd - 12, bodyEnd], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const drift = interpolate(frame, [0, bodyEnd], [0, -30]);

  const tagline = TAGLINES[entry.id] ?? DEFAULT_TAGLINE;
  const tagText = (entry.category ?? KIND_LABEL[kind]).toUpperCase();

  return (
    <AbsoluteFill>
      <Backdrop glow={0.6} />
      <Sequence durationInFrames={bodyEnd}>
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            gap: 56,
            opacity: bodyFade,
            transform: `translateY(${drift}px)`,
            padding: "0 70px",
          }}
        >
          <div
            style={{
              fontFamily: CINZEL,
              fontWeight: 700,
              fontSize: 34,
              letterSpacing: 12,
              color: palette.bone,
              background: palette.crimson,
              border: `3px solid ${palette.umber}`,
              padding: "14px 40px",
              opacity: iconIn,
            }}
          >
            {tagText}
          </div>
          <PixelIcon
            src={entry.icon}
            size={620}
            style={{ transform: `scale(${iconIn})` }}
          />
          <div
            style={{
              fontFamily: CINZEL,
              fontWeight: 700,
              fontSize: 120,
              lineHeight: 1.05,
              textAlign: "center",
              color: palette.bone,
              textShadow: `0 8px 0 ${palette.umber}`,
              transform: `scale(${0.6 + nameIn * 0.4})`,
              opacity: nameIn,
            }}
          >
            {entry.name.toUpperCase()}
          </div>
          <div
            style={{
              fontFamily: CINZEL,
              fontWeight: 700,
              fontSize: 44,
              textAlign: "center",
              color: palette.sand,
              opacity: tagOpacity,
              maxWidth: 860,
            }}
          >
            {tagline}
          </div>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap", justifyContent: "center" }}>
            {entry.stats.map(([label, value], i) => (
              <StatChip key={label} label={label} value={value} delay={70 + i * 8} />
            ))}
          </div>
        </AbsoluteFill>
      </Sequence>
      <Sequence from={bodyEnd}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
