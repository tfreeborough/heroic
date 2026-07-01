/**
 * The creature roster — the pure (renderer-free) half of every enemy. A creature
 * (docs/design/enemy-behaviour.md, layer 3) picks a shared behaviour *archetype*,
 * tunes it with config, and adds combat stats + data-driven actions (a ranged
 * attack, a summon). Wolf and a future hyena are both `circler`s with different
 * numbers; zombie and a ghoul are both `chaser`s.
 *
 * This lives in `@heroic/core` so both games share one bestiary and Realmsmith
 * can offer a real creature picker (a spawner names a `CreatureId`). Presentation
 * — colour, later sprites/sounds — is forbidden here (core stays renderer-free);
 * the app layers it on top per `CreatureId` (see the game's `CREATURE_VISUALS`).
 */
import type { CombatStats } from "../combat/combat";
import type { AttackConfig } from "../combat/attack";
import { makeBrain, type Archetype, type Brain } from "../ai/runtime";
import type { CommonConfig } from "../ai/perception";
import { chaser, type ChaserConfig } from "../ai/archetypes/chaser";
import { circler, type CirclerConfig } from "../ai/archetypes/circler";
import { ambusher, type AmbusherConfig } from "../ai/archetypes/ambusher";
import { kiter, type KiterConfig } from "../ai/archetypes/kiter";
import { charger, type ChargerConfig } from "../ai/archetypes/charger";

/** Each archetype id → the config type it consumes. */
export interface ArchetypeConfigMap {
  chaser: ChaserConfig;
  circler: CirclerConfig;
  ambusher: AmbusherConfig;
  kiter: KiterConfig;
  charger: ChargerConfig;
}
/** The behaviour patterns a creature can pick (docs/design/enemy-behaviour.md, layer 2). */
export type ArchetypeId = keyof ArchetypeConfigMap;

/** Registry: the one place an archetype *id* (data) resolves to its behaviour object. */
export const ARCHETYPES = { chaser, circler, ambusher, kiter, charger } as const;

/** Every creature in the roster. Spawners and summons name creatures by this id. */
export type CreatureId =
  | "zombie"
  | "wolf"
  | "ambusher"
  | "archer"
  | "caster"
  | "charger"
  | "wizard"
  | "bat";

/**
 * A creature's ranged attack: the *same* `AttackConfig` + stats a weapon uses
 * (combat.md — one shared attack library). The projectile's *colour* is
 * presentation and lives app-side, not here.
 */
export interface CreatureAttack {
  config: AttackConfig;
  /** Attacker-side stats (school sources power/crit later); maxHp unused here. */
  stats: CombatStats;
  projectileRadius: number;
}

/**
 * A creature's summon action — the mirror of an attack, but the "strike" spawns
 * creatures instead of projectiles. Fully data-driven: `minionType` is any
 * creature in the roster, so a kiter wizard with `minionType: "wolf"` calls
 * wolves. `maxAlive` caps its live brood. The telegraph *colour* is app-side.
 */
export interface SummonAction {
  minionType: CreatureId;
  /** Minions spawned per cast. */
  count: number;
  /** Telegraph (cast) duration before minions appear, seconds. */
  windup: number;
  /** Cooldown after a cast before the next, seconds. */
  recovery: number;
  /** Hard cap on this summoner's living minions. */
  maxAlive: number;
  /** Minions appear within this radius of the summoner. */
  spawnRadius: number;
  /** Only summons while the player is within this distance. */
  engageRange: number;
}

/**
 * The pure definition of a creature: which archetype it is, that archetype's
 * tuning, combat stats, contact damage, and any ranged/summon action. No
 * presentation — the app composes colour/sprites over this per `CreatureId`.
 */
export interface CreatureDef {
  label: string;
  /** Short archetype × school tag for spawn pickers / debug HUDs. */
  tag: string;
  /** Which behaviour pattern this creature uses. */
  archetype: ArchetypeId;
  /** The archetype's tuning. Its concrete type is enforced at the def via `creature()`. */
  config: CommonConfig;
  /** makeCombatant stats — `attack` doubles as the contact-damage stat. */
  stats: CombatStats;
  /** px/s shove applied to the player on a contact hit. */
  contactKnockback: number;
  /**
   * Flies over voids: routes and crowd-collides against walls only, ignoring
   * chasms (still stopped by walls/breakables/bounds). A movement domain
   * orthogonal to the archetype — any behaviour can fly. Default `false`.
   */
  flying?: boolean;
  /** Ranged attack profile; absent for melee/contact-only creatures. */
  attack?: CreatureAttack;
  /** Summon action; absent for creatures that don't call minions. */
  summon?: SummonAction;
}

/**
 * Typed builder: ties `config`'s type to the chosen `archetype` at the def site,
 * so a circler must be tuned with a `CirclerConfig`. Erasure to `CommonConfig`
 * happens only once, centrally, in `makeCreatureBrain`.
 */
const creature = <K extends ArchetypeId>(
  def: { archetype: K; config: ArchetypeConfigMap[K] } & Omit<CreatureDef, "archetype" | "config">,
): CreatureDef => def;

// ── Archetype tuning ──────────────────────────────────────────────────────────
// Pure data — moved here verbatim from the app so the whole AI/combat half of a
// creature lives in core. Numbers are placeholders found in playtest.

/** Chaser tuning: one state — walk at the player. Slow, tanky, relentless. */
const ZOMBIE_BRAIN: ChaserConfig = {
  speed: 110,
  separationRadius: 56,
  aggroRadius: 580,
};

/**
 * Circler tuning: approaches while unwatched, circles inside the player's
 * front arc. Slightly slower than the player's top speed so it can be outrun;
 * orbit ring sits just outside melee reach.
 */
const WOLF_BRAIN: CirclerConfig = {
  speed: 240,
  separationRadius: 56,
  aggroRadius: 760,
  orbitDistance: 170,
  /**
   * Prowl: circling runs at this fraction of full speed. Full-speed strafing
   * made wolves nearly unhittable (ranged auto-aim leads to where they *were*);
   * the lunge in/out still uses full speed.
   */
  circleSpeedScale: 0.55,
  /** ~126°: matches the "is the player looking at me" feel, found in playtest. */
  frontArcWidth: Math.PI * 0.7,
  /** ~7° of arc-edge stickiness. */
  arcMargin: 0.12,
  minModeTime: 0.3,
};

/**
 * Ambusher tuning: lies dormant, then bursts when the player strays close.
 * Faster than anything else once committed; release radius sits well beyond
 * the trigger so it commits to a chase rather than flickering at the edge.
 */
const AMBUSHER_BRAIN: AmbusherConfig = {
  speed: 320,
  separationRadius: 56,
  triggerRadius: 340,
  releaseRadius: 560,
};

/**
 * Ranged creatures kite (the circler inverted): hold near firing range, close
 * when too far, back off when crowded. Slower than the player so they can be
 * cornered.
 *
 * The standoff is *derived from the attack reach* so the whole range band stays
 * inside firing distance — otherwise a kiter parks just out of range and never
 * shoots. The shoot gate is `centre-distance ≤ reach + PLAYER_RADIUS`; holding
 * the band's far edge `STANDOFF_MARGIN` inside that keeps every position in the
 * band a live shot, with slack for jitter and the windup lock.
 */
const STANDOFF_MARGIN = 24;
/** Mirrors the app's PLAYER_RADIUS — the kiter standoff is derived from it. */
const PLAYER_RADIUS = 18;
const standoff = (reach: number, rangeBand: number): number =>
  reach + PLAYER_RADIUS - rangeBand - STANDOFF_MARGIN;

const ARCHER_REACH = 260;
const CASTER_REACH = 240;

const ARCHER_BRAIN: KiterConfig = {
  speed: 205,
  separationRadius: 56,
  aggroRadius: 740,
  preferredRange: standoff(ARCHER_REACH, 50),
  rangeBand: 50,
};

const CASTER_BRAIN: KiterConfig = {
  speed: 200,
  separationRadius: 56,
  aggroRadius: 760,
  preferredRange: standoff(CASTER_REACH, 50),
  rangeBand: 50,
};

/**
 * Charger: shuffles forward, then commits a telegraphed dash that blows past a
 * player who sidesteps. `speed` is the approach (and separation strength);
 * `maxSpeed` is the dash burst — kept separate so it doesn't shove allies at
 * dash speed. Dash distance = maxSpeed × dashDuration ≈ 576px, well past the
 * ~300px lock, so it sails clear of you when you step off the line.
 */
const CHARGER_BRAIN: ChargerConfig = {
  speed: 130,
  maxSpeed: 640,
  separationRadius: 56,
  aggroRadius: 680,
  chargeRange: 300,
  windupTime: 0.55,
  dashDuration: 0.9,
  recoverTime: 0.7,
};

/**
 * Bat: a fast, fragile chaser that *flies* — it makes a beeline over chasms a
 * ground mob has to go around, so voids stop being a safe wall against it. Tight
 * separation so a colony swarms in a cloud rather than a conga line.
 */
const BAT_BRAIN: ChaserConfig = {
  speed: 205,
  separationRadius: 40,
  aggroRadius: 720,
};

/** Wizard: a kiter that hangs well back (big preferredRange) and summons. */
const WIZARD_BRAIN: KiterConfig = {
  speed: 175,
  separationRadius: 56,
  aggroRadius: 900,
  preferredRange: 360,
  rangeBand: 60,
};

// ── The roster ────────────────────────────────────────────────────────────────

export const CREATURES: Record<CreatureId, CreatureDef> = {
  zombie: creature({
    label: "Zombie",
    tag: "chaser",
    archetype: "chaser",
    config: ZOMBIE_BRAIN,
    stats: { maxHp: 40, attack: 6, defense: 2, critChance: 0, critMultiplier: 1 },
    contactKnockback: 220,
  }),
  wolf: creature({
    label: "Wolf",
    tag: "circler",
    archetype: "circler",
    config: WOLF_BRAIN,
    stats: { maxHp: 26, attack: 10, defense: 0, critChance: 0, critMultiplier: 1 },
    contactKnockback: 320,
  }),
  ambusher: creature({
    label: "Ambusher",
    tag: "ambusher",
    archetype: "ambusher",
    config: AMBUSHER_BRAIN,
    stats: { maxHp: 22, attack: 14, defense: 0, critChance: 0, critMultiplier: 1 },
    contactKnockback: 360,
  }),
  archer: creature({
    label: "Archer",
    tag: "kiter · physical",
    archetype: "kiter",
    config: ARCHER_BRAIN,
    stats: { maxHp: 24, attack: 0, defense: 0, critChance: 0, critMultiplier: 1 },
    contactKnockback: 160,
    attack: {
      config: {
        shape: "projectile",
        school: "physical",
        reach: ARCHER_REACH,
        projectileSpeed: 520,
        pierce: 0,
        windup: 0.5, // the telegraph — long enough to read and dodge
        recovery: 0.9,
        knockback: 140,
      },
      stats: { maxHp: 1, attack: 8, defense: 0, critChance: 0, critMultiplier: 1 },
      projectileRadius: 5,
    },
  }),
  caster: creature({
    label: "Caster",
    tag: "kiter · magic",
    archetype: "kiter",
    config: CASTER_BRAIN,
    stats: { maxHp: 20, attack: 0, defense: 0, critChance: 0, critMultiplier: 1 },
    contactKnockback: 160,
    attack: {
      config: {
        shape: "projectile",
        school: "magic",
        reach: CASTER_REACH,
        projectileSpeed: 420,
        pierce: 1, // a slower, piercing bolt
        windup: 0.65,
        recovery: 1.0,
        knockback: 180,
      },
      stats: { maxHp: 1, attack: 12, defense: 0, critChance: 0, critMultiplier: 1 },
      projectileRadius: 7,
    },
  }),
  charger: creature({
    label: "Charger",
    tag: "charger",
    archetype: "charger",
    config: CHARGER_BRAIN,
    stats: { maxHp: 34, attack: 12, defense: 1, critChance: 0, critMultiplier: 1 },
    contactKnockback: 440, // the dash hits hard
  }),
  bat: creature({
    label: "Bat",
    tag: "chaser · flying",
    archetype: "chaser",
    config: BAT_BRAIN,
    stats: { maxHp: 12, attack: 5, defense: 0, critChance: 0, critMultiplier: 1 },
    contactKnockback: 120,
    flying: true,
  }),
  wizard: creature({
    label: "Wizard",
    tag: "kiter · summon",
    archetype: "kiter",
    config: WIZARD_BRAIN,
    stats: { maxHp: 28, attack: 0, defense: 0, critChance: 0, critMultiplier: 1 },
    contactKnockback: 160,
    summon: {
      minionType: "wolf",
      count: 2,
      windup: 0.8,
      recovery: 2.2,
      maxAlive: 6,
      spawnRadius: 90,
      engageRange: 700,
    },
  }),
};

/** All creature ids, in roster order — what a picker (Realmsmith, debug HUD) lists. */
export const CREATURE_IDS = Object.keys(CREATURES) as CreatureId[];

/** Human label for a creature id (falls back to the id for an unknown one). */
export const creatureLabel = (id: string): string =>
  (CREATURES as Record<string, CreatureDef | undefined>)[id]?.label ?? id;

/**
 * Resolve an arbitrary value — a zone object's `props.creature`, untyped on disk —
 * to a roster `CreatureId`, falling back to `fallback` for anything unknown, so a
 * stale zone can never spawn (or place) a creature that no longer exists. The
 * shared validator behind both a spawner's creature and a placed `creature` object
 * (parseSpawnerConfig uses it too).
 */
export const parseCreatureId = (
  value: unknown,
  fallback: CreatureId = CREATURE_IDS[0]!,
): CreatureId =>
  (CREATURE_IDS as string[]).includes(String(value)) ? (value as CreatureId) : fallback;

/**
 * A fresh brain for one instance of `def`: resolves its archetype id to the
 * behaviour object and binds the config. `index` is the spawn ordinal, so an
 * archetype can vary fixed quirks per individual deterministically.
 */
export const makeCreatureBrain = (def: CreatureDef, index = 0): Brain =>
  makeBrain(ARCHETYPES[def.archetype] as Archetype<CommonConfig, unknown>, def.config, index);
