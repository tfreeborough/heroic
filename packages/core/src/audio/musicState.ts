/**
 * The music decider: which bed should be playing right now. Pure and
 * deterministic — the device-side mixer (`@heroic/engine`'s AudioDirector) is
 * told the result and crossfades to it; this just decides. Same shape as the AI
 * leash hysteresis (`ai/perception`): a boolean in, a debounced state out.
 *
 * Rule: any enemy engaged → combat; otherwise idle. Combat lingers for a
 * `hangover` after the last enemy disengages so the music doesn't snap back to
 * calm the instant a fight pauses (a kited enemy, the last kill). See
 * docs/design/audio.md.
 */
import type { MusicSituation } from "../zone/format";

/** How long combat music carries on after the last enemy disengages. Seconds. */
export const DEFAULT_COMBAT_HANGOVER = 4;

export interface MusicState {
  /** The bed that should be playing. */
  situation: MusicSituation;
  /** Seconds of combat music left after disengaging; 0 unless winding down. */
  hangover: number;
}

export const initMusicState = (): MusicState => ({ situation: "idle", hangover: 0 });

/**
 * Advance the music situation one step. `inCombat` is whether any enemy is
 * engaged this step. Mutates `state` and returns the active situation.
 */
export const stepMusicState = (
  state: MusicState,
  inCombat: boolean,
  dt: number,
  hangoverSecs = DEFAULT_COMBAT_HANGOVER,
): MusicSituation => {
  if (inCombat) {
    state.situation = "combat";
    state.hangover = hangoverSecs;
  } else if (state.situation === "combat") {
    state.hangover -= dt;
    if (state.hangover <= 0) {
      state.hangover = 0;
      state.situation = "idle";
    }
  }
  return state.situation;
};
