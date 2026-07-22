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
 * How switching works: EVERY pack's clips sit in the manifest under a
 * pack-namespaced name (`eliza_nightshade:announce_first_blood_1`), and
 * `resolveAnnouncerClip` remaps a catalogue name to the active pack's entry at
 * play time (audio/index.ts). Namespacing isn't optional: the AudioDirector
 * caches decoded PCM by manifest NAME for the app's lifetime, so re-pointing
 * one name at a different file would keep playing the stale voice.
 *
 * Selection today is the dev menu's ANNOUNCER row (HomeScreen), persisted as a
 * device setting (settings.ts, `bits.announcerPack`); when the store lands the
 * setter stays and entitlements gate WHICH packs are offered (a purchased pack
 * id — see docs/design/monetisation.md, which also records the real product
 * shape: the KILLER's pack plays to the whole room, which needs the pack id in
 * the protocol — not built). Adding a pack = drop its folder + add an entry
 * below. Packs are complete sets today; per-clip fallback to `default` (for a
 * pack that only replaces some lines) is a later nicety if we want it.
 */
export const ANNOUNCER_PACK_IDS = ["default", "eliza_nightshade"] as const;
export type AnnouncerPackId = (typeof ANNOUNCER_PACK_IDS)[number];

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
  eliza_nightshade: {
    announce_first_blood_1: require("../../assets/audio/sfx/announcer/eliza_nightshade/announce_first_blood_1.mp3"),
    announce_double_kill_1: require("../../assets/audio/sfx/announcer/eliza_nightshade/announce_double_kill_1.mp3"),
    announce_multi_kill_1: require("../../assets/audio/sfx/announcer/eliza_nightshade/announce_multi_kill_1.mp3"),
    announce_mega_kill_1: require("../../assets/audio/sfx/announcer/eliza_nightshade/announce_mega_kill_1.mp3"),
    announce_ultra_kill_1: require("../../assets/audio/sfx/announcer/eliza_nightshade/announce_ultra_kill_1.mp3"),
    announce_monster_kill_1: require("../../assets/audio/sfx/announcer/eliza_nightshade/announce_monster_kill_1.mp3"),
  },
};

/** The pack-namespaced manifest name a pack's take on a clip lives under. */
const packedName = (pack: AnnouncerPackId, clip: string): string => `${pack}:${clip}`;

/** Catalogue names that are announcer lines — the remap trigger. */
const ANNOUNCER_CLIP_NAMES = new Set<string>(Object.keys(ANNOUNCER_PACKS.default));

/** EVERY pack's clips under namespaced names — spread into the AudioManifest
 * so any pack is playable (and decode-cacheable) without a director rebuild. */
export const ANNOUNCER_MANIFEST: AudioManifest = Object.fromEntries(
  ANNOUNCER_PACK_IDS.flatMap((pack) =>
    Object.entries(ANNOUNCER_PACKS[pack]).map(([clip, source]) => [packedName(pack, clip), source]),
  ),
);

/** The voice that's live right now. Module state, not React: read on the play
 * path. Set via audio/index.ts `setAnnouncerPack` (which also warms). */
let activeAnnouncer: AnnouncerPackId = "default";

export const getActiveAnnouncer = (): AnnouncerPackId => activeAnnouncer;

export const setActiveAnnouncer = (pack: AnnouncerPackId): void => {
  activeAnnouncer = pack;
};

/** Remap a catalogue clip name to a pack's manifest entry (the active pack
 * unless a specific one is given — playAnnouncement passes the KILLER's);
 * non-announcer names pass through untouched. */
export const resolveAnnouncerClip = (clip: string, pack: AnnouncerPackId = activeAnnouncer): string =>
  ANNOUNCER_CLIP_NAMES.has(clip) ? packedName(pack, clip) : clip;

/** A pack's full set of namespaced manifest names — the warm list on switch. */
export const announcerPackClips = (pack: AnnouncerPackId): string[] =>
  Object.keys(ANNOUNCER_PACKS[pack]).map((clip) => packedName(pack, clip));

/** Collapse a wire pack id (roomState `announcer`, a free-form string) to a
 * pack this build actually has — unknown ids (a newer player's exotic pack,
 * a garbage claim) fall back to the default voice instead of going silent. */
export const asAnnouncerPack = (raw: string | undefined): AnnouncerPackId =>
  (ANNOUNCER_PACK_IDS as readonly string[]).includes(raw ?? "") ? (raw as AnnouncerPackId) : "default";

/** Expand announcer names in a warm list to EVERY pack's entry: any seat's
 * voice can boom mid-combat, so all packs warm. Fine at today's pack count
 * (6 short lines each); narrow to the room's packs if the catalogue grows. */
export const expandAnnouncerClips = (names: string[]): string[] =>
  names.flatMap((n) =>
    ANNOUNCER_CLIP_NAMES.has(n) ? ANNOUNCER_PACK_IDS.map((pack) => packedName(pack, n)) : [n],
  );
