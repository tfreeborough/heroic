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
  /** Death pools only: the pool SEEPS after birth — drawn at
   * r × poolGrowth(age), spreading to POOL_GROWTH× over POOL_GROW_MS. */
  grow?: boolean;
}

// ── Tuning ─────────────────────────────────────────────────────────────────
/** Bleeding starts below this hp fraction and worsens toward zero. */
const BLEED_HP_FRAC = 0.5;
const DRIP_TTL_MS = 45_000;
/** Death pools outlive drips — they're the "someone fell here" marker. */
const POOL_TTL_MS = 100_000;
/** Decals stay fully opaque for this fraction of life, then fade linearly. */
const FADE_START = 0.45;
/** Hard cap — oldest decals evict first (the array is birth-ordered). With the
 * splat-map harvest below this is a backstop, not the eraser it used to be:
 * the live array only holds the last ~BLOOD_DRY_MS of wet blood. */
const MAX_DECALS = 800;

/** A spill dries fully over this long, then holds coagulated (render.ts
 * samples it for the colour ramps). Past it a decal's appearance is FROZEN —
 * by construction it's before any ttl fade starts (16s < FADE_START × ttl for
 * both drips and pools) — which is what makes the splat-map harvest safe. */
export const BLOOD_DRY_MS = 16_000;

// ── Splat-map harvest (bits-blood.md §1) ───────────────────────────────────
/** Dried decals bake into the persistent splat surface in batches — each bake
 * pays a full-surface snapshot, so wait for a batch or an overdue oldest. */
const BAKE_MIN_BATCH = 24;
const BAKE_MAX_WAIT_MS = 2_500;

// ── Death-spray flight (bits-blood.md §2) ──────────────────────────────────
/** Airborne droplet flight time: base + per-px — near drops land first, so
 * the splatter paints outward from the corpse. */
const FLIGHT_BASE_MS = 110;
const FLIGHT_PER_PX_MS = 0.75;

// ── Bloody footprints (bits-blood.md §3) ───────────────────────────────────
/** Stepping in a pool younger than this re-inks your soles (≈ wetness 0.25 —
 * old enough and the surface has set; you don't track set blood). */
const FOOT_WET_MS = 10_000;
const FOOT_STEPS = 6;
const FOOT_STEP_PX = 26;
/** Sideways offset of alternating prints off the walk line. */
const FOOT_SIDE_PX = 3.5;

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

// ── Seeping death pools (bits-blood.md §5) ─────────────────────────────────
/** A death pool spreads to this multiple of its birth radius over
 * POOL_GROW_MS, ease-out — blood runs fast at first, then slows as it soaks
 * into the sand. Growth finishes before BLOOD_DRY_MS by design, so the splat
 * bake always stamps the final footprint. */
export const POOL_GROWTH = 1.5;
export const POOL_GROW_MS = 1_200;

/** Current seep multiplier for a decal (1 for everything non-growing). Pure
 * function of decal + clock, same contract as decalAlpha — render.ts applies
 * it inside the cached scar picture at no wire/per-frame cost. */
export const poolGrowth = (d: BloodDecal, nowMs: number): number => {
  if (!d.grow) return 1;
  const t = Math.min(1, Math.max(0, (nowMs - d.bornMs) / POOL_GROW_MS));
  const ease = 1 - (1 - t) ** 3;
  return 1 + (POOL_GROWTH - 1) * ease;
};

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
  const path = Skia.PathBuilder.Make();
  path.moveTo((xs[0]! + xs[N - 1]!) / 2, (ys[0]! + ys[N - 1]!) / 2);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    path.quadTo(xs[i]!, ys[i]!, (xs[i]! + xs[j]!) / 2, (ys[i]! + ys[j]!) / 2);
  }
  return path.close().detach();
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
  return Skia.PathBuilder.Make()
    .moveTo(tipx, tipy)
    .quadTo(x + nx * r * 1.05, y + ny * r * 1.05, x + nx * r, y + ny * r)
    .quadTo(bkx + nx * r * 0.55, bky + ny * r * 0.55, bkx, bky)
    .quadTo(bkx - nx * r * 0.55, bky - ny * r * 0.55, x - nx * r, y - ny * r)
    .quadTo(x - nx * r * 1.05, y - ny * r * 1.05, tipx, tipy)
    .close()
    .detach();
};

/** Current opacity of a decal (0 once expired). */
export const decalAlpha = (d: BloodDecal, nowMs: number): number => {
  const age = (nowMs - d.bornMs) / d.ttlMs;
  if (age >= 1) return 0;
  return d.alpha * (age <= FADE_START ? 1 : 1 - (age - FADE_START) / (1 - FADE_START));
};

/** A droplet still in the air — launched by deathBurst, promoted to a floor
 * decal at landMs. Drawn per-frame by render.ts (drawFlyingBlood) above the
 * bodies; never enters the scar cache until it lands. */
export interface FlyingDrop {
  /** Launch point (the corpse) and landing point on the sand. */
  x0: number;
  y0: number;
  tx: number;
  ty: number;
  r: number;
  bornMs: number;
  landMs: number;
  /** Decal payload stamped at touchdown (streak vector + birth opacity). */
  dx?: number;
  dy?: number;
  alpha: number;
  ttlMs: number;
}

/** Where a player last dripped — drives the distance/idle drip cadence. */
interface DripTracker {
  x: number;
  y: number;
  lastDripMs: number;
  /** Jitter factors for the NEXT drop (resampled after each) — irregular
   * cadence is what stops the trail reading as a dotted line. */
  gapK: number;
  idleK: number;
  /** Previous rendered-frame position — the footprint stride measures from
   * here (drips measure from the last DRIP, which is not the last frame). */
  px: number;
  py: number;
  /** Bloody-sole state: prints left before the blood wears off, which side
   * the next print lands, distance walked since the last print. */
  footSteps: number;
  footSide: 1 | -1;
  footAcc: number;
}

export class BloodField {
  readonly decals: BloodDecal[] = [];
  /** Droplets still in the air (death sprays) — promoted to decals on landing. */
  readonly flying: FlyingDrop[] = [];
  /** Wet-pool crossings since the last drain (world coords) — GameScreen
   * drains these for the squelch SFX, one per re-inking, not per print. */
  readonly crossings: { x: number; y: number }[] = [];
  /** Total decals ever pushed — the scar cache's dirty signal (render.ts).
   * A plain length can't serve: at the MAX_DECALS cap a push also evicts,
   * so the length sits still while the field churns. */
  epoch = 0;
  private readonly trackers = new Map<number, DripTracker>();

  /**
   * Splice out decals whose appearance is frozen (fully dried — past
   * BLOOD_DRY_MS, before any ttl fade) so render.ts can stamp them into the
   * persistent splat surface (bits-blood.md §1). Batched — each bake pays a
   * full-surface snapshot — so it returns [] until BAKE_MIN_BATCH are dry or
   * the oldest has waited BAKE_MAX_WAIT_MS past drying. The array is
   * birth-ordered, so the dry set is always a prefix. Doesn't touch the
   * epoch: the caller is already mid-rebuild. Never called (surface creation
   * failed) → decals just live out their ttls, exactly the old behaviour.
   */
  harvestDried(nowMs: number): BloodDecal[] {
    const d = this.decals;
    if (d.length === 0 || nowMs - d[0]!.bornMs < BLOOD_DRY_MS) return [];
    let n = 1;
    while (n < d.length && nowMs - d[n]!.bornMs >= BLOOD_DRY_MS) n++;
    if (n < BAKE_MIN_BATCH && nowMs - d[0]!.bornMs < BLOOD_DRY_MS + BAKE_MAX_WAIT_MS)
      return [];
    return d.splice(0, n);
  }

  /** Any death pool still seeping? Drives the scar cache onto its FRESH
   * cadence while true — pool growth stepping at the 1Hz fade beat reads as
   * pops, not spreading. Growing decals are a birth-ordered suffix, so the
   * walk is short. */
  hasGrowingPool(nowMs: number): boolean {
    const d = this.decals;
    for (let i = d.length - 1; i >= 0; i--) {
      const dec = d[i]!;
      if (nowMs - dec.bornMs >= POOL_GROW_MS) break;
      if (dec.grow) return true;
    }
    return false;
  }

  /**
   * Advance the drip trails from an interpolated view's players. Call once
   * per rendered frame; cadence is distance-based so frame rate doesn't
   * change how bloody a trail is.
   */
  update(players: readonly PlayerSnapshot[], nowMs: number): void {
    // Touch down any spray droplets that have finished flying. Born at the
    // promote frame (not landMs) so the array stays strictly birth-ordered —
    // the harvest prefix and FIFO eviction both lean on that.
    const f = this.flying;
    for (let i = f.length - 1; i >= 0; i--) {
      const drop = f[i]!;
      if (nowMs < drop.landMs) continue;
      f.splice(i, 1);
      this.push({
        x: drop.tx,
        y: drop.ty,
        ...(drop.dx !== undefined && drop.dy !== undefined
          ? { dx: drop.dx, dy: drop.dy }
          : {}),
        r: drop.r,
        bornMs: nowMs,
        ttlMs: drop.ttlMs,
        alpha: drop.alpha,
      });
    }

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
        t = {
          x: p.x,
          y: p.y,
          lastDripMs: nowMs,
          gapK: gapJitter(),
          idleK: gapJitter(),
          px: p.x,
          py: p.y,
          footSteps: 0,
          footSide: Math.random() < 0.5 ? 1 : -1,
          footAcc: 0,
        };
        this.trackers.set(p.id, t);
      }
      this.stepFootprints(p, t, nowMs);
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
   * Bloody footprints (bits-blood.md §3): standing in a still-wet pool
   * re-inks your soles; the next FOOT_STEPS strides each stamp a small print,
   * fading as the blood wears off. METRONOMIC on purpose — regular cadence +
   * alternating sides is what reads "footprints" against the deliberately
   * irregular drips, and the trail points at whoever walked away from a kill.
   */
  private stepFootprints(p: PlayerSnapshot, t: DripTracker, nowMs: number): void {
    const fdx = p.x - t.px;
    const fdy = p.y - t.py;
    const stepped = Math.hypot(fdx, fdy);
    t.px = p.x;
    t.py = p.y;
    if (this.inWetPool(p.x, p.y, nowMs)) {
      if (t.footSteps === 0) {
        this.crossings.push({ x: p.x, y: p.y });
        t.footAcc = 0;
      }
      t.footSteps = FOOT_STEPS;
    }
    if (t.footSteps === 0 || stepped < 0.5) return;
    t.footAcc += stepped;
    if (t.footAcc < FOOT_STEP_PX) return;
    t.footAcc = 0;
    t.footSide = t.footSide === 1 ? -1 : 1;
    const ux = fdx / stepped;
    const uy = fdy / stepped;
    // A print: a short smear along the stride, offset alternately off the
    // walk line.
    this.push({
      x: p.x - uy * t.footSide * FOOT_SIDE_PX + (Math.random() - 0.5) * 2,
      y: p.y + ux * t.footSide * FOOT_SIDE_PX + (Math.random() - 0.5) * 2,
      dx: ux * (4 + Math.random() * 2),
      dy: uy * (4 + Math.random() * 2),
      r: 1.5 + Math.random() * 0.4,
      bornMs: nowMs,
      ttlMs: DRIP_TTL_MS,
      alpha: 0.32 * (t.footSteps / FOOT_STEPS), // wears off print by print
    });
    t.footSteps--;
  }

  /** Is (x, y) inside a still-wet pool? Wet decals are a birth-ordered SUFFIX
   * of the array, so walk backward and stop at the first set one; post-harvest
   * the live array is small anyway. */
  private inWetPool(x: number, y: number, nowMs: number): boolean {
    const d = this.decals;
    for (let i = d.length - 1; i >= 0; i--) {
      const dec = d[i]!;
      if (nowMs - dec.bornMs >= FOOT_WET_MS) break;
      if (dec.r < POOL_MIN_R || dec.dx !== undefined) continue;
      const dx = x - dec.x;
      const dy = y - dec.y;
      const rr = dec.r * poolGrowth(dec, nowMs); // a seeping pool inks further
      if (dx * dx + dy * dy <= rr * rr) return true;
    }
    return false;
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
   * The kill spray, fired out of the victim's BACK — (dirX, dirY) is the unit
   * direction of the killing blow (attacker → victim). Called on top of
   * splatter()'s pool.
   *
   * v2 (bits-blood.md §2): the old uniform cone read as airbrush stipple —
   * flung blood has STRUCTURE. Now 3–5 distinct jets with droplets strung
   * along them (fat and dense at the base, fine and sparse at the tips) over
   * a thin mist, anchored to the corpse by heavy smears. Jet + mist droplets
   * FLY (FlyingDrop) and land near-first, so the splatter paints outward over
   * ~a quarter second; anchors and gouts are at the body and appear
   * instantly. Still "small little droplets, just a lot more of it" (Tom,
   * 2026-07-12) — bombast from count and reach, never blob size.
   */
  deathBurst(x: number, y: number, dirX: number, dirY: number, nowMs: number): void {
    const CONE_HALF = (26 * Math.PI) / 180;
    const base = Math.atan2(dirY, dirX);

    const launch = (
      px: number,
      py: number,
      r: number,
      alpha: number,
      dx?: number,
      dy?: number,
    ): void => {
      const dist = Math.hypot(px - x, py - y);
      this.flying.push({
        x0: x,
        y0: y,
        tx: px,
        ty: py,
        r,
        bornMs: nowMs,
        landMs: nowMs + FLIGHT_BASE_MS + dist * FLIGHT_PER_PX_MS,
        ...(dx !== undefined && dy !== undefined ? { dx, dy } : {}),
        alpha,
        ttlMs: POOL_TTL_MS,
      });
    };

    // The jets: stratified across the cone so two never merge, each with its
    // own reach, the first always long.
    const jets = 3 + Math.floor(Math.random() * 3);
    const jetAngs: number[] = [];
    for (let j = 0; j < jets; j++) {
      const frac = (j + 0.5) / jets;
      const ang =
        base + (frac - 0.5) * 2 * CONE_HALF * 0.9 + (Math.random() - 0.5) * 0.07;
      jetAngs.push(ang);
      const len = j === 0 ? 195 + Math.random() * 35 : 90 + Math.random() * 120;
      const drops = 11 + Math.floor(len / 16);
      for (let i = 0; i < drops; i++) {
        // pow > 1 biases t toward the base: dense/fat near the body,
        // sparse/fine at the tip. Lateral spread widens downrange.
        const t = Math.pow(Math.random(), 1.5);
        const dist = 18 + t * (len - 18);
        const lat = (Math.random() - 0.5) * (4 + t * 22);
        const px = x + Math.cos(ang) * dist - Math.sin(ang) * lat;
        const py = y + Math.sin(ang) * dist + Math.cos(ang) * lat;
        // Mostly streaks aligned with the jet, longer the further they flew.
        const streak = Math.random() < 0.65;
        const slen = streak ? (6 + Math.random() * 22) * (0.35 + t) : 0;
        launch(
          px,
          py,
          2.3 - 1.2 * t + Math.random() * 0.8,
          0.34 + Math.random() * 0.24,
          streak ? Math.cos(ang) * slen : undefined,
          streak ? Math.sin(ang) * slen : undefined,
        );
      }
    }

    // A thin uniform mist under the jets — they sit in a haze, not on clean
    // sand.
    for (let i = 0; i < 15; i++) {
      const ang = base + (Math.random() - 0.5) * 2 * CONE_HALF;
      const dist = 20 + Math.sqrt(Math.random()) * 190;
      launch(
        x + Math.cos(ang) * dist,
        y + Math.sin(ang) * dist,
        1.1 + Math.random() * 1.1,
        0.2 + Math.random() * 0.16,
      );
    }

    // Anchor smears: heavy streaks out of the corpse along the first jets —
    // they tie the spray to the body (v1 started 20px out and floated).
    const anchors = 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < anchors && i < jetAngs.length; i++) {
      const ang = jetAngs[i]!;
      const d0 = 6 + Math.random() * 8;
      const len = 28 + Math.random() * 30;
      this.push({
        x: x + Math.cos(ang) * d0,
        y: y + Math.sin(ang) * d0,
        dx: Math.cos(ang) * len,
        dy: Math.sin(ang) * len,
        r: 3 + Math.random() * 1.6,
        bornMs: nowMs,
        ttlMs: POOL_TTL_MS,
        alpha: 0.5,
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

  /** Impact splash for a hit event; a lethal hit also leaves the death pool.
   * (dirX, dirY): the unit attacker→victim line when known — ~60% of droplets
   * then exit in a ±45° fan on the FAR side (the through-wound, reaching
   * further than impact spatter), the rest stay radial, so every hit's
   * geometry is readable and lethal hits aren't a different KIND of physics,
   * just a bigger one (bits-blood.md §4). */
  splatter(
    x: number,
    y: number,
    damage: number,
    lethal: boolean,
    nowMs: number,
    dirX = 0,
    dirY = 0,
  ): void {
    const drops = Math.min(9, 3 + Math.floor(damage / 8)) + (lethal ? 6 : 0);
    const spread = lethal ? 30 : 22;
    const directional = dirX !== 0 || dirY !== 0;
    const exitAng = Math.atan2(dirY, dirX);
    for (let i = 0; i < drops; i++) {
      const exit = directional && Math.random() < 0.6;
      const ang = exit
        ? exitAng + (Math.random() - 0.5) * (Math.PI / 2)
        : Math.random() * Math.PI * 2;
      const dist = exit
        ? (0.3 + Math.random() * 0.9) * spread
        : Math.random() * Math.random() * spread; // biased toward the centre
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
      // marker will sit on top of this later). `grow`: the cluster seeps
      // outward over POOL_GROW_MS — each blob swells around its own centre,
      // so the overlaps deepen and the mass spreads as one stain.
      this.push({ x, y, r: 16, bornMs: nowMs, ttlMs: POOL_TTL_MS, alpha: 0.5, grow: true });
      for (let i = 0; i < 5; i++) {
        const ang = Math.random() * Math.PI * 2;
        this.push({
          x: x + Math.cos(ang) * (6 + Math.random() * 8),
          y: y + Math.sin(ang) * (6 + Math.random() * 8),
          r: 7 + Math.random() * 5,
          bornMs: nowMs,
          ttlMs: POOL_TTL_MS,
          alpha: 0.45,
          grow: true,
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
