/**
 * The Primer's scripted scenes (bits-onboarding.md § the five chapters) —
 * pure data + tiny scripts for ScenarioRunner. Positions sit on the arena's
 * open centre lane (scenario.ts LANE_X, north–south); cameras are directed
 * per scene.
 */
import { WEAPONS, type InterpolatedView } from "@heroic/blood-in-the-sand-sim";
import { LANE_BOTTOM, LANE_TOP, LANE_X, type Scenario, type ScriptInput } from "./scenario";

const IDLE: ScriptInput = { sx: 0, sy: 0 };

const toward = (from: { x: number; y: number }, to: { x: number; y: number }, gain = 1): ScriptInput => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { sx: (dx / len) * gain, sy: (dy / len) * gain };
};

const pos = (p: { mover: { pos: { x: number; y: number } } }) => p.mover.pos;

/** The stage card is only near-square on a roomy phone; a tight one gets a
 * short, wide card. Fixed shots therefore FIT: never zoom past what keeps
 * `spanY` world px inside the stage height (plus a body's worth of margin). */
const fitZoom = (zoom: number, stageH: number, spanY: number): number => Math.min(zoom, stageH / (spanY + 120));

/** A fixed shot on the lane, centred at height `cy`, fitting `spanY`. */
const fixedCamera =
  (cy: number, zoom: number, spanY: number) =>
  (_view: InterpolatedView, _w: number, h: number): { cx: number; cy: number; zoom: number } => ({
    cx: LANE_X,
    cy,
    zoom: fitZoom(zoom, h, spanY),
  });

/** Track the pair's midpoint (a retreat would walk out of a fixed shot),
 * fitting whatever gap they hold. */
const trackPair = (view: InterpolatedView, _w: number, h: number): { cx: number; cy: number; zoom: number } => {
  const a = view.players.find((p) => p.id === 0);
  const b = view.players.find((p) => p.id === 1);
  if (!a || !b) return { cx: LANE_X, cy: 760, zoom: fitZoom(0.52, h, 440) };
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, zoom: fitZoom(0.52, h, Math.abs(a.y - b.y)) };
};

/** Follow seat 0 at a comfortable zoom (the match's own is 0.64). */
const followYou = (view: InterpolatedView): { cx: number; cy: number; zoom: number } => {
  const me = view.players.find((p) => p.id === 0);
  return { cx: me?.x ?? LANE_X, cy: me?.y ?? 720, zoom: 0.62 };
};

/** Where the idle opponent waits in the scenes that are yours alone — the
 * far south-east, well out of any follow shot. */
const PARKED = { x: 1500, y: 1480 };

// ── I · THE SAND — two fighters close, one falls ────────────────────────────

export const SAND_SCENE: Scenario = {
  you: { weapon: "blade", abilities: ["dash", "ironhide"] },
  foe: { weapon: "hammer", abilities: ["dash", "ironhide"] },
  // You from the north, the foe up from the south; the shot sits between.
  place: (seat) => (seat === "you" ? { x: LANE_X, y: 570 } : { x: LANE_X, y: 900, hp: 45 }),
  input: (seat, _t, you, foe) => {
    const a = seat === "you" ? you : foe;
    const b = seat === "you" ? foe : you;
    if (!a.alive || !b.alive) return IDLE;
    const d = Math.hypot(pos(b).x - pos(a).x, pos(b).y - pos(a).y);
    // Close to blade reach, then stand and let the weapons work.
    return d > 105 ? toward(pos(a), pos(b), 0.9) : IDLE;
  },
  camera: fixedCamera(735, 0.55, 330),
  loopSeconds: 12,
  holdAfterRoundEnd: 2.4,
};

// ── II · MOVE — the stick's wander, a fighter in step ───────────────────────

/** The thumb's wander as a function of scene time — shared by the sim
 * input AND the pad overlay, so the knob and the fighter agree exactly. */
const MOVE_SEGMENTS: readonly { until: number; sx: number; sy: number }[] = [
  { until: 0.8, sx: 0, sy: 0 },
  { until: 1.8, sx: 1, sy: 0 },
  { until: 3.0, sx: -0.6, sy: -0.8 },
  { until: 4.2, sx: 0.55, sy: 0.8 },
  { until: 5.0, sx: 0, sy: 0 },
];
export const MOVE_LOOP_SECONDS = 5.0;

export const moveStickAt = (t: number): ScriptInput => {
  let start = 0;
  for (const seg of MOVE_SEGMENTS) {
    if (t < seg.until) {
      // Ease in over the first quarter second of a segment — thumbs don't snap.
      const k = Math.min(1, (t - start) / 0.25);
      const ease = k * k * (3 - 2 * k);
      return { sx: seg.sx * ease, sy: seg.sy * ease };
    }
    start = seg.until;
  }
  return IDLE;
};

export const MOVE_SCENE: Scenario = {
  you: { weapon: "blade", abilities: ["dash", "ironhide"] },
  foe: { weapon: "blade", abilities: ["dash", "ironhide"] },
  // The wander stays inside the pocket: east to ~1320, up to ~450, back.
  place: (seat) => (seat === "you" ? { x: 1040, y: 720 } : PARKED),
  input: (seat, t) => (seat === "you" ? moveStickAt(t) : null),
  camera: followYou,
  loopSeconds: MOVE_LOOP_SECONDS,
};

// ── III · STRIKE — an enemy walks into your reach; your weapon answers ──────

/** Your reach with the staff, to the foe's rim (the renderer's ring). */
const STAFF_RING = WEAPONS.staff.attack.reach;
/** Backing off (north) ends at the lane's top — the hoodoo sits above it. */
const STRIKE_RETREAT_MIN_Y = LANE_TOP;

export const STRIKE_SCENE: Scenario = {
  you: { weapon: "staff", abilities: ["dash", "ironhide"] },
  foe: { weapon: "hammer", abilities: ["dash", "ironhide"] },
  // You near the lane's top, the hammer walking up from its foot.
  place: (seat) =>
    seat === "you" ? { x: LANE_X, y: 600 } : { x: LANE_X + 30, y: LANE_BOTTOM + 90, hp: 55, moveFactor: 0.5 },
  input: (seat, _t, you, foe) => {
    if (!foe.alive || !you.alive) return IDLE;
    const d = Math.hypot(pos(you).x - pos(foe).x, pos(you).y - pos(foe).y);
    if (seat === "you") {
      // Kite (Tom, 2026-08-24): once the mark is inside the ring, back off
      // slowly so the gap HOLDS at the ring's edge — the distance itself is
      // the lesson. Slower than the foe's approach, so it still closes in
      // the end; never past the rock pile.
      const backing = d < STAFF_RING * 0.92 && pos(you).y > STRIKE_RETREAT_MIN_Y;
      return backing ? toward(pos(you), { x: LANE_X, y: pos(you).y - 100 }, 0.4) : IDLE;
    }
    return d > 130 ? toward(pos(foe), pos(you), 1) : IDLE;
  },
  camera: trackPair,
  loopSeconds: 16,
  holdAfterRoundEnd: 2.2,
};

// ── IV · ARM YOURSELF — the picks, cast in button order ─────────────────────

export const ARM_LOOP_SECONDS = 7.5;

export const ARM_SCENE: Scenario = {
  you: { weapon: "blade", abilities: ["dash", "ironhide"] },
  foe: { weapon: "blade", abilities: ["dash", "ironhide"] },
  place: (seat) => (seat === "you" ? { x: LANE_X, y: 720 } : PARKED),
  input: (seat, t) => {
    if (seat !== "you") return null;
    // Two dashes (the top button) either way, an Ironhide (the second) between.
    // Short walks: the pocket is ~200px each side of the lane.
    const press = (at: number): boolean => t >= at && t < at + 0.08;
    const walking = (t >= 0.6 && t < 1.4) || (t >= 4.6 && t < 5.4);
    const dir = t < 3 ? 1 : -1;
    return { sx: walking ? dir : 0, sy: 0, casts: [press(1.0) || press(5.0), press(3.0)] };
  },
  camera: followYou,
  loopSeconds: ARM_LOOP_SECONDS,
};
