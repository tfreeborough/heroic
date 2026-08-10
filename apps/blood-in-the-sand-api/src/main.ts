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
import { RANKED_BRACKETS, WRIT_ITEM_IDS } from "@heroic/blood-in-the-sand-sim";
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
  exchangeGloryForWrit,
  findPlayerByToken,
  gloryBalance,
  gloryEarned,
  rankedSummary,
  recentForm,
  recordGlory,
  recordWrit,
  registerPlayer,
  rungAbove,
  unlockWithWrit,
  writBalance,
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
  const [glory, writs] = await Promise.all([
    gloryBalance(db, playerId),
    writBalance(db, playerId),
  ]);
  return c.json({ glory, writs });
});

/**
 * The store (bits-store.md): one universal Writ unlocks any weapon or spell.
 * The Glory price of a Writ is THE tunable economy knob — env-set,
 * server-side, never client-trusted. Default derives from the ~4–5h grind
 * target at current ranked earn rates (~14 Glory/match average).
 */
const WRIT_GLORY_PRICE = Math.max(1, Number(process.env.WRIT_GLORY_PRICE ?? 800));

/** Everything the store screen needs to render prices and the shelf. */
app.get("/store", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  return c.json({ writGloryPrice: WRIT_GLORY_PRICE, writItems: WRIT_ITEM_IDS });
});

/** Fresh balances after any store mutation — one shape, every response. */
const walletOf = async (playerId: string) => {
  const [glory, writs] = await Promise.all([
    gloryBalance(db, playerId),
    writBalance(db, playerId),
  ]);
  return { glory, writs };
};

/**
 * Glory → 1 Writ, atomically. The client mints a uuid per tap (`key`) so a
 * network retry of the same tap can never buy two Writs; a missing/odd key
 * gets a server-minted one (that request is then simply non-retryable).
 */
app.post("/store/exchange", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { key?: unknown };
  const key =
    typeof body.key === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.key)
      ? body.key
      : crypto.randomUUID();
  const result = await exchangeGloryForWrit(db, { playerId, price: WRIT_GLORY_PRICE, key });
  if (result === "insufficient") {
    return c.json({ error: "insufficient_glory", price: WRIT_GLORY_PRICE }, 409);
  }
  return c.json(await walletOf(playerId)); // "duplicate" = that tap already succeeded
});

/**
 * 1 Writ → a permanent entitlement. Only writ-gated roster ids are for sale
 * — deed items (secrets) are earned, never bought. Already-owned is a no-op
 * success and never charges (the persistence layer guards this atomically).
 */
app.post("/store/unlock", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { itemId?: unknown };
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!WRIT_ITEM_IDS.includes(itemId)) return c.json({ error: "not_purchasable" }, 400);
  const result = await unlockWithWrit(db, { playerId, itemId });
  if (result === "insufficient") return c.json({ error: "insufficient_writs" }, 409);
  return c.json({ ...(await walletOf(playerId)), owned: true });
});

/**
 * Dev-only store tools (bits-store.md § testing): ledger grants + purchase
 * resets so the whole Glory→Writ→unlock flow is testable without money.
 * The routes DO NOT EXIST unless STORE_DEV_TOOLS=1 — never set in prod.
 */
if (process.env.STORE_DEV_TOOLS === "1") {
  console.log("🛠  STORE_DEV_TOOLS on — /dev/grant + /dev/reset-purchases live");

  app.post("/dev/grant", async (c) => {
    const playerId = await authedPlayer(c);
    if (!playerId) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { glory?: unknown; writs?: unknown };
    const glory = Math.trunc(Number(body.glory ?? 0)) || 0;
    const writs = Math.trunc(Number(body.writs ?? 0)) || 0;
    if (glory !== 0) {
      await recordGlory(db, {
        playerId,
        amount: glory,
        source: "dev-grant",
        idempotencyKey: `dev:${crypto.randomUUID()}`,
      });
    }
    if (writs !== 0) {
      await recordWrit(db, {
        playerId,
        amount: writs,
        source: "dev-grant",
        idempotencyKey: `dev:${crypto.randomUUID()}`,
      });
    }
    return c.json(await walletOf(playerId));
  });

  /** Forget every store purchase (entitlements bought with Writs) — deed
   * grants are untouched; Writ balances stay as they are. */
  app.post("/dev/reset-purchases", async (c) => {
    const playerId = await authedPlayer(c);
    if (!playerId) return c.json({ error: "unauthorized" }, 401);
    await db.execute({
      sql: "DELETE FROM entitlements WHERE player_id = ? AND source LIKE 'purchase:%'",
      args: [playerId],
    });
    return c.json({ ok: true });
  });
}

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
