/**
 * Thumbnail mock (2026-10-17): a fresh picture as glyphs, full bleed at
 * 1280×720, plus a few words built out of glyphs in an accent colour.
 * A throwaway to judge column counts, fonts and accents before the real
 * Desk feature is designed. Rendered as one late frame, once every glyph has landed.
 */
import { BuildLayer, TextBuild } from "@heroic/ascii-build/remotion";
import { LOCKED_LOOK, PALETTES, type Palette } from "@heroic/ascii-build";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { useMemo } from "react";
import type * as React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { z } from "zod";
import { CINZEL } from "../../brand";
import { GLYPH_FAMILY } from "../../glyphs";

const anton = loadAnton("normal", { weights: ["400"], subsets: ["latin"] });

const ACCENTS: Record<"bone" | "amber" | "red", Omit<Palette, "bg">> = {
  bone: { ink: [242, 233, 212], trail: [242, 233, 212], head: "#ffffff" },
  amber: { ink: [255, 186, 60], trail: [255, 160, 40], head: "#fff1cc" },
  red: { ink: [255, 72, 58], trail: [230, 50, 40], head: "#ffd6d0" },
};

export const thumbMockSchema = z.object({
  src: z.string(),
  cols: z.number(),
  text: z.string(),
  accent: z.enum(["bone", "amber", "red"]),
  font: z.enum(["anton", "cinzel"]),
  textCols: z.number(),
  seed: z.number(),
  gain: z.number().optional(),
  glow: z.number().optional(),
});
export type ThumbMockProps = z.infer<typeof thumbMockSchema>;

export const THUMB_FRAME = 300; // 10s at 30fps: the picture landed at 8s, the glow is up

export const ThumbMock: React.FC<ThumbMockProps> = ({ src, cols, text, accent, font, textCols, seed, gain = LOCKED_LOOK.gain, glow = 0.22 }) => {
  const { width, height } = useVideoConfig();
  const pal = PALETTES.matrix;
  const textPal: Palette = useMemo(() => ({ bg: pal.bg, ...ACCENTS[accent] }), [accent, pal.bg]);
  const look = useMemo(() => ({ ...LOCKED_LOOK, cols, gain }), [cols, gain]);
  // Cover, not fit: the 3:2 picture is cropped top and bottom to fill 16:9.
  const ph = Math.round((width * 1024) / 1536);
  const box = { x: 0, y: Math.round((height - ph) / 2), w: width, h: ph };
  const css = font === "anton" ? `400 300px "${anton.fontFamily}"` : `700 260px ${CINZEL}`;
  return (
    <AbsoluteFill style={{ backgroundColor: pal.bg }}>
      <BuildLayer cards={[{ id: "pic", src, seed, at: 0, seconds: 100 }]} palette={pal} family={GLYPH_FAMILY} look={look} box={box} glow={glow} />
      {text ? (
        <TextBuild
          text={text}
          font={css}
          maxWidth={900}
          box={{ x: width * 0.03, y: height * 0.08, w: width * 0.4, h: height * 0.78 }}
          look={look}
          cols={textCols}
          seed={seed + 7}
          timing={{ start: 0, end: 1 }}
          palette={textPal}
          family={GLYPH_FAMILY}
          arrival="pop"
          order="random"
        />
      ) : null}
    </AbsoluteFill>
  );
};
