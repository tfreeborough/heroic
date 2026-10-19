/**
 * Thumbnail readability check (2026-10-19): the Desk's real thumbnail engine
 * (planThumbnail + drawThumbnail) drawn into a still, with the words' passes
 * (shade, outline, body) switchable, so before and after can sit side by
 * side at feed size. Rendered by render-real.ts.
 */
import { THUMB, THUMB_WORDS_STYLE, drawThumbnail, inkFromImage, planThumbnail } from "@heroic/ascii-build";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { useEffect, useRef } from "react";
import type * as React from "react";
import { AbsoluteFill, continueRender, delayRender, staticFile } from "remotion";
import { z } from "zod";
import { GLYPH_FAMILY } from "../../glyphs";

const anton = loadAnton("normal", { weights: ["400"], subsets: ["latin"] });
const WORDS_FAMILY = `"${anton.fontFamily}", Impact, sans-serif`;

export const thumbRealSchema = z.object({
  src: z.string(),
  words: z.string(),
  accent: z.enum(["red", "white"]),
  shade: z.boolean(),
  outline: z.boolean(),
  body: z.boolean(),
  pictureScale: z.number().optional(),
  pictureCols: z.number().optional(),
});
export type ThumbRealProps = z.infer<typeof thumbRealSchema>;

export const ThumbReal: React.FC<ThumbRealProps> = ({ src, words, accent, shade, outline, body, pictureScale, pictureCols }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const handle = delayRender("thumbnail");
    const img = new Image();
    img.onload = async () => {
      await Promise.all([document.fonts.load(`700 12px ${GLYPH_FAMILY}`), document.fonts.load(`400 40px ${WORDS_FAMILY}`)]);
      const ctx = canvas.current!.getContext("2d")!;
      const plan = planThumbnail({ picture: inkFromImage(img, "light", 512, "auto"), words, seed: 3, family: WORDS_FAMILY, pictureScale, pictureCols });
      drawThumbnail(ctx, plan, { accent, family: GLYPH_FAMILY, style: { ...THUMB_WORDS_STYLE, shade, outline, body } });
      continueRender(handle);
    };
    img.src = staticFile(src);
  }, [src, words, accent, shade, outline, body, pictureScale, pictureCols]);
  return (
    <AbsoluteFill>
      <canvas ref={canvas} width={THUMB.w} height={THUMB.h} />
    </AbsoluteFill>
  );
};
