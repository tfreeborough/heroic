/**
 * Blood in the Sand — all tuning constants for the M1 slice (fixed loadout:
 * sword + dash). One file so PvP numbers never leak into (or out of) the PvE
 * games: same core systems, separate tuning tables (see docs/design/pvp-arena.md).
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

/** Both players identical in M1 — the fixed loadout IS the build. */
export const PLAYER_STATS: CombatStats = {
  maxHp: 100,
  attack: 16,
  defense: 2,
  critChance: 0.15,
  critMultiplier: 2,
};

// ── The sword ──────────────────────────────────────────────────────────────
// Windup stretched well past the PvE feel: a human opponent needs to *read*
// the telegraph and have time to dash out of it.
export const SWORD_ARC_WIDTH = (110 * Math.PI) / 180;
export const SWORD_KNOCKBACK = 620; // px/s impulse on victims

export const SWORD: AttackConfig = {
  shape: "arc",
  school: "physical",
  reach: 80,
  arcWidth: SWORD_ARC_WIDTH,
  windup: 0.3,
  recovery: 0.45,
  knockback: SWORD_KNOCKBACK,
};

/** Auto-target acquisition radius (gauntlet rule: reach + a margin). */
export const ENGAGEMENT_RADIUS = SWORD.reach + 160;

// ── Dash ───────────────────────────────────────────────────────────────────
// PvP cooldown is far shorter than the Gauntlet's 8s — dodging telegraphs is
// the whole defensive game here.
export const DASH: AbilityConfig = { activeDuration: 0.2, cooldown: 3 };
export const DASH_DISTANCE = 180; // px covered by the committed movement
export const DASH_SPEED = DASH_DISTANCE / DASH.activeDuration; // px/s
export const DASH_IFRAMES = 0.25; // outlasts the movement by a grace tail
export const DASH_SHOVE_RADIUS = 46; // the "bowling ball" barge sweep
export const DASH_KNOCKBACK = 840; // px/s outward cap on shoved victims

// ── Rounds ─────────────────────────────────────────────────────────────────
export const COUNTDOWN_SECONDS = 3;
export const ROUND_END_SECONDS = 2.5;
export const MATCH_END_SECONDS = 8; // then a fresh match with the same players
export const WINS_TO_TAKE_MATCH = 3;
