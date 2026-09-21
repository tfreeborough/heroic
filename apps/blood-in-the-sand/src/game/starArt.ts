/**
 * Shared star art for the "Night" cosmetics (bits-cosmetics.md) — Starblood
 * (bloodMaterials.ts) and the Constellation finisher (constellation.ts) bake
 * the same four-point star into their atlases, so the set reads as one hand.
 */
import { Skia, type SkPath } from "@shopify/react-native-skia";

/** A four-point star: long N/E/S/W points, a pinched waist. */
export const starPath = (cx: number, cy: number, r: number): SkPath => {
  const b = Skia.PathBuilder.Make();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.16;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) b.moveTo(x, y);
    else b.lineTo(x, y);
  }
  return b.close().detach();
};
