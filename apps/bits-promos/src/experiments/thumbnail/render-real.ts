/** Render ThumbReal before/after pairs into public/experiments/thumb-mock/real/. Bundles once. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import type { ThumbRealProps } from "./ThumbReal";

const OUT = join(import.meta.dir, "../../../public/experiments/thumb-mock/real");
mkdirSync(OUT, { recursive: true });

const ideas: Record<string, Pick<ThumbRealProps, "src" | "words" | "accent">> = {
  eye: { src: "cards/0a51c083-27d6-407d-9b6f-73fd8e364196/thumb-te0hx3rd-own-1.png", words: "I SEE YOU", accent: "red" },
  players: { src: "cards/d89ec8f2-1b7c-45f6-8df1-6784dc64c8e1/thumb-2dngj7hl-1.png", words: "NO PLAYERS", accent: "red" },
  grim: { src: "cards/d89ec8f2-1b7c-45f6-8df1-6784dc64c8e1/thumb-lpb8w9un-1.png", words: "THE GRIM CHOICE", accent: "white" },
  apple: { src: "cards/d89ec8f2-1b7c-45f6-8df1-6784dc64c8e1/thumb-2egsgkl5-1.png", words: "Apple said no", accent: "red" },
};
const styles = {
  ...(process.env.BEFORE ? { before: { shade: false, outline: false, body: false } } : {}),
  c160: { shade: true, outline: true, body: true, pictureScale: 0.88, pictureCols: 160 },
  c140: { shade: true, outline: true, body: true, pictureScale: 0.88, pictureCols: 140 },
  c125: { shade: true, outline: true, body: true, pictureScale: 0.88, pictureCols: 125 },
};

const only = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: join(import.meta.dir, "../../index.ts"), publicDir: join(import.meta.dir, "../../../public") });
for (const [idea, base] of Object.entries(ideas)) {
  if (only.length && !only.includes(idea)) continue;
  for (const [style, passes] of Object.entries(styles)) {
    const inputProps: ThumbRealProps = { ...base, ...passes };
    const composition = await selectComposition({ serveUrl, id: "ThumbReal", inputProps });
    await renderStill({ composition, serveUrl, output: join(OUT, `${idea}-${style}.png`), inputProps, frame: 0 });
    console.log("✓", idea, style);
  }
}
