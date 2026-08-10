/**
 * Blood in the Sand — all tuning constants. One file so PvP numbers never
 * leak into (or out of) the PvE games: same core systems, separate tuning
 * tables (see docs/design/pvp-arena.md).
 */
import type { AbilityConfig, AttackConfig, CombatStats, StackingDotConfig } from "@heroic/core";

/** Server sim rate. Core primitives are dt-parameterised, so 30Hz "just works". */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

/** Broadcast every Nth tick. 1 = every tick (~21KB/s per client — nothing on LAN). */
export const SNAPSHOT_DIVISOR = 1;

// ── Liveness (heartbeat) ────────────────────────────────────────────────────
// A force-quit / lost-network client often sends no WebSocket close frame, so
// its seat would linger forever (the server's own snapshot broadcasts keep
// Bun's transport idle-timer from ever firing). The client pings on this beat
// so the server knows a QUIET lobby seat is still alive; a seat silent past the
// timeout is a ghost and gets freed (protocol v14).
/** How often the client sends `{t:"ping"}` while connected. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
/** A seat with no inbound traffic for this long is dropped as a ghost. Three
 * missed pings — a brief background/blip under this survives (you can rejoin
 * regardless). */
export const HEARTBEAT_TIMEOUT_MS = 15_000;
/** How often the server sweeps every room for silent seats. */
export const HEARTBEAT_SWEEP_MS = 5_000;

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

export type WeaponId =
  | "blade"
  | "bow"
  | "staff"
  | "hammer"
  | "trident"
  | "fang"
  | "scorpion"
  | "bombard";
export const WEAPON_IDS: readonly WeaponId[] = [
  "blade",
  "bow",
  "staff",
  "hammer",
  "trident",
  "fang",
  "scorpion",
  "bombard",
];

/** The FREE roster — what bots and forceStart's random-fill draft from.
 * Gated items (bits-secret-items.md) are earned through deeds and NEVER
 * drafted by bots (Tom, 2026-08-09: base roster only, permanently — an
 * earned item in hand is proof of humanity). */
export const FREE_WEAPON_IDS: readonly WeaponId[] = ["blade", "bow", "staff", "hammer"];

/** A chance-on-arc-hit damage-over-time rider (the blade's bleed). */
export interface BleedConfig {
  chance: number;
  ticks: number;
  /** Seconds between ticks (and before the first). */
  interval: number;
  /** Fixed damage per tick — no variance, crit, or defense (rng-stream neutral). */
  damage: number;
  /** true = a re-hit RESETS the wielder's existing bleed instead of queueing
   * a second one (the trident's steady drain). Absent = bleeds stack, the
   * blade's original rule. */
  refresh?: boolean;
}

/** A stacking-intensity DoT rider (the Fang's poison — bits-store-arms.md):
 * every non-lethal hit adds a stack (capped) and refreshes ONE shared clock;
 * tick damage = stacks × damagePerStack and all stacks fall off together.
 * Bleed punishes getting tagged once; poison punishes staying in reach. No
 * rng draw on application — deterministic like the slow. */
export type PoisonConfig = StackingDotConfig;

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

/** A lobbed AOE shell (the Bombard — bits-store-arms.md): the struck instant
 * marks the mark's CURRENT position and a shell flies there over a FIXED
 * flight time — no collision on the way (it's above the fight; the arc is
 * render flavour), then a sandtrap-style blast at the marked point: fixed
 * damage (no crit/defense — artillery is reliable, not lucky), radial
 * knockback, hitting EVERYONE in the zone — allies and the gunner included
 * (Tom, 2026-08-10) — dash i-frames dodge it, Ironhide tanks it. The
 * landing ring renders for BOTH teams from the moment of launch — walking
 * off the mark is the whole counterplay, and an unmarked artillery hit
 * would read as cheating. */
export interface ShellConfig {
  /** Flight scales with launch distance (Tom, 2026-08-10 — a closer shell
   * needn't travel as far): flightMin at point-blank, flightMax at full
   * reach, linear between. The FLOOR is a balance line, not flavour: a
   * dead-centred target needs blastRadius + body = 138px to walk clear,
   * 0.49s at full sprint — flightMin 0.55 keeps the walk-out barely alive
   * at any range; under it, close shells become dash-or-eat. */
  flightMin: number;
  flightMax: number;
  blastRadius: number;
  /** Fixed blast damage (the sandtrap idiom, not a weapon resolve). */
  damage: number;
  /** Radial impulse on everyone caught, px/s. */
  knockback: number;
}

/** A multi-bolt volley per attack cycle (the Scorpion — bits-store-arms.md):
 * the struck instant looses bolt 1, then `count - 1` follow-ups fire on this
 * interval DURING recovery, each re-aimed at the mark's position at its own
 * release instant — that's what makes the volley harder to fully sidestep
 * than one bow shot, without any aim being networked. A dead or smoked mark
 * ends the volley (the windup-lock rules). */
export interface BurstConfig {
  count: number;
  /** Seconds between bolts. */
  interval: number;
}

export interface WeaponConfig {
  name: string;
  attack: AttackConfig;
  /** Overlaid on PLAYER_STATS when the weapon is picked. */
  stats: Partial<CombatStats>;
  /** Auto-target acquisition radius (gauntlet rule: reach + a margin). */
  engagementRadius: number;
  bleed?: BleedConfig;
  poison?: PoisonConfig;
  slow?: SlowConfig;
  projectile?: WeaponProjectileConfig;
  burst?: BurstConfig;
  shell?: ShellConfig;
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
  // The retiarius thrust (bits-secret-items.md — the first GATED weapon,
  // earned at The Sand snake): the spacing game the roster lacked. Only the
  // HEAD is dangerous (Tom, 2026-08-09: a trident is deadly at the tip, not
  // along the shaft): minReach floats the hit region into a band at the end
  // of its reach, and the strike TRAVELS (thrustDuration) — the point runs
  // out through the harmless shaft-zone and only bites once it crosses into
  // the band. The knockback shoves victims back out to its own preferred
  // range while the slow pins them there — a landed poke resets the fight
  // to trident rules AND sets up the next poke (device pass 2026-08-09:
  // 180 knockback was imperceptible next to the mover's damping; bow's felt
  // shove is 260). Riders re-cut for the band rework (2026-08-09, pokes are
  // harder to land now): a real 40%/1s slow and a GUARANTEED drip bleed —
  // 1 dmg every 0.5s for 6s, refresh-not-stack so re-pokes reset the clock
  // rather than queueing lethal stacks. Arc widened 18°→26° so the floating
  // band reads as the three-pronged head, not a sliver; windup trimmed to a
  // piston jab. Counterplay: dash i-frames through the front — and dash's
  // 75px hop now carries you INSIDE the band, where the prongs can't touch
  // you at all (step.ts never even starts a swing on a dead-zone target).
  trident: {
    name: "Trident",
    attack: {
      shape: "arc",
      school: "physical",
      // 160/95 → 180/115 (Tom, 2026-08-09): more range, same 65px head,
      // and dash's 75px hop from max range still lands inside the prongs.
      reach: 180,
      minReach: 115,
      arcWidth: (26 * Math.PI) / 180,
      // 0.4 → 0.35 and knockback 320 → 480 (Tom, 2026-08-09): the poke is a
      // snap-jab, and a landed one LAUNCHES them — stab, shove them clear
      // past your band, and use the second you bought to reposition.
      windup: 0.35,
      recovery: 0.7,
      knockback: 480,
      thrustDuration: 0.15,
    },
    stats: { attack: 15 },
    engagementRadius: 180 + 160,
    bleed: { chance: 1, ticks: 12, interval: 0.5, damage: 1, refresh: true },
    slow: { duration: 1, factor: 0.6 },
  },
  // The skirmisher's poison dagger (bits-store-arms.md — the first WRIT
  // weapon, launch shelf item 1): ultra-short reach, the fastest cycle in
  // the game, feeble raw hits — the kill is the poison working while you're
  // already gone. Zero knockback on purpose (it wants the next stab), and
  // deliberately IN-REACHED by everything: blade 90 / hammer 125 out-space
  // it, so its whole game is closing through telegraphs and leaving before
  // the answer lands.
  // Device pass 2026-08-09 (Tom): reach 70 → 60 (even more knife-range),
  // cycle 0.53 → 0.45 (windup 0.15 keeps it a flick you can still read),
  // attack 7 → 5 — the raw hit is a formality, the venom is the weapon.
  // Venom pass, same day (Tom: get in, stab a few times, get OUT): 2/stack
  // → 3 and clock 4s → 5s, so a 3-stab pass leaves 9/s burning for 5s (45
  // post-disengage) — and FULL stacks (12/s) now out-drip a Blood Font's
  // 8/s: the fang is the roster's anti-heal pressure. The clock only
  // refreshes while the knife keeps touching you, so leaving is still the
  // whole counterplay.
  fang: {
    name: "Fang",
    attack: {
      shape: "arc",
      school: "physical",
      reach: 60,
      arcWidth: (35 * Math.PI) / 180,
      windup: 0.15,
      recovery: 0.3,
      knockback: 0,
    },
    stats: { attack: 5 },
    engagementRadius: 60 + 160,
    poison: { maxStacks: 4, interval: 1, damagePerStack: 3, duration: 5 },
  },
  // The burst repeater (bits-store-arms.md launch shelf item 2, WRIT): the
  // third ranged identity — bow is one big earned hit, staff is slow homing
  // pressure, the scorpion is a three-bolt volley on the slowest ranged
  // cycle. Each bolt re-aims at release (BurstConfig above), so a strafer
  // sheds SOME bolts but rarely all three; dash i-frames through the middle
  // of the volley remain the clean answer, and Mirror Guard turns each bolt
  // individually. Per-bolt damage is feeble — the full volley (3 × 8 raw)
  // just out-pays one bow hit (20 raw at attack 20), the premium for
  // landing every bolt. Bolts fly far faster than arrows (850 vs 650) but
  // across a MID-RANGE band only — device pass 2026-08-09 (Tom): 320 reach
  // was too dangerous, cut to 240 (well under staff's 320, above melee)
  // with the bolt speed up 750 → 850 as the trade. It wants to skirmish at
  // the seam between the melee bracket and the true ranged weapons.
  scorpion: {
    name: "Scorpion",
    attack: {
      shape: "projectile",
      school: "physical",
      reach: 240,
      projectileSpeed: 850,
      windup: 0.45,
      recovery: 1.3,
      knockback: 80,
    },
    stats: { attack: 8 },
    engagementRadius: 240 + 20,
    // maxRange deliberately breaks the roster's reach+60 idiom (Tom,
    // 2026-08-09): the 240 band gates where a volley may BEGIN, but loosed
    // bolts carry to double that — past even the bow's 420 arrow — so a
    // volley fired at the edge still runs down a fleeing mark. The short
    // acquisition band stays the balance lever; the flight is the flavour.
    projectile: { radius: 5, maxRange: 480 },
    burst: { count: 3, interval: 0.12 },
  },
  // The artillery piece (bits-store-arms.md launch shelf item 3, WRIT):
  // the longest reach in the game behind the slowest cycle (400 → 380,
  // Tom's device pass 2026-08-10 — just past the bow's 360, paired with
  // the client's artillery zoom so the whole ring fits on screen), firing
  // a lobbed
  // shell that lands where the mark STOOD — flight time makes it dodgeable
  // by walking, terrifying against anyone holding ground (a font, a quake,
  // a choke). minReach reuses the trident's floating-band plumbing as a
  // close-quarters DEAD ZONE: inside 120 it cannot even start a swing, so
  // diving the gunner is total safety from the gun — that's the engine-free
  // counterplay. stats.attack mirrors shell.damage for the codex bar only;
  // the blast applies the fixed shell number (no crit, no defense).
  bombard: {
    name: "Bombard",
    attack: {
      shape: "projectile",
      school: "physical",
      reach: 380,
      minReach: 120,
      windup: 0.55,
      recovery: 1.4,
      knockback: 0,
    },
    stats: { attack: 22 },
    engagementRadius: 380 + 20,
    shell: { flightMin: 0.55, flightMax: 0.9, blastRadius: 120, damage: 22, knockback: 400 },
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
  | "warding-shout"
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

/** Tremor: an earthquake ZONE (reworked from the instant slam, Tom
 * 2026-07-17 — the slam's peel lives on as Warding Shout). Fixed at the
 * caster's feet; enemies inside take chip ticks and a refreshed slow. Damage
 * deliberately totals the old slam's 12 but sits UNDER a Blood Font's 8/s
 * heal — a quake pressures a font, it doesn't negate one. */
export const TREMOR = {
  radius: 240,
  duration: 4,
  tickInterval: 1,
  damagePerTick: 3,
  /** Move-speed multiplier while inside (the hammer's slow plumbing). */
  slowFactor: 0.75,
  /** Refreshed every step in the zone, so this is also the step-out linger. */
  slowLinger: 0.3,
};

/** Warding Shout: the old tremor slam promoted to a defensive peel — an
 * instant no-damage cone off the facing that HURLS. Aimable, so whiffable:
 * it comes out of the mouth, not the boots (Tom, 2026-07-17). */
export const WARDING_SHOUT = {
  range: 170,
  /** Cone half-angle from the facing, radians (90° total). */
  halfAngle: Math.PI / 4,
  knockback: 2400,
};

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

/** Straw Man: a targetable decoy (a combatant that can't act) that TAUNTS on
 * the drop (Tom, 2026-07-20 — the passive decoy underwhelmed; pvp-abilities.md
 * § Straw Man): enemies inside tauntRadius of the drop point are force-locked
 * onto it for tauntDuration, an in-flight windup included. The radius sits
 * between melee reach (blade 250 / hammer 285) and ranged standoff (staff 340
 * / bow 380) on purpose: it flips divers, never shooters. Bumped 260→310
 * (Tom, 2026-07-20) — still under the staff's band, but only just. */
export const STRAW_MAN = { hp: 30, lifetime: 4, tauntRadius: 310, tauntDuration: 1.5 };

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
  // Pure utility (no damage), so priced between dash's metronome and the moments.
  "warding-shout": { name: "Warding Shout", category: "defensive", cooldown: 7, activeDuration: 0, charges: 3 },
  "war-drums": {
    name: "War Drums", category: "support", cooldown: 12, activeDuration: WAR_DRUMS.duration, charges: 3,
  },
  // ONE pour per round — healing is enormous in a one-life mode.
  "blood-font": { name: "Blood Font", category: "support", cooldown: 16, activeDuration: 0, charges: 1 },
  sandstorm: { name: "Sandstorm", category: "support", cooldown: 14, activeDuration: 0, charges: 2 },
};

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];

/** The FREE ability roster (see FREE_WEAPON_IDS — same drafting rule). No
 * abilities are gated yet; the split exists so a future gated ability can't
 * leak through the random-fill sweep. Kept in config (not items.ts) beside
 * its weapon twin — items.ts owns the entitlement side. */
export const FREE_ABILITY_IDS = ABILITY_IDS;

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
export const LOBBY_COUNTDOWN_SECONDS = 5;
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
