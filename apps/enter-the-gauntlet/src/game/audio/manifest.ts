import type { AudioManifest } from "@heroic/engine";

/**
 * Clip name → bundled audio file. Zone `audio.beds` and the SFX catalogue
 * (`sounds.ts`) name clips that resolve here; the AudioDirector looks them up.
 * Keep music-bed names stable — they live in zone JSON. See docs/design/audio.md.
 *
 * A combat bed drops in by adding the file, one line here, and `"combat":
 * "<name>"` to a zone's `audio.beds` — no code changes.
 *
 * SFX: to add a sound, drop the mp3 in `assets/audio/sfx/` and add one line in
 * the SFX block below whose *name* matches a clip name used in `sounds.ts`. A
 * name referenced by the catalogue with no entry here just warns once and stays
 * silent, so the catalogue can be authored ahead of the files.
 */
export const AUDIO_MANIFEST: AudioManifest = {
  // ── Music beds ──────────────────────────────────────────────────────────
  idle: require("../../../assets/audio/music/idle.mp3"),

  // ── SFX (add lines as the clips land; names must match sounds.ts) ────────
  // strike_generic_1: require("../../../assets/audio/sfx/strike_generic_1.mp3"),
  // dash_whoosh_1: require("../../../assets/audio/sfx/dash_whoosh_1.mp3"),
  // level_up: require("../../../assets/audio/sfx/level_up.mp3"),

  door_unlock_1: require("../../../assets/audio/sfx/door_unlock_1.mp3"),
  spawner_destroyed_1: require("../../../assets/audio/sfx/spawner_destroyed_1.mp3"),
  block_1: require("../../../assets/audio/sfx/block_1.mp3"),
  strike_generic_1: require("../../../assets/audio/sfx/strike_generic_1.mp3"),
  bow_release_1: require("../../../assets/audio/sfx/bow_release_1.mp3"),
  dash_whoosh_1: require("../../../assets/audio/sfx/dash_whoosh_1.mp3"),
  level_up_1: require("../../../assets/audio/sfx/level_up_1.mp3"),
  talent_pick_1: require("../../../assets/audio/sfx/talent_pick_1.mp3"),
};
