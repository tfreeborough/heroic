/**
 * Tileset serving (docs/design/tilesets.md) — the second sanctioned exception to
 * Realmsmith's "no server", beside the Asset Forge. Zone JSON stores a tileset
 * *name*; the games resolve it through their bundled-asset manifests, and the
 * editor resolves it here: a dev-only Vite middleware that serves the repacked
 * atlas PNGs straight from the game apps' asset folders. No copies, no picker
 * ceremony per image — open a zone and the atlas it names just loads.
 *
 * Endpoints:
 *   GET /tilesets            → { tilesets: string[] }  (names found across apps —
 *                              drives the zone-settings switcher, so swapping to
 *                              any future set is one dropdown)
 *   GET /tilesets/<name>.png → the atlas image
 */
import type { ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

/** Tileset names are file names and registry keys — kebab/snake, letter first. */
const NAME_RE = /^[a-z][a-z0-9_-]*$/;

const json = (res: ServerResponse, code: number, body: unknown): void => {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

/** Every `apps/<app>/assets/tilesets` dir that exists (games own the images). */
const tilesetDirs = async (repoRoot: string): Promise<string[]> => {
  const appsDir = join(repoRoot, "apps");
  const apps = await readdir(appsDir, { withFileTypes: true });
  return apps
    .filter((a) => a.isDirectory())
    .map((a) => join(appsDir, a.name, "assets", "tilesets"))
    .filter((d) => existsSync(d));
};

export const tilesetServerPlugin = (): Plugin => {
  let repoRoot = "";

  return {
    name: "realmsmith-tilesets",
    apply: "serve",
    configResolved(config) {
      repoRoot = resolve(config.root, "../..");
    },
    configureServer(server) {
      server.middlewares.use("/tilesets", (req, res) => {
        void (async () => {
          // Mounted at /tilesets, so req.url arrives with that prefix stripped.
          const url = (req.url ?? "").split("?")[0] ?? "";
          const dirs = await tilesetDirs(repoRoot);

          if (url === "" || url === "/") {
            const names = new Set<string>();
            for (const dir of dirs) {
              for (const f of await readdir(dir)) {
                if (f.endsWith(".png")) names.add(f.slice(0, -4));
              }
            }
            return json(res, 200, { tilesets: [...names].sort() });
          }

          const m = /^\/([^/]+)\.png$/.exec(url);
          const name = m?.[1] ?? "";
          if (!NAME_RE.test(name)) return json(res, 400, { error: "bad tileset name" });
          for (const dir of dirs) {
            const file = join(dir, `${name}.png`);
            if (!existsSync(file)) continue;
            res.statusCode = 200;
            res.setHeader("content-type", "image/png");
            // Repacks land while the editor is open — always revalidate.
            res.setHeader("cache-control", "no-cache");
            res.end(await readFile(file));
            return;
          }
          json(res, 404, { error: `no tileset "${name}"` });
        })().catch((e: unknown) => {
          if (!res.headersSent)
            json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        });
      });
    },
  };
};
