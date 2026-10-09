/**
 * The ideas list's file: <rendersDir>/ideas.json, and everything that
 * changes it. Server only (node:fs).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameConfig } from "../game";
import type { Idea, IdeaPatch } from "./ideas";
import { rendersDir } from "./render";

const path = (g: GameConfig) => join(rendersDir(g), "ideas.json");

export const readIdeas = (g: GameConfig): Idea[] => {
  const p = path(g);
  if (!existsSync(p)) return [];
  try {
    const list = JSON.parse(readFileSync(p, "utf8")) as (Partial<Idea> & { text?: string })[];
    if (!Array.isArray(list)) return [];
    // `text` is the shape from before title and description were separate: first line → title.
    return list.map((i) => {
      const [first = "", ...rest] = (i.text ?? "").split("\n");
      return { id: i.id ?? crypto.randomUUID(), title: i.title ?? first, description: i.description ?? rest.join("\n"), done: i.done, createdAt: i.createdAt ?? new Date().toISOString() };
    });
  } catch {
    return [];
  }
};
const writeIdeas = (g: GameConfig, list: Idea[]) => {
  mkdirSync(rendersDir(g), { recursive: true });
  writeFileSync(path(g), JSON.stringify(list, null, 2) + "\n");
  return list;
};

/** Newest first, so a fresh idea is at the top of the page. */
export const addIdea = (g: GameConfig, title: string, description = ""): Idea[] => {
  const t = title.trim();
  if (!t) return readIdeas(g);
  return writeIdeas(g, [{ id: crypto.randomUUID(), title: t, description: description.trim(), createdAt: new Date().toISOString() }, ...readIdeas(g)]);
};

export const updateIdea = (g: GameConfig, id: string, patch: IdeaPatch): Idea[] => {
  const list = readIdeas(g);
  const i = list.find((x) => x.id === id);
  if (!i) throw new Error(`no idea ${id}`);
  if (patch.title !== undefined && patch.title.trim()) i.title = patch.title.trim();
  if (patch.description !== undefined) i.description = patch.description.trim();
  if (patch.done === true && !i.done) i.done = new Date().toISOString();
  if (patch.done === false) delete i.done;
  return writeIdeas(g, list);
};

export const removeIdea = (g: GameConfig, id: string): Idea[] => writeIdeas(g, readIdeas(g).filter((x) => x.id !== id));
