/**
 * Blood decals — the game's namesake. Wounded players drip a trail onto the
 * sand (worse the lower their hp), every hit splashes at the impact point, and
 * a kill leaves a lingering pool plus a giant cone of spray fired out of the
 * victim's back. The arena accumulates a readable history of
 * where fights happened, and a fresh trail lets you hunt a wounded runner.
 *
 * Everything here is CLIENT-DERIVED from data every client already receives —
 * snapshot positions + hp for the drips, hit events for the splashes — so
 * blood never touches the sim or the wire (the events.ts contract: the wire
 * only carries what a client can't re-derive). The Math.random jitter means
 * clients differ by a few pixels per drop; the trails they describe are the
 * same. Known trade-off: a spectator or rejoiner arriving mid-match starts
 * with a clean floor and only sees blood spilt after they arrived.
 */
import { Skia, type SkPath } from "@shopify/react-native-skia";
import type { PlayerSnapshot } from "@heroic/blood-in-the-sand-sim";

export interface BloodDecal {
  x: number;
  y: number;
  r: number;
  bornMs: number;
  ttlMs: number;
  /** Opacity at birth (severity-scaled for drips); fades via decalAlpha. */
  alpha: number;
  /** Smear vector: when set, the decal is a streak from (x,y) to (x+dx,y+dy)
   * (a round-capped thick line, r = half-width) instead of a round drop. */
  dx?: number;
  dy?: number;
  /** Per-decal random, frozen at birth. Seeds the irregular splat silhouette
   * so a mark's shape is stable across scar rebuilds (a fresh Math.random per
   * rebuild would make every pool crawl). */
  seed: number;
  /** Silhouette built ONCE at birth (the cracks.ts lesson — rebuilding every
   * path each scar pass was the `rec`-spike killer on weak devices). Drops and
   * teardrops bake in world coords and draw directly; pools bake at UNIT
   * radius around the origin and draw under translate(x,y)+scale(r), which is
   * what lets the renderer reuse one cached radial gradient per ramp step. */
  path: SkPath;
  /** Pools only: the drying clot blob, unit-local like `path`. */
  clotPath?: SkPath;
}

// ── Tuning ─────────────────────────────────────────────────────────────────
/** Bleeding starts below this hp fraction and worsens toward zero. */
const BLEED_HP_FRAC = 0.5;
const DRIP_TTL_MS = 45_000;
/** Death pools outlive drips — they're the "someone fell here" marker. */
const POOL_TTL_MS = 100_000;
/** Decals stay fully opaque for this fraction of life, then fade linearly. */
const FADE_START = 0.45;
/** Hard cap — oldest decals evict first (the array is birth-ordered). */
const MAX_DECALS = 800;

/** Trail spacing: a drop every ~N px moved, tighter the worse the wound.
 * Each gap is resampled with heavy random spread (gapJitter) — even spacing
 * is what made trails read as dotted lines. (Halved density 2026-07-10, Tom:
 * the first pass painted too much blood.) */
const DRIP_SPACING_MAX = 68;
const DRIP_SPACING_MIN = 24;
/** Multiplier range applied to every sampled gap/interval: 0.35×–1.75×. */
const gapJitter = (): number => 0.35 + Math.random() * 1.4;
/** Standing still still bleeds — a slow pool builds under an idle body. */
const IDLE_DRIP_MS_MAX = 2800;
const IDLE_DRIP_MS_MIN = 840;

/** Decals at least this big are pools — the premium gradient treatment. */
export const POOL_MIN_R = 6;

const TAU = Math.PI * 2;

/** Stable per-decal edge noise — layered sines keyed on the frozen seed so the
 *  silhouette is irregular but doesn't crawl between rebuilds. */
const wobble = (seed: number, a: number): number =>
  0.5 * Math.sin(a * 3 + seed) +
  0.3 * Math.sin(a * 5 - seed * 1.7 + 1.3) +
  0.2 * Math.sin(a * 2 + seed * 0.6);

/** A closed, smoothly-rounded irregular blob (no circular edge). */
const blobPath = (
  cx: number,
  cy: number,
  r: number,
  seed: number,
  amp: number,
): SkPath => {
  const N = 16;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const rr = r * (1 + amp * wobble(seed, a));
    xs.push(cx + Math.cos(a) * rr);
    ys.push(cy + Math.sin(a) * rr);
  }
  const path = Skia.Path.Make();
  path.moveTo((xs[0]! + xs[N - 1]!) / 2, (ys[0]! + ys[N - 1]!) / 2);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    path.quadTo(xs[i]!, ys[i]!, (xs[i]! + xs[j]!) / 2, (ys[i]! + ys[j]!) / 2);
  }
  path.close();
  return path;
};

/** A flung droplet: rounded fat back at (x,y) tapering to a point at
 *  (x+dx,y+dy) — spray reads as thrown blood, not round dots. */
const teardropPath = (
  x: number,
  y: number,
  dx: number,
  dy: number,
  r: number,
): SkPath => {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const tipx = x + dx;
  const tipy = y + dy;
  const bkx = x - ux * r * 1.15;
  const bky = y - uy * r * 1.15;
  const path = Skia.Path.Make();
  path.moveTo(tipx, tipy);
  path.quadTo(x + nx * r * 1.05, y + ny * r * 1.05, x + nx * r, y + ny * r);
  path.quadTo(bkx + nx * r * 0.55, bky + ny * r * 0.55, bkx, bky);
  path.quadTo(bkx - nx * r * 0.55, bky - ny * r * 0.55, x - nx * r, y - ny * r);
  path.quadTo(x - nx * r * 1.05, y - ny * r * 1.05, tipx, tipy);
  path.close();
  return path;
};

/** Current opacity of a decal (0 once expired). */
export const decalAlpha = (d: BloodDecal, nowMs: number): number => {
  const age = (nowMs - d.bornMs) / d.ttlMs;
  if (age >= 1) return 0;
  return d.alpha * (age <= FADE_START ? 1 : 1 - (age - FADE_START) / (1 - FADE_START));
};

/** Where a player last dripped — drives the distance/idle drip cadence. */
interface DripTracker {
  x: number;
  y: number;
  lastDripMs: number;
  /** Jitter factors for the NEXT drop (resampled after each) — irregular
   * cadence is what stops the trail reading as a dotted line. */
  gapK: number;
  idleK: number;
}

export class BloodField {
  readonly decals: BloodDecal[] = [];
  /** Total decals ever pushed — the scar cache's dirty signal (render.ts).
   * A plain length can't serve: at the MAX_DECALS cap a push also evicts,
   * so the length sits still while the field churns. */
  epoch = 0;
  private readonly trackers = new Map<number, DripTracker>();

  /**
   * Advance the drip trails from an interpolated view's players. Call once
   * per rendered frame; cadence is distance-based so frame rate doesn't
   * change how bloody a trail is.
   */
  update(players: readonly PlayerSnapshot[], nowMs: number): void {
    const d = this.decals;
    for (let i = d.length - 1; i >= 0; i--) {
      if (nowMs - d[i]!.bornMs >= d[i]!.ttlMs) d.splice(i, 1);
    }

    for (const p of players) {
      if (!p.alive) {
        this.trackers.delete(p.id);
        continue;
      }
      let t = this.trackers.get(p.id);
      if (!t) {
        t = { x: p.x, y: p.y, lastDripMs: nowMs, gapK: gapJitter(), idleK: gapJitter() };
        this.trackers.set(p.id, t);
      }
      const hpFrac = p.hp / p.maxHp;
      if (hpFrac >= BLEED_HP_FRAC) {
        // Healthy: keep the tracker glued on so the first wounded drop lands
        // where the wound happened, not spaced from some stale position.
        t.x = p.x;
        t.y = p.y;
        t.lastDripMs = nowMs;
        continue;
      }

      const severity = 1 - hpFrac / BLEED_HP_FRAC; // 0 at threshold → 1 near death
      const spacing = (DRIP_SPACING_MAX - (DRIP_SPACING_MAX - DRIP_SPACING_MIN) * severity) * t.gapK;
      const idleMs = (IDLE_DRIP_MS_MAX - (IDLE_DRIP_MS_MAX - IDLE_DRIP_MS_MIN) * severity) * t.idleK;
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      const moved = Math.hypot(dx, dy);
      if (moved < spacing && nowMs - t.lastDripMs < idleMs) continue;

      t.x = p.x;
      t.y = p.y;
      t.lastDripMs = nowMs;
      t.gapK = gapJitter();
      t.idleK = gapJitter();
      this.drip(p.x, p.y, moved > 2 ? dx / moved : 0, moved > 2 ? dy / moved : 0, severity, nowMs);
    }
  }

  /**
   * One trail emission — a weighted mix of shapes so the trail reads as gore,
   * not a dotted line: lone drops, 2–3 drop spatters, and (only while moving)
   * smears streaked along the direction of travel.
   */
  private drip(x: number, y: number, dirX: number, dirY: number, severity: number, nowMs: number): void {
    const moving = dirX !== 0 || dirY !== 0;
    const roll = Math.random();
    // Drops land around the feet, biased sideways off the path so the trail
    // wanders instead of tracing the exact walk line.
    const jitter = (spread: number): number => (Math.random() - 0.5) * spread;

    if (moving && roll < 0.3) {
      // Smear: a streak along the travel direction, skewed a little.
      const len = (8 + Math.random() * 14) * (0.7 + severity * 0.6);
      this.push({
        x: x + jitter(14),
        y: y + jitter(14),
        dx: dirX * len + jitter(5),
        dy: dirY * len + jitter(5),
        r: 1.5 + severity * 1.5 + Math.random(),
        bornMs: nowMs,
        ttlMs: DRIP_TTL_MS,
        alpha: 0.25 + 0.3 * severity,
      });
      return;
    }
    if (roll < 0.6) {
      // Spatter: 2–3 small drops flung close together.
      const n = 2 + (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        this.push({
          x: x + jitter(20),
          y: y + jitter(20),
          r: 1.2 + severity * 1.8 + Math.random() * 1.2,
          bornMs: nowMs,
          ttlMs: DRIP_TTL_MS,
          alpha: 0.22 + 0.28 * severity + Math.random() * 0.1,
        });
      }
      return;
    }
    // Lone drop, size and placement both loose.
    this.push({
      x: x + jitter(16),
      y: y + jitter(16),
      r: 1.8 + severity * 2.5 + Math.random() * 2,
      bornMs: nowMs,
      ttlMs: DRIP_TTL_MS,
      alpha: 0.28 + 0.32 * severity,
    });
  }

  /**
   * The kill splatter: a giant spray fired out of the victim's BACK — a
   * narrow cone opposite the killing blow, painted onto the sand in long
   * streaks and flung drops. Called on top of splatter()'s pool, with
   * (dirX, dirY) the unit direction of the blow (attacker → victim).
   */
  deathBurst(x: number, y: number, dirX: number, dirY: number, nowMs: number): void {
    const CONE_HALF = (26 * Math.PI) / 180;
    const base = Math.atan2(dirY, dirX);
    // Bombast comes from COUNT and reach, not droplet size (Tom, 2026-07-12:
    // it must stay "small little droplets, just a lot more of it") — a dense
    // mist of trail-scale drops fanning ~3 body-lengths out the back.
    const drops = 80;
    for (let i = 0; i < drops; i++) {
      const ang = base + (Math.random() - 0.5) * 2 * CONE_HALF;
      // sqrt bias pushes mass OUT into the cone — this is spray, not a pool.
      const dist = 20 + Math.sqrt(Math.random()) * 200;
      const px = x + Math.cos(ang) * dist;
      const py = y + Math.sin(ang) * dist;
      // Mostly streaks aligned with the spray; longer the further they flew.
      const streak = Math.random() < 0.6;
      const len = streak ? 8 + Math.random() * 24 * (dist / 220) : 0;
      this.push({
        x: px,
        y: py,
        ...(streak ? { dx: Math.cos(ang) * len, dy: Math.sin(ang) * len } : {}),
        r: (streak ? 1.2 : 1.6) + Math.random() * 2.2,
        bornMs: nowMs,
        ttlMs: POOL_TTL_MS,
        alpha: 0.32 + Math.random() * 0.25,
      });
    }
    // A short trail of modest gouts right behind the body, bridging pool and
    // spray — small enough to read as blood, not blobs.
    for (let i = 0; i < 5; i++) {
      const ang = base + (Math.random() - 0.5) * CONE_HALF;
      const dist = 10 + i * 12;
      this.push({
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist,
        r: 7 - i * 0.8 + Math.random() * 2,
        bornMs: nowMs,
        ttlMs: POOL_TTL_MS,
        alpha: 0.5,
      });
    }
  }

  /** Impact splash for a hit event; a lethal hit also leaves the death pool. */
  splatter(x: number, y: number, damage: number, lethal: boolean, nowMs: number): void {
    const drops = Math.min(9, 3 + Math.floor(damage / 8)) + (lethal ? 6 : 0);
    const spread = lethal ? 30 : 22;
    for (let i = 0; i < drops; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.random() * Math.random() * spread; // biased toward the centre
      const px = x + Math.cos(ang) * dist;
      const py = y + Math.sin(ang) * dist;
      // Outer droplets sometimes streak outward — flung, not placed.
      const streak = dist > spread * 0.3 && Math.random() < 0.45;
      const len = streak ? 5 + Math.random() * 10 : 0;
      this.push({
        x: px,
        y: py,
        ...(streak ? { dx: Math.cos(ang) * len, dy: Math.sin(ang) * len } : {}),
        r: (streak ? 1.2 : 1.5) + Math.random() * (lethal ? 4 : 3),
        bornMs: nowMs,
        ttlMs: DRIP_TTL_MS,
        alpha: 0.35 + Math.random() * 0.2,
      });
    }
    if (lethal) {
      // An irregular pool: one big blob plus offset lobes (the skeleton
      // marker will sit on top of this later).
      this.push({ x, y, r: 16, bornMs: nowMs, ttlMs: POOL_TTL_MS, alpha: 0.5 });
      for (let i = 0; i < 5; i++) {
        const ang = Math.random() * Math.PI * 2;
        this.push({
          x: x + Math.cos(ang) * (6 + Math.random() * 8),
          y: y + Math.sin(ang) * (6 + Math.random() * 8),
          r: 7 + Math.random() * 5,
          bornMs: nowMs,
          ttlMs: POOL_TTL_MS,
          alpha: 0.45,
        });
      }
    }
  }

  private push(decal: Omit<BloodDecal, "seed" | "path" | "clotPath">): void {
    const d = decal as BloodDecal;
    d.seed = Math.random() * 1000;
    if (d.dx !== undefined && d.dy !== undefined) {
      d.path = teardropPath(d.x, d.y, d.dx, d.dy, Math.max(1, d.r));
    } else if (d.r < POOL_MIN_R) {
      d.path = blobPath(d.x, d.y, d.r, d.seed, d.r < 4 ? 0.16 : 0.3);
    } else {
      d.path = blobPath(0, 0, 1, d.seed, 0.32);
      d.clotPath = blobPath(0, 0, 0.6, d.seed * 1.7 + 11, 0.28);
    }
    this.epoch++;
    if (this.decals.length >= MAX_DECALS) this.decals.shift();
    this.decals.push(d);
  }
}
