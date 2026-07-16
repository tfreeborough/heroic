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

/** Host-picked at room creation: 1v1 / 2v2 / 3v3 / 4v4 → 2×N seats. */
export type TeamSize = 1 | 2 | 3 | 4;
export const MAX_TEAM_SIZE = 4;
/** Gap between teammate spawn slots in the formation line — > 2×radius so
 * nobody starts overlapped (stepCrowd would shove them apart, ugly). */
export const SPAWN_SPACING = PLAYER_RADIUS * 2.5;
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

// ── Abilities ──────────────────────────────────────────────────────────────
// The pickable roster (docs/design/pvp-abilities.md): every player drafts
// LOADOUT_ABILITY_COUNT of these alongside their weapon — pick order IS the
// in-match button order. Lifecycle numbers (activeDuration/cooldown) live on
// the roster table so ABILITIES[id] plugs straight into core's stepAbility;
// each ability's effect numbers sit in its own table below. All first-pass
// numbers; a cooldown re-tune for 3-ability loadouts is owed (see the doc's
// balance caveat).

export type AbilityCategory = "offensive" | "defensive" | "support";

export type AbilityId =
  | "sandtrap"
  | "tremor"
  | "harpoon"
  | "dash"
  | "mirror-guard"
  | "ironhide"
  | "straw-man"
  | "war-drums"
  | "blood-font"
  | "sandstorm";

export interface AbilityDef extends AbilityConfig {
  name: string;
  category: AbilityCategory;
  /** Uses per ROUND (Tom, 2026-07-15 — the ability economy): a finite budget
   * that replenishes at every round reset, with the cooldown still gating
   * back-to-back uses. Spam-capped without cross-round snowballing. */
  charges: number;
}

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

// ── Per-ability effect tables ──────────────────────────────────────────────
// Every number is fixed — no rng draws anywhere in the ability layer, so the
// seed/rngDraws restore contract is untouched (the BleedConfig pattern). The
// codex reads these at runtime; nothing is hand-copied into UI copy.

/** Sandtrap: a buried powder charge — big blast, area denial (re-flavoured
 * from a blade trap and sized WAY up, Tom 2026-07-15 after play). */
export const SANDTRAP = {
  armSeconds: 2,
  /** Edge distance (to a body's rim) that sets it off once armed. */
  triggerRadius: 120,
  blastRadius: 240,
  damage: 30,
  /** Radial impulse on everyone caught in the blast, px/s. */
  knockback: 700,
  /** Effectively "until triggered or round end" (deployables clear each round). */
  lifetime: 600,
};

/** Tremor: the anti-dogpile slam — instant, centred on the caster. Knockback
 * sized to genuinely HURL (Tom 2026-07-15: "really knock players back"). */
export const TREMOR = { radius: 110, damage: 12, knockback: 1500 };

/** Harpoon: an instant chain at the auto-target — one line, a hook on the
 * end, incredibly fast (reworked from a dodgeable projectile, Tom
 * 2026-07-15: it whiffed constantly against normal strafing). It auto-locks:
 * if the mark is alive when the throw lands, it sticks — only dash i-frames
 * (timing), Ironhide (the pull) or Mirror Guard (the reflect) answer it. */
export const HARPOON = {
  windup: 0.1,
  /** Chain reach — deliberately past every weapon's engagement radius (Tom,
   * 2026-07-15): the harpoon does its OWN acquisition at press time, so it
   * isn't capped by the picked weapon's lock-on distance. */
  maxRange: 550,
  damage: 8,
  /** The reel ends this far (centre distance) in front of the puller. */
  pullGap: 50,
  /** The REEL (Tom, 2026-07-15): the chain lands instantly, then hauls the
   * victim in at this speed — faster than a sprint (280), well under a dash —
   * while the caster stands ROOTED, dragging. px/s. */
  reelSpeed: 360,
  /** Safety timeout on a reel that can't finish (snagged on a corner). */
  maxReelSeconds: 2.5,
};

/** Mirror Guard: reflected shots re-home hard enough to be a real threat. */
export const MIRROR_GUARD = { duration: 2, homingTurnRate: 4 };

/** Ironhide: walk through the telegraph instead of dodging it. */
export const IRONHIDE = { duration: 2.5, damageTakenFactor: 0.3, selfSlowFactor: 0.5 };

/** Straw Man: a targetable decoy (a combatant that can't act). */
export const STRAW_MAN = { hp: 30, lifetime: 4 };

/** War Drums: a moving ally aura — the slow plumbing mirrored (>1 factor).
 * Radius doubled 130→260 (Tom, 2026-07-15: the circle should feel like a
 * war-band's worth of ground, not a personal bubble). */
export const WAR_DRUMS = { radius: 260, duration: 3, speedFactor: 1.35 };

/** Blood Font: bleed-in-reverse — fixed heal ticks inside a held circle. */
export const BLOOD_FONT = { radius: 100, duration: 4, healPerTick: 4, tickInterval: 0.5 };

/** Sandstorm: nothing inside can be auto-targeted, friend or foe. */
export const SANDSTORM = { radius: 120, duration: 3 };

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  sandtrap: { name: "Sandtrap", category: "offensive", cooldown: 10, activeDuration: 0, charges: 2 },
  tremor: { name: "Tremor", category: "offensive", cooldown: 9, activeDuration: 0, charges: 2 },
  // The harpoon's active window IS its (near-zero) windup — it fires at the end.
  harpoon: { name: "Harpoon", category: "offensive", cooldown: 12, activeDuration: HARPOON.windup, charges: 2 },
  // Dash keeps the fattest budget — it's the metronome pick, small value often.
  dash: {
    name: "Dash", category: "defensive", cooldown: DASH.cooldown, activeDuration: DASH.activeDuration, charges: 4,
  },
  "mirror-guard": {
    name: "Mirror Guard", category: "defensive", cooldown: 12, activeDuration: MIRROR_GUARD.duration, charges: 3,
  },
  ironhide: { name: "Ironhide", category: "defensive", cooldown: 12, activeDuration: IRONHIDE.duration, charges: 3 },
  "straw-man": { name: "Straw Man", category: "defensive", cooldown: 14, activeDuration: 0, charges: 2 },
  "war-drums": {
    name: "War Drums", category: "support", cooldown: 12, activeDuration: WAR_DRUMS.duration, charges: 3,
  },
  // ONE pour per round — healing is enormous in a one-life mode.
  "blood-font": { name: "Blood Font", category: "support", cooldown: 16, activeDuration: 0, charges: 1 },
  sandstorm: { name: "Sandstorm", category: "support", cooldown: 14, activeDuration: 0, charges: 2 },
};

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];

/** Abilities per loadout; pick order = button order in the match. Two, not
 * three: rounds are short and one-life, so a third button read as chaos in
 * testing (2026-07-16) — fewer slots make each pick a real choice. */
export const LOADOUT_ABILITY_COUNT = 2;

/** Deployable ids live above the seat range so they can share the target-id
 * space with players (a straw man is a valid auto-target). Room for 5v5. */
export const DEPLOYABLE_ID_BASE = 100;

/** The straw man's stat sheet — resolveAttack needs a full combatant, and a
 * dummy is exactly that: hittable, critable, and utterly harmless. */
export const STRAW_MAN_STATS: CombatStats = {
  maxHp: STRAW_MAN.hp,
  attack: 0,
  defense: 0,
  critChance: 0,
  critMultiplier: 1,
};

// ── Rounds ─────────────────────────────────────────────────────────────────
/** The arming countdown (pvp-loadout-flow.md): the moment every seat is armed
 * the round machine counts this down and starts the match ITSELF — no host
 * button. Joins/leaves cancel it; it restarts fresh. Rides round.timer while
 * the phase is still "lobby" (timer 0 = no countdown running). */
export const LOBBY_COUNTDOWN_SECONDS = 10;
/** How long a straggler may sit unarmed (while everyone else is ready) before
 * the host's force-start appears. Client-side gate only — the sim accepts a
 * force-start whenever someone is unarmed. */
export const FORCE_START_GRACE_SECONDS = 30;
export const COUNTDOWN_SECONDS = 3;
export const ROUND_END_SECONDS = 2.5;
export const MATCH_END_SECONDS = 8; // then a fresh match with the same players
export const WINS_TO_TAKE_MATCH = 3;

// ── Training (the dev menu's target-dummy range) ───────────────────────────
/** Beat between a dummy's death and its replacement standing back up — long
 * enough to read the kill (blood burst, death sound), short enough that the
 * firing range never feels empty. */
export const DUMMY_RESPAWN_SECONDS = 2;
