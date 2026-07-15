/**
 * The app's one voice: a process-wide AudioDirector (`@heroic/engine`, the
 * expo-audio voice pool) driven by a pure scheduler (`@heroic/core`). Screens
 * and the match loop both call `playSound` — a single director means UI taps and
 * combat share the voice pool and one volume/mute bus, and no screen has to own
 * audio lifecycle.
 *
 * Fire-and-forget: `playSound` is a no-op when the moment is throttled or its
 * clip isn't forged yet, so callers never branch on audio readiness. The
 * director is built lazily on first use (a menu that never makes a sound holds
 * zero native audio sessions), and the first build should ride a user gesture —
 * `unlockAudio()` on first tap covers the web/iOS "audio needs a gesture" rule.
 */
import { createAudioDirector, type AudioDirector } from "@heroic/engine";
import { createSoundScheduler, type SoundConfig, type SoundScheduler } from "@heroic/core";
import { AUDIO_MANIFEST } from "./manifest";
import { SOUND_CATALOGUE, type BitsSoundEvent } from "./catalogue";

export type { BitsSoundEvent } from "./catalogue";

let director: AudioDirector | null = null;
let scheduler: SoundScheduler<BitsSoundEvent> | null = null;
let muted = false;

interface Audio {
  director: AudioDirector;
  scheduler: SoundScheduler<BitsSoundEvent>;
}

const ensure = (): Audio => {
  if (director === null || scheduler === null) {
    director = createAudioDirector(AUDIO_MANIFEST);
    director.setMuted(muted);
    // Wall-clock throttle (like haptics); an rng independent of the sim so sound
    // choice never perturbs deterministic combat rolls.
    scheduler = createSoundScheduler<BitsSoundEvent>({
      catalogue: SOUND_CATALOGUE,
      now: () => Date.now(),
      rng: { next: () => Math.random() },
    });
  }
  return { director, scheduler };
};

/**
 * Play the sound for a gameplay/UI moment. `qualifier` picks a variant bank
 * (weapon id, ability id, win/loss). Safe to call anywhere, any time.
 */
export const playSound = (
  event: BitsSoundEvent,
  qualifier?: string,
  overrides?: SoundConfig,
): void => {
  const { director, scheduler } = ensure();
  const cmd = scheduler.play(event, qualifier, overrides);
  if (cmd) director.playSfx(cmd.clip, { volume: cmd.volume, pitchVariance: cmd.pitchVariance });
};

/**
 * Wake the audio session — call on the first user interaction (web/iOS won't
 * start audio without a gesture). Idempotent and cheap; builds the director if
 * it isn't up yet, so the gesture that unlocks is also what allocates.
 */
export const unlockAudio = (): void => {
  ensure().director.resume();
};

/** Mute/unmute everything. Persists across director rebuilds. */
export const setAudioMuted = (on: boolean): void => {
  muted = on;
  director?.setMuted(on);
};
