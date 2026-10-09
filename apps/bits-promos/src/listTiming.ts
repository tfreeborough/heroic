/**
 * A list clip's timing, kept apart from the component so it tests without
 * Remotion. See ListClip.tsx and docs/design/desk-list-clip.md.
 */

export const LIST_TIMING = { titleFor: 3, hold: 1.5, settle: 0.4, minTitle: 1, tailRoom: 1.5, showFor: 9, intro: 3, gap: 1, dim: 0.6 } as const;

/** A stretch something is on screen for, start to end (any unit). */
export type Window = [from: number, to: number];

/** Windows in order, with any that overlap or sit within `gap` of each other joined: nothing blinks off just to come straight back. */
export const mergeWindows = (windows: Window[], gap = 0): Window[] => {
  const out: Window[] = [];
  for (const [a, b] of windows.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a - last[1] <= gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
};

/**
 * How much of something shows at `t`, 0 to 1: up over `fadeIn` at the start
 * of each window, down over `fadeOut` before its end. A window starting at
 * `hardFrom` or ending at `hardTo` cuts instead (frame zero, and a loop's
 * last frame, which has to match it).
 */
export const windowLevel = (t: number, windows: Window[], fade: { in: number; out: number; hardFrom?: number; hardTo?: number }): number => {
  let level = 0;
  for (const [a, b] of windows) {
    if (t < a || t > b) continue;
    const up = a === fade.hardFrom || fade.in <= 0 ? 1 : Math.min(1, (t - a) / fade.in);
    const down = b === fade.hardTo || fade.out <= 0 ? 1 : Math.min(1, (b - t) / fade.out);
    level = Math.max(level, Math.min(up, down));
  }
  return level;
};

/** The items worth showing: blank rows are ones still being typed. */
export const filledItems = (items: unknown): string[] => (Array.isArray(items) ? items.map((x) => String(x ?? "").trim()).filter(Boolean) : []);

/** The number item `i` (in speaking order) wears, of `n`. */
export const numberOf = (i: number, n: number, order: "down" | "up" = "down"): number => (order === "up" ? i + 1 : n - i);

/**
 * When each item lands, in seconds of the video. The markers inside the
 * video's stretch of the edit (`startFrom` on) take the items in order; items
 * without one are spread evenly through what's left before the end, after
 * the title or the last marker used.
 */
export const itemTimes = (n: number, markers: number[], opts: { startFrom: number; seconds: number; titleFor: number }): number[] => {
  const end = Math.max(0, opts.seconds - LIST_TIMING.tailRoom);
  const inside = markers
    .map((m) => m - opts.startFrom)
    .filter((t) => t >= 0 && t < opts.seconds)
    .sort((a, b) => a - b)
    .slice(0, n);
  const left = n - inside.length;
  if (!left) return inside;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  // After the last marker: shared out evenly, none on top of it.
  if (inside.length) {
    const from = inside[inside.length - 1]!;
    const step = Math.max(0, end - from) / (left + 1);
    return [...inside, ...Array.from({ length: left }, (_, j) => r3(from + step * (j + 1)))];
  }
  // No markers at all: the first just after the title lifts, the rest evenly to the end.
  const from = Math.min(opts.titleFor + 0.3, end);
  const step = Math.max(0, end - from) / left;
  return Array.from({ length: left }, (_, j) => r3(from + step * j));
};

/** What the Desk says about the markers against the items, if anything's off. */
export const markerWarning = (items: number, markers: number | undefined): string | undefined => {
  if (!items) return undefined;
  if (markers === undefined) return "This isn't an edit, so there are no markers: the items are spaced evenly. Open it in the editor and press M on each item to time them to your voice.";
  if (!markers) return `No markers on this edit yet, so the ${items} items are spaced evenly. In the editor, press M where you start each item.`;
  if (markers < items) return `${items} items but ${markers} marker${markers === 1 ? "" : "s"}: the last ${items - markers === 1 ? "item lands" : `${items - markers} items land`} evenly in what's left. Add markers in the editor to time ${items - markers === 1 ? "it" : "them"}.`;
  if (markers > items) return `${markers} markers but ${items} items: the last ${markers - items === 1 ? "marker does" : `${markers - items} markers do`} nothing.`;
  return undefined;
};
