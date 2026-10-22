/**
 * The Google Play / App Store listing, as data. The feature graphic, every
 * store screenshot and the store preview video render from this file
 * (`bun run render:store`, `--video` for the previews); the prose lives in
 * docs/store-listing.md so the two never disagree on the pitch.
 *
 * v2 (2026-10-22): the "You don't aim" lead is gone — it read as a thing
 * the game lacks, not a reason to install. Cards now lead with what you
 * get (quick bloody fights, one life, mates, more arenas, bots), the
 * footage fills the card and is zoomed onto the action so a fight reads at
 * thumbnail size, and every card is a different arena.
 */

export const FEATURE = {
  title: ["BLOOD", "IN THE SAND"],
  line: "Quick, bloody arena fights. One life a round.",
  chips: ["MADE BY ONE PERSON", "FREE TO PLAY"],
} as const;

/** Where the action is in a frame: fractions of the kept picture, 0–1. */
export type Focus = readonly [x: number, y: number];

export type StoreShotSpec = {
  /** Output file name (no extension) under out/store/. */
  slug: string;
  /** The headline (Cinzel, upper-cased in render). Break lines yourself with \n — auto-wrap orphans words. */
  headline: string;
  /** Cinzel size for a long headline that would wrap to three lines at the default 96. */
  headlineSize?: number;
  /** The subline (Inter). One sentence; break it yourself with \n so no word is left alone on a line. */
  line: string;
  /** Under public/: an .mp4 (a frame is pulled at `at` seconds) or a .png. */
  src: string;
  at?: number;
  /** The recording's width ÷ height (the footage sidecar's facts). */
  aspect?: number;
  /** Shave the phone's status strip / nav bar: fractions of the source height. */
  cropTop?: number;
  cropBottom?: number;
  /** How far in to push past "cover the card" (1 = the whole kept picture, cropped to 9:16). Keep it at 1: the recordings are compressed phone captures and anything past the fit goes blurry (Tom, 2026-10-22). `focus` still picks which strip of the screen the 9:16 crop keeps. */
  zoom?: number;
  /** The point in the kept picture to keep in view when zoomed (fractions). */
  focus?: Focus;
  /** A menu screen rather than a fight: show the whole screen in a phone frame under the caption instead of filling the card. */
  framed?: boolean;
};

/** The hand-recorded Android captures all carry the same chrome. The Desk's
 * cleaned-up cuts have already had the nav bar shaved (sidecar `cleanup`). */
const raw = { cropTop: 0.035, cropBottom: 0.065 } as const;
const cut = (w: number, h: number) => ({ aspect: w / h }) as const;

/**
 * Order matters — Google shows the first two or three before the fold,
 * Apple the first three. Captions sell the SPECTACLE and the rules that
 * never change (one life, the windup, the crowd, the blood, mates) — never
 * counts, mode names or the roster, which go stale with every patch
 * (Tom, 2026-09-07). One card per arena where the footage allows.
 */
export const STORE_SHOTS: StoreShotSpec[] = [
  {
    slug: "01-dies",
    headline: "Someone dies\nevery round",
    line: "A round's about a minute.\nOne of you doesn't walk out of it.",
    src: "footage/Obelisk Brawl 1 cut.mp4",
    at: 14.2,
    ...cut(874, 1794),
    zoom: 1.0,
    focus: [0.55, 0.62],
  },
  {
    slug: "02-blood",
    headline: "Blood stays\non the sand",
    line: "Every kill leaves a mark\nfor the whole match.",
    src: "footage/Horde - Bombard Cut 2.mp4",
    at: 18.5,
    ...cut(874, 1814),
    zoom: 1.0,
    focus: [0.5, 0.55],
  },
  {
    slug: "03-dodge",
    headline: "Dodge it\nor wear it",
    line: "Every swing is telegraphed.\nStep out, block, or take it on the chin.",
    src: "footage/Hammer Showcase.mp4",
    at: 2.4,
    ...cut(720, 1480),
    zoom: 1.0,
    focus: [0.42, 0.5],
  },
  {
    slug: "04-mates",
    headline: "Bring\na mate",
    line: "Two of you against two of them.\nOr everyone against everyone.",
    src: "footage/fang arena fight.mp4",
    at: 4.6,
    ...cut(720, 1496),
    zoom: 1.0,
    focus: [0.6, 0.45],
  },
  {
    slug: "05-standing",
    headline: "Last one\nstanding",
    line: "Everyone goes in.\nOne walks out.",
    src: "footage/Brawl footage .mp4",
    at: 26.4,
    ...cut(874, 1920),
    ...raw,
    zoom: 1.0,
    focus: [0.5, 0.55],
  },
  {
    slug: "06-arenas",
    headline: "Different arenas,\ndifferent cover",
    headlineSize: 84,
    line: "Rocks to hide behind,\ngaps you'll get caught in.",
    src: "footage/Obelisk Brawl 1 cut.mp4",
    at: 24.6,
    ...cut(874, 1794),
    zoom: 1.0,
    focus: [0.5, 0.5],
  },
  {
    slug: "07-arms",
    headline: "Choose\nyour arms",
    line: "A weapon and a few abilities\nbefore every match.",
    src: "footage/VID_20260928_221918.mp4",
    at: 2.5,
    ...cut(874, 1920),
    ...raw,
    framed: true,
  },
  {
    slug: "08-bots",
    headline: "The bots\ndon't go easy",
    line: "Practice offline.\nThe hard ones will beat you.",
    src: "footage/Player vs godlike (trident).mp4",
    at: 25.9,
    ...cut(720, 1496),
    zoom: 1.0,
    focus: [0.5, 0.5],
  },
];

/**
 * The last screenshot: no gameplay, just a note from Tom. Solo-dev
 * listings that end on this do better than ones that don't — people back
 * a person. Written as a Discord post, not a press release.
 */
export const DEV_NOTE = {
  heading: "A note from the dev",
  paragraphs: [
    "Hi, I'm Tom. I made Blood in the Sand on my own, in the evenings, because I wanted a fighting game about timing and nerve rather than fast thumbs.",
    "It's free, and it only really works if there are people to fight. So if you like it, tell a mate, and come and say hello on Discord.",
    "Bugs, balance rants, ideas. All welcome. I read everything.",
  ],
  signoff: "Tom",
  studio: "Free the Borough Games",
  handle: "discord.gg/8FHgBmaSnT",
} as const;

/** One stretch of footage in the store preview video. */
export type PreviewBeat = {
  /** Under public/. */
  src: string;
  /** Seconds into the recording to start. */
  from: number;
  /** How long the beat runs. */
  seconds: number;
  /** The line on screen for this beat (Cinzel). Empty = footage alone. */
  caption?: string;
  aspect?: number;
  cropTop?: number;
  cropBottom?: number;
  zoom?: number;
  focus?: Focus;
};

/**
 * The store preview, as a cut. Apple caps a preview at 30s and only takes
 * footage captured in the app, so this is five stretches of real matches,
 * 5–5.5s each with a line apiece (Tom, 2026-10-22: fewer cuts, less zoom;
 * zoom here is barely past the whole screen), then a 3.5s card. Google
 * takes the same cut as a YouTube link (landscape, the footage framed in
 * the middle). Beats total 25s; `PREVIEW_END` is the card.
 */
export const PREVIEW_BEATS: PreviewBeat[] = [
  { src: "footage/Obelisk Brawl 1 cut.mp4", from: 10.8, seconds: 5.5, caption: "Quick, bloody arena fights", ...cut(874, 1794), zoom: 1.08, focus: [0.5, 0.55] },
  { src: "footage/fang arena fight.mp4", from: 2, seconds: 5, caption: "One life a round", ...cut(720, 1496), zoom: 1.08, focus: [0.55, 0.45] },
  { src: "footage/Blade Showcase.mp4", from: 20, seconds: 5, caption: "Bring a mate", ...cut(874, 1794), zoom: 1.08, focus: [0.5, 0.55] },
  { src: "footage/Brawl footage .mp4", from: 23.5, seconds: 4.5, caption: "Or everyone for themselves", ...cut(874, 1920), ...raw, zoom: 1.05, focus: [0.5, 0.45] },
  { src: "footage/Obelisk Brawl 1 cut.mp4", from: 36.5, seconds: 5, caption: "Made by one person", ...cut(874, 1794), zoom: 1.0, focus: [0.5, 0.5] },
];

/** The closing card of the preview. */
export const PREVIEW_END = {
  seconds: 3.5,
  game: "BLOOD IN THE SAND",
  line: "Free on iOS and Android",
  eyebrow: "A game from a one-person studio",
} as const;

/** A song from public/music/ under the whole preview (the footage keeps its own sound). Empty = none. */
export const PREVIEW_MUSIC = { file: "berserker.mp3", from: 0, level: 0.45 } as const;

export const previewSeconds = (): number => PREVIEW_BEATS.reduce((s, b) => s + b.seconds, 0) + PREVIEW_END.seconds;

/**
 * Apple's Asset Library placements (App Store Connect, from 2026-10-05): a
 * 21:9 product page header (3840×1646) and a 3:2 search results card
 * (3840×2560), each an image or a 5–30s video that loops, muted by
 * default. Neither takes a preview or a screenshot size (Tom hit
 * "invalid dimensions" uploading those, 10-22). The videos are the preview
 * beats cover-cropped to the strip around the fight — no end card, since
 * they loop — and the stills are one frame of the same crop. On a phone
 * the header is a thin strip the width of the page, so the fight has to
 * fill it; Apple keeps roughly the middle 64% × 70% safe on every device.
 */
export const BANNER_STILL = {
  src: "footage/Obelisk Brawl 1 cut.mp4",
  at: 14.2,
  ...cut(874, 1794),
  focus: [0.55, 0.62] as Focus,
} as const;
/** The one line on the search card (the header sits under the app's own name, so it carries none). */
export const BANNER_CAPTION = "One life a round";
export const bannerSeconds = (): number => PREVIEW_BEATS.reduce((s, b) => s + b.seconds, 0);
