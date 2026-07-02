// Tunables for the movement + combat prototype. Numbers here are placeholders
// to be found in playtest (see docs/design/player-movement-and-targeting.md
// and docs/design/combat.md).

import {
  CREATURES,
  loadZone,
  rectEdges,
  ZONE_PALETTE,
  type CreatureId,
  type VisionSegment,
} from "@heroic/engine";
import { REALM_00 } from "./zones/realm-00";

// The arena is authored as a zone file and loaded through the Realmsmith pipeline
// (docs/design/world-representation.md). loadZone reproduces the geometry the old
// hand-coded constants did; the exports below are derived from it, so the rest of
// the app is untouched while the world becomes data-driven. Exported whole so the
// renderer can bake and cull the zone's chunks.
export const ZONE = loadZone(REALM_00);

/** World units are pixels at 1:1 camera zoom. */
export const TILE_SIZE = ZONE.tileSize;
/** Zone dimensions in tiles (no longer assumed square). */
export const ARENA_COLS = REALM_00.size.cols;
export const ARENA_ROWS = REALM_00.size.rows;
/** Zone dimensions in world px. */
export const ARENA_WIDTH = ZONE.size.x;
export const ARENA_HEIGHT = ZONE.size.y;
export const WALL_THICKNESS = 48;

/** Where the player starts — the zone's authored player spawn. */
export const SPAWN = ZONE.spawn;

/**
 * Arena boundary walls (centred rects), shared by physics bodies and rendering.
 * Derived from the zone's rectangular bounds (interior obstacles are the zone's
 * collision — PILLARS below). Enemies are kept in by the bounds clamp, so these
 * only block the player (Matter) and get drawn.
 */
export const WALLS: { x: number; y: number; w: number; h: number }[] = (() => {
  const w = ZONE.size.x;
  const h = ZONE.size.y;
  const t = WALL_THICKNESS;
  return [
    { x: w / 2, y: -t / 2, w: w + 2 * t, h: t },
    { x: w / 2, y: h + t / 2, w: w + 2 * t, h: t },
    { x: -t / 2, y: h / 2, w: t, h: h + 2 * t },
    { x: w + t / 2, y: h / 2, w: t, h: h + 2 * t },
  ];
})();

/**
 * Interior **walls**: solid blocks that collide with bodies, are drawn, AND occlude
 * line of sight / projectiles / targeting. The zone's `"wall"`-material collision
 * (greedy-meshed by loadZone). Voids are NOT here — they block movement only, via
 * SOLIDS below — so the game only ever draws and occludes against walls.
 */
export const PILLARS = ZONE.walls;

/**
 * Everything that blocks **movement** — walls *and* voids (chasms). Feeds the
 * player's Matter blocker bodies, the crowd, and the enemy nav grid, so nothing
 * can walk into a void; but voids stay out of OCCLUDERS, so you still see and shoot
 * across them. Equals `PILLARS` whenever a zone has no void collision.
 */
export const SOLIDS = ZONE.collision;

/**
 * Void collision: chasms that block movement but are drawn as a dark, drifting-mist
 * pit (see renderCombat) — not occluders, so you see/shoot across them. The fenced
 * floorless border lives here too. Empty when a zone has no void.
 */
export const VOIDS = ZONE.voids;

/**
 * Sight / projectile occluders, shared by the renderer (fog-of-war rays) and the
 * sim (projectile-vs-wall collisions and enemy line-of-sight): the zone-bounds
 * rectangle plus every wall's edges. Built from PILLARS (walls) only — voids don't
 * occlude, so a bridge over a chasm lets you see/shoot to the far side. The bounds
 * box never lies between two interior points, so it doesn't affect enemy↔player
 * sightlines — it only stops projectiles at the boundary and bounds the fog rays.
 */
export const OCCLUDERS: VisionSegment[] = [
  { ax: 0, ay: 0, bx: ZONE.size.x, by: 0 },
  { ax: ZONE.size.x, ay: 0, bx: ZONE.size.x, by: ZONE.size.y },
  { ax: ZONE.size.x, ay: ZONE.size.y, bx: 0, by: ZONE.size.y },
  { ax: 0, ay: ZONE.size.y, bx: 0, by: 0 },
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
  exploredAlpha: 0.95,
  /** Opacity over never-seen area, 0..1. 0.98 keeps the faint hint of unknown
   *  geometry you liked on the original blind spots. */
  unexploredAlpha: 0.98,
  /** Softness of the *current-sight* boundary, world px of blur. Kept tight so
   *  the sightline still reads as a crisp edge. */
  edgeFeather: 5,
  /** Softness of the *fog frontier* (explored ↔ unseen), world px of blur. Large
   *  on purpose: it dissolves the underlying memory grid into soft mist instead
   *  of visible cells. Roughly cell-sized or bigger is what kills the blockiness. */
  fogSoftness: 60,
  /** Drifting-mist wisp colour — the lighter veins that roll through the fog.
   *  A touch lighter/bluer than `shadowColor` so they read against the dark. */
  mistColor: "#1e1e1e",
  /** Mist feature size, world px. Bigger = larger, lazier-looking clouds. */
  mistScale: 200,
  /** Mist drift speed, world px/s — now maps ~directly to visible travel. Slow
   *  reads as atmospheric; 0 = static (curls in place). */
  mistSpeed: 7,
  /** Current clear-vision range, world px. Beyond this — even down an open
   *  sightline — the view fades into fog, so vision closes in around you. Pulled
   *  in from 360 to tighten the lit bubble for a more claustrophobic feel. */
  sightRadius: 460,
  /** Where the clear→fog fade begins, as a fraction of sightRadius (0..1).
   *  Inside this you see fully; from here to sightRadius it ramps to the dim.
   *  Dropped from 0.55 so the dimming starts much closer to the player — distant
   *  geometry reads markedly darker, the view crowding in around you. */
  sightFalloff: 0.50,
  /** Exploration range, world px. Cells within this AND in line of sight become
   *  "explored" (dim memory). Kept a hair above sightRadius so a thin ring just
   *  past clear vision still gets discovered as you move. Tightened from 500 so
   *  you must get close to permanently clear fog — most of what you glimpse at a
   *  distance stays unrevealed. */
  discoverRadius: 340,
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

/**
 * Flow-field pathfinding (docs/design/flow-field-pathfinding.md). One flood from the
 * player gives the whole crowd its "route toward the player around walls" in O(1),
 * replacing per-enemy A* while it covers the mover.
 *
 * `FLOW_RADIUS` — world px the flood reaches from the player. Must comfortably cover
 * the region where enemies actually path (roughly the on-screen sim radius): an
 * enemy inside it reads the field, one outside falls back to A* (and off-screen ones
 * don't path at all). Bigger = more of the fight covered, but a larger flood.
 */
export const FLOW_RADIUS = 2400;
/**
 * Sim steps between flow-field re-floods. The field goes stale as the player moves,
 * but slowly, and the routing tolerates it (same trade as the A* re-path throttle).
 * Higher = cheaper, staler.
 */
export const FLOW_RESWEEP_STEPS = 6;
/**
 * Enemy count at/above which the flow field is used; below it, enemies fall back to
 * per-enemy A*. The flood is a FIXED cost (independent of enemy count), so it only
 * pays off once enough enemies would otherwise be running their own searches — below
 * the threshold a handful of A* paths is cheaper than flooding the map. This keeps the
 * flow field a pure win: it kicks in exactly when the crowd is big enough to need it.
 */
export const FLOW_MIN_ENEMIES = 12;

/**
 * Distance-of-detail cutoff for the *uncapped* per-enemy AI cost — the line-of-
 * sight raycast (against every occluder, every LOS_RECHECK_STEPS) and the wall-
 * routing pathfinding. Enemies within this multiple of the on-screen radius (the
 * visible world's half-diagonal, so it tracks zoom) get the full treatment;
 * those beyond it — off-screen — skip the raycast and A* and simply steer
 * straight at the player. The leash still reels them in (they keep moving); they
 * just don't navigate around walls until they're back near the camera, where it
 * shows. >1 so a creature at the screen edge is already fully simulated.
 */
export const OFFSCREEN_SIM_MARGIN = 1.25;

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

// --- Dash / roll -------------------------------------------------------------
// A committed burst in the stick direction (or facing, if the stick is idle):
// the player's velocity is pinned to DASH_SPEED for DASH_DURATION, bypassing the
// usual acceleration ramp, then normal locomotion's decel skids it back out.
/** Roll distance, world px (≈10 player diameters — a real repositioning dodge). */
export const DASH_DISTANCE = 180;
/** Roll duration, seconds: distance is covered over this window. */
export const DASH_DURATION = 0.2;
/** Roll speed, px/s — derived so distance/duration stay the things you tune. */
export const DASH_SPEED = DASH_DISTANCE / DASH_DURATION;
/** Seconds before the roll can be used again (the cooldown clock fills this). */
export const DASH_COOLDOWN = 8;
/**
 * Invulnerability window, seconds — a touch longer than the roll itself so the
 * dodge stays forgiving at the tail. Tracked separately from the post-hit
 * i-frames so a roll never triggers the red "hurt" flash.
 */
export const DASH_IFRAMES = 0.25;
/**
 * Outward shove applied to any enemy the roll barges into, px/s (a velocity
 * impulse that decays through the enemy's locomotion decel, same as a melee
 * knockback). Firm — between a contact bite and the sword's heavy swing.
 */
export const DASH_KNOCKBACK = 840;
/**
 * The player's *effective* barge radius while dashing — the "bowling ball" size,
 * deliberately wider than PLAYER_RADIUS (18) so a roll sweeps up a whole clump
 * and scatters it, not just the one enemy you physically touch. The shove
 * triggers within DASH_SHOVE_RADIUS + ENEMY_RADIUS of the player centre. ~one
 * tile (64) wide is a satisfying sweep; only applies during the active roll.
 */
export const DASH_SHOVE_RADIUS = 46;

// --- Targeting & combat -------------------------------------------------------

/**
 * Engagement radius (which hostiles the player *faces*) sits this far beyond
 * the weapon's attack range, so the player turns toward an approaching enemy
 * before it's hittable.
 */
export const ENGAGEMENT_MARGIN = 160;

/**
 * Combat *music* trigger: any living enemy within this radius of the player
 * counts as "in a fight", switching the soundtrack to the combat bed (with a
 * hangover — see audio/musicState). Deliberately generous (≈7 tiles) so the
 * music swells a touch before things are in your face. A coarse proxy for the
 * AI's own engagement; refine to brain-engaged state if it ever feels off.
 */
export const COMBAT_MUSIC_RADIUS = 480;

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

/**
 * The creature roster is **pure data** and now lives in `@heroic/core`
 * (`creature/roster`): archetype + tuning + combat stats + actions. Both games
 * share that one bestiary, and Realmsmith reads it to offer a real creature
 * picker (a spawner names a `CreatureId`). It's re-exported here — with the
 * stable `EnemyTypeId` alias — so existing app imports from "./constants" are
 * unchanged. See docs/design/enemy-behaviour.md (layer 3).
 */
export type EnemyTypeId = CreatureId;
export { CREATURES };

/**
 * App-side **presentation**, layered over the pure roster per creature id. Core
 * is renderer-free, so anything visual lives here: the body fill now, plus the
 * projectile / summon-telegraph tints for ranged and summoning creatures, and
 * sprites/haptics later. Keyed by id so it can't drift out of sync with the
 * roster (a missing key is a type error).
 */
export const CREATURE_VISUALS: Record<
  EnemyTypeId,
  { color: string; projectileColor?: string; telegraphColor?: string }
> = {
  zombie: { color: "#7fa05f" },
  wolf: { color: "#9fb4d8" },
  ambusher: { color: "#b06a8c" },
  archer: { color: "#caa86a", projectileColor: "#e8d7a6" },
  caster: { color: "#8a6fc0", projectileColor: "#9b7bff" },
  charger: { color: "#d2683f" },
  bat: { color: "#9b7fc0" },
  wizard: { color: "#4a63c0", telegraphColor: "#b98cff" },
};

// --- Player health -------------------------------------------------------------
// (Player stats now come from the chosen class through @heroic/core's modifier
// pipeline — see stats/classes.ts and derivePlayerCombatStats.)

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

// --- Breakables ----------------------------------------------------------------
// Destructible blockers authored into the zone (docs/design/world-representation.md):
// a Combatant + a static Aabb, no Mover/Brain. The player breaks them with melee
// and projectiles; an `onBreak` explosion deals AoE to enemies, the player, and
// other breakables (so barrels chain-detonate).

/**
 * Outward shove an explosion's AoE applies to caught enemies/player, px/s — a
 * velocity impulse that decays through locomotion decel like a melee knockback.
 * Firm enough to scatter a clump that was hugging a barrel.
 */
export const EXPLOSION_KNOCKBACK = 520;

/**
 * Lifetime of the explosion *visual* (flash + fireball + shockwave ring + sparks),
 * seconds. Purely cosmetic — the damage is dealt instantly on break; this is just
 * how long the blast lingers on screen. See renderCombat.
 */
export const EXPLOSION_FX_DURATION = 0.45;

/**
 * Fuse: the beat between an explosive breakable reaching 0 hp and actually
 * detonating, seconds. Because a blast primes its neighbours' fuses (rather than
 * bursting them instantly), a cluster chain-reacts as a visible cascade — pop,
 * pop, pop — instead of all going off on the same frame. Also a moment to back off
 * a barrel you just shot. A primed barrel glows hotter as the fuse burns down.
 */
export const EXPLOSION_FUSE_DELAY = 0.18;

// --- Low-health warning vignette. Below the threshold a red inset glow pulses
// around the play area; the beat quickens and brightens from `MIN` (just under
// the threshold) toward `MAX` (near death). Pulse rate is in full beats/sec.
/** HP fraction at/under which the low-health vignette appears. */
export const LOW_HP_THRESHOLD = 0.35;
export const LOW_HP_PULSE_MIN_HZ = 0.2;
export const LOW_HP_PULSE_MAX_HZ = 2.6;
/** Peak opacity of the vignette at its brightest point in a beat. */
export const LOW_HP_VIGNETTE_MIN_ALPHA = 0.1;
export const LOW_HP_VIGNETTE_MAX_ALPHA = 0.62;

export const COLORS = {
  // World/zone palette — the single source of truth shared with the Realmsmith
  // editor (see ZONE_PALETTE in @heroic/core): void / tileLight / tileDark / wall /
  // pillar / breakableWood / breakableBarrel / breakableCrate / breakableEdge.
  ...ZONE_PALETTE,
  // Explosion VFX palette (additive fireball core→mid, plus ring + debris sparks).
  explosionCore: "#fff6d5",
  explosionMid: "#ff6a1a",
  explosionRing: "#ffcf8a",
  explosionSpark: "#ffb24a",
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
