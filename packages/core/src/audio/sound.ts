/**
 * SFX brain: decide *what* one-shot to play for a gameplay moment, and *when*.
 * Pure and deterministic — the device-side mixer (`@heroic/engine`'s
 * AudioDirector.playSfx) is handed the result and plays it; this just decides.
 * Same split as the music decider (`audio/musicState`): the sim emits intent,
 * core resolves it against a catalogue, the engine makes the noise.
 *
 * The two-level model (decided 2026-07-05, see docs/design/audio.md): an event
 * is a *type* + an optional open-string *qualifier*. The type is the stable,
 * shared vocabulary every Heroic game speaks; the qualifier is what varies per
 * game — which creature died, which surface the foot landed on, which weapon
 * swung — and selects a *variant bank* of clips. So a new creature or tileset is
 * a catalogue entry, never a change to this union, and the other games reuse the
 * whole scheduler with their own content.
 */
import type { Rng } from "../rng";

/**
 * The shared vocabulary of gameplay moments that can make a sound. Deliberately
 * small and stable — this is the contract, not the content. Variation rides on
 * the per-event `qualifier` (see `play`), so this never grows just because a game
 * adds a creature or a floor type.
 */
export type SoundEvent =
  | "weaponStrike" // a melee weapon connects       (qualifier: weapon id)
  | "projectileFire" // a ranged weapon looses        (qualifier: weapon id)
  | "hitTaken" // the player takes damage
  | "abilityCast" // a skill fires — dash/roll, spells (qualifier: ability id)
  | "footstep" // a footfall                     (qualifier: surface under the foot)
  | "creatureDeath" // an enemy dies                  (qualifier: creature kind)
  | "breakableDestroyed" // a crate/pot/etc. shatters (qualifier: breakable kind)
  | "explosion" // a blast
  | "doorOpen" // a locked door opens — its key is spent (qualifier: key color)
  | "spawnerDestroyed" // a spawner nest bursts, destroyed or spent (spawners.md)
  | "levelUp" // the player gains a level
  | "talentPick" // a talent card is chosen
  | "uiSelect"; // a generic UI confirm / tap

/** Per-bank playback shaping. Every field is optional and falls back up the chain. */
export interface SoundConfig {
  /** Base volume 0..1, before the SFX bus scales it. Default 1. */
  volume?: number;
  /** ±fraction pitch randomisation so repeats don't sound machine-stamped. Default 0. */
  pitchVariance?: number;
  /** Minimum ms between two plays that resolve to this bank. Default the scheduler floor. */
  throttleMs?: number;
}

/** A variation set: one clip is picked at random per play. `clips` are manifest names. */
export interface SoundBank extends SoundConfig {
  clips: string[];
}

/**
 * One event's sounds. The `clips` bank plays for an unqualified or unmatched
 * event; `variants` maps a qualifier value (creature kind, surface, weapon) to
 * its own bank. A variant's config overrides the def's; an event with only
 * `variants` and no `clips` simply stays silent for unknown qualifiers.
 */
export interface SoundDef extends SoundConfig {
  /** Fallback variation set for an unqualified / unmatched event. Optional. */
  clips?: string[];
  /** Qualifier value → its own variation set (+ optional config overrides). */
  variants?: Record<string, SoundBank>;
}

/**
 * event → its definition. A game supplies only the events it has sounds for.
 *
 * Generic over the event key so a game with its own event vocabulary (Blood in
 * the Sand's `BitsSoundEvent`) reuses this whole scheduler without widening the
 * shared {@link SoundEvent} union — the union stays the small, stable contract
 * for games that speak it, and the type param carries anything bespoke. Defaults
 * to `SoundEvent`, so existing callers are unchanged.
 */
export type SoundCatalogue<E extends string = SoundEvent> = Partial<Record<E, SoundDef>>;

/** What the scheduler decided to play — handed straight to the engine's `playSfx`. */
export interface PlaySound {
  /** Manifest clip name to resolve + play. */
  clip: string;
  /** Final pre-bus volume, 0..1. */
  volume: number;
  /** ±fraction pitch randomisation for the engine to apply. */
  pitchVariance: number;
}

/** Default minimum ms between two plays of the *same* resolved sound — tuned like the haptics floor. */
export const DEFAULT_THROTTLE_MS = 60;

export interface SoundScheduler<E extends string = SoundEvent> {
  /**
   * Decide whether `event` should sound right now. `qualifier` selects a variant
   * bank (creature kind / surface / weapon); omit it (or pass an unknown one) to
   * fall back to the event's base clips. `overrides` win over all catalogue
   * config for this one play. Returns the concrete clip to play, or `null` if the
   * sound is throttled or the catalogue has nothing for it — the app hands any
   * non-null result to the AudioDirector's `playSfx`, fire-and-forget.
   */
  play(event: E, qualifier?: string, overrides?: SoundConfig): PlaySound | null;
}

export interface SoundSchedulerDeps<E extends string = SoundEvent> {
  /** What each event sounds like. */
  catalogue: SoundCatalogue<E>;
  /** Clock in ms — the app passes `Date.now`; tests pass a controllable stub. */
  now: () => number;
  /** Seeded RNG for clip choice + (later) any random shaping. Deterministic in tests. */
  rng: Rng;
  /** Floor between two plays of the same bank when the bank sets none. Default {@link DEFAULT_THROTTLE_MS}. */
  defaultThrottleMs?: number;
}

/** Pick a clip, nudging off an immediate repeat when the bank has a choice. */
const pickClip = (clips: string[], key: string, lastClip: Map<string, number>, rng: Rng): string => {
  if (clips.length === 1) return clips[0]!;
  let i = Math.floor(rng.next() * clips.length) % clips.length;
  if (i === lastClip.get(key)) i = (i + 1) % clips.length;
  lastClip.set(key, i);
  return clips[i]!;
};

export const createSoundScheduler = <E extends string = SoundEvent>(
  deps: SoundSchedulerDeps<E>,
): SoundScheduler<E> => {
  const { catalogue, now, rng } = deps;
  const defaultThrottleMs = deps.defaultThrottleMs ?? DEFAULT_THROTTLE_MS;
  /** Resolved bank key → last play time (ms). Throttling is per-bank so the *same* sound
   *  can't machine-gun, while different sounds overlap freely (a footstep isn't gated by a sword). */
  const lastPlayed = new Map<string, number>();
  /** Resolved bank key → index of the clip played last, to avoid an immediate repeat. */
  const lastClip = new Map<string, number>();

  return {
    play(event, qualifier, overrides) {
      const def = catalogue[event];
      if (def === undefined) return null;

      const variant = qualifier !== undefined ? def.variants?.[qualifier] : undefined;
      const bank: SoundBank | undefined =
        variant ?? (def.clips && def.clips.length > 0 ? { clips: def.clips } : undefined);
      if (bank === undefined || bank.clips.length === 0) return null;

      const key = variant !== undefined ? `${event}:${qualifier}` : event;
      const throttleMs =
        overrides?.throttleMs ?? variant?.throttleMs ?? def.throttleMs ?? defaultThrottleMs;
      const t = now();
      const last = lastPlayed.get(key);
      if (last !== undefined && t - last < throttleMs) return null;
      lastPlayed.set(key, t);

      const clip = pickClip(bank.clips, key, lastClip, rng);
      const volume = overrides?.volume ?? variant?.volume ?? def.volume ?? 1;
      const pitchVariance = overrides?.pitchVariance ?? variant?.pitchVariance ?? def.pitchVariance ?? 0;
      return { clip, volume, pitchVariance };
    },
  };
};

/**
 * Turns continuous movement into discrete footfalls. Movement has no natural
 * "step" event — the player just has a velocity — so we accumulate distance
 * travelled and fire once per stride's worth. The app samples the tile under the
 * player when this fires and plays `footstep` qualified by that surface.
 */
export interface FootstepCadence {
  /** World distance travelled since the last footfall. */
  accum: number;
}

export const initFootstepCadence = (): FootstepCadence => ({ accum: 0 });

/**
 * Feed the distance the player moved this step; returns true on the steps where a
 * footfall should sound. `strideLength` is the world distance between footfalls
 * (larger = slower cadence). Standing still never fires, and a single oversized
 * step (a dash/teleport) yields at most one footfall rather than a burst.
 */
export const stepFootstepCadence = (
  cadence: FootstepCadence,
  distance: number,
  strideLength: number,
): boolean => {
  if (distance <= 0 || strideLength <= 0) return false;
  cadence.accum += distance;
  if (cadence.accum < strideLength) return false;
  cadence.accum -= strideLength;
  if (cadence.accum >= strideLength) cadence.accum = 0; // swallow a huge single step
  return true;
};
