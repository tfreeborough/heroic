/**
 * The one database connection (hq.md § Decision 1): HQ is a third service
 * on the shared-Turso rule, reading through the persistence package like
 * the API and game server do. Cached on globalThis so `next dev`'s module
 * reloads don't open a connection per edit.
 *
 * Env: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN — same values as the API.
 * Unset = the repo's local dev.db, the file the API and server share.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDb, ensureSchema, type Db } from "@heroic/blood-in-the-sand-persistence";

const localDbFile = resolve(process.cwd(), "../../db/dev.db");

const g = globalThis as { __hqDb?: Promise<Db> };

export const db = (): Promise<Db> => {
  if (!g.__hqDb) {
    g.__hqDb = (async () => {
      const url = process.env.TURSO_DATABASE_URL ?? `file:${localDbFile}`;
      if (!process.env.TURSO_DATABASE_URL) mkdirSync(dirname(localDbFile), { recursive: true });
      const handle = createDb(url, process.env.TURSO_AUTH_TOKEN);
      await ensureSchema(handle);
      return handle;
    })();
  }
  return g.__hqDb;
};

/** Unix seconds now — every stats read takes the clock explicitly. */
export const nowS = (): number => Math.floor(Date.now() / 1000);

/** Which database this HQ is looking at, for the footer. */
export const dbLabel = (): string =>
  process.env.TURSO_DATABASE_URL ? new URL(process.env.TURSO_DATABASE_URL).host || "turso" : "local dev.db";
