/**
 * The posting queue's file: <rendersDir>/schedule.json, and everything that
 * changes it. Server only (node:fs, the library).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameConfig } from "../game";
import { type DraftInput, draftWithClaude, hasClaude } from "./draft";
import { readSidecar } from "./footage";
import { rendersDir } from "./render";
import { type Batch, listBatches } from "./renders";
import { DEFAULT_SETTINGS, type Post, type Schedule, type Settings, isDone, placeOne, today } from "./schedule";

const path = (g: GameConfig) => join(rendersDir(g), "schedule.json");

export const readSchedule = (g: GameConfig): Schedule => {
  const p = path(g);
  if (!existsSync(p)) return { ...DEFAULT_SETTINGS, posts: [], ignored: [] };
  try {
    const s = JSON.parse(readFileSync(p, "utf8")) as Partial<Schedule>;
    return { ...DEFAULT_SETTINGS, ...s, posts: s.posts ?? [], ignored: s.ignored ?? [] };
  } catch {
    return { ...DEFAULT_SETTINGS, posts: [], ignored: [] };
  }
};
export const writeSchedule = (g: GameConfig, s: Schedule) => {
  writeFileSync(path(g), JSON.stringify(s, null, 2) + "\n");
  return s;
};

/** The recording a batch came from: any prop pointing into footage/, else its clip prop, else the batch. */
const clipOf = (b: Batch): string => {
  const props = b.renders[0]?.props ?? {};
  const footage = Object.values(props).find((v): v is string => typeof v === "string" && v.startsWith("footage/"));
  if (footage) return footage;
  const clip = props.clip;
  return typeof clip === "string" && clip ? clip : `batch:${b.id}`;
};
const hookOf = (b: Batch): string => {
  const props = b.renders[0]?.props ?? {};
  for (const k of ["hook", "line", "title"]) {
    const v = props[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
};

/** What the drafter gets to work from: the hook, the clip's note, the spotlight's item. */
const draftInput = (g: GameConfig, b: Batch): DraftInput => {
  const props = b.renders[0]?.props ?? {};
  const footage = clipOf(b);
  const side = footage.startsWith("footage/") ? readSidecar(g, footage.slice(8)) : undefined;
  const hook = hookOf(b).split("|")[0]!.trim();
  return { template: b.template, hook, note: side?.note ?? "" };
};

/**
 * The words for a batch: the game's template draft, then — with a key and a
 * voice — Claude's, which wins unless the call fails.
 */
const wordsFor = async (g: GameConfig, b: Batch): Promise<Pick<Post, "title" | "description" | "titleOptions" | "draftedBy">> => {
  const r = b.renders.find((x) => x.format === "vertical") ?? b.renders[0]!;
  const fallback = g.post ? g.post.draft(b.template, r.props) : { title: b.name, description: hookOf(b) };
  if (!g.post?.ai || !hasClaude()) return { ...fallback, draftedBy: "template" };
  try {
    const ai = await draftWithClaude(g.post.ai, draftInput(g, b));
    return { ...ai, draftedBy: "claude" };
  } catch (e) {
    console.warn(`⚠ draft for ${b.name} fell back to the template: ${(e as Error).message}`);
    return { ...fallback, draftedBy: "template" };
  }
};

/**
 * Queue these batches (the vertical of each, or its first render), each in
 * the next free slot that keeps the clip-spacing rule, in the order given.
 * Batches already queued or ignored are skipped. Returns the schedule and
 * where each landed. Drafting runs before the file is touched, so a slow
 * or failed call never leaves a half-written queue.
 */
export const queueBatches = async (g: GameConfig, ids: string[], from = today()): Promise<{ schedule: Schedule; placed: Post[]; skipped: string[] }> => {
  const before = readSchedule(g);
  const batches = listBatches(g);
  const skipped: string[] = [];
  const todo: Batch[] = [];
  for (const id of ids) {
    const b = batches.find((x) => x.id === id);
    if (!b || before.posts.some((p) => p.batch === id) || before.ignored.includes(id)) skipped.push(id);
    else todo.push(b);
  }
  const words = await Promise.all(todo.map((b) => wordsFor(g, b)));
  const s = readSchedule(g);
  const placed: Post[] = [];
  todo.forEach((b, i) => {
    if (s.posts.some((p) => p.batch === b.id)) return; // queued meanwhile
    const r = b.renders.find((x) => x.format === "vertical") ?? b.renders[0]!;
    const clip = clipOf(b);
    const at = placeOne(s, s.posts, clip, from);
    const post: Post = { id: crypto.randomUUID(), batch: b.id, slug: r.slug, name: b.name, template: b.template, clip, hook: hookOf(b), ...at, ...words[i]!, posted: {}, createdAt: new Date().toISOString() };
    s.posts.push(post);
    placed.push(post);
  });
  return { schedule: writeSchedule(g, s), placed, skipped };
};

/** Fresh words for a post that's already queued (the Queue's Redraft button). */
export const redraftPost = async (g: GameConfig, id: string): Promise<Schedule> => {
  const s = readSchedule(g);
  const p = s.posts.find((x) => x.id === id);
  if (!p) throw new Error(`no post ${id}`);
  const b = listBatches(g).find((x) => x.id === p.batch);
  if (!b) throw new Error("its render is gone");
  if (!g.post?.ai || !hasClaude()) throw new Error("no ANTHROPIC_API_KEY in apps/desk/.env");
  const ai = await draftWithClaude(g.post.ai, draftInput(g, b));
  Object.assign(p, ai, { draftedBy: "claude" });
  return writeSchedule(g, s);
};

export const updatePost = (g: GameConfig, id: string, patch: Partial<Pick<Post, "day" | "slot" | "title" | "description" | "posted">>): Schedule => {
  const s = readSchedule(g);
  const p = s.posts.find((x) => x.id === id);
  if (!p) throw new Error(`no post ${id}`);
  if (patch.day !== undefined) p.day = patch.day;
  if (patch.slot !== undefined) p.slot = patch.slot;
  if (patch.title !== undefined) p.title = patch.title;
  if (patch.description !== undefined) p.description = patch.description;
  if (patch.posted !== undefined) p.posted = patch.posted;
  return writeSchedule(g, s);
};

export const removePost = (g: GameConfig, id: string): Schedule => {
  const s = readSchedule(g);
  s.posts = s.posts.filter((p) => p.id !== id);
  return writeSchedule(g, s);
};

/** Ignore a batch (experiments): off the queue if it was on it, and never auto-queued. */
export const setIgnored = (g: GameConfig, batch: string, ignored: boolean): Schedule => {
  const s = readSchedule(g);
  s.ignored = s.ignored.filter((b) => b !== batch);
  if (ignored) {
    s.ignored.push(batch);
    s.posts = s.posts.filter((p) => p.batch !== batch);
  }
  return writeSchedule(g, s);
};

export const updateSettings = (g: GameConfig, patch: Partial<Settings>): Schedule => {
  const s = readSchedule(g);
  if (patch.slotsPerDay !== undefined) s.slotsPerDay = Math.max(1, Math.min(6, Math.round(patch.slotsPerDay)));
  if (patch.minGapDays !== undefined) s.minGapDays = Math.max(1, Math.min(14, Math.round(patch.minGapDays)));
  if (patch.slotLabels !== undefined) s.slotLabels = patch.slotLabels;
  while (s.slotLabels.length < s.slotsPerDay) s.slotLabels.push(`slot ${s.slotLabels.length + 1}`);
  return writeSchedule(g, s);
};

/**
 * Missed a day? Everything not fully posted is lifted, kept in its order,
 * and put back from today under the spacing rule — done posts stay where
 * they were and still count for spacing.
 */
export const reflow = (g: GameConfig, from = today()): Schedule => {
  const s = readSchedule(g);
  const done = s.posts.filter(isDone);
  const open = s.posts.filter((p) => !isDone(p)).sort((a, b) => (a.day === b.day ? a.slot - b.slot : a.day < b.day ? -1 : 1));
  const taken = [...done];
  for (const p of open) {
    const at = placeOne(s, taken, p.clip, from);
    p.day = at.day;
    p.slot = at.slot;
    taken.push(p);
  }
  s.posts = [...done, ...open];
  return writeSchedule(g, s);
};

/** Posts that are gone from the library (deleted renders) drop off the queue. */
export const pruneSchedule = (g: GameConfig): Schedule => {
  const s = readSchedule(g);
  const have = new Set(listBatches(g).map((b) => b.id));
  const kept = s.posts.filter((p) => have.has(p.batch));
  const ignored = s.ignored.filter((b) => have.has(b));
  return kept.length === s.posts.length && ignored.length === s.ignored.length ? s : writeSchedule(g, { ...s, posts: kept, ignored });
};
