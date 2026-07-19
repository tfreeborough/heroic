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
 *
 * The catch in that lazy growth: a clip's FIRST play pays the native cost —
 * `createAudioPlayer` (a whole player instantiated) or `player.replace` (a
 * source load) — on the exact frame the game moment fires, which on a weak
 * device is a visible hitch right at an ability cast or the first clash.
 * `warm(names)` fixes it: call it from a calm moment (a lobby, a loading
 * screen) and the pool pre-loads those clips one per beat, marking their
 * voices *pinned* so ordinary churn (UI taps, stingers) prefers other voices
 * and the warm set stays resident. In combat those clips then always hit the
 * cheap `seekTo(0)` path.
 */
import {
  createAudioPlayer,
  setAudioModeAsync,
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
/** Default cap on simultaneous native SFX players (plus the two music decks).
 * Doubles as how many distinct clips can stay resident (loaded) at once — a game
 * with more clips than voices reloads the evicted ones cold, which reads as
 * trigger latency, so a clip-heavy game can raise this (see `sfxVoices`). */
const DEFAULT_SFX_VOICES = 8;
/**
 * A voice counts as busy this soon after firing even if `playing` hasn't
 * flipped yet — `play()` reports asynchronously, so two same-frame one-shots
 * would otherwise both grab the same voice.
 */
const VOICE_HOLD_MS = 250;
/**
 * Same-clip repeats closer than the hold don't hunt for another voice — they
 * REWIND the voice already holding the clip (cutting its tail), the classic
 * fast-retrigger. Routing them to a spare voice meant a `replace()` load per
 * repeat, and on iOS a cold voice's deferred start is exactly where fast
 * swing/hit repeats were vanishing. Below this floor the two onsets would
 * read as one sound anyway, so the repeat is dropped outright.
 */
const RETRIGGER_FLOOR_MS = 50;
/** ms between `warm()` loads — one native player prep per beat, so warming
 * never costs any single frame more than one load. A ~20-clip set warms in ~2s,
 * well inside a lobby wait. */
const WARM_STAGGER_MS = 90;
/**
 * Cap on native play-starts per ~frame. Every start is a batch of native
 * calls, and on iOS those dispatch through the main thread — a burst (a
 * teamfight's worth of hits in one tick) taxes the frame even with warm
 * voices. Beyond the cap, surplus sounds are dropped outright: in a burst
 * they're perceptually masked by the ones that did play.
 */
const MAX_STARTS_PER_WINDOW = 3;
const START_WINDOW_MS = 16;
/** Escape hatch: treat a voice as reusable this long after its fire even if
 * no status event ever cleared its `busy` mirror (the longest one-shots —
 * announcer lines — run ~2s). Keeps a lost event from leaking a voice. */
const MAX_BUSY_MS = 4_000;

/**
 * One reusable SFX player. `clip` is what's loaded, so same-clip replays skip
 * the reload.
 *
 * Everything the hot path needs to know about the player is MIRRORED here in
 * JS (`busy`, `loaded`, `atStart`), maintained by the status listener and the
 * fire path — because reading a property off the native player (`.playing`,
 * `.isLoaded`) is a synchronous hop into native, and on iOS that means the
 * main thread. A per-play selection scan that reads `.playing` across a warm
 * 26-voice pool is hundreds of sync native reads a second in a busy fight —
 * a steady frame tax. With the mirrors, selection is pure JS.
 */
interface Voice {
  player: AudioPlayer;
  clip: string;
  /** Wall-clock ms of the last fire — the steal heuristic takes the stalest. */
  firedAt: number;
  /** Pre-warmed via `warm()`: churn loads prefer unpinned voices so this clip
   * stays resident. Softly held, not reserved — evicted (and unpinned) only
   * when every unpinned voice is busy. */
  pinned: boolean;
  /** Playhead known to sit at 0 (a freshly loaded item), so the first fire
   * can skip its `seekTo(0)`. One-way: false from the first fire until the
   * next load. (An earlier version re-armed idle voices to 0 from the status
   * listener to skip ALL hot-path seeks — reverted: a transient `!playing`
   * status could rewind a LIVE sound, which reads as a double-fire.) */
  atStart: boolean;
  /** JS mirror of "this one-shot is still ringing" — set at fire, cleared by
   * the status listener's didJustFinish (plus the MAX_BUSY_MS escape hatch
   * in `free`, in case events ever go missing). */
  busy: boolean;
  /** JS mirror of the player's isLoaded, set by the status listener. */
  loaded: boolean;
  /** The status listener's subscription, removed on dispose. */
  sub: { remove(): void };
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

  /** Fire a one-shot SFX by manifest name. Designed-but-unused until the SFX pass. */
  playSfx(name: string, opts?: { volume?: number; pitchVariance?: number }): void;

  /**
   * Pre-load clips onto pinned voices so their first real play is a rewind, not
   * a native load (the load IS the frame hitch on weak devices). Staggered one
   * clip per {@link WARM_STAGGER_MS}; call from a calm moment — a lobby, not
   * mid-combat. Idempotent and fire-and-forget: already-warm clips are skipped,
   * unknown names ignored, and clips past the pool cap are simply left cold.
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
  /** Max concurrent SFX voices AND how many clips stay resident before cold
   * reloads begin. Default {@link DEFAULT_SFX_VOICES}. Raise it past the count of
   * frequently-triggered clips to keep them all warm (bounded, so still safe on
   * Android's session limit — this is a fixed pool, not per-play allocation). */
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
  /** The SFX voice pool — grows lazily to SFX_VOICES, then steals. */
  const voices: Voice[] = [];
  /** Clips still waiting for a staggered warm load. */
  const warmQueue: string[] = [];
  let warmTimer: ReturnType<typeof setTimeout> | null = null;

  /** Native play-start budget: window origin + starts used within it. */
  let startWindowAt = 0;
  let startsInWindow = 0;

  let beds: Partial<Record<MusicSituation, string>> = {};
  let crossfade = DEFAULT_CROSSFADE;
  let situation: MusicSituation = "idle";

  let master = 1;
  let music = 1;
  let sfx = 1;
  let muted = false;

  const resolve = (clip: string): AudioSource | undefined => manifest[clip];

  /**
   * Start a voice — but wait for its source to be ready first. iOS's
   * `playImmediately` (what expo-audio's `play()` runs) SILENTLY DROPS a play
   * issued before the AVPlayerItem is `.readyToPlay`, so a voice we just
   * `replace()`d onto a new clip or freshly created hasn't loaded yet and stays
   * silent — this is why one-shots vanish intermittently (a tap dropped mid-swipe
   * as fast repeats keep landing on cold, just-swapped voices). A voice already
   * holding its clip is loaded and fires this frame; a cold one fires on its next
   * status update, ~a frame later (imperceptible; assets are preloaded). `token`
   * is the play's `firedAt` — if the voice gets stolen for a newer sound before a
   * deferred start runs, the token no longer matches and the stale start is
   * dropped (the newer play owns the voice and schedules its own start).
   *
   * `rewind` (a reused voice whose playhead isn't at 0) is the OTHER iOS silent
   * drop: `seekTo(0)` is async, and a `play()` issued while the seek is still in
   * flight runs at the OLD playhead — for a just-finished one-shot that's the end
   * of the clip, which AVPlayer treats as already-done and plays nothing. Android
   * queues the two in order, which is why only iPhones lost repeats (the
   * countdown thud every ~1s rode this exact path). So the seek must COMPLETE
   * before the play is issued; on a local, already-loaded asset that's ~ms.
   */
  const fire = (voice: Voice, token: number, volume: number, rate: number, rewind: boolean): void => {
    const start = (): void => {
      if (voice.firedAt !== token) return; // stolen for a newer play — that one fires instead
      voice.player.volume = volume;
      // Always set the rate — voices are reused, so a previous play's variance
      // would otherwise stick to the next sound. (An earlier version skipped
      // "unchanged" volume/rate via JS mirrors — reverted: whether a replace()
      // resets native player state is expo-audio-internal, and a wrong guess
      // means wrong-volume or wrong-pitch sounds.)
      voice.player.setPlaybackRate(rate);
      // play() can throw from inside native session activation (a phone call,
      // Siri) — a dropped sound, never a crashed frame.
      try {
        voice.player.play();
      } catch {
        voice.busy = false;
      }
    };
    const begin = (): void => {
      if (voice.firedAt !== token) return;
      // Play even if the seek failed: worst case is the old (dropped-sound)
      // behaviour, never worse.
      if (rewind) voice.player.seekTo(0).then(start, start);
      else start();
    };
    // The JS mirror answers without touching native; fall back to ONE native
    // read only while a cold voice hasn't reported loaded yet.
    if (voice.loaded || voice.player.isLoaded) {
      voice.loaded = true;
      begin();
      return;
    }
    const sub = voice.player.addListener("playbackStatusUpdate", (status) => {
      if (!status.isLoaded) return;
      voice.loaded = true;
      sub.remove();
      begin();
    });
  };

  /**
   * Create a pool voice. Its persistent status listener maintains the JS
   * mirrors so the hot path never reads a native property. Deliberately
   * minimal after a correctness scare: only the unambiguous `didJustFinish`
   * frees a voice (a transient `!playing` — buffering, a deferred start still
   * pending — must not), and the listener never touches the playhead (a seek
   * under a live sound reads as a double-fire). Note most combat clips are
   * SHORTER than VOICE_HOLD_MS, so their finish lands inside the hold window
   * — busy must clear regardless of fire recency, or every short clip's voice
   * locks out until the MAX_BUSY_MS hatch.
   */
  const makeVoice = (source: AudioSource, clip: string, pinned: boolean): Voice => {
    const voice: Voice = {
      player: createAudioPlayer(source, PLAYER_OPTIONS),
      clip,
      firedAt: 0,
      pinned,
      atStart: true,
      busy: false,
      loaded: false,
      sub: { remove: () => {} },
    };
    voice.sub = voice.player.addListener("playbackStatusUpdate", (status) => {
      if (status.isLoaded) voice.loaded = true;
      if (status.didJustFinish) voice.busy = false;
    });
    return voice;
  };

  /** One warm beat: load (or just pin) the next queued clip, then re-arm. */
  const warmStep = (): void => {
    warmTimer = null;
    const name = warmQueue.shift();
    if (name !== undefined) {
      const source = resolve(name);
      const resident = voices.find((v) => v.clip === name);
      if (resident) {
        resident.pinned = true; // already loaded — just protect it from churn
      } else if (source !== undefined && voices.length < sfxVoices) {
        voices.push(makeVoice(source, name, true));
      }
      // Unknown name or pool full: drop it — playSfx handles it cold as before.
    }
    if (warmQueue.length > 0) warmTimer = setTimeout(warmStep, WARM_STAGGER_MS);
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
      const source = resolve(name);
      if (source === undefined) {
        console.warn(`[audio] no manifest entry for sfx "${name}"`);
        return;
      }
      const now = Date.now();
      // Per-frame start budget — drop surplus burst sounds before any native work.
      if (now - startWindowAt > START_WINDOW_MS) {
        startWindowAt = now;
        startsInWindow = 0;
      }
      if (startsInWindow >= MAX_STARTS_PER_WINDOW) return;
      startsInWindow += 1;
      // Pure-JS freeness — the busy mirror, never a native `.playing` read
      // (that's a sync main-thread hop on iOS, and this runs across the whole
      // pool per play). MAX_BUSY_MS is the lost-event escape hatch.
      const free = (v: Voice): boolean =>
        now - v.firedAt > VOICE_HOLD_MS && (!v.busy || now - v.firedAt > MAX_BUSY_MS);
      /** Point a voice at a different clip; the new source must load again. */
      const load = (v: Voice): void => {
        v.player.replace(source);
        v.clip = name;
        v.loaded = false;
        v.atStart = true; // a fresh item starts at 0
      };
      // Best → worst: a free voice already holding this clip (re-armed at 0 or
      // a cheap rewind — no reload); the SAME voice mid-ring for a fast repeat
      // (rewind-retrigger, see RETRIGGER_FLOOR_MS — cuts the tail, never
      // reloads); a free UNPINNED voice (load onto it — pinned warm clips stay
      // resident); grow the pool while under the cap (lazily, so a menu screen
      // isn't holding eight native sessions); evict a free pinned voice (better
      // than cutting a still-ringing one-shot); steal the stalest voice
      // outright. `rewind` = the playhead isn't at 0, so fire() must complete a
      // seek before playing (the iOS ordering rule on fire's doc).
      let rewind = false;
      let voice = voices.find((v) => v.clip === name && free(v));
      if (voice) {
        rewind = !voice.atStart;
      } else if ((voice = voices.find((v) => v.clip === name))) {
        if (now - voice.firedAt <= RETRIGGER_FLOOR_MS) return; // one onset, already playing
        rewind = !voice.atStart;
      } else if ((voice = voices.find((v) => free(v) && !v.pinned))) {
        load(voice);
      } else if (voices.length < sfxVoices) {
        voice = makeVoice(source, name, false);
        voices.push(voice);
      } else if ((voice = voices.find(free))) {
        voice.pinned = false;
        load(voice);
      } else {
        voice = voices.reduce((a, b) => (a.firedAt <= b.firedAt ? a : b));
        voice.pinned = false;
        load(voice);
      }
      voice.firedAt = now;
      voice.busy = true;
      voice.atStart = false; // it's about to play (or about to rewind to 0)
      const volume = clamp01((muted ? 0 : master * sfx) * (opts?.volume ?? 1));
      const rate = opts?.pitchVariance ? 1 + (Math.random() * 2 - 1) * opts.pitchVariance : 1;
      fire(voice, now, volume, rate, rewind);
    },

    warm(names) {
      for (const name of names) {
        if (!warmQueue.includes(name)) warmQueue.push(name);
      }
      if (warmTimer === null && warmQueue.length > 0) warmTimer = setTimeout(warmStep, 0);
    },

    resume() {
      configureSession();
      setIsAudioActiveAsync(true).catch(() => {});
      const active = decks[activeIdx];
      if (active.clip && !active.player.playing) active.player.play();
    },
    suspend() {
      setIsAudioActiveAsync(false).catch(() => {});
    },

    dispose() {
      if (warmTimer !== null) clearTimeout(warmTimer);
      warmTimer = null;
      warmQueue.length = 0;
      for (const d of decks) d.player.remove();
      for (const v of voices) {
        v.sub.remove();
        v.player.remove();
      }
      voices.length = 0;
    },
  };
};
