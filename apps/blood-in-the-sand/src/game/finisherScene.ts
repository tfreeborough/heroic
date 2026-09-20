/**
 * The finisher shop window's one scene (bits-cosmetics.md § F2/F3, Tom
 * 2026-09-20: "the previews should look more like an actual match — zoomed
 * out to match height, one player shooting another as they advance").
 *
 * A scripted scene for the Primer's ScenarioRunner, so nothing is staged art:
 * the real sim, the real renderer, the real arrow, splatter, death spray,
 * pool and kill shake — and the finisher playing over it exactly as it will
 * in a match. You hold the top of the arena's open lane with a bow; a
 * hammer walks up it at you, takes an arrow, takes a second, and falls in
 * the lower-middle of the frame, with headroom above the body for the shows
 * that reach UP (Smite's bolt, the rising constellation, Medusa's eyes).
 */
import { PLAYER_RADIUS, WEAPONS, type InterpolatedView } from "@heroic/blood-in-the-sand-sim";
import { LANE_X, type Scenario, type ScriptInput } from "../primer/scenario";

const IDLE: ScriptInput = { sx: 0, sy: 0 };

/** The match's own follow zoom (render.ts): FOLLOW_ZOOM, clamped so the
 * roster's longest range ring fits across the view's width. A preview frame
 * is about a phone's width, so this is the size a kill really is. */
const FOLLOW_ZOOM = 0.64;
const MAX_WEAPON_REACH = Math.max(...Object.values(WEAPONS).map((w) => w.attack.reach));
const matchZoom = (w: number): number => Math.min(FOLLOW_ZOOM, w / 2 / (MAX_WEAPON_REACH + PLAYER_RADIUS + 16));

const YOU_Y = 545;
/** Where the second arrow finds him, give or take a stride. */
const KILL_Y = 740;
/** Off the bottom of the frame — the foe walks INTO shot. */
const FOE_START_Y = 1010;
/** Arrows land for 15–21, a crit for ~31 (checked by running the scene
 * headlessly): 33 HP means never a one-shot, nearly always the second arrow,
 * now and then a third — three arrows still finds him halted outside reach. */
const FOE_HP = 33;
/** The hammer never gets to swing: it stops well outside its own reach, and
 * walks slowly enough that the second arrow finds it mid-lane. */
const FOE_HALT = 200;
const FOE_PACE = 0.42;

export const FINISHER_KILL_SCENE: Scenario = {
  you: { weapon: "bow", abilities: ["dash", "ironhide"] },
  foe: { weapon: "hammer", abilities: ["dash", "ironhide"] },
  place: (seat) =>
    seat === "you" ? { x: LANE_X - 14, y: YOU_Y } : { x: LANE_X + 22, y: FOE_START_Y, hp: FOE_HP, moveFactor: FOE_PACE },
  input: (seat, _t, you, foe) => {
    if (seat === "you" || !you.alive || !foe.alive) return IDLE; // the bow aims and looses by itself
    const dx = you.mover.pos.x - foe.mover.pos.x;
    const dy = you.mover.pos.y - foe.mover.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    return len > FOE_HALT ? { sx: dx / len, sy: dy / len } : IDLE;
  },
  // A fixed shot, centred on the ACTION rather than the archer: the kill
  // lands mid-lane (y ≈ 740, measured by running the scene headlessly), so
  // that's the middle of the frame — the archer above it, the foe walking up
  // from below, and headroom over the body for the shows that reach up.
  camera: (_view: InterpolatedView, w: number) => ({ cx: LANE_X, cy: KILL_Y - 24, zoom: matchZoom(w) }),
  loopSeconds: 9,
  // Long enough for the slowest show (Snuffed, 1.77s) plus a beat on the
  // mark it leaves, short enough that the loop never idles.
  holdAfterRoundEnd: 2.7,
};
