/**
 * Bot difficulty — the eight Unreal-Tournament-named execution-quality tiers
 * (docs/design/bot-brains.md, rollout step 4). DECIDED: difficulty changes NO
 * stats; every tier fights with even numbers and differs only in how well the
 * brain executes. Orthogonal to archetype: the archetype says what the bot is
 * trying to do, the tier says how well it does it.
 *
 * The backbone dial is REACTION TIME, implemented as snapshot staleness: the
 * host keeps a short history and each bot thinks on the snapshot ~N ms old.
 * Every downstream skill falls out of stale data for free — late dodges,
 * kite overshoot, lazy corners — with no hand-written "make a mistake" code.
 * On top sit three explicit dials: the odds a live telegraph actually gets
 * its reactive answer, how disciplined the proactive casting is, and a
 * movement wobble so low tiers don't track with robotic precision.
 */
import type { SnapshotMsg } from "./protocol";

export type DifficultyId =
  | "novice"
  | "average"
  | "experienced"
  | "skilled"
  | "adept"
  | "masterful"
  | "inhuman"
  | "godlike";

export const DIFFICULTY_IDS: readonly DifficultyId[] = [
  "novice",
  "average",
  "experienced",
  "skilled",
  "adept",
  "masterful",
  "inhuman",
  "godlike",
];

/** The tier every host uses until a picker says otherwise (step 5) —
 * "plays like a person" (median human visual reaction is ~250ms). */
export const DEFAULT_DIFFICULTY: DifficultyId = "skilled";

export interface DifficultyPreset {
  name: string;
  /** Snapshot staleness in ticks (30Hz): the bot thinks on a world this old. */
  reactionTicks: number;
  /** Odds a live telegraph gets its reactive answer (dodge / mirror / iron).
   * Rolled once per threat episode, not per tick — a failed roll means THIS
   * swing goes unanswered, the next one rolls fresh. */
  dodgeChance: number;
  /** Odds a satisfied proactive cast rule actually presses on its beat; a
   * failed roll re-rolls a few ticks later, so low tiers cast late and
   * ragged rather than never. */
  castChance: number;
  /** Extra ticks on the proactive cast-pacing hold — low tiers also play
   * their hands SLOWER, not just less reliably. */
  castHoldExtra: number;
  /** Movement noise: max radians of per-tick wander on the walk intent. */
  wobble: number;
  /** Odds PER SECOND of a short freeze mid-fight — the overwhelmed-new-player
   * hesitation (Tom's step-6 pass: staleness alone didn't read as "new"). */
  dither: number;
  /** Serpentine strength (0–1) while closing on a RANGED target — the
   * counter to "kite with a bow and they walk a straight line into arrows"
   * (Tom's step-6 exploit). Lateral component, sign-flipped irregularly. */
  weave: number;
  /** Projectile-timed dodges: hold the dash until the shot is about to
   * loose, then hop PERPENDICULAR — dodge by displacement (a dash at windup
   * start burns its i-frames long before an arrow arrives; that mistimed
   * dodge IS the low-tier behaviour, so this stays false down there). */
  smartDodge: boolean;
  /** Permanent move-speed multiplier (REVISED decision, Tom 2026-07-20: the
   * top two tiers run 5/10% hot — the ONE stat difficulty touches; damage
   * and HP stay even at every tier). Host-applied via ArenaPlayer.moveFactor. */
  speedFactor: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyPreset> = {
  novice: { name: "Novice", reactionTicks: 20, dodgeChance: 0, castChance: 0.2, castHoldExtra: 60, wobble: 0.8, dither: 0.5, weave: 0, smartDodge: false, speedFactor: 1 },
  average: { name: "Average", reactionTicks: 15, dodgeChance: 0.1, castChance: 0.35, castHoldExtra: 36, wobble: 0.6, dither: 0.3, weave: 0, smartDodge: false, speedFactor: 1 },
  experienced: { name: "Experienced", reactionTicks: 11, dodgeChance: 0.3, castChance: 0.55, castHoldExtra: 18, wobble: 0.35, dither: 0.1, weave: 0.15, smartDodge: false, speedFactor: 1 },
  skilled: { name: "Skilled", reactionTicks: 8, dodgeChance: 0.55, castChance: 0.75, castHoldExtra: 9, wobble: 0.18, dither: 0, weave: 0.3, smartDodge: false, speedFactor: 1 },
  adept: { name: "Adept", reactionTicks: 6, dodgeChance: 0.7, castChance: 0.85, castHoldExtra: 4, wobble: 0.1, dither: 0, weave: 0.5, smartDodge: true, speedFactor: 1 },
  masterful: { name: "Masterful", reactionTicks: 4, dodgeChance: 0.85, castChance: 0.95, castHoldExtra: 0, wobble: 0.04, dither: 0, weave: 0.65, smartDodge: true, speedFactor: 1 },
  inhuman: { name: "Inhuman", reactionTicks: 3, dodgeChance: 0.95, castChance: 1, castHoldExtra: 0, wobble: 0, dither: 0, weave: 0.75, smartDodge: true, speedFactor: 1.05 },
  godlike: { name: "Godlike", reactionTicks: 1, dodgeChance: 1, castChance: 1, castHoldExtra: 0, wobble: 0, dither: 0, weave: 0.8, smartDodge: true, speedFactor: 1.1 },
};

/**
 * The host-side snapshot ring: push every tick's snapshot, read the one N
 * ticks old for each bot's tier. One history per host serves every bot (each
 * indexes its own delay). Asking further back than we hold returns the
 * oldest we have — early ticks are just briefly extra-stale.
 */
const HISTORY_CAP = 24; // covers novice's 20 ticks + slack

export class SnapshotHistory {
  private readonly buf: SnapshotMsg[] = [];

  push(snap: SnapshotMsg): void {
    this.buf.push(snap);
    if (this.buf.length > HISTORY_CAP) this.buf.shift();
  }

  /** The snapshot `ticks` behind the newest (0 = newest), or null if empty. */
  stale(ticks: number): SnapshotMsg | null {
    if (this.buf.length === 0) return null;
    const idx = Math.max(0, this.buf.length - 1 - ticks);
    return this.buf[idx]!;
  }
}
