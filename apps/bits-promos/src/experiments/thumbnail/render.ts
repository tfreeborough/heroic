/** Render the thumbnail mocks (ThumbMock.tsx) into public/experiments/thumb-mock/out/. Bundles once. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { THUMB_FRAME, type ThumbMockProps } from "./ThumbMock";

const OUT = join(import.meta.dir, "../../../public/experiments/thumb-mock/out");
mkdirSync(OUT, { recursive: true });
const pic = (n: string) => `experiments/thumb-mock/${n}.png`;
const base = { cols: 140, text: "", accent: "bone", font: "anton", textCols: 80, seed: 3 } as const;

const variants: Record<string, ThumbMockProps> = {
  "r2-face-120": { ...base, src: pic("face"), cols: 120, gain: 1.6, glow: 0.45, text: "NOT\nLAG", accent: "red", textCols: 50 },
  "r2-face-160": { ...base, src: pic("face"), cols: 160, gain: 1.6, glow: 0.45, text: "NOT\nLAG", accent: "red", textCols: 50 },
  "r2-face-160-bone": { ...base, src: pic("face"), cols: 160, gain: 1.6, glow: 0.45, text: "NOT\nLAG", accent: "bone", textCols: 50 },
  "r2-face-160-plain": { ...base, src: pic("face"), cols: 160, gain: 1.6, glow: 0.45 },
  "r2-crown-160": { ...base, src: pic("crown"), cols: 160, gain: 1.6, glow: 0.45, text: "I\nWIN", accent: "amber", textCols: 45 },
  "r2-crown-160-cinzel": { ...base, src: pic("crown"), cols: 160, gain: 1.6, glow: 0.45, text: "I\nWIN", accent: "amber", font: "cinzel", textCols: 45 },
  "r2-eye-160": { ...base, src: pic("eye"), cols: 160, gain: 1.6, glow: 0.45, text: "I SEE\nYOU", accent: "red", textCols: 55 },
  "r2-eye-160-plain": { ...base, src: pic("eye"), cols: 160, gain: 1.6, glow: 0.45 },
};

const serveUrl = await bundle({ entryPoint: join(import.meta.dir, "../../index.ts"), publicDir: join(import.meta.dir, "../../../public") });
for (const [name, props] of Object.entries(variants)) {
  const composition = await selectComposition({ serveUrl, id: "ThumbMock", inputProps: props });
  await renderStill({ composition, serveUrl, output: join(OUT, `${name}.png`), inputProps: props, frame: THUMB_FRAME });
  console.log("✓", name);
}
