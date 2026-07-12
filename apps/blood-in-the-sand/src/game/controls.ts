/**
 * Control schemes under test (tester thumb-fatigue complaint, 2026-07-12).
 * All three produce the same wire input (sx, sy per tick) — the sim and
 * protocol never know which scheme made it:
 *
 * - "stick": the original fixed-centre thumbstick.
 * - "float": the stick spawns under the thumb and its origin leashes along
 *   when dragged past the rim — no fixed anchor to hold a precise offset
 *   against, and full speed arrives at ~55% deflection instead of the rim.
 * - "pad": no stick at all — four target-relative auto-run buttons
 *   (in / out / orbit either way). Tap an intent, the client steers; orbit
 *   holds the distance you engaged at, tracing better circles than a thumb.
 */
export type ControlScheme = "stick" | "float" | "pad";

export const CONTROL_SCHEMES: readonly ControlScheme[] = ["stick", "float", "pad"];
export const KEY_CONTROLS = "bits.controls";
export const SCHEME_LABEL: Record<ControlScheme, string> = {
  stick: "STICK",
  float: "FLOAT",
  pad: "PAD",
};

/** The pad's four movement intents. cw/ccw name the on-screen orbit sense. */
export type PadMode = "in" | "out" | "cw" | "ccw";

/**
 * Resolve a pad intent into this tick's stick vector, relative to the enemy.
 * Orbit blends the tangent with a radial correction toward `holdDist` (the
 * distance captured when the orbit was engaged) so circles don't drift.
 * No enemy → stand still (the buttons are meaningless without a reference).
 */
export const padInput = (
  mode: PadMode,
  me: { x: number; y: number },
  enemy: { x: number; y: number } | undefined,
  holdDist: number,
): { sx: number; sy: number } => {
  if (!enemy) return { sx: 0, sy: 0 };
  const dx = enemy.x - me.x;
  const dy = enemy.y - me.y;
  const dist = Math.hypot(dx, dy) || 1;
  const tx = dx / dist;
  const ty = dy / dist;

  if (mode === "in") return { sx: tx, sy: ty };
  if (mode === "out") return { sx: -tx, sy: -ty };

  // Screen coords have y down, so (−ty, tx) sweeps clockwise on screen.
  const sign = mode === "cw" ? 1 : -1;
  const inward = Math.max(-0.75, Math.min(0.75, (dist - holdDist) / 40));
  const sx = -ty * sign + tx * inward;
  const sy = tx * sign + ty * inward;
  const mag = Math.hypot(sx, sy) || 1;
  return { sx: sx / mag, sy: sy / mag };
};
