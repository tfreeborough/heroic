/**
 * Words as ink, so type builds out of glyphs like a picture: the title cold
 * open, a chapter name, a pulled word, a thumbnail's words. Browser only
 * (it sets the type on an OffscreenCanvas), but free of Remotion.
 */
import { type Ink, inkFromRGBA } from "./ink";

/**
 * Text as ink: white type on black, wrapped to `maxWidth` px at the size in
 * `font` (a CSS font, e.g. `700 160px Cinzel`), centred. Builds like a picture.
 * A word too long for the width can't wrap, so the whole text sets smaller
 * until it fits (it used to be cut off: "ULTIPLAYE").
 */
export const inkFromText = (text: string, givenFont: string, maxWidth: number, lineHeight = 1.15): Ink => {
  const probe = new OffscreenCanvas(8, 8).getContext("2d")!;
  const given = Number(/(\d+(?:\.\d+)?)px/.exec(givenFont)?.[1] ?? 100);
  probe.font = givenFont;
  const widest = Math.max(1, ...text.split(/\s+/).filter(Boolean).map((w) => probe.measureText(w).width));
  const px = widest > maxWidth ? Math.floor(given * (maxWidth / widest) * 0.98) : given;
  const font = givenFont.replace(/(\d+(?:\.\d+)?)px/, `${px}px`);
  probe.font = font;
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${w}` : w;
      if (line && probe.measureText(next).width > maxWidth) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  const lh = px * lineHeight;
  const pad = Math.round(px * 0.3);
  const width = Math.ceil(Math.min(maxWidth, Math.max(1, ...lines.map((l) => probe.measureText(l).width)))) + pad * 2;
  const height = Math.ceil(lines.length * lh) + pad * 2;
  const c = new OffscreenCanvas(width, height);
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, width, height);
  g.fillStyle = "#fff";
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((l, i) => g.fillText(l, width / 2, pad + lh * (i + 0.5)));
  return inkFromRGBA(g.getImageData(0, 0, width, height).data, width, height, "light", "empty");
};
