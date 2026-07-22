/**
 * The app's one voice: a process-wide AudioDirector (`@heroic/engine` — Web
 * Audio SFX mixing + expo-audio music decks) driven by a pure scheduler
 * (`@heroic/core`). Screens
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
import {
  announcerPackClips,
  expandAnnouncerClips,
  resolveAnnouncerClip,
  setActiveAnnouncer,
  type AnnouncerPackId,
} from "./announcer";

export type { BitsSoundEvent } from "./catalogue";
export { ANNOUNCER_PACK_IDS, asAnnouncerPack, getActiveAnnouncer, type AnnouncerPackId } from "./announcer";

/** Cap on SIMULTANEOUS one-shots (the Web Audio engine mixes them all; this
 * is a spam guard, not a residency budget — warmed clips stay decoded
 * regardless). A full 4v4 teamfight peaks well under this. */
const SFX_VOICES = 32;

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
  // Announcer lines remap to the active PACK's manifest entry (announcer.ts);
  // every other clip name passes through unchanged.
  if (cmd) director.playSfx(resolveAnnouncerClip(cmd.clip), { volume: cmd.volume * gain, pitchVariance: cmd.pitchVariance });
};

/**
 * A kill announcement in a SPECIFIC pack's voice — the networked flex
 * (monetisation.md): GameScreen passes the KILLER's pack (from roomState), so
 * everyone hears the scorer's announcer, not their own. Rides the normal
 * scheduler (throttles/volume), only the pack remap is pinned. The local
 * active pack still covers non-attributed plays (the dev menu's preview).
 */
export const playAnnouncement = (
  event: "firstBlood" | "multiKill",
  pack: AnnouncerPackId,
  qualifier?: string,
): void => {
  if (devFlags.disableSfx) return;
  const { director, scheduler } = ensure();
  const cmd = scheduler.play(event, qualifier);
  if (cmd) director.playSfx(resolveAnnouncerClip(cmd.clip, pack), { volume: cmd.volume });
};

/**
 * Switch the announcer voice (dev menu today, the store later). Sets the
 * remap target for every future announcer play and — if the director is
 * already up — warms the new pack's clips so a kill right after switching
 * doesn't cold-decode. Deliberately does NOT build the director: on a cold
 * launch this runs before any user gesture (App.tsx applying the persisted
 * pick), and the first build must ride a gesture; warmCombatAudio covers
 * pre-match warming in that case.
 */
export const setAnnouncerPack = (pack: AnnouncerPackId): void => {
  setActiveAnnouncer(pack);
  if (devFlags.disableSfx) return;
  director?.warm(announcerPackClips(pack));
};

/**
 * The events that can fire MID-FIGHT — every clip they can resolve to is
 * decoded to resident PCM before the first clash, so no combat moment ever
 * waits on (or drops to) a decode. Warming = RAM now, not native players, so
 * the old pool-pressure exclusions (crowd, announcer) are gone: kills are
 * exactly when those fire, and they were the last cold loads mid-combat.
 * Match-flow stings (roundEnd/matchEnd, UI taps) stay lazy — they play at calm
 * phase boundaries and self-warm on first use. Derived from the catalogue, so
 * a newly forged weapon/ability clip warms itself.
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
  "crowdCheer",
  "crowdJeer",
  "firstBlood",
  "multiKill",
  "countdownTick",
  "roundStart",
  "fightStart",
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
  // The catalogue names announcer lines by their stable names; expand them to
  // EVERY pack's entries — in a match any seat's voice can boom on a kill.
  ensure().director.warm(expandAnnouncerClips([...names]));
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

/**
 * The constant pit-crowd AMBIENCE bed — a looping murmur on the music deck,
 * UNDER the one-shot crowd-cheer SFX (separate channels, they layer). Rides the
 * director's crossfade decks (proven in the gauntlet); BITS runs the director as
 * a singleton with no per-frame music tick, so we snap the deck's fade-in gain
 * to full once (`tick(9999)`) and drive the AUDIBLE fade on the music BUS via a
 * small self-contained ramp — no game-loop coupling. Silent until the
 * `crowd_ambience` clip is forged (crossfadeTo warns once, then nothing plays).
 */
const AMBIENCE_BED = "crowd_ambience_1";
const AMBIENCE_VOLUME = 0.28; // under combat SFX; tune on device
const AMBIENCE_FADE_MS = 900;
let ambienceTimer: ReturnType<typeof setInterval> | null = null;
let musicLevel = 0; // our own mirror of the music-bus level (no getter on the director)

/** Ramp the music bus from its current level to `to` over AMBIENCE_FADE_MS; when
 *  fading to silence, pause the decks after so nothing loops inaudibly. */
const fadeMusic = (d: AudioDirector, to: number, stopAtEnd: boolean): void => {
  if (ambienceTimer) clearInterval(ambienceTimer);
  const from = musicLevel;
  const start = Date.now();
  ambienceTimer = setInterval(() => {
    const t = Math.min(1, (Date.now() - start) / AMBIENCE_FADE_MS);
    musicLevel = from + (to - from) * t;
    d.setMusicVolume(musicLevel);
    if (t >= 1) {
      clearInterval(ambienceTimer!);
      ambienceTimer = null;
      if (stopAtEnd) d.stopMusic();
    }
  }, 33);
};

/** Start the looping crowd bed — call on entering the arena (GameScreen mount). */
export const startCrowdAmbience = (): void => {
  if (devFlags.disableSfx) return; // dev A/B: no audio work at all
  const { director } = ensure();
  director.setMusicVolume(0);
  musicLevel = 0;
  director.setZone({ beds: { idle: AMBIENCE_BED, combat: AMBIENCE_BED } });
  director.tick(9999); // snap the crossfade gain to full; the audible fade rides the bus
  fadeMusic(director, AMBIENCE_VOLUME, false);
};

/** Fade out and stop the crowd bed — call on leaving the arena (GameScreen unmount). */
export const stopCrowdAmbience = (): void => {
  if (!director) return;
  fadeMusic(director, 0, true);
};
