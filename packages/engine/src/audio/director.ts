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
 * SFX (`playSfx`) is the **Web Audio path** (react-native-audio-api): every
 * clip decodes ONCE into in-memory PCM (an `AudioBuffer`), and a play is a
 * tiny node graph — buffer source → gain → destination — software-mixed with
 * everything else on a dedicated native audio render thread. Dozens of
 * simultaneous one-shots are the design point, and the JS-side cost of a play
 * is a couple of object allocations. This replaced an expo-audio voice pool
 * (2026-07-19): a "voice" there was a full OS media player (ExoPlayer /
 * AVPlayer) — ~30 resident decoder pipelines whose per-play native traffic
 * and CPU appetite froze combat on weak Androids, and whose async state
 * machine was the source of every iOS silent-drop workaround this file used
 * to carry. `warm(names)` now just decodes clips ahead of time so a combat
 * moment never waits on a decode; a cold clip's first play still fires if its
 * decode lands within {@link LATE_PLAY_MS} (a first-ever UI tap), and every
 * decoded buffer stays resident for the app's lifetime.
 */
import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer,
  type AudioSource,
} from "expo-audio";
import {
  AudioContext,
  AudioManager,
  type AudioBuffer,
} from "react-native-audio-api";
import type { MusicSituation, ZoneAudio } from "@heroic/core";

/** Clip name → bundled source (`require("…/foo.mp3")`) or a uri. The app owns this. */
export type AudioManifest = Record<string, AudioSource>;

/** Seconds to crossfade when a zone doesn't specify its own. */
const DEFAULT_CROSSFADE = 2;
/** Below this gain a faded-out deck is paused so it stops decoding silence. */
const SILENT_EPSILON = 0.001;
/** Default cap on simultaneous one-shots. Mixing is cheap — this is a spam
 * guard against pathological bursts, not a resource budget; a real fight sits
 * far below it. */
const DEFAULT_SFX_VOICES = 32;
/**
 * Same-clip onsets closer than this are ONE sound to the ear — layering them
 * (three same-tick hits of the same weapon) just stacks into one louder,
 * phasier onset, so the repeats are dropped outright. Distinct clips always
 * layer; that's what a mixer is for.
 */
const RETRIGGER_FLOOR_MS = 50;
/**
 * A cold clip's play waits on its decode; if the decode lands within this
 * window the sound still fires — late enough to measure, not to hear (a
 * first-ever UI tap rides this). Past it the moment is gone: stay silent,
 * and the now-resident buffer makes every later play immediate.
 */
const LATE_PLAY_MS = 250;

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
  /** Stop all music: pause both decks and clear their fades, so nothing keeps
   *  looping silently. A later setZone/setSituation restarts the bed. */
  stopMusic(): void;

  /** Master / music / SFX volume, each 0..1. */
  setMasterVolume(v: number): void;
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  /** Silence everything without losing playback position. */
  setMuted(on: boolean): void;

  /** Advance crossfades by `dt` seconds. Call once per frame/step. */
  tick(dt: number): void;

  /** Fire a one-shot SFX by manifest name: a buffer-source + gain node pair
   * mixed on the audio render thread. Muted / zero-gain plays cost nothing. */
  playSfx(name: string, opts?: { volume?: number; pitchVariance?: number }): void;

  /**
   * Decode clips to resident PCM ahead of time so a combat moment never waits
   * on a decode. Decodes run off the JS thread, one clip in flight at a time;
   * call from a calm moment — a lobby, a loading screen. Idempotent and
   * fire-and-forget: already-decoded clips are skipped, unknown names ignored.
   * Buffers stay for the app's lifetime (in-memory PCM ≈ 350KB/s stereo — size
   * the warm set, not the pool).
   */
  warm(names: string[]): void;

  /** Re-activate audio and (re)start the active bed — app foreground, or web's first-gesture unlock. */
  resume(): void;
  /** Deactivate audio at the session level — call when the app backgrounds. */
  suspend(): void;

  /** Release the decks. */
  dispose(): void;
}

export interface AudioDirectorOptions {
  /** Cap on SIMULTANEOUS one-shots (a spam guard — surplus plays in a burst
   * are dropped). Default {@link DEFAULT_SFX_VOICES}. Unlike the old voice
   * pool this is not a residency budget: every warmed clip stays decoded
   * regardless, and concurrent plays just mix. */
  sfxVoices?: number;
}

export const createAudioDirector = (
  manifest: AudioManifest,
  options?: AudioDirectorOptions,
): AudioDirector => {
  const sfxVoices = options?.sfxVoices ?? DEFAULT_SFX_VOICES;

  /**
   * Every player keeps the iOS audio session active — THE iPhone stutter fix.
   * expo-audio's native `play()` runs `AVAudioSession.setActive(true)` — a
   * blocking IPC into the media daemon — synchronously on the JS thread, and
   * with the default `keepAudioSessionActive: false` every finished one-shot
   * schedules a session DEACTIVATION (~100ms later, whenever nothing else is
   * ringing). Game SFX come in bursts with quiet between, so the first sound
   * after any lull paid a full session re-negotiation (tens of ms, JS thread
   * stalled mid-frame) — felt as "the game hitches right on the cast". With
   * the session held active, the per-play setActive is a cheap no-op; app
   * backgrounding still silences properly via `suspend()`'s
   * `setIsAudioActiveAsync(false)`. Android has no session dance at all.
   */
  const PLAYER_OPTIONS = { keepAudioSessionActive: true } as const;

  // Flip iOS off its default session category (`ambient`/`soloAmbient`, which is
  // muted by the physical ring/silent switch) onto `playback`, so game audio is
  // heard even with the switch on — the norm for phones. Without this, an iPhone
  // on silent plays nothing while Android is unaffected. `mixWithOthers` keeps it
  // a polite sound-effects session that ducks alongside the user's own music
  // rather than seizing exclusive focus. Fire-and-forget; re-asserted on resume
  // because an interruption (call, Siri) can reset the category out from under us.
  const configureSession = (): void => {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers" }).catch(
      () => {},
    );
    // The Web Audio side (SFX) and the expo-audio decks share ONE iOS session;
    // both libraries configure it, so they must ask for the same thing —
    // playback category (audible on the ring/silent switch) that mixes politely
    // with the user's own audio — or the last one to touch it wins a fight.
    AudioManager.setAudioSessionOptions({
      iosCategory: "playback",
      iosMode: "default",
      iosOptions: ["mixWithOthers"],
    });
  };
  configureSession();

  const makeDeck = (): Deck => {
    const player = createAudioPlayer(null, PLAYER_OPTIONS);
    player.loop = true;
    return { player, clip: null, gain: 0, target: 0 };
  };
  const decks: [Deck, Deck] = [makeDeck(), makeDeck()];
  /** Index of the deck holding the bed that should be at full volume. */
  let activeIdx: 0 | 1 = 0;

  // ── SFX: the Web Audio engine ─────────────────────────────────────────────
  const sfxCtx = new AudioContext();
  /** Clip → decoded PCM, resident for the app's lifetime once decoded. */
  const buffers = new Map<string, AudioBuffer>();
  /** In-flight decodes, so concurrent requests for a clip share one decode. */
  const decoding = new Map<string, Promise<AudioBuffer | null>>();
  /** Expected end times (epoch ms) of live one-shots — the sfxVoices spam cap
   * reads this, pruned lazily per play. Derived from buffer duration ÷ rate
   * rather than counted via onEnded events, so a lost event can never wedge
   * the cap shut (the old pool needed MAX_BUSY_MS for exactly that). */
  const liveEnds: number[] = [];
  /** Last onset per clip — the same-clip double-fire floor. */
  const lastOnset = new Map<string, number>();
  /** warm()'s sequential decode chain — one clip in flight at a time. */
  let warmChain: Promise<void> = Promise.resolve();

  let beds: Partial<Record<MusicSituation, string>> = {};
  let crossfade = DEFAULT_CROSSFADE;
  let situation: MusicSituation = "idle";

  let master = 1;
  let music = 1;
  let sfx = 1;
  let muted = false;

  const resolve = (clip: string): AudioSource | undefined => manifest[clip];

  /**
   * Decode a clip to resident PCM, once; concurrent callers share the decode.
   * The manifest holds expo-audio `AudioSource` shapes — a `require()` module
   * number, a uri string, or `{ uri }` — and `decodeAudioData` takes the first
   * two directly. Decode failures resolve null (a silent clip, never a throw
   * on the play path) and are NOT cached, so a transient miss (dev-server
   * hiccup) retries on the next request.
   */
  const loadBuffer = (name: string): Promise<AudioBuffer | null> => {
    const ready = buffers.get(name);
    if (ready) return Promise.resolve(ready);
    const inFlight = decoding.get(name);
    if (inFlight) return inFlight;
    const source = resolve(name);
    const input =
      typeof source === "number" || typeof source === "string"
        ? source
        : (source && typeof source === "object" && source.uri) || null;
    if (input === null) return Promise.resolve(null);
    const p = sfxCtx
      .decodeAudioData(input)
      .then((buffer): AudioBuffer | null => {
        buffers.set(name, buffer);
        return buffer;
      })
      .catch((): null => null)
      .finally(() => decoding.delete(name));
    decoding.set(name, p);
    return p;
  };

  /** Fire a decoded buffer: source → gain → out, self-releasing on end. */
  const startSfx = (buffer: AudioBuffer, volume: number, rate: number): void => {
    liveEnds.push(Date.now() + (buffer.duration / rate) * 1000 + 100);
    const gain = sfxCtx.createGain();
    gain.gain.value = volume;
    const src = sfxCtx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(gain);
    gain.connect(sfxCtx.destination);
    src.onEnded = () => {
      src.disconnect();
      gain.disconnect();
    };
    src.start();
  };

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

    stopMusic() {
      for (const d of decks) {
        d.target = 0;
        d.gain = 0;
        if (d.player.playing) d.player.pause();
      }
      applyVolumes();
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
      if (resolve(name) === undefined) {
        console.warn(`[audio] no manifest entry for sfx "${name}"`);
        return;
      }
      // Silence is free: muted or fully-attenuated plays skip ALL audio work,
      // which also makes the mute toggle a true perf kill-switch on device.
      const volume = clamp01((muted ? 0 : master * sfx) * (opts?.volume ?? 1));
      if (volume <= 0) return;
      const now = Date.now();
      const last = lastOnset.get(name);
      if (last !== undefined && now - last < RETRIGGER_FLOOR_MS) return; // one onset
      lastOnset.set(name, now);
      for (let i = liveEnds.length - 1; i >= 0; i--) {
        if (liveEnds[i]! <= now) liveEnds.splice(i, 1);
      }
      if (liveEnds.length >= sfxVoices) return; // spam guard; real fights sit well below
      const rate = opts?.pitchVariance ? 1 + (Math.random() * 2 - 1) * opts.pitchVariance : 1;
      const ready = buffers.get(name);
      if (ready) {
        startSfx(ready, volume, rate);
        return;
      }
      // Cold clip: decode off-thread, and still fire if it lands inside the
      // LATE_PLAY_MS grace (first-ever UI taps); a combat moment never gets
      // here — its clips are warmed. Either way the buffer is now resident.
      void loadBuffer(name).then((buffer) => {
        if (buffer && Date.now() - now <= LATE_PLAY_MS) startSfx(buffer, volume, rate);
      });
    },

    warm(names) {
      warmChain = warmChain.then(async () => {
        for (const name of names) {
          if (resolve(name) !== undefined) await loadBuffer(name);
        }
      });
    },

    resume() {
      configureSession();
      setIsAudioActiveAsync(true).catch(() => {});
      void sfxCtx.resume().catch(() => {});
      const active = decks[activeIdx];
      if (active.clip && !active.player.playing) active.player.play();
    },
    suspend() {
      void sfxCtx.suspend().catch(() => {});
      setIsAudioActiveAsync(false).catch(() => {});
    },

    dispose() {
      for (const d of decks) d.player.remove();
      buffers.clear();
      lastOnset.clear();
      liveEnds.length = 0;
      void sfxCtx.close().catch(() => {});
    },
  };
};
