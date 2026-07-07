import type { SoundCatalogue } from "@heroic/core";

/**
 * The SFX catalogue: which clips each gameplay event plays. This is *content* —
 * the authoring surface, like the zone JSON — not logic; the pure scheduler in
 * `@heroic/core` (`createSoundScheduler`) reads it and decides what to fire, and
 * the AudioDirector's `playSfx` makes the noise. See docs/design/audio.md.
 *
 * The model is two-level: an event `type` (stable, shared across all our games)
 * plus an open-string `qualifier` that picks a `variants` bank — which creature
 * died, which surface the foot hit, which weapon swung. Add a creature or a
 * floor type by adding a variant here, never by touching core.
 *
 * `clips` are *manifest names*, not files — each must have a matching entry in
 * `manifest.ts` (`name → require("…/assets/audio/sfx/x.mp3")`). A name with no
 * manifest entry just warns once and stays silent, so this file is safe to fill
 * in ahead of the actual audio files. Multiple clips in a bank = variation: one
 * is picked at random per play so repeats don't sound stamped.
 */
export const SOUND_CATALOGUE: SoundCatalogue = {
  // ── Combat ────────────────────────────────────────────────────────────────
  // Melee connect. Qualify by weapon when swings should sound different; the base
  // bank covers weapons with no bespoke sound.
  // NOTE: banks list only clips whose files exist — a listed-but-missing clip
  // plays as silence for its share of the random picks. Forge more takes
  // (`strike_generic_2`, …) and append them here + in manifest.ts.
  weaponStrike: {
    clips: ["strike_generic_1"],
    pitchVariance: 0.08,
    // variants: { sword: { clips: ["sword_hit_1", "sword_hit_2"] }, axe: { clips: ["axe_hit"] } },
  },
  // Ranged release (bowstring / recoil).
  projectileFire: {
    clips: ["bow_release_1"],
    pitchVariance: 0.08,
  },
  // The player takes damage. One channel; kept a touch quieter than enemy hits.
  hitTaken: {
    clips: ["player_hurt_1", "player_hurt_2"],
    volume: 0.9,
  },
  // Enemy death. No base bank on purpose — every creature dies differently, so
  // add one variant per creature kind (the qualifier is the creature's kind).
  creatureDeath: {
    variants: {
      // goblin: { clips: ["goblin_die_1", "goblin_die_2"] },
      // slime: { clips: ["slime_die"], pitchVariance: 0.15 },
    },
  },

  // ── Abilities ─────────────────────────────────────────────────────────────
  // Skills fire this qualified by ability id. Dash/roll is the first one.
  abilityCast: {
    variants: {
      dash: { clips: ["dash_whoosh_1"], pitchVariance: 0.1 },
    },
  },

  // ── World ─────────────────────────────────────────────────────────────────
  // A locked door opens (its key is spent). The clip is the unlock clunk.
  doorOpen: {
    clips: ["door_unlock_1"],
  },
  // A spawner nest bursts — destroyed by the player or spent (both share the
  // same particle poof, so they share the sound; spawners.md).
  spawnerDestroyed: {
    clips: ["spawner_destroyed_1"],
  },

  // ── Movement ──────────────────────────────────────────────────────────────
  // Footfalls, qualified by the surface under the player. Base = generic step for
  // any surface with no bespoke bank. Throttled loosely — cadence already spaces
  // these, the throttle is just a safety floor.
  footstep: {
    clips: ["step_generic_1", "step_generic_2", "step_generic_3"],
    volume: 0.5,
    pitchVariance: 0.12,
    throttleMs: 120,
    variants: {
      // stone: { clips: ["step_stone_1", "step_stone_2", "step_stone_3"] },
      // grass: { clips: ["step_grass_1", "step_grass_2"] },
    },
  },

  // ── Progression / UI ──────────────────────────────────────────────────────
  // The player levels up — a bright, uncommon flourish.
  levelUp: {
    clips: ["level_up_1"],
  },
  // A talent card is chosen.
  talentPick: {
    clips: ["talent_pick_1"],
  },
};
