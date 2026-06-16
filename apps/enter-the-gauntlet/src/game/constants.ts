// Tunables for the movement + combat prototype. Numbers here are placeholders
// to be found in playtest (see docs/design/player-movement-and-targeting.md
// and docs/design/combat.md).

import {
  ambusher,
  charger,
  chaser,
  circler,
  kiter,
  makeBrain,
  rectEdges,
  type AmbusherConfig,
  type AttackConfig,
  type Brain,
  type ChargerConfig,
  type ChaserConfig,
  type CirclerConfig,
  type CombatStats,
  type KiterConfig,
  type VisionSegment,
} from "@heroic/engine";

/** World units are pixels at 1:1 camera zoom. */
export const TILE_SIZE = 64;
/** Arena is square: this many tiles per side. */
export const ARENA_TILES = 25;
export const ARENA_SIZE = TILE_SIZE * ARENA_TILES;
export const WALL_THICKNESS = 48;

/** Arena boundary walls (centred rects), shared by physics bodies and rendering. */
export const WALLS: { x: number; y: number; w: number; h: number }[] = (() => {
  const s = ARENA_SIZE;
  const t = WALL_THICKNESS;
  return [
    { x: s / 2, y: -t / 2, w: s + 2 * t, h: t },
    { x: s / 2, y: s + t / 2, w: s + 2 * t, h: t },
    { x: -t / 2, y: s / 2, w: t, h: s + 2 * t },
    { x: s + t / 2, y: s / 2, w: t, h: s + 2 * t },
  ];
})();

/**
 * Interior pillars: solid blocks that both collide with bodies and occlude line
 * of sight. Centre-based like WALLS. Scattered a few tiles off the arena centre
 * (where the player spawns) so you immediately have blind spots to peek around.
 * This is a LOS demo layout — real arenas would author obstacles per realm.
 */
export const PILLARS: { x: number; y: number; w: number; h: number }[] = (() => {
  const c = ARENA_SIZE / 2;
  const u = TILE_SIZE;
  return [
    { x: c - 3.5 * u, y: c - 3.5 * u, w: 1.5 * u, h: 1.5 * u },
    { x: c + 3.5 * u, y: c - 3 * u, w: 2 * u, h: u },
    { x: c + 5 * u, y: c + 1.5 * u, w: u, h: 3 * u },
    { x: c - 0.5 * u, y: c + 4 * u, w: 3 * u, h: 1.5 * u },
    { x: c - 5 * u, y: c + 1 * u, w: u, h: 2.5 * u },
  ];
})();

/**
 * Sight / projectile occluders, shared by the renderer (fog-of-war rays) and the
 * sim (projectile-vs-wall collisions and enemy line-of-sight): the arena
 * rectangle plus every pillar's edges. The arena box never lies between two
 * interior points, so it doesn't affect enemy↔player sightlines — it only stops
 * projectiles at the boundary and bounds the fog rays.
 */
export const OCCLUDERS: VisionSegment[] = [
  { ax: 0, ay: 0, bx: ARENA_SIZE, by: 0 },
  { ax: ARENA_SIZE, ay: 0, bx: ARENA_SIZE, by: ARENA_SIZE },
  { ax: ARENA_SIZE, ay: ARENA_SIZE, bx: 0, by: ARENA_SIZE },
  { ax: 0, ay: ARENA_SIZE, bx: 0, by: 0 },
  ...PILLARS.flatMap((p) => rectEdges(p.x, p.y, p.w, p.h)),
];

/**
 * Fog-of-war presentation. Three states layered over the world: areas you can
 * see *now* are clear; areas you've seen before but can't see now are dimmed to
 * `exploredAlpha` (their static geometry stays faintly readable — live enemies
 * are clipped out, so memory ≠ current intel); never-seen areas sit near-black
 * at `unexploredAlpha`. `edgeFeather` softens every fog boundary.
 */
export const VISION = {
  /** Fog fill colour (slightly bluer than the void so depth still reads). */
  shadowColor: "#060810",
  /** Opacity over explored-but-unseen area, 0..1 — the dim "memory" layer. */
  exploredAlpha: 0.80,
  /** Opacity over never-seen area, 0..1. 0.98 keeps the faint hint of unknown
   *  geometry you liked on the original blind spots. */
  unexploredAlpha: 0.98,
  /** Softness of the *current-sight* boundary, world px of blur. Kept tight so
   *  the sightline still reads as a crisp edge. */
  edgeFeather: 5,
  /** Softness of the *fog frontier* (explored ↔ unseen), world px of blur. Large
   *  on purpose: it dissolves the underlying memory grid into soft mist instead
   *  of visible cells. Roughly cell-sized or bigger is what kills the blockiness. */
  fogSoftness: 30,
  /** Drifting-mist wisp colour — the lighter veins that roll through the fog.
   *  A touch lighter/bluer than `shadowColor` so they read against the dark. */
  mistColor: "#27324f",
  /** Mist feature size, world px. Bigger = larger, lazier-looking clouds. */
  mistScale: 150,
  /** Mist drift speed, world px/s — now maps ~directly to visible travel. Slow
   *  reads as atmospheric; 0 = static (curls in place). */
  mistSpeed: 7,
  /** Current clear-vision range, world px. Beyond this — even down an open
   *  sightline — the view fades into fog, so vision closes in around you. */
  sightRadius: 360,
  /** Where the clear→fog fade begins, as a fraction of sightRadius (0..1).
   *  Inside this you see fully; from here to sightRadius it ramps to the dim. */
  sightFalloff: 0.55,
  /** Exploration range, world px. Cells within this AND in line of sight become
   *  "explored" (dim memory). Larger than sightRadius, so a ring just past what
   *  you can clearly see still gets discovered as you move. */
  discoverRadius: 500,
} as const;

/**
 * Fog-of-war memory grid resolution, world px per cell. The visibility polygon
 * is rasterised into this grid to remember where you've been. The grid is never
 * seen directly — `VISION.fogSoftness` blurs it away — so this only controls how
 * tightly the remembered area hugs where you actually looked. Smaller = tighter
 * but more cells to sweep/draw per frame.
 */
export const FOG_CELL = 32;

/**
 * Enemy navigation grid resolution, world px per cell. Enemies route around
 * walls via A* on this grid (built from PILLARS, inflated by ENEMY_RADIUS).
 * Finer = paths hug obstacles more tightly but cost more per re-path; pillars
 * are as small as one tile, so keep it well under TILE_SIZE.
 */
export const NAV_CELL = 32;

/**
 * Enemy separation grid resolution, world px per cell. The sim buckets enemies
 * into this grid each step so separation only checks the 3×3 neighbourhood
 * instead of every other enemy (O(n²) → ~O(n)). Must be ≥ the largest creature
 * `separationRadius` (56) for the 3×3 query to be exhaustive; 64 (= TILE_SIZE)
 * is the smallest such round value. See docs/design/enemy-physics-and-crowds.md.
 */
export const ENEMY_GRID_CELL = 64;

/**
 * Crowd push-apart strength (0..1): the fraction of an overlap resolved per step
 * when two enemies interpenetrate. 1 fully separates an isolated pair in one
 * step; lower is softer and smoother through dense chains. Tunable feel knob —
 * see docs/design/enemy-physics-and-crowds.md.
 */
export const CROWD_PUSH = 0.5;

/**
 * How many sim steps between line-of-sight rechecks per enemy. LOS (a ray test
 * against every occluder) only decides steer-direct vs. pathfind, so it tolerates
 * a few frames of lag; recomputing every step for every enemy is wasted work.
 * Checks are staggered across enemies so they don't all land on the same step.
 */
export const LOS_RECHECK_STEPS = 6;

/**
 * Max enemies that may run A* pathfinding in a single sim step. When many lose
 * line of sight at once (you duck behind a pillar), this caps the pathfinding
 * cost per step — the rest keep following their cached route and re-path a step
 * or two later, which is invisible. Spreads the spikes that made moving laggy.
 */
export const MAX_REPATHS_PER_STEP = 6;

// --- Layout -----------------------------------------------------------------
// Vertical play: the top portion is the play space, the bottom is the control
// deck. The play space targets a 3:4 (w:h) ratio; whatever screen height is
// left goes to the controls, which never shrink below CONTROLS_MIN_HEIGHT —
// on short/wide screens the play space gives way instead. Bigger screens
// seeing a bit more world is fine (singleplayer).

/** Play-space height as a multiple of screen width (3:4 → height = 4/3 × width). */
export const PLAY_HEIGHT_RATIO = 4 / 3;
export const CONTROLS_MIN_HEIGHT = 250;

// --- Player movement ---------------------------------------------------------

export const PLAYER_RADIUS = 18;
/** Top speed in px/s when the stick is at full deflection. */
export const PLAYER_MAX_SPEED = 280;
/** Ramp-up rate, px/s². 0 → max in ~0.09s — a quick, responsive wind-up. */
export const PLAYER_ACCEL = 3000;
/**
 * Slow-down rate, px/s². Much higher than accel: releasing at full speed
 * stops in ~0.1s, skidding ~14px (v²/2a) — a hint of weight, not ice.
 */
export const PLAYER_DECEL = 2800;

// --- Targeting & combat -------------------------------------------------------

/**
 * Engagement radius (which hostiles the player *faces*) sits this far beyond
 * the weapon's attack range, so the player turns toward an approaching enemy
 * before it's hittable.
 */
export const ENGAGEMENT_MARGIN = 160;

/**
 * The camera zooms out just enough that the *equipped* weapon's attack-range
 * ring fits on screen with this much margin (screen px) — auto-firing at
 * things you can't see reads as a glitch.
 */
export const CAMERA_FIT_MARGIN = 24;

/**
 * Floor on the world radius the camera frames. Pinning to the equipped
 * weapon would zoom short-reach melee claustrophobically close — never
 * frame less world than this, whatever the weapon's reach.
 */
export const CAMERA_MIN_RADIUS = 230;

/**
 * Extra breathing room: the framed world radius is scaled up by this factor so
 * the player never sits right on top of the lens. Higher = more world on
 * screen (smaller player). Multiplies rather than floors, so per-weapon zoom
 * differences survive. Pulled back from 1.25 so the sight-radius fog ring sits
 * comfortably on-screen rather than past the edge.
 */
export const CAMERA_FRAME_PADDING = 1.6;

/**
 * Camera chase stiffness, 1/s: each second the camera closes this multiple
 * of its remaining gap to the player (exponential decay, so it eases in —
 * fast when far behind, gentle as it re-centres). While the player holds a
 * constant speed the camera settles at speed/rate behind them: at top speed
 * that's PLAYER_MAX_SPEED / CAMERA_FOLLOW_RATE = ~23 world px of trail.
 * Higher = stiffer/snappier, lower = floatier camera operator.
 */
export const CAMERA_FOLLOW_RATE = 12;

// --- Enemies ------------------------------------------------------------------
// A creature (docs/design/enemy-behaviour.md, layer 3) is data: it picks a
// shared behaviour *archetype* from @heroic/core, tunes it with config, and
// adds combat stats + presentation. Wolf and a future hyena are both circlers;
// zombie and a ghoul are both chasers. Radius is shared across types for now so
// every hit calculation stays uniform.

export const ENEMY_RADIUS = 18;
/** Seconds the white hit-flash lingers on a struck enemy (and the player). */
export const HIT_FLASH_DURATION = 0.12;

/**
 * Locomotion shaping for brain-driven movement, px/s² (see PLAYER_ACCEL).
 * Softer than the player's, so enemies telegraph direction changes — and
 * knockback decays through the same decel instead of physics damping.
 */
export const ENEMY_ACCEL = 1300;
export const ENEMY_DECEL = 1900;

export type EnemyTypeId =
  | "zombie"
  | "wolf"
  | "ambusher"
  | "archer"
  | "caster"
  | "charger"
  | "wizard";

/**
 * A creature's ranged attack: the *same* AttackConfig + stats a weapon uses.
 * Per combat.md there's one shared attack library — a skeleton archer fires
 * the projectile a player bow would. `school` already carries physical vs.
 * magic, so "weapon-like, typed" stats come for free.
 */
export interface CreatureAttack {
  config: AttackConfig;
  /** Attacker-side stats (school sources power/crit later); maxHp unused here. */
  stats: CombatStats;
  projectileRadius: number;
  projectileColor: string;
}

/**
 * A creature's summon action — the mirror of an attack, but the "strike" spawns
 * creatures instead of projectiles (docs/design/enemy-behaviour.md). Fully
 * data-driven: `minionType` is any creature in the roster, so a kiter wizard
 * with `minionType: "wolf"` calls wolves. `maxAlive` caps its live brood.
 */
export interface SummonAction {
  minionType: EnemyTypeId;
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
  /** Telegraph ring colour. */
  telegraphColor: string;
}

export interface CreatureDef {
  label: string;
  /** Short archetype × school tag for the spawn picker. */
  tag: string;
  /** makeCombatant stats — `attack` doubles as the contact-damage stat. */
  stats: {
    maxHp: number;
    attack: number;
    defense: number;
    critChance: number;
    critMultiplier: number;
  };
  /** px/s shove applied to the player on a contact hit. */
  contactKnockback: number;
  /** Presentation — app-side only (core stays renderer-free). */
  color: string;
  /** Fresh brain for a spawning instance; `index` varies per-instance quirks. */
  makeBrain: (index: number) => Brain;
  /** Ranged attack profile; absent for melee/contact-only creatures. */
  attack?: CreatureAttack;
  /** Summon action; absent for creatures that don't call minions. */
  summon?: SummonAction;
}

/** Chaser tuning: one state — walk at the player. Slow, tanky, relentless. */
const ZOMBIE_BRAIN: ChaserConfig = {
  speed: 110,
  separationRadius: 56,
  aggroRadius: 480,
};

/**
 * Circler tuning: approaches while unwatched, circles inside the player's
 * front arc. Slightly slower than the player's top speed so it can be outrun;
 * orbit ring sits just outside melee reach.
 */
const WOLF_BRAIN: CirclerConfig = {
  speed: 240,
  separationRadius: 56,
  aggroRadius: 640,
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
  triggerRadius: 300,
  releaseRadius: 500,
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
 * band a live shot, with slack for jitter and the windup lock. Bigger margin =
 * holds closer (safer); smaller = hangs nearer max range.
 */
const STANDOFF_MARGIN = 24;
const standoff = (reach: number, rangeBand: number): number =>
  reach + PLAYER_RADIUS - rangeBand - STANDOFF_MARGIN;

const ARCHER_REACH = 260;
const CASTER_REACH = 240;

const ARCHER_BRAIN: KiterConfig = {
  speed: 205,
  separationRadius: 56,
  aggroRadius: 620,
  preferredRange: standoff(ARCHER_REACH, 50),
  rangeBand: 50,
};

const CASTER_BRAIN: KiterConfig = {
  speed: 200,
  separationRadius: 56,
  aggroRadius: 640,
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
  aggroRadius: 560,
  chargeRange: 300,
  windupTime: 0.55,
  dashDuration: 0.9,
  recoverTime: 0.7,
};

/** Wizard: a kiter that hangs well back (big preferredRange) and summons. */
const WIZARD_BRAIN: KiterConfig = {
  speed: 175,
  separationRadius: 56,
  aggroRadius: 760,
  preferredRange: 360,
  rangeBand: 60,
};

export const CREATURES: Record<EnemyTypeId, CreatureDef> = {
  zombie: {
    label: "Zombie",
    tag: "chaser",
    stats: { maxHp: 40, attack: 6, defense: 2, critChance: 0, critMultiplier: 1 },
    contactKnockback: 220,
    color: "#7fa05f",
    makeBrain: (index) => makeBrain(chaser, ZOMBIE_BRAIN, index),
  },
  wolf: {
    label: "Wolf",
    tag: "circler",
    stats: { maxHp: 26, attack: 10, defense: 0, critChance: 0, critMultiplier: 1 },
    contactKnockback: 320,
    color: "#9fb4d8",
    makeBrain: (index) => makeBrain(circler, WOLF_BRAIN, index),
  },
  ambusher: {
    label: "Ambusher",
    tag: "ambusher",
    stats: { maxHp: 22, attack: 14, defense: 0, critChance: 0, critMultiplier: 1 },
    contactKnockback: 360,
    color: "#b06a8c",
    makeBrain: (index) => makeBrain(ambusher, AMBUSHER_BRAIN, index),
  },
  archer: {
    label: "Archer",
    tag: "kiter · physical",
    stats: { maxHp: 24, attack: 0, defense: 0, critChance: 0, critMultiplier: 1 },
    contactKnockback: 160,
    color: "#caa86a",
    makeBrain: (index) => makeBrain(kiter, ARCHER_BRAIN, index),
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
      projectileColor: "#e8d7a6",
    },
  },
  caster: {
    label: "Caster",
    tag: "kiter · magic",
    stats: { maxHp: 20, attack: 0, defense: 0, critChance: 0, critMultiplier: 1 },
    contactKnockback: 160,
    color: "#8a6fc0",
    makeBrain: (index) => makeBrain(kiter, CASTER_BRAIN, index),
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
      projectileColor: "#9b7bff",
    },
  },
  charger: {
    label: "Charger",
    tag: "charger",
    stats: { maxHp: 34, attack: 12, defense: 1, critChance: 0, critMultiplier: 1 },
    contactKnockback: 440, // the dash hits hard
    color: "#d2683f",
    makeBrain: (index) => makeBrain(charger, CHARGER_BRAIN, index),
  },
  wizard: {
    label: "Wizard",
    tag: "kiter · summon",
    stats: { maxHp: 28, attack: 0, defense: 0, critChance: 0, critMultiplier: 1 },
    contactKnockback: 160,
    color: "#4a63c0",
    makeBrain: (index) => makeBrain(kiter, WIZARD_BRAIN, index),
    summon: {
      minionType: "wolf",
      count: 2,
      windup: 0.8,
      recovery: 2.2,
      maxAlive: 6,
      spawnRadius: 90,
      engageRange: 700,
      telegraphColor: "#b98cff",
    },
  },
};

// --- Player health -------------------------------------------------------------

export const PLAYER_STATS = {
  maxHp: 100,
  attack: 0,
  defense: 0,
  critChance: 0,
  critMultiplier: 1,
};

/**
 * Invulnerability window after taking a contact hit, seconds. Without it a
 * touching enemy would tick damage every sim step; with it, contact reads as
 * discrete bites. No death yet in the tech demo — at 0 HP the bar refills.
 */
export const PLAYER_IFRAMES = 0.9;

/** Seconds a floating damage number lives. */
export const DAMAGE_NUMBER_LIFE = 0.7;
/** Upward drift of damage numbers, px/s. */
export const DAMAGE_NUMBER_RISE = 42;
/** Seconds the melee swing flash lingers after a strike. */
export const ARC_FLASH_DURATION = 0.15;

export const COLORS = {
  void: "#0e1116",
  tileLight: "#222a3c",
  tileDark: "#1a2030",
  wall: "#4a5470",
  pillar: "#5b6685",
  player: "#f2c14e",
  playerNotch: "#1d2433",
  hpBarBack: "#10141c",
  hpBarFill: "#6fd178",
  targetRing: "#f2c14e",
  rangeRing: "#ffffff",
  windup: "#f2e6c8",
  damageText: "#f2f2f2",
  critText: "#ffd24a",
  hurtText: "#ff7a6b",
  playerHurt: "#e8503a",
  chargeTell: "#ff8a3a",
} as const;
