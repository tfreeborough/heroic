/**
 * Finisher CUES — the kill stings and the killer's haptics
 * (bits-cosmetics.md § Finisher sound briefs + cue sheet).
 *
 * The Forge makes ONE sound per bank, so a finisher with several beats is
 * several banks, each played on its cue. This is that cue sheet as data, and
 * the little player that walks it. Pure (no Skia, no audio import): the
 * caller hands `update` the two things a cue can do.
 *
 * Cues fire off the FRAME clock the finisher itself is drawn on, never
 * timers — a match that's paused or backgrounded mid-show can't play its
 * crumble two seconds late over nothing. A cue that comes due more than
 * LATE_MS ago is dropped, not played.
 *
 * Sound cues with an attack to them sit ~20ms AHEAD of the picture: a
 * transient that's late reads as lag, one that's early reads as impact.
 * Haptics start after 0 on purpose — the kill's own heavy pulse lands at 0
 * and the haptic throttle would swallow anything beside it.
 */
import type { OwnableFinisherId } from "@heroic/blood-in-the-sand-sim";
import type { HapticWeight } from "./haptics";

export interface FinisherCue {
  atMs: number;
  /** The `finisher` sound event's qualifier — bank `finisher_<sound>`. */
  sound?: string;
  /** The KILLER's hand only. "rigid" is the sharp tick (the crit's pulse). */
  haptic?: HapticWeight | "rigid";
}

export const FINISHER_CUES: Readonly<Record<OwnableFinisherId, readonly FinisherCue[]>> = {
  butterflies: [{ atMs: 0, sound: "butterflies" }],
  smite: [{ atMs: 0, sound: "smite" }],
  constellation: [
    { atMs: 40, sound: "constellation" }, // the stars ignite
    { atMs: 780, sound: "constellation_rise" }, // the flare, and up
    { atMs: 800, haptic: "light" },
  ],
  medusa: [
    { atMs: 0, sound: "medusa" }, // the snakes rear
    { atMs: 310, sound: "medusa_stone" }, // the turning
    { atMs: 330, haptic: "rigid" },
    { atMs: 1130, sound: "medusa_crumble" },
    { atMs: 1150, haptic: "medium" },
  ],
  talons: [
    { atMs: 0, sound: "talons" }, // the stoop
    { atMs: 230, sound: "talons_strike" }, // the hit, then the wingbeats away
    { atMs: 260, haptic: "medium" },
  ],
  scarabs: [
    { atMs: 0, sound: "scarabs" }, // the swarm
    { atMs: 450, haptic: "soft" }, // a buzz that ramps as the heap closes
    { atMs: 540, sound: "scarabs_feed" },
    { atMs: 560, haptic: "light" },
    { atMs: 670, haptic: "medium" },
  ],
  snuffed: [
    { atMs: 370, sound: "snuffed" }, // the pinch
    { atMs: 420, haptic: "soft" },
  ],
};

/** A cue this overdue is dropped — the moment it scored has gone. */
const LATE_MS = 300;

interface Running {
  cues: readonly FinisherCue[];
  next: number;
  bornMs: number;
  gain: number;
  mine: boolean;
}

export class FinisherCues {
  private readonly running: Running[] = [];

  /** A finisher spawned. `gain` is the kill's positional gain, held for the
   *  whole show (it's over in a second and a half); `mine` = the local
   *  player struck the blow, so the haptics are theirs. */
  start(id: OwnableFinisherId, nowMs: number, gain: number, mine: boolean): void {
    this.running.push({ cues: FINISHER_CUES[id], next: 0, bornMs: nowMs, gain, mine });
  }

  /** Once per rendered frame: fire whatever has come due. */
  update(
    nowMs: number,
    playSound: (sound: string, gain: number) => void,
    playHaptic: (haptic: HapticWeight | "rigid") => void,
  ): void {
    for (let i = this.running.length - 1; i >= 0; i--) {
      const r = this.running[i]!;
      const age = nowMs - r.bornMs;
      while (r.next < r.cues.length && r.cues[r.next]!.atMs <= age) {
        const cue = r.cues[r.next++]!;
        if (age - cue.atMs > LATE_MS) continue;
        if (cue.sound !== undefined) playSound(cue.sound, r.gain);
        if (cue.haptic !== undefined && r.mine) playHaptic(cue.haptic);
      }
      if (r.next >= r.cues.length) this.running.splice(i, 1);
    }
  }

  clear(): void {
    this.running.length = 0;
  }
}
