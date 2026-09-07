/**
 * Battle music — the arena score (docs/design/bits-music.md, v3).
 *
 * The score belongs to the MATCH, not the round. The first fight opens with a
 * few seconds of crowd and steel, then a song creeps in and keeps playing
 * through every round: DUCKED under the end plate and the next countdown,
 * back up at FIGHT. When a song runs out the next one from the match's
 * shuffled deck starts (its quiet opening is the breath). Match end fades
 * the score out; the next match deals afresh. (v2 dealt one song per round
 * and cut it on every plate — rounds are too short for a song to ever get
 * into its swing.)
 *
 * Own expo-audio player rather than the AudioDirector's decks — those carry
 * the looping crowd-ambience bed, and the score fades independently under it.
 * Fades ride a small interval — no game-loop coupling, like the ambience ramp
 * in `index.ts`.
 *
 * Driven by `syncRoundMusic`, called per frame with the round snapshot:
 * idempotent, so a mid-match rejoin (no roundStart event ever seen) still
 * deals a deck and brings the score in. Every path is a no-op when the pool
 * is empty.
 */
import { createAudioPlayer, type AudioPlayer, type AudioSource } from "expo-audio";
import type { RoundPhase } from "@heroic/blood-in-the-sand-sim";
import { loadMusicEnabled } from "../settings";

/** Song → bundled track: every `<song>.mp3` in assets/audio/music, via the
 * generated manifest (`bun run sfx:manifest` in apps/realmsmith after dropping
 * files in). The pool is the keys. */
export { MUSIC_MANIFEST } from "./musicManifest.generated";
import { MUSIC_MANIFEST } from "./musicManifest.generated";

/** Music level under the combat SFX, over the 0.18 crowd bed. Tune on device. */
const MUSIC_VOLUME = 0.55;
/** The score's level under the end plate + countdown (× MUSIC_VOLUME): low
 * enough that the round stinger and the 3·2·1 ticks sit clearly above it. */
const DUCK_LEVEL = 0.35;
/** Seconds of ACTIVE time in the match's FIRST fight before the score enters
 * (a breath of crowd and steel, then the song creeps in). */
const MUSIC_ENTRY_S = 4;
/** Slow fade-in at entry (ms) — the song should creep in, not arrive. */
const ENTRY_FADE_MS = 3000;
/** Duck down on the end plate / back up at FIGHT (ms). */
const DUCK_FADE_MS = 600;
const RESTORE_FADE_MS = 800;
/** A song ran out mid-match: the next one fades in from its top (ms). */
const NEXT_SONG_FADE_MS = 1000;
/** Fade to silence on the match-end plate (ms). */
const MATCH_END_FADE_MS = 1500;
/** Fade to silence on the way out of the arena / the Settings toggle (ms). */
const LEAVE_FADE_MS = 800;
const FADE_TICK_MS = 33;
/** Below this gain a fading-out player is paused so it stops decoding silence. */
const SILENT_EPSILON = 0.01;

interface Voice {
  player: AudioPlayer;
  /** Song currently loaded on this player, so a repeat needs no `replace`. */
  song: string | null;
  gain: number;
  target: number;
  /** Gain change per fade tick for the running fade. */
  rate: number;
}

let voice: Voice | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let muted = false;
/** The Settings toggle (bits.music). Read once, lazily, on the first sync;
 * the settings row pushes changes live via setMusicEnabled. */
let enabled = true;
let settingLoaded = false;

/** The match's shuffled pool and where we are in it. */
let deck: string[] = [];
let deckIdx = 0;
/** Highest round number seen this match — a smaller one means a NEW match. */
let lastRound = 0;
/** Wall-clock ms the first fight went active (for the entry delay), or null. */
let activeSince: number | null = null;
/** The score is on (playing or fading in) for this match. */
let entered = false;
/** The match resolved: stay silent until a fresh round 1 arrives. */
let matchOver = false;
/** Where the score should sit right now: 1 in the fight, DUCK_LEVEL between
 * rounds, 0 when out. Song swaps fade back in to this. */
let level = 0;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const ensure = (): Voice => {
  if (voice === null) {
    const player = createAudioPlayer(null, { keepAudioSessionActive: true });
    // A song plays ONCE; when it ends the next in the deck takes over. Looping
    // a song's quiet opening mid-match would be worse than a fresh song's.
    player.loop = false;
    player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) onSongEnded();
    });
    voice = { player, song: null, gain: 0, target: 0, rate: 1 };
  }
  return voice;
};

const applyVolume = (): void => {
  if (!voice) return;
  voice.player.volume = clamp01((muted ? 0 : MUSIC_VOLUME) * voice.gain);
};

/** Run the fade to its target; stop ticking once it lands. */
const tickFade = (): void => {
  const v = voice;
  if (!v) return;
  if (v.gain !== v.target) {
    const delta = Math.max(-v.rate, Math.min(v.rate, v.target - v.gain));
    v.gain = clamp01(v.gain + delta);
    if (v.target === 0 && v.gain <= SILENT_EPSILON) {
      v.gain = 0;
      if (v.player.playing) v.player.pause();
    }
  }
  applyVolume();
  if (v.gain === v.target && fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
};

const fadeTo = (target: number, ms: number): void => {
  const v = ensure();
  v.target = target;
  v.rate = ms > 0 ? FADE_TICK_MS / ms : 1;
  fadeTimer ??= setInterval(tickFade, FADE_TICK_MS);
};

/** Fisher–Yates on a copy. Local Math.random: music never touches sim rng. */
const shuffle = (pool: readonly string[]): string[] => {
  const out = [...pool];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

/** Load `song` from its top and play (silently — the caller sets the fade). */
const cue = (song: string): boolean => {
  const v = ensure();
  const source: AudioSource | undefined = MUSIC_MANIFEST[song];
  if (source === undefined) return false;
  if (v.song !== song) {
    v.player.replace(source);
    v.song = song;
  }
  void v.player.seekTo(0);
  if (!v.player.playing) v.player.play();
  return true;
};

/** A fresh match: new deck, nothing playing. */
const resetMatch = (): void => {
  deck = shuffle(Object.keys(MUSIC_MANIFEST));
  deckIdx = 0;
  activeSince = null;
  entered = false;
  matchOver = false;
  level = 0;
};

/** Bring the deck's current song in from its top with the slow entry fade. */
const enter = (): void => {
  if (entered || !enabled || deck.length === 0) return;
  const song = deck[deckIdx % deck.length]!;
  if (!cue(song)) return;
  entered = true;
  level = 1;
  fadeTo(level, ENTRY_FADE_MS);
};

/** The song ran out mid-match: the next one, from its top, at the current level. */
const onSongEnded = (): void => {
  if (!entered || deck.length === 0) return;
  deckIdx = (deckIdx + 1) % deck.length;
  const v = ensure();
  v.gain = 0;
  applyVolume();
  if (cue(deck[deckIdx]!)) fadeTo(level, NEXT_SONG_FADE_MS);
};

const setLevel = (next: number, ms: number): void => {
  if (level === next) return;
  level = next;
  if (entered) fadeTo(level, ms);
};

/** Take the score out (match end, leaving, the toggle). */
const silence = (ms: number): void => {
  level = 0;
  if (!entered) return;
  entered = false;
  fadeTo(0, ms);
};

/**
 * Keep the score in step with the round — call per frame with the round
 * snapshot (cheap: a few comparisons when nothing changed).
 * - round number drops (a new match) → new deck, silent;
 * - MUSIC_ENTRY_S of the first fight, or the sands already out (rejoin) →
 *   enter; thereafter the song runs across rounds;
 * - active → full level; countdown / roundEnd → ducked; matchEnd / lobby → out.
 */
export const syncRoundMusic = (round: {
  phase: RoundPhase;
  roundNumber: number;
  sands: unknown | null;
}): void => {
  if (!settingLoaded) {
    settingLoaded = true;
    void loadMusicEnabled().then(setMusicEnabled);
  }
  if (round.phase === "countdown" || round.phase === "active") {
    if (round.roundNumber < lastRound || deck.length === 0 || matchOver) {
      silence(MATCH_END_FADE_MS);
      resetMatch();
    }
    lastRound = round.roundNumber;
    if (round.phase === "active") {
      activeSince ??= Date.now();
      const due = Date.now() - activeSince >= MUSIC_ENTRY_S * 1000;
      if (!entered && (due || round.sands !== null)) enter();
      else setLevel(1, RESTORE_FADE_MS);
    } else {
      setLevel(DUCK_LEVEL, DUCK_FADE_MS);
    }
  } else if (round.phase === "roundEnd") {
    setLevel(DUCK_LEVEL, DUCK_FADE_MS);
  } else if (entered || !matchOver) {
    // matchEnd / lobby: out, and stay out until a fresh round 1.
    matchOver = true;
    silence(MATCH_END_FADE_MS);
  }
};

/** Leaving the arena (GameScreen unmount): fade out, forget the match. */
export const stopRoundMusic = (): void => {
  silence(LEAVE_FADE_MS);
  deck = [];
  lastRound = 0;
  matchOver = false;
};

/** The Settings toggle. Off mid-song fades the score out; back on lets the
 * next sync bring it in (the entry delay has long passed). */
export const setMusicEnabled = (on: boolean): void => {
  enabled = on;
  if (!on) silence(LEAVE_FADE_MS);
};

/** Rides the app-wide mute (index.ts `setAudioMuted`). */
export const setMusicMuted = (on: boolean): void => {
  muted = on;
  applyVolume();
};

/** Every bundled music source, for the pre-match asset warm. */
export const musicSources = (): AudioSource[] => Object.values(MUSIC_MANIFEST);
