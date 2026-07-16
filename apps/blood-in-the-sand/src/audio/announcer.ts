import type { AudioManifest } from "@heroic/engine";

/**
 * Announcer packs — the booming kill-announcement voice, kept SEPARATE from the
 * base SFX (its own `assets/audio/sfx/announcer/<pack>/` folders) because it's
 * meant to be sold as swappable packs: a free `default` pack ships, premium
 * packs (other voices/personas) drop in later for money.
 *
 * The gameplay side only ever references the stable clip names from catalogue.ts
 * (`announce_first_blood_1`, …). WHICH pack's file each name resolves to is this
 * module's job — so selling or switching a pack is a change HERE, never in the
 * catalogue, the scheduler, or GameScreen.
 *
 * NOT built yet: pack SELECTION. `ACTIVE_ANNOUNCER` is hard-wired to `default`;
 * when the store lands it comes from settings + entitlements (a purchased pack id
 * — see docs/design/monetisation.md). Adding a pack = drop its folder + add an
 * entry below. Packs are complete sets today; per-clip fallback to `default`
 * (for a pack that only replaces some lines) is a later nicety if we want it.
 */
export type AnnouncerPackId = "default";

/** The clips every announcer pack must provide (mirrors catalogue.ts). */
export type AnnouncerClip =
  | "announce_first_blood_1"
  | "announce_double_kill_1"
  | "announce_multi_kill_1"
  | "announce_mega_kill_1"
  | "announce_ultra_kill_1"
  | "announce_monster_kill_1";

/** AudioSource without importing it — the manifest's value type. Static-literal
 * `require()`s only (Metro can't bundle a dynamic path). */
type PackClips = Record<AnnouncerClip, AudioManifest[string]>;

export const ANNOUNCER_PACKS: Record<AnnouncerPackId, PackClips> = {
  default: {
    announce_first_blood_1: require("../../assets/audio/sfx/announcer/default/announce_first_blood_1.mp3"),
    announce_double_kill_1: require("../../assets/audio/sfx/announcer/default/announce_double_kill_1.mp3"),
    announce_multi_kill_1: require("../../assets/audio/sfx/announcer/default/announce_multi_kill_1.mp3"),
    announce_mega_kill_1: require("../../assets/audio/sfx/announcer/default/announce_mega_kill_1.mp3"),
    announce_ultra_kill_1: require("../../assets/audio/sfx/announcer/default/announce_ultra_kill_1.mp3"),
    announce_monster_kill_1: require("../../assets/audio/sfx/announcer/default/announce_monster_kill_1.mp3"),
  },
};

/** The pack whose clips are live right now. Store/entitlement-driven later. */
export const ACTIVE_ANNOUNCER: AnnouncerPackId = "default";

/** The active pack's clips, keyed by catalogue clip name — spread into the
 * AudioManifest so the announcements resolve through the normal lookup. */
export const ANNOUNCER_MANIFEST: AudioManifest = ANNOUNCER_PACKS[ACTIVE_ANNOUNCER];
