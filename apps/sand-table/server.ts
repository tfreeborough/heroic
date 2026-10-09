/**
 * The Sand Table — `bun run sand` at the repo root → http://localhost:3500.
 * A hand-drawn whiteboard in the game's colours for explainers on camera.
 *
 * Bun bundles the React page from index.html; the API is JSON under
 * /api/<game>/…; the game's art is served under /stamps/<game>/… and the
 * finished clips under /out/<game>/….
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import index from "./index.html";
import { type GameBrand, GAMES, gameById } from "./games";
import { type ExportSpec, abandonExport, addFrame, exports, finishExport, record, sendToDesk, startExport, still } from "./lib/export";
import type { Scene } from "./lib/scene";
import { listOut, listScenes, outDir, readScene, removeOut, removeScene, renameScene, safeName, writeScene } from "./lib/store";
import { listStamps, stampPath } from "./lib/stamps";

const PORT = Number(process.env.SAND_PORT ?? 3500);

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (e: unknown, status = 500) => json({ error: (e as Error).message ?? String(e) }, status);

/** A file response that honours Range, so <video> can seek. */
const file = (path: string, req?: Request): Response => {
  if (!existsSync(path) || !statSync(path).isFile()) return new Response("not found", { status: 404 });
  const f = Bun.file(path);
  const range = req?.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) return new Response(f, { headers: { "Accept-Ranges": "bytes", "Cache-Control": "no-cache" } });
  const CHUNK = 4 * 1024 * 1024;
  const start = m[1] ? Number(m[1]) : Math.max(0, f.size - Number(m[2]));
  const end = Math.min(m[1] && m[2] ? Number(m[2]) : f.size - 1, f.size - 1, start + CHUNK - 1);
  if (start > end || start >= f.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${f.size}` } });
  return new Response(f.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Range": `bytes ${start}-${end}/${f.size}`, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), "Content-Type": f.type },
  });
};

type Req = Request & { params: Record<string, string> };
const withGame = (fn: (g: GameBrand, req: Req) => Response | Promise<Response>) => (req: Req) => {
  const g = gameById(req.params.game ?? "");
  return g ? fn(g, req) : json({ error: `unknown game ${req.params.game}` }, 404);
};

const publicBrand = (g: GameBrand) => ({ id: g.id, name: g.name, palette: g.palette, background: g.background, stampGroups: g.stamps.map((s) => ({ id: s.id, label: s.label })), desk: Boolean(g.deskGame) });

// Frames of an export that never finished (the page was closed mid-way) are just litter.
for (const g of GAMES) {
  const dir = outDir(g.id);
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.startsWith(".frames-")) rmSync(join(dir, f), { recursive: true, force: true });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255,
  development: { hmr: false, console: true },
  routes: {
    "/": index,
    "/api/games": () => json(GAMES.map(publicBrand)),
    "/game-icon/:game": withGame((g) => file(g.icon)),
    "/fonts/:game/title.ttf": withGame((g) => file(g.titleFont)),
    "/stamps/:game/:group/:file": withGame((g, req) => {
      const p = stampPath(g, req.params.group ?? "", req.params.file ?? "");
      return p ? file(p, req) : new Response("not found", { status: 404 });
    }),
    "/api/:game/stamps": withGame((g) => json(listStamps(g))),

    "/api/:game/scenes": {
      GET: withGame((g) => json(listScenes(g.id))),
      POST: withGame(async (g, req) => {
        const { name } = (await req.json()) as { name?: string };
        const s = await readScene(g.id, name ?? "");
        if (s) return json({ error: `there's already a scene called ${safeName(name ?? "")}` }, 409);
        return json(await writeScene(g.id, { version: 1, name: safeName(name ?? ""), elements: [], camera: { x: 0, y: 0, zoom: 1 }, updatedAt: "" }));
      }),
    },
    "/api/:game/scenes/:name": {
      GET: withGame(async (g, req) => {
        const s = await readScene(g.id, req.params.name ?? "");
        return s ? json(s) : json({ error: "no such scene" }, 404);
      }),
      PUT: withGame(async (g, req) => {
        try {
          const body = (await req.json()) as Scene;
          return json(await writeScene(g.id, { ...body, name: req.params.name ?? body.name }));
        } catch (e) {
          return fail(e, 400);
        }
      }),
      DELETE: withGame((g, req) => {
        removeScene(g.id, req.params.name ?? "");
        return json({ ok: true });
      }),
    },
    "/api/:game/scenes/:name/rename": {
      POST: withGame(async (g, req) => {
        try {
          const { to } = (await req.json()) as { to: string };
          const s = await renameScene(g.id, req.params.name ?? "", to);
          return s ? json(s) : json({ error: "no such scene" }, 404);
        } catch (e) {
          return fail(e, 400);
        }
      }),
    },

    /** Frame-by-frame export: open a job, post the frames, finish → ffmpeg. */
    "/api/:game/exports": {
      GET: withGame((g) => json([...exports.values()].filter((j) => j.game === g.id).sort((a, b) => b.startedAt - a.startedAt).slice(0, 10))),
      POST: withGame(async (g, req) => {
        const spec = (await req.json()) as ExportSpec;
        if (!(spec.width > 0 && spec.height > 0 && spec.fps > 0)) return json({ error: "bad spec" }, 400);
        return json(startExport(g.id, spec));
      }),
    },
    "/api/:game/exports/:id/frames/:n": {
      PUT: async (req: Req) => {
        const job = exports.get(req.params.id ?? "");
        if (!job || job.state !== "open") return json({ error: "no open export" }, 404);
        try {
          await addFrame(job, Number(req.params.n), req.body);
          return json({ frames: job.frames });
        } catch (e) {
          return fail(e);
        }
      },
    },
    "/api/:game/exports/:id/finish": {
      POST: async (req: Req) => {
        const job = exports.get(req.params.id ?? "");
        if (!job) return json({ error: "no such export" }, 404);
        try {
          return json(await finishExport(job));
        } catch (e) {
          return fail(e);
        }
      },
    },
    "/api/:game/exports/:id": {
      DELETE: (req: Req) => {
        const job = exports.get(req.params.id ?? "");
        if (job) abandonExport(job);
        return json({ ok: true });
      },
    },
    /** A live recording (webm body) → mp4 in out/. */
    "/api/:game/recordings": {
      POST: withGame(async (g, req) => {
        try {
          return json({ file: await record(g.id, new URL(req.url).searchParams.get("name") ?? "recording", req.body, req.signal) });
        } catch (e) {
          return fail(e);
        }
      }),
    },
    "/api/:game/stills": {
      POST: withGame(async (g, req) => {
        try {
          return json({ file: await still(g.id, new URL(req.url).searchParams.get("name") ?? "still", req.body) });
        } catch (e) {
          return fail(e);
        }
      }),
    },
    "/api/:game/out": {
      GET: withGame((g) => json(listOut(g.id))),
    },
    "/api/:game/out/:file": {
      DELETE: withGame((g, req) => {
        removeOut(g.id, req.params.file ?? "");
        return json({ ok: true });
      }),
    },
    "/api/:game/out/:file/desk": {
      POST: withGame(async (g, req) => {
        if (!g.deskGame) return json({ error: `${g.name} isn't on the Desk` }, 400);
        try {
          return json(await sendToDesk(g.id, g.deskGame, req.params.file ?? ""));
        } catch (e) {
          return fail(e, 400);
        }
      }),
    },
    "/out/:game/:file": withGame((g, req) => file(join(outDir(g.id), basename(req.params.file ?? "")), req)),
  },
  fetch: () => new Response("not found", { status: 404 }),
});

console.log(`The Sand Table → http://localhost:${server.port}  (${GAMES.map((g) => g.name).join(", ")})`);
