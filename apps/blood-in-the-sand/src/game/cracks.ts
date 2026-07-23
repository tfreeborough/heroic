/**
 * Cracked-earth decals — Tremor's mark on the arena. Client-derived from cast
 * events + deployable snapshots, never networked (the blood-trail pattern,
 * docs/design/pvp-abilities.md).
 *
 * v2 (bits-blood.md §7): ONE fracture web per quake instead of ~27
 * accumulating pop decals. A web is born with its zone and expands outward
 * (clip reveal), stays dramatic while the quake shakes, then settle-fades to
 * a subtler stain when the quake dies and is stamped ONCE into the persistent
 * splat surface alongside the blood. The old design's 150ms crack pops each
 * bumped the scar epoch, pinning the whole scar picture (up to 128 live
 * paths, ~10ms of record) on its 200ms rebuild beat for every quake's entire
 * life — THE tremor frame-drop. Now the scar cache doesn't know cracks
 * exist: live cost is a handful of per-frame drawPath calls, settled cost is
 * zero.
 */
import { Skia, type SkPath } from "@shopify/react-native-skia";
import type { Vec2 } from "@heroic/core";

// ── Tuning ─────────────────────────────────────────────────────────────────
/** A cast-slam web's reveal — a stomp, so it races. Quake webs instead take
 * their zone's full duration: the ground keeps giving way for as long as the
 * ability runs, and full radius lands exactly as the zone dies. */
const SLAM_EXPAND_MS = 450;
/** The reveal advances in this many small jolts (mixed over a linear base) —
 * seismic lurching, not one smooth wipe. */
const LURCH_STEPS = 9;
/** Live drama stroke alpha, and the settled/baked stain's alpha. */
export const CRACK_DRAMA_ALPHA = 0.55;
export const CRACK_SETTLE_ALPHA = 0.3;
/** Quake died (or slam window passed) → drama fades to the settle look over
 * this long; at its end the web is harvestable for the splat stamp. */
export const CRACK_SETTLE_FADE_MS = 800;
/** A cast-slam web's drama window (no zone to keep it alive). */
const SLAM_DRAMA_MS = 1_200;
/** Fallback only (splat surface unavailable, so no bake): a settled web
 * slow-fades to nothing instead. Never seen when harvesting works — the
 * decal is stamped and removed the moment its settle-fade ends. */
const FALLBACK_FADE_MS = 30_000;
/** Live-list sanity cap — settled webs normally harvest out within ~1s. */
const MAX_LIVE = 32;

export interface CrackDecal {
  x: number;
  y: number;
  /** Full web radius — the reveal clip grows to this over expandMs. */
  r: number;
  bornMs: number;
  /** Reveal duration: SLAM_EXPAND_MS for stomps, the zone's full life for
   * quakes (animation time == ability time). */
  expandMs: number;
  /** When the drama ended: starts the settle-fade AND freezes the reveal
   * (the quake stopped, so the cracking stops). null while the quake still
   * shakes (settled by CrackField.settle when its zone dies). */
  settleAtMs: number | null;
  /** Primary arms as ONE SkPath, world coords, built at spawn — per-frame
   * path construction was the original record-time killer. */
  path: SkPath;
  /** Fine detail — branches, sub-forks and broken ring cracks — drawn
   * thinner than the primary arms. */
  finePath: SkPath;
  /** Links a web to its quake zone so the zone's death settles it. */
  quakeId?: number;
}

/** Current stroke alpha (absolute): drama → settle-fade → (fallback) gone. */
export const crackAlpha = (c: CrackDecal, nowMs: number): number => {
  if (c.settleAtMs === null || nowMs < c.settleAtMs) return CRACK_DRAMA_ALPHA;
  const t = (nowMs - c.settleAtMs) / CRACK_SETTLE_FADE_MS;
  if (t < 1)
    return CRACK_DRAMA_ALPHA + (CRACK_SETTLE_ALPHA - CRACK_DRAMA_ALPHA) * t;
  const f = (nowMs - c.settleAtMs - CRACK_SETTLE_FADE_MS) / FALLBACK_FADE_MS;
  return f >= 1 ? 0 : CRACK_SETTLE_ALPHA * (1 - f);
};

/** 0..1 reveal fraction — a linear front mixed with discrete jolts (the
 *  ground lurches open, it doesn't wipe). Frozen at settleAtMs: a dead zone
 *  stops cracking, and the splat stamp clips to the same frozen front.
 *  render.ts clips the web to r × this while < 1. */
export const crackReveal = (c: CrackDecal, nowMs: number): number => {
  const eff = c.settleAtMs === null ? nowMs : Math.min(nowMs, c.settleAtMs);
  const t = Math.min(1, Math.max(0, (eff - c.bornMs) / c.expandMs));
  const lurch = Math.floor(t * LURCH_STEPS) / LURCH_STEPS;
  return 0.65 * t + 0.35 * lurch;
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

  /** The full quake fracture web — one decal for the zone's whole life,
   * expanding to the zone radius over the zone's full duration (animation
   * time == ability time). Settled by settle() at the zone's death. */
  addQuake(
    quakeId: number,
    x: number,
    y: number,
    radius: number,
    durationMs: number,
    nowMs: number,
  ): void {
    this.add(x, y, radius, nowMs, durationMs, null, quakeId);
  }

  /** A cast-slam stomp web — races open, settles on its own short window. */
  addSlam(x: number, y: number, radius: number, nowMs: number): void {
    this.add(x, y, radius, nowMs, SLAM_EXPAND_MS, nowMs + SLAM_DRAMA_MS);
  }

  /** The quake zone died — start its web's settle-fade. */
  settle(quakeId: number, nowMs: number): void {
    for (const c of this.decals)
      if (c.quakeId === quakeId && c.settleAtMs === null) c.settleAtMs = nowMs;
  }

  /** Splice out webs done settling so render.ts can stamp them into the
   * splat surface at CRACK_SETTLE_ALPHA — the exact look they held live, so
   * the handoff is invisible. Only called when the surface exists; without
   * it, update()'s fallback fade reaps them instead. */
  harvestSettled(nowMs: number): CrackDecal[] {
    const out: CrackDecal[] = [];
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const c = this.decals[i]!;
      if (c.settleAtMs !== null && nowMs >= c.settleAtMs + CRACK_SETTLE_FADE_MS) {
        out.push(c);
        this.decals.splice(i, 1);
      }
    }
    return out;
  }

  /** Drop fully-faded webs (fallback path only). Once per frame. */
  update(nowMs: number): void {
    let write = 0;
    for (let read = 0; read < this.decals.length; read++) {
      const c = this.decals[read]!;
      if (crackAlpha(c, nowMs) > 0) this.decals[write++] = c;
    }
    this.decals.length = write;
  }

  /** Build the web — a primary skeleton plus a fine-detail layer, so the
   * fracture reads geological rather than asterisk:
   * - PRIMARY: jagged radial arms, count scaled to the radius.
   * - FINE: 1–2 branches per arm partway along (with a chance of a
   *   sub-fork off each branch tip), plus broken concentric RING cracks —
   *   the circumferential fractures real shattering has. The clip reveal
   *   uncovers each ring as the front passes its radius, so new structure
   *   keeps appearing for the whole expansion. */
  private add(
    x: number,
    y: number,
    radius: number,
    nowMs: number,
    expandMs: number,
    settleAtMs: number | null,
    quakeId?: number,
  ): void {
    const path = Skia.Path.Make();
    const finePath = Skia.Path.Make();
    const addPoly = (target: SkPath, pts: Vec2[]): void => {
      target.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) target.lineTo(pts[i]!.x, pts[i]!.y);
    };

    const arms = Math.round(7 + radius / 45 + Math.random() * 3);
    for (let i = 0; i < arms; i++) {
      const angle = ((i + 0.2 + Math.random() * 0.6) / arms) * Math.PI * 2;
      const length = radius * (0.55 + Math.random() * 0.45);
      const arm = jaggedLine(x, y, angle, length);
      addPoly(path, arm);
      const branches = 1 + (Math.random() < 0.6 ? 1 : 0);
      for (let b = 0; b < branches; b++) {
        // Fork from partway along the arm, veering off the arm's heading.
        const from = arm[1 + Math.floor(Math.random() * (arm.length - 2))]!;
        const bAngle = angle + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.7);
        const bLen = length * (0.25 + Math.random() * 0.2);
        const branch = jaggedLine(from.x, from.y, bAngle, bLen);
        addPoly(finePath, branch);
        if (Math.random() < 0.35) {
          const tip = branch[branch.length - 2]!;
          addPoly(
            finePath,
            jaggedLine(tip.x, tip.y, bAngle + (Math.random() - 0.5) * 1.4, bLen * 0.5),
          );
        }
      }
    }

    // Broken ring cracks: a few concentric bands, each a handful of jagged
    // arc pieces with gaps — never a clean circle.
    const rings = radius >= 150 ? 3 : 1 + Math.floor(Math.random() * 2);
    for (let ri = 0; ri < rings; ri++) {
      const rr = radius * (0.32 + (ri / Math.max(1, rings - 1)) * 0.5 + Math.random() * 0.06);
      const pieces = 2 + Math.floor(Math.random() * 3);
      for (let p = 0; p < pieces; p++) {
        const start = Math.random() * Math.PI * 2;
        const span = 0.5 + Math.random() * 0.8;
        const steps = Math.max(3, Math.round(span / 0.14));
        const pts: Vec2[] = [];
        for (let s = 0; s <= steps; s++) {
          const a = start + (span * s) / steps;
          const jr = rr + (Math.random() - 0.5) * 12;
          pts.push({ x: x + Math.cos(a) * jr, y: y + Math.sin(a) * jr });
        }
        addPoly(finePath, pts);
      }
    }

    this.decals.push({
      x,
      y,
      r: radius,
      bornMs: nowMs,
      expandMs,
      settleAtMs,
      path,
      finePath,
      ...(quakeId !== undefined ? { quakeId } : {}),
    });
    if (this.decals.length > MAX_LIVE) this.decals.splice(0, this.decals.length - MAX_LIVE);
  }
}
