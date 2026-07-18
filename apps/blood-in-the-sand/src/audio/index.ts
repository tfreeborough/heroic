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
import { Asset } from "expo-asset";
import { createAudioDirector, type AudioDirector } from "@heroic/engine";
import { createSoundScheduler, type SoundConfig, type SoundScheduler } from "@heroic/core";
import { devFlags } from "../dev";
import { AUDIO_MANIFEST } from "./manifest";
import { SOUND_CATALOGUE, type BitsSoundEvent } from "./catalogue";

export type { BitsSoundEvent } from "./catalogue";

/** Voices ≈ how many clips stay warm at once. Sized to hold the whole
 * mid-combat set (~24 clips: every cast, hit, fire, death, hurt, the quake
 * bed — see `warmCombatAudio`) on pinned voices with a few unpinned left
 * over for UI/flow/announcer churn. A cold clip's first play is a native
 * load — a visible frame hitch on weak devices — so combat clips must never
 * be the ones reloading. Still a fixed pool, so Android-safe; if a low-end
 * device ever objects to this many resident players, shrink the warm SET
 * first. */
const SFX_VOICES = 28;

let director: AudioDirector | null = null;
let scheduler: SoundScheduler<BitsSoundEvent> | null = null;
let muted = false;
let preloadStarted = false;

interface Audio {
  director: AudioDirector;
  scheduler: SoundScheduler<BitsSoundEvent>;
}

/**
 * Warm every clip up front so none loads cold on its first trigger — the cause
 * of the "sound plays a beat late" feel. It matters most in dev, where a
 * `require()`d asset is served by Metro over HTTP and otherwise fetched on the
 * FIRST play; this pulls them all into the local cache once, so playback only
 * ever hits an already-local file. Fire-and-forget; runs once.
 */
const preloadClips = (): void => {
  if (preloadStarted) return;
  preloadStarted = true;
  // Bundled `require()` sources are module numbers — the shape Asset.loadAsync wants.
  const sources = Object.values(AUDIO_MANIFEST).filter((s): s is number => typeof s === "number");
  Asset.loadAsync(sources).catch(() => {
    preloadStarted = false; // let a later call retry if the warm failed
  });
};

const ensure = (): Audio => {
  if (director === null || scheduler === null) {
    director = createAudioDirector(AUDIO_MANIFEST, { sfxVoices: SFX_VOICES });
    director.setMuted(muted);
    preloadClips();
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
 * (weapon id, ability id, win/loss). `gain` (0..1) scales the resolved volume —
 * the caller passes a distance-based factor for positional sounds, leaving the
 * per-bank catalogue volume intact (1 = unattenuated). Safe to call anywhere.
 */
export const playSound = (
  event: BitsSoundEvent,
  qualifier?: string,
  overrides?: SoundConfig,
  gain = 1,
): void => {
  // Dev A/B (not a mute): skip ALL per-play work incl. the native calls, so a
  // choppy device can answer "is it the audio?" with one dev-menu toggle.
  if (devFlags.disableSfx) return;
  const { director, scheduler } = ensure();
  const cmd = scheduler.play(event, qualifier, overrides);
  if (cmd) director.playSfx(cmd.clip, { volume: cmd.volume * gain, pitchVariance: cmd.pitchVariance });
};

/**
 * The events that can fire MID-FIGHT — every clip they can resolve to must be
 * warm before the first clash, because a cold clip's first play is a native
 * player load on the exact frame the moment fires (the "screen freezes when an
 * ability goes off" bug). Match-flow stings and UI stay cold: they play at
 * calm phase boundaries where a one-off load can't stutter combat. Derived
 * from the catalogue, so a newly forged weapon/ability clip warms itself.
 */
const COMBAT_EVENTS: BitsSoundEvent[] = [
  "weaponFire",
  "weaponStrike",
  "hitTaken",
  "death",
  "abilityCast",
  "abilityDetonate",
  "harpoonWhip",
  "quakeRumble",
  "heal",
];

/**
 * Pre-load the mid-combat clip set onto the director's pinned voices. Call
 * from a calm pre-match moment — the room lobby / arming wizard — and call
 * freely: it's idempotent, staggered (one native load per ~90ms), and skips
 * anything already warm.
 */
export const warmCombatAudio = (): void => {
  // Under the dev SFX kill, skip the warm too — otherwise the A/B still
  // builds the whole native player pool and only silences the plays.
  if (devFlags.disableSfx) return;
  const names = new Set<string>();
  for (const event of COMBAT_EVENTS) {
    const def = SOUND_CATALOGUE[event];
    if (!def) continue;
    for (const clip of def.clips ?? []) names.add(clip);
    for (const bank of Object.values(def.variants ?? {})) {
      for (const clip of bank.clips) names.add(clip);
    }
  }
  ensure().director.warm([...names]);
};

/**
 * Wake the audio session — call on the first user interaction (web/iOS won't
 * start audio without a gesture). Idempotent and cheap; builds the director if
 * it isn't up yet, so the gesture that unlocks is also what allocates.
 */
export const unlockAudio = (): void => {
  if (devFlags.disableSfx) return; // dev A/B: no director, no native session
  ensure().director.resume();
};

/** Mute/unmute everything. Persists across director rebuilds. */
export const setAudioMuted = (on: boolean): void => {
  muted = on;
  director?.setMuted(on);
};
