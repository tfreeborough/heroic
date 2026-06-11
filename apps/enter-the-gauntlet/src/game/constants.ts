// Tunables for the movement + combat prototype. Numbers here are placeholders
// to be found in playtest (see docs/design/player-movement-and-targeting.md
// and docs/design/combat.md).

/** World units are pixels at 1:1 camera zoom. */
export const TILE_SIZE = 64;
/** Arena is square: this many tiles per side. */
export const ARENA_TILES = 25;
export const ARENA_SIZE = TILE_SIZE * ARENA_TILES;
export const WALL_THICKNESS = 48;

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
/** Ramp-up rate, px/s². 0 → max in ~0.18s — a short, readable wind-up. */
export const PLAYER_ACCEL = 2100;
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
export const CAMERA_MIN_RADIUS = 200;

/** Training dummies: stationary hostiles to swing at while tuning weapon feel. */
export const DUMMY_RADIUS = 18;
export const DUMMY_MAX_HP = 40;
export const DUMMY_DEFENSE = 2;
/** Seconds a dead dummy stays gone before popping back up at its spawn. */
export const DUMMY_RESPAWN = 2.5;
/** Velocity damping so knocked-back dummies glide to a stop (Matter frictionAir). */
export const DUMMY_FRICTION_AIR = 0.12;
/** Seconds the white hit-flash lingers on a struck dummy. */
export const HIT_FLASH_DURATION = 0.12;

/**
 * Dummy spawn points: a loose ring around the arena centre (the player
 * spawn), at varied distances — some inside ranged reach from the start,
 * others needing a walk, so every weapon's range is easy to feel out.
 */
export const DUMMY_SPAWNS: { x: number; y: number }[] = [
  { x: 800, y: 620 },
  { x: 1080, y: 760 },
  { x: 940, y: 1090 },
  { x: 560, y: 950 },
  { x: 640, y: 640 },
];

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
  player: "#f2c14e",
  playerNotch: "#1d2433",
  dummy: "#9a6a8c",
  dummyDamaged: "#6e4a64",
  hpBarBack: "#10141c",
  hpBarFill: "#6fd178",
  targetRing: "#f2c14e",
  rangeRing: "#ffffff",
  windup: "#f2e6c8",
  damageText: "#f2f2f2",
  critText: "#ffd24a",
} as const;
