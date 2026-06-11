// Tunables for the movement prototype. Numbers here are placeholders to be
// found in playtest (see docs/design/player-movement-and-targeting.md).

/** World units are pixels at 1:1 camera zoom. */
export const TILE_SIZE = 64;
/** Arena is square: this many tiles per side. */
export const ARENA_TILES = 25;
export const ARENA_SIZE = TILE_SIZE * ARENA_TILES;
export const WALL_THICKNESS = 48;

export const PLAYER_RADIUS = 18;
/** Top speed in px/s when the stick is at full deflection. */
export const PLAYER_MAX_SPEED = 280;
/** Ramp-up rate, px/s². 0 → max in ~0.18s — a short, readable wind-up. */
export const PLAYER_ACCEL = 1600;
/**
 * Slow-down rate, px/s². Much higher than accel: releasing at full speed
 * stops in ~0.1s, skidding ~14px (v²/2a) — a hint of weight, not ice.
 */
export const PLAYER_DECEL = 2800;

export const COLORS = {
  void: "#0e1116",
  tileLight: "#222a3c",
  tileDark: "#1a2030",
  wall: "#4a5470",
  player: "#f2c14e",
  playerNotch: "#1d2433",
} as const;
