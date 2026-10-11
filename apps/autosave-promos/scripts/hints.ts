/**
 * The loading-screen hints: a queue Tom orders on the Hints tab, two per
 * video off the top. A Render press marks the pair used (the Save template
 * tells the server), so the next fresh form gets the next two and no two
 * videos share one. Kept in hints.json beside the config, committed: the
 * words are Tom's.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Hint = {
  id: string;
  text: string;
  /** When a render took it, and which one. Unused hints are the queue, in file order. */
  used?: { at: number; in: string };
};

const FILE = join(import.meta.dir, "../hints.json");
const load = (): Hint[] => (existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as { hints: Hint[] }).hints : []);
const store = (hints: Hint[]) => writeFileSync(FILE, JSON.stringify({ hints }, null, 2) + "\n");
const newId = () => `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const tidy = (s: string) => s.replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim();

/** The queue in order, and the used ones most recent first. */
export const view = (hints = load()) => ({
  queue: hints.filter((h) => !h.used),
  used: hints.filter((h) => h.used).sort((a, b) => b.used!.at - a.used!.at),
});

/** Read, change, write, answer with the new view. Small and synchronous. */
const change = (fn: (hints: Hint[]) => Hint[] | void) => {
  const hints = load();
  const next = fn(hints) ?? hints;
  store(next);
  return view(next);
};

export const add = (text: string, top: boolean) =>
  change((hs) => {
    const h = { id: newId(), text: tidy(text) };
    if (!h.text) return;
    return top ? [h, ...hs] : [...hs, h];
  });

export const edit = (id: string, text: string) =>
  change((hs) => {
    const h = hs.find((x) => x.id === id);
    if (h && tidy(text)) h.text = tidy(text);
  });

export const remove = (id: string) => change((hs) => hs.filter((h) => h.id !== id));

/** The queue in a new order (ids it doesn't name keep their place at the end). */
export const order = (ids: string[]) =>
  change((hs) => {
    const byId = new Map(hs.map((h) => [h.id, h]));
    const queue = ids.map((id) => byId.get(id)).filter((h): h is Hint => Boolean(h && !h.used));
    const named = new Set(queue.map((h) => h.id));
    return [...queue, ...hs.filter((h) => !h.used && !named.has(h.id)), ...hs.filter((h) => h.used)];
  });

/** A used hint goes back to the top of the queue. */
export const requeue = (id: string) =>
  change((hs) => {
    const h = hs.find((x) => x.id === id);
    if (!h) return;
    delete h.used;
    return [h, ...hs.filter((x) => x !== h)];
  });

/** The next `n` off the top. */
export const next = (n: number) => view().queue.slice(0, n).map((h) => h.text);

/** A render took these. One typed in Make that isn't in the bank joins it, already used. */
export const markUsed = (texts: string[], name: string) =>
  change((hs) => {
    const now = Date.now();
    texts
      .map(tidy)
      .filter(Boolean)
      .forEach((text, i) => {
        // A pair lists in video order under "most recent first": the first hint gets the later stamp.
        const used = { at: now + (texts.length - i), in: name };
        const h = hs.find((x) => x.text === text);
        if (h) h.used = used;
        else hs.push({ id: newId(), text, used });
      });
  });
