/**
 * Look lab (11-05): one Beats picture through the real build layer, with
 * the glyph look's knobs as props, so a still or a short clip can be
 * rendered for each setting side by side. Not a format: a test rig for
 * judging glow, punch, outline, columns and the camera move on real
 * pictures (docs/design/desk-ascii-scripts.md § Film stills).
 */
import { BEATS_GLOW, BEATS_LOOK, BEATS_MOTION, PALETTES } from "@heroic/ascii-build";
import { BuildLayer, MOVE_KINDS } from "@heroic/ascii-build/remotion";
import { AbsoluteFill } from "remotion";
import { z } from "zod";
import { GLYPH_FAMILY } from "../../glyphs";

export const lookLabSchema = z.object({
  src: z.string(),
  depth: z.string().optional(),
  seconds: z.number().min(2).max(30),
  seed: z.number().optional(),
  cols: z.number().optional(),
  glow: z.number().optional(),
  punch: z.enum(["off", "on", "strong"]).optional(),
  outline: z.enum(["off", "on", "strong"]).optional(),
  motion: z.number().optional(),
  palette: z.enum(["sand", "matrix"]).optional(),
  gain: z.number().optional(),
  move: z.enum(MOVE_KINDS).optional(),
  parallax: z.number().optional(),
});

export const LookLab: React.FC<z.infer<typeof lookLabSchema>> = (p) => {
  const pal = PALETTES[p.palette ?? "matrix"];
  const look = { ...BEATS_LOOK, gain: p.gain ?? BEATS_LOOK.gain, cols: p.cols ?? BEATS_LOOK.cols, punch: p.punch === "off" ? undefined : (p.punch ?? BEATS_LOOK.punch), outline: p.outline === "off" ? undefined : (p.outline ?? BEATS_LOOK.outline) };
  // The Beats landscape picture box: full width, the caption band (14%) off the bottom.
  const box = { x: 0, y: 0, w: 1920, h: Math.round(1080 * 0.86) };
  return (
    <AbsoluteFill style={{ backgroundColor: pal.bg }}>
      <BuildLayer cards={[{ id: "lab", src: p.src, ...(p.depth ? { depth: p.depth } : {}), seed: p.seed ?? 7, at: 0, seconds: p.seconds }]} palette={pal} family={GLYPH_FAMILY} look={look} box={box} glow={p.glow ?? BEATS_GLOW} motion={p.motion ?? BEATS_MOTION} moves={p.move ? [p.move] : undefined} parallax={p.parallax} />
    </AbsoluteFill>
  );
};
