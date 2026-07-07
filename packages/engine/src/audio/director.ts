/**
 * AudioDirector — the device-side mixer. Lives here in `@heroic/engine` because,
 * like `useGameLoop` and the physics binding, it's the layer that's allowed to
 * touch the runtime (here: `expo-audio`). Pure `@heroic/core` decides *what*
 * should play (the music situation — see `audio/musicState`); this plays it.
 *
 * Music model: **crossfade between named beds** (see docs/design/audio.md). A
 * zone supplies a clip per situation (`idle`, `combat`); the director keeps two
 * looping "decks" and, when the active situation's bed changes, fades the
 * outgoing deck down while fading the incoming one up. A situation the zone has
 * no bed for keeps the current bed playing (so an idle-only zone just stays on
 * idle through a fight until a combat bed exists).
 *
 * `expo-audio` has no built-in fade, so we ramp `player.volume` ourselves every
 * `tick(dt)` — call it once per frame (or step) with elapsed seconds.
 *
 * SFX (`playSfx`) plays one-shots through a fixed **voice pool**: a small set of
 * reusable players, growing lazily to a hard cap, stealing the oldest voice when
 * all are busy (classic game-audio voice stealing). A player per play sounds
 * simpler but exhausts Android's native audio sessions at gameplay rates
 * (footsteps every ~300ms + strikes + hurts) — "Null pointer error creating
 * session" — and leaks any player whose finish-callback never fires.
 */
import {
  createAudioPlayer,
  setIsAudioActiveAsync,
  type AudioPlayer,
  type AudioSource,
} from "expo-audio";
import type { MusicSituation, ZoneAudio } from "@heroic/core";

/** Clip name → bundled source (`require("…/foo.mp3")`) or a uri. The app owns this. */
export type AudioManifest = Record<string, AudioSource>;

/** Seconds to crossfade when a zone doesn't specify its own. */
const DEFAULT_CROSSFADE = 2;
/** Below this gain a faded-out deck is paused so it stops decoding silence. */
const SILENT_EPSILON = 0.001;
/** Hard cap on simultaneous native SFX players (plus the two music decks). */
const SFX_VOICES = 8;
/**
 * A voice counts as busy this soon after firing even if `playing` hasn't
 * flipped yet — `play()` reports asynchronously, so two same-frame one-shots
 * would otherwise both grab the same voice.
 */
const VOICE_HOLD_MS = 250;

/** One reusable SFX player. `clip` is what's loaded, so same-clip replays skip the reload. */
interface Voice {
  player: AudioPlayer;
  clip: string;
  /** Wall-clock ms of the last fire — the steal heuristic takes the stalest. */
  firedAt: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One of the two crossfade decks: a reusable looping player plus its fade state. */
interface Deck {
  player: AudioPlayer;
  /** Manifest clip currently loaded on this deck, or null if never loaded. */
  clip: string | null;
  /** Current fade gain, 0..1. */
  gain: number;
  /** Where `gain` is heading, 0..1. */
  target: number;
}

export interface AudioDirector {
  /** Point the director at a zone's beds. Call on zone load. Starts the current situation's bed. */
  setZone(audio: ZoneAudio | undefined): void;
  /** Set the active music situation (from the core decider). Crossfades if its bed changed. */
  setSituation(situation: MusicSituation): void;

  /** Master / music / SFX volume, each 0..1. */
  setMasterVolume(v: number): void;
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  /** Silence everything without losing playback position. */
  setMuted(on: boolean): void;

  /** Advance crossfades by `dt` seconds. Call once per frame/step. */
  tick(dt: number): void;

  /** Fire a one-shot SFX by manifest name. Designed-but-unused until the SFX pass. */
  playSfx(name: string, opts?: { volume?: number; pitchVariance?: number }): void;

  /** Re-activate audio and (re)start the active bed — app foreground, or web's first-gesture unlock. */
  resume(): void;
  /** Deactivate audio at the session level — call when the app backgrounds. */
  suspend(): void;

  /** Release the decks. */
  dispose(): void;
}

export const createAudioDirector = (manifest: AudioManifest): AudioDirector => {
  const makeDeck = (): Deck => {
    const player = createAudioPlayer(null);
    player.loop = true;
    return { player, clip: null, gain: 0, target: 0 };
  };
  const decks: [Deck, Deck] = [makeDeck(), makeDeck()];
  /** Index of the deck holding the bed that should be at full volume. */
  let activeIdx: 0 | 1 = 0;
  /** The SFX voice pool — grows lazily to SFX_VOICES, then steals. */
  const voices: Voice[] = [];

  let beds: Partial<Record<MusicSituation, string>> = {};
  let crossfade = DEFAULT_CROSSFADE;
  let situation: MusicSituation = "idle";

  let master = 1;
  let music = 1;
  let sfx = 1;
  let muted = false;

  const resolve = (clip: string): AudioSource | undefined => manifest[clip];

  /** Recompute every deck's real volume from master · music · mute · its fade gain. */
  const applyVolumes = (): void => {
    const level = muted ? 0 : master * music;
    for (const d of decks) d.player.volume = clamp01(level * d.gain);
  };

  /** Begin a crossfade onto `clip`, reusing the off-deck (no restart if it already holds it). */
  const crossfadeTo = (clip: string): void => {
    const source = resolve(clip);
    if (source === undefined) {
      console.warn(`[audio] no manifest entry for bed "${clip}"`);
      return;
    }
    const toIdx: 0 | 1 = activeIdx === 0 ? 1 : 0;
    const to = decks[toIdx];
    if (to.clip !== clip) {
      to.player.replace(source);
      to.player.loop = true;
      to.clip = clip;
    }
    if (!to.player.playing) to.player.play();
    to.target = 1;
    decks[activeIdx].target = 0;
    activeIdx = toIdx;
    applyVolumes();
  };

  /** Ensure the deck reflects the current situation's bed. Missing bed → keep current. */
  const apply = (): void => {
    const clip = beds[situation];
    if (!clip) return; // no bed for this situation — leave whatever's playing
    const active = decks[activeIdx];
    if (active.clip === clip && active.target === 1) return; // already on it
    crossfadeTo(clip);
  };

  return {
    setZone(audio) {
      beds = audio?.beds ?? {};
      crossfade = audio?.crossfade ?? DEFAULT_CROSSFADE;
      apply();
    },

    setSituation(next) {
      situation = next;
      apply();
    },

    setMasterVolume(v) {
      master = clamp01(v);
      applyVolumes();
    },
    setMusicVolume(v) {
      music = clamp01(v);
      applyVolumes();
    },
    setSfxVolume(v) {
      sfx = clamp01(v);
    },
    setMuted(on) {
      muted = on;
      applyVolumes();
    },

    tick(dt) {
      const rate = crossfade > 0 ? dt / crossfade : 1;
      let changed = false;
      for (const d of decks) {
        if (d.gain === d.target) continue;
        const delta = Math.max(-rate, Math.min(rate, d.target - d.gain));
        d.gain = clamp01(d.gain + delta);
        changed = true;
        // Once fully faded out, pause so the deck isn't decoding inaudible audio.
        if (d.target === 0 && d.gain <= SILENT_EPSILON && d.player.playing) d.player.pause();
      }
      if (changed) applyVolumes();
    },

    playSfx(name, opts) {
      const source = resolve(name);
      if (source === undefined) {
        console.warn(`[audio] no manifest entry for sfx "${name}"`);
        return;
      }
      const now = Date.now();
      const free = (v: Voice): boolean => now - v.firedAt > VOICE_HOLD_MS && !v.player.playing;
      // Best → worst: a free voice already holding this clip (rewind, no reload);
      // any free voice (load the clip onto it); grow the pool while under the cap
      // (lazily, so a menu screen isn't holding eight native sessions); steal the
      // stalest voice, cutting the oldest still-ringing one-shot.
      let voice = voices.find((v) => v.clip === name && free(v));
      if (voice) {
        void voice.player.seekTo(0);
      } else if ((voice = voices.find(free))) {
        voice.player.replace(source);
        voice.clip = name;
      } else if (voices.length < SFX_VOICES) {
        voice = { player: createAudioPlayer(source), clip: name, firedAt: 0 };
        voices.push(voice);
      } else {
        voice = voices.reduce((a, b) => (a.firedAt <= b.firedAt ? a : b));
        if (voice.clip === name) {
          void voice.player.seekTo(0);
        } else {
          voice.player.replace(source);
          voice.clip = name;
        }
      }
      voice.firedAt = now;
      voice.player.volume = clamp01((muted ? 0 : master * sfx) * (opts?.volume ?? 1));
      // Always set the rate — voices are reused, so a previous play's variance
      // would otherwise stick to the next sound.
      voice.player.setPlaybackRate(
        opts?.pitchVariance ? 1 + (Math.random() * 2 - 1) * opts.pitchVariance : 1,
      );
      voice.player.play();
    },

    resume() {
      setIsAudioActiveAsync(true).catch(() => {});
      const active = decks[activeIdx];
      if (active.clip && !active.player.playing) active.player.play();
    },
    suspend() {
      setIsAudioActiveAsync(false).catch(() => {});
    },

    dispose() {
      for (const d of decks) d.player.remove();
      for (const v of voices) v.player.remove();
      voices.length = 0;
    },
  };
};
