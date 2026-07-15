import type { AudioManifest } from "@heroic/engine";

/**
 * Clip name → bundled audio file. The SFX catalogue (`catalogue.ts`) names
 * clips that resolve here; the AudioDirector looks them up. A name the catalogue
 * uses with no entry here warns once and stays silent, so the catalogue is safe
 * to author ahead of the files — which is exactly the state below: nothing forged
 * yet, so every sound is a silent no-op until its clip lands.
 *
 * To add a sound: forge it in Realmsmith (Asset Forge → "Sound (Blood in the
 * Sand)"), which drops `<name>.mp3` into `assets/audio/sfx/` and hands back the
 * exact line to paste here. The line's *name* must match a clip in `catalogue.ts`
 * (the Forge's bank names mirror the catalogue's, so they line up by construction).
 *
 * `require()` a file that doesn't exist and the bundler errors — so lines only
 * appear here once their mp3 is on disk. Uncomment/paste as clips are forged:
 *
 *   hit_blade_1: require("../../assets/audio/sfx/hit_blade_1.mp3"),
 *   cast_dash_1: require("../../assets/audio/sfx/cast_dash_1.mp3"),
 *   fight_start_1: require("../../assets/audio/sfx/fight_start_1.mp3"),
 *
 * The announcer lines (`announce_first_blood_1`, `announce_double_kill_1`,
 * `announce_multi_kill_1`, `announce_mega_kill_1`, `announce_ultra_kill_1`,
 * `announce_monster_kill_1`) are a booming voice you record/supply yourself —
 * drop the mp3s here like any other clip; the Forge doesn't generate speech.
 */
export const AUDIO_MANIFEST: AudioManifest = {
  // ── SFX (paste a line per forged clip; names must match catalogue.ts) ─────
};
