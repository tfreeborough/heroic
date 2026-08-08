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
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { RANKED_BRACKETS } from "@heroic/blood-in-the-sand-sim";
import {
  PLACEMENT_MATCHES,
  RATING_START,
  achievementCounters,
  achievementUnlocks,
  createDb,
  displayFloorOf,
  displayRungFor,
  ensureSchema,
  entitlementsOf,
  findPlayerByToken,
  gloryBalance,
  gloryEarned,
  rankedSummary,
  recentForm,
  registerPlayer,
  rungAbove,
} from "@heroic/blood-in-the-sand-persistence";

// Local fallback: the ONE repo-anchored file every service shares — never a
// cwd-relative path (see the game server's main.ts for the 2026-07-29 story).
const localDbFile = resolve(import.meta.dir, "../../../db/dev.db");
const dbUrl = process.env.TURSO_DATABASE_URL ?? `file:${localDbFile}`;
if (!process.env.TURSO_DATABASE_URL) mkdirSync(dirname(localDbFile), { recursive: true });
const db = createDb(dbUrl, process.env.TURSO_AUTH_TOKEN);
await ensureSchema(db);
if (!process.env.TURSO_DATABASE_URL) {
  console.log(`⚠️  TURSO_DATABASE_URL not set — using ${localDbFile}`);
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

/** Season config — must match the game server's (ranked.ts). One constant,
 * two readers; promote to shared config if it ever grows past a number. */
const SEASON = 1;

/**
 * The caller's ranked standing (bits-ranked.md § display v2): one row per
 * bracket, unplayed brackets synthesized at the 1500 default so the client
 * never special-cases a fresh player. Everything band-shaped is computed
 * here — display tier (sticky-badge grace), the tier's floor, the next tier
 * up — the client renders progress, never re-implements the bands.
 */
app.get("/ranked/me", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  const rows = await rankedSummary(db, playerId, SEASON);
  const brackets = await Promise.all(
    Object.keys(RANKED_BRACKETS).map(async (bracket) => {
      const row = rows.find((r) => r.bracket === bracket);
      const played = (row?.wins ?? 0) + (row?.losses ?? 0);
      const rating = row?.rating ?? RATING_START;
      const peak = row?.peak ?? RATING_START;
      const rung = displayRungFor(rating, peak);
      const next = rungAbove(rung);
      return {
        bracket,
        rating,
        tier: rung.tier,
        division: rung.division,
        // Initiate gets a synthetic display floor (1150) — the client hides
        // the progress bar entirely while rating < rankFloor.
        rankFloor: displayFloorOf(rung),
        // null at the top of the ladder — the client shows summit copy
        // instead of a progress target.
        nextRank: next,
        peak,
        // Last 10 results, oldest → newest — the form-dots row. Skipped for
        // never-played brackets (no row, nothing to query).
        form: row ? await recentForm(db, playerId, SEASON, bracket) : [],
        wins: row?.wins ?? 0,
        losses: row?.losses ?? 0,
        // > 0 = still placing: the client hides rank + rating and shows
        // placement progress instead (Tom, 2026-07-30).
        placementsLeft: Math.max(0, PLACEMENT_MATCHES - played),
      };
    }),
  );
  return c.json({ season: SEASON, brackets });
});

/**
 * The deeds screen's one read (achievements.md § API): unlocked ids +
 * timestamps, lifetime counters (milestone progress bars), and owned
 * entitlements. Definitions ship in the app bundle (the sim package) — only
 * STATE lives here. `glory_earned` is served live off the ledger, not the
 * counter row, so Glory earned before the achievements deploy still counts
 * toward the map's progress display.
 */
app.get("/achievements/me", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  const [unlocks, counters, entitlements, earned] = await Promise.all([
    achievementUnlocks(db, playerId),
    achievementCounters(db, playerId),
    entitlementsOf(db, playerId),
    gloryEarned(db, playerId),
  ]);
  return c.json({
    unlocks,
    counters: { ...counters, glory_earned: earned },
    entitlements,
  });
});

Bun.serve({ port, fetch: app.fetch });
console.log(`⚔️  blood-in-the-sand API listening on port ${port} (db: ${dbUrl})`);
