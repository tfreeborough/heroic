/**
 * The posting queue: which finished video goes out on which day, in which
 * slot, with what title and description, and whether it's been uploaded to
 * each platform yet. One JSON file next to the renders. The Desk never
 * uploads to the platforms itself (their posting APIs need app audits);
 * this is the plan and the tick-list, and the native schedulers do the rest.
 *
 * This file is the pure half (types, days, the placing rule) — the page
 * imports it too. The file store is scheduleStore.ts.
 */

export type Platform = "tiktok" | "shorts" | "reels";
/** Where a vertical goes, and which of them take a title as well as a description. */
export const PLATFORMS: { id: Platform; label: string; title: boolean }[] = [
  { id: "tiktok", label: "TikTok", title: false },
  { id: "shorts", label: "Shorts", title: true },
  { id: "reels", label: "Reels", title: false },
];

export type Post = {
  id: string;
  /** The library batch this post is, and the one render of it to upload (the vertical). */
  batch: string;
  slug: string;
  name: string;
  template: string;
  /** What the spacing rule keys on: the recording the video came from
   * (hook variants of one clip share it), else the batch itself. */
  clip: string;
  /** The hook / line on the video, for the queue's own eyes. */
  hook: string;
  /** YYYY-MM-DD, and the slot in that day (0 = first). */
  day: string;
  slot: number;
  /** The words for the platforms: the title where one exists (Shorts), the description everywhere. */
  title: string;
  description: string;
  /** Other titles Claude offered, to pick from in the Queue. */
  titleOptions?: string[];
  draftedBy?: "template" | "claude";
  /** ISO timestamp per platform once it's up. */
  posted: Partial<Record<Platform, string>>;
  createdAt: string;
};

export type Settings = {
  slotsPerDay: number;
  slotLabels: string[];
  /** Days that must separate two posts from the same clip. */
  minGapDays: number;
};
/** `ignored` = batches the queue leaves alone (experiments, tests): never
 * auto-queued, and taken off the queue when marked. */
export type Schedule = Settings & { posts: Post[]; ignored: string[] };

export const DEFAULT_SETTINGS: Settings = { slotsPerDay: 2, slotLabels: ["morning", "evening"], minGapDays: 3 };

// ── days ──
export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
export const dayDiff = (a: string, b: string): number => {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

export const isDone = (p: Post): boolean => PLATFORMS.every((pl) => Boolean(p.posted[pl.id]));

// ── placing ──
/**
 * The next free slot from `from` where nothing from the same clip sits
 * within `minGapDays` days. Greedy: the first that fits. Two different
 * clips may sit side by side; two hooks of one clip never do — the empty
 * slots between them are for other content (spotlights, another clip).
 */
export const placeOne = (s: Schedule, taken: Post[], clip: string, from: string): { day: string; slot: number } => {
  for (let i = 0; i < 3650; i++) {
    const day = addDays(from, i);
    const near = taken.some((p) => p.clip === clip && Math.abs(dayDiff(p.day, day)) < s.minGapDays);
    if (near) continue;
    for (let slot = 0; slot < s.slotsPerDay; slot++) {
      if (!taken.some((p) => p.day === day && p.slot === slot)) return { day, slot };
    }
  }
  return { day: addDays(from, 3650), slot: 0 };
};

