import type { AudioManifest } from "@heroic/engine";
import { ANNOUNCER_MANIFEST } from "./announcer";

/**
 * Clip name → bundled audio file. The SFX catalogue (`catalogue.ts`) names
 * clips that resolve here; the AudioDirector looks them up. A name the catalogue
 * uses with no entry here warns once and stays silent, so the catalogue is safe
 * to author ahead of the files.
 *
 * To add a sound: forge it in Realmsmith (Asset Forge → "Sound (Blood in the
 * Sand)"), which drops `<name>.mp3` into `assets/audio/sfx/` and hands back the
 * exact line to paste here. The line's *name* must match a clip in `catalogue.ts`
 * (the Forge's bank names mirror the catalogue's, so they line up by construction).
 *
 * `require()` a file that doesn't exist and the bundler errors — so lines only
 * appear here once their mp3 is on disk.
 *
 * The booming announcer voice (`announce_*`) is NOT here: it's a swappable,
 * sellable PACK, so it lives in `announcer.ts` (its own `announcer/<pack>/`
 * folders) and is spread in below as the active pack's clips.
 */
export const AUDIO_MANIFEST: AudioManifest = {
    hit_blade_1: require("../../assets/audio/sfx/hit_blade_1.mp3"),
    fire_bow_1: require("../../assets/audio/sfx/fire_bow_1.mp3"),
    hit_bow_1: require("../../assets/audio/sfx/hit_bow_1.mp3"),
    fire_staff_1: require("../../assets/audio/sfx/fire_staff_1.mp3"),
    hit_staff_1: require("../../assets/audio/sfx/hit_staff_1.mp3"),
    hit_hammer_1: require("../../assets/audio/sfx/hit_hammer_1.mp3"),
    hit_generic_1: require("../../assets/audio/sfx/hit_generic_1.mp3"),
    player_hurt_1: require("../../assets/audio/sfx/player_hurt_1.mp3"),
    death_1: require("../../assets/audio/sfx/death_1.mp3"),

    cast_sandtrap_1: require("../../assets/audio/sfx/cast_sandtrap_1.mp3"),
    cast_tremor_1: require("../../assets/audio/sfx/cast_tremor_1.mp3"),
    cast_harpoon_1: require("../../assets/audio/sfx/cast_harpoon_1.mp3"),
    cast_dash_1: require("../../assets/audio/sfx/cast_dash_1.mp3"),
    cast_mirror_guard_1: require("../../assets/audio/sfx/cast_mirror_guard_1.mp3"),
    cast_ironhide_1: require("../../assets/audio/sfx/cast_ironhide_1.mp3"),
    cast_straw_man_1: require("../../assets/audio/sfx/cast_straw_man_1.mp3"),
    cast_warding_shout_1: require("../../assets/audio/sfx/cast_warding_shout_1.mp3"),
    cast_war_drums_1: require("../../assets/audio/sfx/cast_war_drums_1.mp3"),
    cast_blood_font_1: require("../../assets/audio/sfx/cast_blood_font_1.mp3"),
    cast_sandstorm_1: require("../../assets/audio/sfx/cast_sandstorm_1.mp3"),
    detonate_sandtrap_1: require("../../assets/audio/sfx/detonate_sandtrap_1.mp3"),
    cast_generic_1: require("../../assets/audio/sfx/cast_generic_1.mp3"),
    harpoon_whip_1: require("../../assets/audio/sfx/harpoon_whip_1.mp3"),
    heal_tick_1: require("../../assets/audio/sfx/heal_tick_1.mp3"),
    quake_rumble_1: require("../../assets/audio/sfx/quake_rumble_1.mp3"),

    countdown_tick_1: require("../../assets/audio/sfx/countdown_tick_1.mp3"),
    round_start_1: require("../../assets/audio/sfx/round_start_1.mp3"),
    fight_start_1: require("../../assets/audio/sfx/fight_start_1.mp3"),
    round_win_1: require("../../assets/audio/sfx/round_win_1.mp3"),
    round_loss_1: require("../../assets/audio/sfx/round_loss_1.mp3"),
    round_draw_1: require("../../assets/audio/sfx/round_draw_1.mp3"),
    match_win_1: require("../../assets/audio/sfx/match_win_1.mp3"),
    match_loss_1: require("../../assets/audio/sfx/match_loss_1.mp3"),


    ui_tap_1: require("../../assets/audio/sfx/ui_tap_1.mp3"),
    ui_confirm_1: require("../../assets/audio/sfx/ui_confirm_1.mp3"),
    ui_back_1: require("../../assets/audio/sfx/ui_back_1.mp3"),
    ui_error_1: require("../../assets/audio/sfx/ui_error_1.mp3"),

    // The active announcer pack (announcer.ts) — announce_first_blood_1, …
    ...ANNOUNCER_MANIFEST,
};
