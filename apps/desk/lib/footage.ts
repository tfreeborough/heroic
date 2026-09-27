/**
 * A game's raw-recording library: mirror its Google Drive drop folder into
 * its footage dir (additively), probe every media file, keep a sidecar per
 * clip. Used by the server and by `bun cli.ts sync <game>`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { GameConfig } from "../game";
import { exec } from "./exec";
import { ffprobe } from "./ffmpeg";
import { type FootageFacts, type FootageSidecar, MEDIA_EXT, freshSidecar, sidecarName } from "./sidecar";

export const footageDir = (g: GameConfig) => join(g.root, g.footageDir);
export const publicDir = (g: GameConfig) => join(g.root, g.publicDir);
const trashDir = (g: GameConfig) => join(footageDir(g), ".trash");
/** The bin ledger: names of recordings you binned. Committed (it's a .json in
 * the footage dir), so a binned raw never comes back from Drive — not on this
 * machine after `.trash/` is emptied, not on a fresh clone. */
const LEDGER = ".binned.json";
const ledgerPath = (g: GameConfig) => join(footageDir(g), LEDGER);
export const readBinned = (g: GameConfig): string[] => {
  try {
    const v = JSON.parse(readFileSync(ledgerPath(g), "utf8")) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const writeBinned = (g: GameConfig, names: string[]) => {
  const sorted = [...new Set(names)].sort();
  if (sorted.length) writeFileSync(ledgerPath(g), JSON.stringify(sorted, null, 2) + "\n");
  else if (existsSync(ledgerPath(g))) unlinkSync(ledgerPath(g));
};


/** Android/iOS recorders stamp the moment into the name: VID_20260912_194723, Screen_Recording_20260912-194723… */
const recordedAt = (file: string, mtime: Date): string => {
  const m = /(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/.exec(file);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return mtime.toISOString().slice(0, 19);
};

export const readSidecar = (g: GameConfig, file: string): FootageSidecar | undefined => {
  const p = join(footageDir(g), sidecarName(file));
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as FootageSidecar;
  } catch {
    return undefined;
  }
};

export const writeSidecar = (g: GameConfig, side: FootageSidecar) => {
  writeFileSync(join(footageDir(g), sidecarName(side.file)), JSON.stringify(side, null, 2) + "\n");
};

export const mediaFiles = (g: GameConfig): string[] => {
  mkdirSync(footageDir(g), { recursive: true });
  return readdirSync(footageDir(g))
    .filter((f) => MEDIA_EXT.test(f) && !f.endsWith(".partial"))
    .sort();
};

/** Probe anything new or changed; returns the log lines. */
export const probeAll = (g: GameConfig): string[] => {
  const log: string[] = [];
  for (const file of mediaFiles(g)) {
    const path = join(footageDir(g), file);
    const st = statSync(path);
    const side = readSidecar(g, file);
    if (side && side.facts?.bytes === st.size) continue;
    const facts: FootageFacts = { ...ffprobe(path), recordedAt: recordedAt(file, st.mtime), bytes: st.size };
    if (side) {
      writeSidecar(g, { ...side, file, facts });
      log.push(`↻ re-probed ${file} (${facts.seconds}s)`);
    } else {
      writeSidecar(g, freshSidecar(file, facts));
      log.push(`★ new ${file} (${facts.seconds}s, ${facts.width}×${facts.height}@${facts.fps})`);
    }
  }
  return log;
};

export type SyncResult = { ok: boolean; log: string };

/** Drive → footage dir (additive, media only), then probe. */
export const syncFootage = async (g: GameConfig, opts: { offline?: boolean; add?: string[] } = {}): Promise<SyncResult> => {
  const log: string[] = [];
  let ok = true;
  const dir = footageDir(g);
  mkdirSync(dir, { recursive: true });
  if (!opts.offline) {
    const remote = g.drive.footageRemote;
    const remotes = await exec(["rclone", "listremotes"], g.root);
    if (!remotes.ok) {
      log.push("⚠ rclone not available — skipping Drive (brew install rclone)");
      ok = false;
    } else if (!remotes.out.split("\n").includes(`${remote}:`)) {
      log.push(`⚠ no "${remote}" rclone remote yet — one-time setup (opens a browser):`);
      log.push(`  rclone config create ${remote} drive scope=drive.readonly root_folder_id=${g.drive.footageFolderId}`);
      ok = false;
    } else {
      // List first, then copy by name: a video is anything Drive calls a video
      // OR anything with a media extension, so a phone export saved without
      // an extension ("scorpion raw") still comes down, and lands here with
      // the extension its type says it needs. Binned names stay on Drive.
      const listed = await exec(["rclone", "lsjson", "--recursive", "--files-only", `${remote}:`], g.root);
      if (!listed.ok) {
        log.push("⚠ rclone couldn't list the Drive folder (offline?) — continuing with what's on disk");
        log.push(...listed.err.split("\n").filter((l) => l && !l.includes("shared Google Drive client_id")));
        ok = false;
      } else {
        const binned = readBinned(g);
        const files = JSON.parse(listed.out || "[]") as { Path: string; Name: string; Size: number; MimeType?: string }[];
        const want: { path: string; local: string; size: number }[] = [];
        const ignored: string[] = [];
        for (const f of files) {
          const ext = MEDIA_EXT.test(f.Name) ? "" : f.MimeType === "video/quicktime" ? ".mov" : f.MimeType?.startsWith("video/") ? ".mp4" : null;
          if (ext === null) {
            ignored.push(f.Path);
            continue;
          }
          const local = f.Name + ext;
          if (binned.includes(local) || binned.includes(f.Name)) continue;
          const have = join(dir, local);
          if (existsSync(have) && statSync(have).size === f.Size) continue;
          want.push({ path: f.Path, local, size: f.Size });
        }
        if (want.length) {
          const list = join(dir, ".sync-files");
          writeFileSync(list, want.map((w) => w.path).join("\n") + "\n");
          const r = await exec(["rclone", "copy", `${remote}:`, dir, "--files-from-raw", list, "--stats-one-line", "--stats", "10s", "--stats-log-level", "NOTICE"], g.root);
          unlinkSync(list);
          const noise = r.err.split("\n").filter((l) => l && !l.includes("shared Google Drive client_id"));
          if (noise.length) log.push(...noise);
          if (!r.ok) {
            log.push("⚠ rclone copy failed (offline?) — continuing with what's on disk");
            ok = false;
          }
          for (const w of want) {
            const down = join(dir, w.path);
            if (w.local !== basename(w.path) && existsSync(down)) {
              renameSync(down, join(dir, w.local));
              log.push(`⇣ ${w.path} → ${w.local} (no extension on Drive; it's a video, so it gets one here)`);
            } else if (existsSync(join(dir, w.local))) log.push(`⇣ ${w.local}`);
          }
        } else log.push(`⇣ Drive folder up to date (${files.length - ignored.length} recording${files.length - ignored.length === 1 ? "" : "s"} there, all here${binned.length ? `, ${binned.length} binned` : ""})`);
        for (const n of ignored) log.push(`· ignored ${n} on Drive — not a video`);
      }
    }
  }
  for (const src of opts.add ?? []) {
    if (!existsSync(src)) {
      log.push(`⚠ --add: no such file ${src}`);
      continue;
    }
    copyFileSync(src, join(dir, basename(src)));
    log.push(`+ imported ${basename(src)}`);
  }
  log.push(...probeAll(g));
  const files = mediaFiles(g);
  const orphans = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== LEDGER && !files.some((m) => sidecarName(m) === f));
  for (const o of orphans) log.push(`⚠ orphan sidecar ${o} — its recording isn't in the folder`);
  log.push(`✔ ${files.length} recording${files.length === 1 ? "" : "s"} in ${g.footageDir}/`);
  return { ok, log: log.join("\n") };
};

/** Everything the Desk lists: sidecars for every media file, newest first. */
export const listClips = (g: GameConfig): FootageSidecar[] =>
  mediaFiles(g)
    .map((f) => readSidecar(g, f))
    .filter((s): s is FootageSidecar => Boolean(s?.facts))
    .sort((a, b) => (a.facts.recordedAt < b.facts.recordedAt ? 1 : -1));

/** Out of the library, not off the disk: media + sidecar go to .trash/, and
 * the name goes in the ledger so the next Drive sync leaves it there. */
export const trashClip = (g: GameConfig, file: string) => {
  mkdirSync(trashDir(g), { recursive: true });
  for (const f of [file, sidecarName(file)]) {
    const from = join(footageDir(g), f);
    if (existsSync(from)) renameSync(from, join(trashDir(g), f));
  }
  writeBinned(g, [...readBinned(g), file]);
};

export type Binned = { file: string; /** Still in .trash/ — restore puts it straight back. */ onDisk: boolean };
/** Everything binned: the ledger plus anything sitting in .trash/. */
export const listBinned = (g: GameConfig): Binned[] => {
  const inTrash = existsSync(trashDir(g)) ? readdirSync(trashDir(g)).filter((f) => MEDIA_EXT.test(f)) : [];
  const live = mediaFiles(g); // a name that's back in the library (an old sync re-fetched it) isn't binned
  const names = [...new Set([...readBinned(g), ...inTrash])].filter((n) => !live.includes(n)).sort();
  return names.map((file) => ({ file, onDisk: inTrash.includes(file) }));
};

/** Back into the library: from .trash/ if it's still there, else off the
 * ledger so the next sync fetches it from Drive again. */
export const restoreClip = (g: GameConfig, file: string): { onDisk: boolean } => {
  let onDisk = false;
  for (const f of [file, sidecarName(file)]) {
    const from = join(trashDir(g), f);
    if (!existsSync(from) || existsSync(join(footageDir(g), f))) continue;
    renameSync(from, join(footageDir(g), f));
    if (f === file) onDisk = true;
  }
  writeBinned(g, readBinned(g).filter((n) => n !== file));
  return { onDisk };
};
