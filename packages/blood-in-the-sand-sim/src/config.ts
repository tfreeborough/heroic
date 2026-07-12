/**
 * Blood in the Sand — all tuning constants. One file so PvP numbers never
 * leak into (or out of) the PvE games: same core systems, separate tuning
 * tables (see docs/design/pvp-arena.md).
 */
import type { AbilityConfig, AttackConfig, CombatStats } from "@heroic/core";

/** Server sim rate. Core primitives are dt-parameterised, so 30Hz "just works". */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

/** Broadcast every Nth tick. 1 = every tick (~21KB/s per client — nothing on LAN). */
export const SNAPSHOT_DIVISOR = 1;

// ── Players ────────────────────────────────────────────────────────────────
export const PLAYER_RADIUS = 18;
export const PLAYER_MAX_SPEED = 280; // px/s
export const PLAYER_ACCEL = 3000; // px/s²
export const PLAYER_DECEL = 2800; // px/s²
export const CROWD_PUSH = 0.5;

/** The shared base sheet; each weapon overlays its own tweaks (WEAPONS[..].stats). */
export const PLAYER_STATS: CombatStats = {
  maxHp: 100,
  attack: 16,
  defense: 2,
  critChance: 0.15,
  critMultiplier: 2,
};

// ── Weapons ────────────────────────────────────────────────────────────────
// Picked per-player in the lobby (duplicates allowed); the pick IS the build.
// Windups stay well past the PvE feel: a human opponent needs to *read* the
// telegraph and have time to dash out of it. Every weapon auto-fires at the
// auto-target — no aim is networked (the design doc's netcode rule).
// Pacing pass 2026-07-10 (Tom, after playing v1): cycles slowed across the
// board — ranged especially — so melee can actually close the gap between
// shots. The staff was near-unapproachable at a 0.9s cycle; it now telegraphs
// longest and fires rarest.

export type WeaponId = "blade" | "bow" | "staff" | "hammer";
export const WEAPON_IDS: readonly WeaponId[] = ["blade", "bow", "staff", "hammer"];

/** A chance-on-arc-hit damage-over-time rider (the blade's bleed). */
export interface BleedConfig {
  chance: number;
  ticks: number;
  /** Seconds between ticks (and before the first). */
  interval: number;
  /** Fixed damage per tick — no variance, crit, or defense (rng-stream neutral). */
  damage: number;
}

/** An on-arc-hit movement debuff (the hammer's slow). Applies on every
 * non-lethal hit — no rng draw, so the stream stays deterministic. */
export interface SlowConfig {
  /** Seconds the slow lasts (refreshed, never stacked). */
  duration: number;
  /** Multiplier on the victim's max run speed while slowed. */
  factor: number;
}

export interface WeaponProjectileConfig {
  radius: number;
  maxRange: number;
  /** rad/s the shot may steer toward its fire-time target; absent = straight. */
  homingTurnRate?: number;
}

export interface WeaponConfig {
  name: string;
  attack: AttackConfig;
  /** Overlaid on PLAYER_STATS when the weapon is picked. */
  stats: Partial<CombatStats>;
  /** Auto-target acquisition radius (gauntlet rule: reach + a margin). */
  engagementRadius: number;
  bleed?: BleedConfig;
  slow?: SlowConfig;
  projectile?: WeaponProjectileConfig;
}

export const WEAPONS: Record<WeaponId, WeaponConfig> = {
  // Thin cone, short reach, quickest cycle — commit in close, stick bleeds.
  // Deliberately OUT-REACHED by the hammer (Tom, 2026-07-10): fast cycle +
  // bleed already carry it; reach was making it dominate the melee bracket.
  blade: {
    name: "Blade",
    attack: {
      shape: "arc",
      school: "physical",
      reach: 90,
      arcWidth: (40 * Math.PI) / 180,
      windup: 0.25,
      recovery: 0.55,
      // Near-zero on purpose: the blade WANTS you to stay in reach (bleed
      // stacking) — knocking its own target away was self-defeating.
      knockback: 100,
    },
    stats: {},
    engagementRadius: 90 + 160,
    bleed: { chance: 0.35, ticks: 3, interval: 1, damage: 3 },
  },
  // Long-range poke: fast arrow, biggest hit, slowest to re-aim in close.
  // Tester pass 2026-07-12: slower cycle, faster arrow — the shot is harder
  // to earn but harder to sidestep once loosed (dash i-frames stay the answer).
  bow: {
    name: "Bow",
    attack: {
      shape: "projectile",
      school: "physical",
      reach: 360,
      projectileSpeed: 650,
      windup: 0.5,
      recovery: 0.9,
      knockback: 260,
    },
    stats: { attack: 20 },
    engagementRadius: 360 + 20,
    // maxRange past reach: a shot fired at the acquisition edge still connects.
    projectile: { radius: 6, maxRange: 360 + 60 },
  },
  // Slow seeking orb — zoning pressure you must dodge or dash through.
  // Speed sits just above PLAYER_MAX_SPEED: outrunnable never, out-dashable always.
  staff: {
    name: "Staff",
    attack: {
      shape: "projectile",
      school: "magic",
      reach: 320,
      projectileSpeed: 300,
      windup: 0.6,
      recovery: 0.9,
      knockback: 300,
    },
    stats: { attack: 17 },
    engagementRadius: 320 + 20,
    // 2.2 rad/s can't track a close strafer — "slightly homing" by design.
    projectile: { radius: 10, maxRange: 320 + 60, homingTurnRate: 2.2 },
  },
  // The cruncher: the hardest single hit in the game behind the slowest, most
  // readable sweep — and it SLOWS whoever it catches instead of launching them
  // (reworked from huge-knockback zoning 2026-07-12: the launch reset fights;
  // the slow sets up the NEXT hit, so landing one is a real threat). Longest
  // melee reach (out-spaces the blade).
  hammer: {
    name: "Hammer",
    attack: {
      shape: "arc",
      school: "physical",
      reach: 125,
      arcWidth: (90 * Math.PI) / 180,
      windup: 0.65,
      recovery: 0.75,
      knockback: 0,
    },
    stats: { attack: 19 },
    engagementRadius: 125 + 160,
    slow: { duration: 1.5, factor: 0.5 },
  },
};

// ── Dash ───────────────────────────────────────────────────────────────────
// PvP cooldown is far shorter than the Gauntlet's 8s — dodging telegraphs is
// the whole defensive game here. Deliberately a short escape hop, not a
// traversal (180px → 100px 2026-07-10; → 75px 2026-07-12, duration trimmed
// with it so the hop stays snappy rather than becoming a slow shuffle).
export const DASH: AbilityConfig = { activeDuration: 0.1, cooldown: 3 };
export const DASH_DISTANCE = 75; // px covered by the committed movement
export const DASH_SPEED = DASH_DISTANCE / DASH.activeDuration; // px/s
export const DASH_IFRAMES = 0.2; // outlasts the movement by a grace tail
export const DASH_SHOVE_RADIUS = 46; // the "bowling ball" barge sweep
export const DASH_KNOCKBACK = 840; // px/s outward cap on shoved victims

// ── Rounds ─────────────────────────────────────────────────────────────────
export const COUNTDOWN_SECONDS = 3;
export const ROUND_END_SECONDS = 2.5;
export const MATCH_END_SECONDS = 8; // then a fresh match with the same players
export const WINS_TO_TAKE_MATCH = 3;
