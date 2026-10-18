/**
 * Scripts from Google Docs (docs/design/desk-docs.md), server side: the
 * game's Video Scripts folder through rclone (a drive.readonly remote
 * rooted at the folder, like footage), each Doc exported as markdown so
 * its headings, bold and lists come with it. Pick one and the script
 * remembers it; Pull the latest replaces re-pasting. The Desk never
 * writes to the folder.
 *
 * rclone runs through exec (async): never spawnSync in a Bun.serve handler.
 */
import type { GameConfig } from "../game";
import { type DocEntry, cleanDocMarkdown, docTitle } from "./doc";
import { exec } from "./exec";
import type { Script } from "./scripts";
import { readScript, saveScript } from "./scriptsStore";

const EXPORT = ["--drive-export-formats", "md"];

const remoteOf = (g: GameConfig): string => {
  const { scriptsRemote: remote, scriptsFolderId: folder } = g.drive;
  if (!remote || !folder) throw new Error(`${g.name} has no scripts folder (drive.scriptsFolderId and scriptsRemote in its desk.config)`);
  return remote;
};

/** The one-time setup line for the remote (opens a browser to say yes). */
export const setupCommand = (g: GameConfig): string => `rclone config create ${g.drive.scriptsRemote} drive scope=drive.readonly root_folder_id=${g.drive.scriptsFolderId}`;

const ready = async (g: GameConfig, remote: string) => {
  const r = await exec(["rclone", "listremotes"], g.root);
  if (!r.ok) throw new Error("rclone isn't installed (brew install rclone)");
  if (!r.out.split("\n").includes(`${remote}:`)) throw new Error(`The Desk can't see your scripts folder yet. One-time setup, in a terminal (it opens a browser): ${setupCommand(g)}`);
};

type Listed = { Path: string; Name: string; MimeType: string; ModTime: string; ID?: string };

/** Listings, by game, for a little while: the page asks on every open. */
const cache = new Map<string, { at: number; docs: DocEntry[] }>();

/** Every Google Doc in the folder (and its subfolders), newest first. */
export const listDocs = async (g: GameConfig, fresh = false): Promise<DocEntry[]> => {
  const hit = cache.get(g.id);
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.docs;
  const remote = remoteOf(g);
  await ready(g, remote);
  const r = await exec(["rclone", "lsjson", `${remote}:`, "--recursive", "--files-only", ...EXPORT], g.root);
  if (!r.ok) throw new Error(`couldn't list the scripts folder: ${r.err.split("\n").find((l) => l.trim() && !l.includes("client_id")) ?? `rclone exit ${r.exitCode}`}`);
  const docs = (JSON.parse(r.out || "[]") as Listed[])
    // Drive says "text/markdown; charset=utf-8".
    .filter((f) => f.MimeType.startsWith("text/markdown") && f.ID)
    .map((f) => ({ id: f.ID!, name: docTitle(f.Name), path: f.Path, modified: f.ModTime }))
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
  cache.set(g.id, { at: Date.now(), docs });
  return docs;
};

/** The Doc as tidy markdown, found by its id (it may have been renamed or moved since). */
const fetchDoc = async (g: GameConfig, id: string): Promise<{ doc: DocEntry; text: string }> => {
  let doc = (await listDocs(g)).find((d) => d.id === id);
  if (!doc) doc = (await listDocs(g, true)).find((d) => d.id === id);
  if (!doc) throw new Error("that Doc isn't in the scripts folder any more");
  const r = await exec(["rclone", "cat", `${remoteOf(g)}:${doc.path}`, ...EXPORT], g.root);
  if (!r.ok) throw new Error(`couldn't read ${doc.name}: ${r.err.split("\n").find((l) => l.trim() && !l.includes("client_id")) ?? `rclone exit ${r.exitCode}`}`);
  return { doc, text: cleanDocMarkdown(r.out) };
};

/**
 * Pull a Doc into a script: its words become the script's source (the
 * box), the script remembers the Doc. With no `id`, the Doc it's already
 * linked to (Pull the latest). An untitled script takes the Doc's name.
 */
export const pullDoc = async (g: GameConfig, scriptId: string, id?: string): Promise<Script> => {
  const s = readScript(g, scriptId);
  if (!s) throw new Error(`no script ${scriptId}`);
  const docId = id ?? s.doc?.id;
  if (!docId) throw new Error("this script isn't linked to a Doc");
  const { doc, text } = await fetchDoc(g, docId);
  if (!text.trim()) throw new Error(`${doc.name} is empty`);
  // Read again: Tom may have changed something while Drive was answering.
  const now = readScript(g, scriptId) ?? s;
  const title = !now.title.trim() || now.title === "Untitled" || now.title === now.doc?.name ? doc.name : now.title;
  return saveScript(g, { ...now, title, source: text, doc: { id: doc.id, name: doc.name, modified: doc.modified, pulledAt: new Date().toISOString() } });
};

/** Forget the Doc: the words stay, the box is editable again. */
export const unlinkDoc = (g: GameConfig, scriptId: string): Script => {
  const s = readScript(g, scriptId);
  if (!s) throw new Error(`no script ${scriptId}`);
  const { doc: _doc, ...rest } = s;
  return saveScript(g, rest);
};

/** Drive's modified time for a script's Doc now (from the listing), to say when it's changed since the pull. */
export const docModified = async (g: GameConfig, scriptId: string): Promise<string | null> => {
  const s = readScript(g, scriptId);
  if (!s?.doc) return null;
  return (await listDocs(g)).find((d) => d.id === s.doc!.id)?.modified ?? null;
};
