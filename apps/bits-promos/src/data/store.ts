/**
 * The Google Play / App Store listing, as data. The feature graphic and
 * every store screenshot render from this file (`bun run render:store`);
 * the prose lives in docs/store-listing.md so the two never disagree on
 * the pitch.
 */

export const FEATURE = {
  title: ["BLOOD", "IN THE SAND"],
  line: "Short, bloody duels. No aiming, just timing.",
  chips: ["MADE BY ONE PERSON", "FREE TO PLAY"],
} as const;

export type StoreShotSpec = {
  /** Output file name (no extension) under out/store/. */
  slug: string;
  /** The headline (Cinzel, upper-cased in render). Break lines yourself with \n — auto-wrap orphans words. */
  headline: string;
  /** The subline (Inter). One sentence. */
  line: string;
  /** Under public/: an .mp4 (a frame is pulled at `at` seconds) or a .png. */
  src: string;
  at?: number;
  /** Shave the phone's status strip / nav bar: fractions of the source height. */
  cropTop?: number;
  cropBottom?: number;
};

/** The hand-recorded Android captures all carry the same chrome. */
const android = { cropTop: 0.035, cropBottom: 0.065 } as const;

/**
 * Order matters — Google shows the first two or three before the fold.
 * Captions sell the SPECTACLE and the rules that never change (one life,
 * no aim, the crowd, the blood) — never counts, mode names or the roster,
 * which go stale with every patch (Tom, 2026-09-07). Swap in menu-screen
 * PNGs as they get captured on a phone.
 */
export const STORE_SHOTS: StoreShotSpec[] = [
  {
    slug: "01-telegraph",
    headline: "You don't aim",
    line: "Every attack has a windup. See it coming, get out of the way, hit back.",
    src: "clips/weapon-blade.mp4",
    at: 9,
    ...android,
  },
  {
    slug: "02-one-life",
    headline: "One life\nper round",
    line: "Die and you watch the rest of it from the sand.",
    src: "clips/weapon-bombard.mp4",
    at: 24,
    ...android,
  },
  {
    slug: "03-crowd",
    headline: "The crowd\nis into it",
    line: "Kills get called out. The blood stays on the floor all match.",
    src: "clips/ability-titans-draught.mp4",
    at: 14.4,
    ...android,
  },
  {
    slug: "04-ground",
    headline: "The arena\njoins in",
    line: "Traps, quakes and sandstorms, if that's your sort of thing.",
    src: "clips/ability-tremor.mp4",
    at: 4,
    ...android,
  },
  {
    slug: "05-mind-games",
    headline: "Mostly it's\nmind games",
    line: "Make them dash early. Then it's yours.",
    src: "clips/ability-sinkhole.mp4",
    at: 22,
    ...android,
  },
  {
    slug: "06-friends",
    headline: "Better\nwith a mate",
    line: "Team up, or fight each other. Either works.",
    src: "clips/weapon-lifeline.mp4",
    at: 12,
    ...android,
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
    "Hi, I'm Tom. I made Blood in the Sand on my own, in the evenings, because I wanted a duel game that was about timing rather than aim.",
    "It's free, and it only really works if there are people to fight. So if you like it, tell a mate, and come and say hello on Discord.",
    "Bugs, balance rants, ideas. All welcome. I read everything.",
  ],
  signoff: "Tom",
  studio: "Free the Borough Games",
  handle: "discord.gg/8FHgBmaSnT",
} as const;
