/**
 * The Desk — `bun run desk` at the repo root. One local page for the whole
 * promo loop of every registered game (games.ts): raw clips in (Drive),
 * cleanup (ffmpeg), template + props → render (Remotion), and the library
 * of finished videos (+ Drive upload).
 *
 * Bun bundles the React page from index.html itself (HMR in dev); the API
 * is plain JSON under /api/<game>/…. A game's public dir is served at
 * /g/<game>/… for the page, AND at the root for whichever game the page
 * last selected (cookie) — that's what the templates' staticFile() paths
 * resolve to inside the live preview.
 */
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import index from "./index.html";
import { type GameConfig } from "./game";
import { GAMES, gameById } from "./games";
import { type CleanupSpec, cleanupClip, ffprobe, filmstrip, thumbnail } from "./lib/ffmpeg";
import { footageDir, listBinned, listClips, publicDir, readSidecar, restoreClip, syncFootage, trashClip, writeSidecar } from "./lib/footage";
import { jobs, renderStillTo, rendersDir, startRender } from "./lib/render";
import { deleteBatch, deleteRender, listBatches, listRenders, uploadRenders } from "./lib/renders";
import { type FootageSidecar, MEDIA_EXT, freshSidecar } from "./lib/sidecar";

const PORT = Number(process.env.DESK_PORT ?? 3400);

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (e: unknown, status = 500) => json({ error: (e as Error).message ?? String(e) }, status);
const safeName = (name: string) => basename(name); // never walk out of a folder

/** A file response that honours Range, so <video> can seek. */
const file = (path: string, req?: Request): Response => {
  if (!existsSync(path) || !statSync(path).isFile()) return new Response("not found", { status: 404 });
  const f = Bun.file(path);
  const range = req?.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) return new Response(f, { headers: { "Accept-Ranges": "bytes" } });
  const start = m[1] ? Number(m[1]) : Math.max(0, f.size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), f.size - 1) : f.size - 1;
  if (start > end || start >= f.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${f.size}` } });
  return new Response(f.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Range": `bytes ${start}-${end}/${f.size}`, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), "Content-Type": f.type },
  });
};

/** Route helper: resolve :game or 404. */
const withGame = (fn: (g: GameConfig, req: Request & { params: Record<string, string> }) => Response | Promise<Response>) => (req: Request & { params: Record<string, string> }) => {
  const g = gameById(req.params.game ?? "");
  return g ? fn(g, req) : json({ error: `unknown game ${req.params.game}` }, 404);
};

// Each game's prepare step (e.g. sync icons from the game app) once at start.
for (const g of GAMES) {
  for (const cmd of g.prepare ?? []) {
    const p = Bun.spawnSync(cmd, { cwd: g.root, stdout: "inherit", stderr: "inherit" });
    if (p.exitCode !== 0) console.warn(`⚠ ${g.id}: ${cmd.join(" ")} exited ${p.exitCode}`);
  }
}

const server = Bun.serve({
  port: PORT,
  // Sync, cleanup and Drive upload answer only when the child process is done,
  // which can be minutes; Bun's default 10s idle timeout would drop the socket
  // under them. 255 is the ceiling Bun allows.
  idleTimeout: 255,
  // Full page reloads on change, not hot swaps: the templates load as a lazy
  // chunk and a hot-swapped screen would keep the old one until a reload.
  development: { hmr: false, console: true },
  routes: {
    "/": index,
    "/api/games": {
      GET: () => json(GAMES.map((g) => ({ id: g.id, name: g.name, icon: `/g/${g.id}/${g.icon}`, fps: g.fps, formats: g.formats, footageFolderId: g.drive.footageFolderId, footageDir: g.footageDir, rendersDir: g.rendersDir }))),
    },

    // ── raw clips ──
    "/api/:game/clips": { GET: withGame((g) => json(listClips(g))) },
    "/api/:game/clips/sync": {
      POST: withGame(async (g, req) => json(await syncFootage(g, { offline: new URL(req.url).searchParams.get("offline") === "1" }))),
    },
    /** What's been binned; restore puts a recording back (from .trash/, or off the ledger so Drive re-sends it). */
    "/api/:game/bin": { GET: withGame((g) => json(listBinned(g))) },
    "/api/:game/bin/:file/restore": { POST: withGame((g, req) => json(restoreClip(g, safeName(decodeURIComponent(req.params.file!))))) },
    "/api/:game/clips/:file": {
      GET: withGame((g, req) => {
        const side = readSidecar(g, safeName(decodeURIComponent(req.params.file!)));
        return side ? json(side) : json({ error: "no such clip" }, 404);
      }),
      /** Save the sidecar's editable fields (title/line/note/crop…). */
      PUT: withGame(async (g, req) => {
        const name = safeName(decodeURIComponent(req.params.file!));
        const prev = readSidecar(g, name);
        if (!prev) return json({ error: "no such clip" }, 404);
        const patch = (await req.json()) as Partial<FootageSidecar>;
        const next: FootageSidecar = { ...prev, ...patch, file: prev.file, facts: prev.facts };
        writeSidecar(g, next);
        return json(next);
      }),
      DELETE: withGame((g, req) => {
        trashClip(g, safeName(decodeURIComponent(req.params.file!)));
        return json({ ok: true });
      }),
    },
    "/api/:game/clips/:file/thumb": {
      GET: withGame((g, req) => {
        const name = safeName(decodeURIComponent(req.params.file!));
        const at = Number(new URL(req.url).searchParams.get("at") ?? 1);
        try {
          return file(thumbnail(join(footageDir(g), name), Math.max(0, at)));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    "/api/:game/clips/:file/strip": {
      GET: withGame((g, req) => {
        const name = safeName(decodeURIComponent(req.params.file!));
        const side = readSidecar(g, name);
        if (!side) return json({ error: "no such clip" }, 404);
        try {
          return file(filmstrip(join(footageDir(g), name), side.facts.seconds));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** Cut + crop into a new clip in the library. `replace` names an existing
     * cut of this recording to save over (re-cutting from the Clips screen). */
    "/api/:game/clips/:file/cleanup": {
      POST: withGame(async (g, req) => {
        const name = safeName(decodeURIComponent(req.params.file!));
        const body = (await req.json()) as CleanupSpec & { name: string; replace?: string };
        const src = readSidecar(g, name);
        if (!src) return json({ error: "no such clip" }, 404);
        const outName = `${safeName(body.name).replace(MEDIA_EXT, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "clip"}.mp4`;
        const dir = footageDir(g);
        const replacing = body.replace && outName === safeName(body.replace) ? readSidecar(g, outName) : undefined;
        if (existsSync(join(dir, outName)) && !replacing) return json({ error: `${outName} already exists — pick another name` }, 409);
        if (replacing && replacing.source !== src.file) return json({ error: `${outName} was cut from ${replacing.source ?? "somewhere else"}, not ${src.file}` }, 409);
        // Always encode to a .partial beside the target, then swap in: a failed or
        // cancelled cut leaves no half-written .mp4 (the library skips .partial),
        // and a failed re-cut leaves the old cut intact.
        const tmp = join(dir, `.${outName}.partial`);
        try {
          await cleanupClip(join(dir, name), tmp, body, req.signal);
          renameSync(tmp, join(dir, outName));
          const facts = { ...ffprobe(join(dir, outName)), recordedAt: src.facts.recordedAt, bytes: statSync(join(dir, outName)).size };
          const keep = replacing ?? src;
          const side: FootageSidecar = {
            ...freshSidecar(outName, facts),
            title: keep.title,
            line: keep.line,
            note: keep.note,
            cropTop: 0,
            cropBottom: 0,
            muted: body.muted,
            source: src.file,
            cleanup: { segments: body.segments, transition: body.transition, transitionSeconds: body.transitionSeconds, cropTop: body.cropTop, cropBottom: body.cropBottom, muted: body.muted },
          };
          writeSidecar(g, side);
          return json(side);
        } catch (e) {
          rmSync(tmp, { force: true });
          return fail(e);
        }
      }),
    },

    // ── rendering ──
    "/api/:game/render": {
      POST: withGame(async (g, req) => {
        const body = (await req.json()) as { template: string; props: Record<string, unknown>; formats: string[]; name: string };
        const batch = crypto.randomUUID(); // the formats of one press = one batch in the library
        return json(body.formats.map((format) => startRender(g, { template: body.template, props: body.props, format, name: body.name, batch })));
      }),
    },
    "/api/:game/jobs": { GET: withGame((g) => json([...jobs.values()].filter((j) => j.game === g.id).sort((a, b) => b.startedAt - a.startedAt).slice(0, 30))) },
    "/api/:game/still": {
      POST: withGame(async (g, req) => {
        const body = (await req.json()) as { template: string; props: Record<string, unknown>; format: string; frame: number; name: string };
        const out = join(rendersDir(g), `${safeName(body.name)}-${body.format}-f${body.frame}.png`);
        try {
          await renderStillTo(g, { ...body, out });
          return json({ file: basename(out) });
        } catch (e) {
          return fail(e);
        }
      }),
    },

    // ── finished videos ──
    "/api/:game/renders": { GET: withGame((g) => json(listRenders(g))) },
    "/api/:game/batches": { GET: withGame((g) => json(listBatches(g))) },
    "/api/:game/batches/:id": {
      DELETE: withGame((g, req) => json({ ok: true, deleted: deleteBatch(g, decodeURIComponent(req.params.id!)) })),
    },
    /** One rclone run for however many renders — a whole batch, or the ones not on Drive yet. */
    "/api/:game/renders/upload": {
      POST: withGame(async (g, req) => {
        const body = (await req.json()) as { slugs: string[] };
        return json(await uploadRenders(g, (body.slugs ?? []).map(safeName)));
      }),
    },
    "/api/:game/renders/:slug": {
      DELETE: withGame((g, req) => {
        deleteRender(g, safeName(req.params.slug!));
        return json({ ok: true });
      }),
    },
    "/api/:game/renders/:slug/thumb": {
      GET: withGame((g, req) => {
        try {
          return file(thumbnail(join(rendersDir(g), `${safeName(req.params.slug!)}.mp4`), 1.5));
        } catch (e) {
          return fail(e);
        }
      }),
    },
  },
  /** Static: /g/<game>/renders/<file>, /g/<game>/<public path>, then the cookie-selected game's public dir at the root. */
  fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const m = /^\/g\/([^/]+)\/(.*)$/.exec(path);
    if (m) {
      const g = gameById(m[1]!);
      if (!g) return new Response("unknown game", { status: 404 });
      if (m[2]!.startsWith("renders/")) return file(join(rendersDir(g), safeName(m[2]!.slice(8))), req);
      const pub = publicDir(g);
      const p = join(pub, m[2]!);
      return p.startsWith(pub + "/") ? file(p, req) : new Response("not found", { status: 404 });
    }
    const cookie = /(?:^|;\s*)desk_game=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
    const g = gameById(cookie ?? "") ?? GAMES[0];
    if (g) {
      const pub = publicDir(g);
      const p = join(pub, path);
      if (p.startsWith(pub + "/")) return file(p, req);
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`\n  The Desk → http://localhost:${server.port}   (${GAMES.map((g) => g.name).join(", ")})\n`);
