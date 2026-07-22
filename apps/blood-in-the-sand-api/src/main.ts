/**
 * The business-logic API (glory-economy.md) — identity + Glory wallet, later
 * the store/entitlements. Deliberately a SEPARATE service from the game
 * server: economy code deploys daily without dropping live matches, and
 * nothing here shares the sim's frame budget. The two services share the
 * Turso database through @heroic/blood-in-the-sand-persistence, never each other's HTTP.
 *
 * Env: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (Turso in production; defaults
 * to a local `file:dev.db` so local dev needs no credentials), PORT.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import {
  createDb,
  ensureSchema,
  findPlayerByToken,
  gloryBalance,
  registerPlayer,
} from "@heroic/blood-in-the-sand-persistence";

const dbUrl = process.env.TURSO_DATABASE_URL ?? "file:dev.db";
const db = createDb(dbUrl, process.env.TURSO_AUTH_TOKEN);
await ensureSchema(db);
if (!process.env.TURSO_DATABASE_URL) {
  console.log("⚠️  TURSO_DATABASE_URL not set — using local file:dev.db");
}

// The game server owns 7777; the API sits beside it on 7780 in dev.
const port = Number(process.env.PORT ?? 7780);

const app = new Hono();

/** Health check (Render pings this). */
app.get("/", (c) => c.json({ ok: true }));

/**
 * Mint an anonymous identity — no signup, ever (monetisation.md). The token
 * comes back exactly once; the client keeps it in the device keychain and
 * everything else authenticates with it.
 */
app.post("/register", async (c) => c.json(await registerPlayer(db)));

/** Resolve the bearer token, or null → the route 401s. */
const authedPlayer = async (c: Context): Promise<string | null> => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return findPlayerByToken(db, header.slice("Bearer ".length));
};

app.get("/wallet", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  return c.json({ glory: await gloryBalance(db, playerId) });
});

Bun.serve({ port, fetch: app.fetch });
console.log(`⚔️  blood-in-the-sand API listening on port ${port} (db: ${dbUrl})`);
