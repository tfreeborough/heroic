/**
 * Cracked-earth decals — Tremor's mark on the arena, the blood-trail pattern
 * exactly (docs/design/pvp-abilities.md): client-derived from cast events,
 * never networked, persisting on the floor and fading out. Each crack is a
 * burst of jagged radial polylines generated once at spawn (no per-frame
 * randomness), drawn in the floor pass under the blood.
 */
import { Skia, type SkPath } from "@shopify/react-native-skia";
import type { Vec2 } from "@heroic/core";

/** How long a crack stays on the sand before it's fully faded. */
export const CRACK_TTL_MS = 30_000;
// Oldest-evict cap — tremor spam can't grow the record cost. Sized for the
// quake era: a zone pops ~27 cracks over its 4s and they linger 20s, so a
// couple of overlapping quakes plus history fit without evicting. Cracks draw
// through render.ts's cached scar picture, so the cap bounds the ~5Hz rebuild
// cost, not a per-frame one.
const MAX_CRACKS = 128;

export interface CrackDecal {
  x: number;
  y: number;
  bornMs: number;
  /** Lifetime for THIS decal — the quake's pops die in ~2.5s, scars in 30s. */
  ttlMs: number;
  /** All arms as one SkPath, world coords, built ONCE at spawn — per-frame
   * path construction was the record-time killer (one quake = ~1300 paths). */
  path: SkPath;
}

/** 0..1 draw alpha: holds strong briefly, then a long linear fade. */
export const crackAlpha = (c: CrackDecal, nowMs: number): number => {
  const t = (nowMs - c.bornMs) / c.ttlMs;
  if (t >= 1) return 0;
  return t < 0.1 ? 1 : 1 - (t - 0.1) / 0.9;
};

/** One jagged radial line: outward from the centre with lateral jitter. */
const jaggedLine = (x: number, y: number, angle: number, length: number): Vec2[] => {
  const segments = 3 + Math.floor(Math.random() * 2);
  const points: Vec2[] = [{ x, y }];
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  for (let s = 1; s <= segments; s++) {
    const along = (length * s) / segments;
    const jitter = (Math.random() - 0.5) * 14;
    points.push({
      x: x + dirX * along - dirY * jitter,
      y: y + dirY * along + dirX * jitter,
    });
  }
  return points;
};

export class CrackField {
  readonly decals: CrackDecal[] = [];
  /** Total cracks ever added — the scar cache's dirty signal (render.ts). */
  epoch = 0;

  /** Fracture the ground at a slam point. `radius` scales the burst. */
  add(x: number, y: number, radius: number, nowMs: number, ttlMs = CRACK_TTL_MS): void {
    const path = Skia.Path.Make();
    const addArm = (arm: Vec2[]): void => {
      path.moveTo(arm[0]!.x, arm[0]!.y);
      for (let i = 1; i < arm.length; i++) path.lineTo(arm[i]!.x, arm[i]!.y);
    };
    const arms = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < arms; i++) {
      const angle = ((i + 0.2 + Math.random() * 0.6) / arms) * Math.PI * 2;
      const length = radius * (0.35 + Math.random() * 0.4);
      const arm = jaggedLine(x, y, angle, length);
      addArm(arm);
      // Half the arms fork near their tip — reads as fracture, not asterisk.
      if (Math.random() < 0.5) {
        const from = arm[arm.length - 2]!;
        addArm(jaggedLine(from.x, from.y, angle + (Math.random() - 0.5) * 1.6, length * 0.4));
      }
    }
    this.epoch++;
    this.decals.push({ x, y, bornMs: nowMs, ttlMs, path });
    if (this.decals.length > MAX_CRACKS) this.decals.splice(0, this.decals.length - MAX_CRACKS);
  }

  /** Drop fully-faded decals. Once per frame, like BloodField.update. */
  update(nowMs: number): void {
    let write = 0;
    for (let read = 0; read < this.decals.length; read++) {
      const c = this.decals[read]!;
      if (nowMs - c.bornMs < c.ttlMs) this.decals[write++] = c;
    }
    this.decals.length = write;
  }
}
