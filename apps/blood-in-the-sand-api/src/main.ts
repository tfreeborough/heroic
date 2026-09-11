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
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { ACHIEVEMENT_DEFS, RANKED_BRACKETS, SIGNET_ITEM_IDS, SIGNET_PACKS } from "@heroic/blood-in-the-sand-sim";
import {
  FEEDBACK_EMAIL_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_STAMP_MAX,
  PLACEMENT_MATCHES,
  RATING_START,
  achievementCounters,
  achievementUnlocks,
  applyMatchAchievements,
  createDb,
  creditIapSignets,
  displayFloorOf,
  displayRungFor,
  ensureSchema,
  entitlementsOf,
  exchangeGloryForSignet,
  findPlayerByToken,
  gloryBalance,
  gloryEarned,
  linkAccount,
  linkedClerkUserId,
  listCodes,
  listFeedback,
  mintCodes,
  rankedSummary,
  recordFeedback,
  redeemCode,
  restoreAccount,
  setCodeActive,
  unlinkAccount,
  recentForm,
  registerPlayer,
  rungAbove,
  unlockWithSignet,
  signetBalance,
  type CodeKind,
  type FeedbackKind,
} from "@heroic/blood-in-the-sand-persistence";
import { accountsEnabled, deleteClerkUser, verifyClerkToken } from "./clerk";
import { verifyAppleTransaction } from "./iapApple";
import { verifyGooglePurchase } from "./iapGoogle";

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

/**
 * Belt-and-braces against the one deploy foot-gun the dev tools have: Bun
 * auto-loads .env.local, so a deploy that copies a working tree (instead of
 * building from git, as Render does) would silently ship the mock IAP arm —
 * a free-Signet faucet. A Turso URL means production data; refuse the
 * combination outright.
 */
if (
  process.env.STORE_DEV_TOOLS === "1" &&
  process.env.TURSO_DATABASE_URL &&
  !process.env.TURSO_DATABASE_URL.startsWith("file:")
) {
  // A hard exit, not a throw — an unhandled module-level throw under Bun has
  // been observed to leave a half-initialised process alive, which is exactly
  // what this guard must never allow.
  console.error(
    "FATAL: STORE_DEV_TOOLS=1 with a remote TURSO_DATABASE_URL — dev grant tools must never run against production data. Unset one.",
  );
  process.exit(1);
}

/**
 * Minimal fixed-window rate limiting, in-memory (the API is a single
 * instance by design — promote to a shared store if that ever changes).
 * Buckets are `route:principal` (IP for unauthenticated routes, playerId
 * once a token resolved). Returns true when the caller is over budget.
 */
const rateWindows = new Map<string, { count: number; resetAt: number }>();
const overLimit = (bucket: string, max: number, windowMs = 60_000): boolean => {
  const now = Date.now();
  // Lazy prune: the map only grows while abuse is in progress; sweep expired
  // windows once it's big enough to care about.
  if (rateWindows.size > 10_000) {
    for (const [key, w] of rateWindows) if (now >= w.resetAt) rateWindows.delete(key);
  }
  const w = rateWindows.get(bucket);
  if (!w || now >= w.resetAt) {
    rateWindows.set(bucket, { count: 1, resetAt: now + windowMs });
    return false;
  }
  w.count += 1;
  return w.count > max;
};

/** The caller's network identity for pre-auth limits — Render terminates
 * TLS, so the client address rides x-forwarded-for. */
const callerIp = (c: Context): string =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

const app = new Hono();

/** Health check (Render pings this). */
app.get("/", (c) => c.json({ ok: true }));

/**
 * Mint an anonymous identity — no signup, ever (monetisation.md). The token
 * comes back exactly once; the client keeps it in the device keychain and
 * everything else authenticates with it.
 */
app.post("/register", async (c) => {
  // Identity minting is free by design — but not unbounded: a mint costs us
  // a permanent row, and smurf fleets feed every farming scheme. 5/min/IP
  // is a lifetime's worth of legitimate first launches.
  if (overLimit(`register:${callerIp(c)}`, 5)) return c.json({ error: "rate_limited" }, 429);
  return c.json(await registerPlayer(db));
});

/** Resolve the bearer token, or null → the route 401s. */
const authedPlayer = async (c: Context): Promise<string | null> => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return findPlayerByToken(db, header.slice("Bearer ".length));
};

app.get("/wallet", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  const [glory, signets, clerkUserId] = await Promise.all([
    gloryBalance(db, playerId),
    signetBalance(db, playerId),
    linkedClerkUserId(db, playerId),
  ]);
  // `linked` + `accounts` drive the restore door's visibility
  // (bits-accounts.md): the wallet fetch already rides every screen that
  // shows the pill, so the client needs no second read to know its doors.
  return c.json({ glory, signets, linked: clerkUserId !== null, accounts: accountsEnabled });
});

/**
 * The store (bits-store.md): one universal Signet unlocks any weapon or spell.
 * The Glory price of a Signet is THE tunable economy knob — env-set,
 * server-side, never client-trusted. Default derives from the ~4–5h grind
 * target at current ranked earn rates (~14 Glory/match average).
 */
const SIGNET_GLORY_PRICE = Math.max(1, Number(process.env.SIGNET_GLORY_PRICE ?? 800));

/** Everything the store screen needs to render prices and the shelf. */
app.get("/store", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  // `accounts` is the kill switch's client face (bits-accounts.md): false
  // hides the post-purchase sheet, the restore door, and the Settings rows.
  return c.json({
    signetGloryPrice: SIGNET_GLORY_PRICE,
    signetItems: SIGNET_ITEM_IDS,
    accounts: accountsEnabled,
  });
});

/** Fresh balances after any store mutation — one shape, every response,
 * account fields included (the post-purchase offer keys off the wallet that
 * rides the purchase answer, bits-accounts.md). */
const walletOf = async (playerId: string) => {
  const [glory, signets, clerkUserId] = await Promise.all([
    gloryBalance(db, playerId),
    signetBalance(db, playerId),
    linkedClerkUserId(db, playerId),
  ]);
  return { glory, signets, linked: clerkUserId !== null, accounts: accountsEnabled };
};

/**
 * Glory → 1 Signet, atomically. The client mints a uuid per tap (`key`) so a
 * network retry of the same tap can never buy two Signets; a missing/odd key
 * gets a server-minted one (that request is then simply non-retryable).
 */
app.post("/store/exchange", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  if (overLimit(`store:${playerId}`, 60)) return c.json({ error: "rate_limited" }, 429);
  const body = (await c.req.json().catch(() => ({}))) as { key?: unknown };
  const key =
    typeof body.key === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.key)
      ? body.key
      : crypto.randomUUID();
  const result = await exchangeGloryForSignet(db, { playerId, price: SIGNET_GLORY_PRICE, key });
  if (result === "insufficient") {
    return c.json({ error: "insufficient_glory", price: SIGNET_GLORY_PRICE }, 409);
  }
  return c.json(await walletOf(playerId)); // "duplicate" = that tap already succeeded
});

/**
 * 1 Signet → a permanent entitlement. Only signet-gated roster ids are for sale
 * — deed items (secrets) are earned, never bought. Already-owned is a no-op
 * success and never charges (the persistence layer guards this atomically).
 */
app.post("/store/unlock", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  if (overLimit(`store:${playerId}`, 60)) return c.json({ error: "rate_limited" }, 429);
  const body = (await c.req.json().catch(() => ({}))) as { itemId?: unknown };
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!SIGNET_ITEM_IDS.includes(itemId)) return c.json({ error: "not_purchasable" }, 400);
  const result = await unlockWithSignet(db, { playerId, itemId });
  if (result === "insufficient") return c.json({ error: "insufficient_signets" }, 409);
  return c.json({ ...(await walletOf(playerId)), owned: true });
});

/**
 * Real-money Signet packs (bits-store.md § S3, ratified 2026-08-15). The
 * client hands over the STORE's proof of purchase — an Apple signed
 * transaction (JWS) or a Google purchase token — and every fact the credit
 * uses comes from server-side verification of that proof: the product from
 * the verified payload, the pack size from SIGNET_PACKS, the idempotency key
 * from the store's own transaction id (globally unique in the ledger, so a
 * receipt replayed from any account credits at most once, ever).
 *
 * Response contract the client's finishTransaction logic leans on:
 *  - 200 `{ glory, signets, credited }` — verified; credited is 0 when this
 *    transaction had already been credited (both cases: FINISH the store
 *    transaction, the Signets are banked).
 *  - 400 `invalid_receipt` / `unknown_product` — affirmatively not a valid
 *    purchase of ours; nothing credited.
 *  - 503 `store_unavailable` — verification infrastructure unreachable;
 *    KEEP the transaction unfinished and retry later (the replay-on-launch
 *    path re-submits it).
 */
app.post("/store/iap", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  if (overLimit(`iap:${playerId}`, 20)) return c.json({ error: "rate_limited" }, 429);
  const body = (await c.req.json().catch(() => ({}))) as {
    platform?: unknown;
    jws?: unknown;
    productId?: unknown;
    purchaseToken?: unknown;
    key?: unknown;
  };

  let platform: "apple" | "google" | "mock";
  let productId: string;
  let transactionId: string;
  if (body.platform === "apple" && typeof body.jws === "string") {
    const verified = await verifyAppleTransaction(body.jws);
    if (!verified.ok) {
      return verified.reason === "invalid"
        ? c.json({ error: "invalid_receipt" }, 400)
        : c.json({ error: "store_unavailable" }, 503);
    }
    platform = "apple";
    productId = verified.productId;
    transactionId = verified.transactionId;
  } else if (
    body.platform === "google" &&
    typeof body.productId === "string" &&
    typeof body.purchaseToken === "string"
  ) {
    // The product must be one of ours BEFORE we spend a Play API call on it;
    // the lookup then proves the token really is a purchase of that product.
    if (!(body.productId in SIGNET_PACKS)) return c.json({ error: "unknown_product" }, 400);
    const verified = await verifyGooglePurchase(body.productId, body.purchaseToken);
    if (!verified.ok) {
      return verified.reason === "invalid"
        ? c.json({ error: "invalid_receipt" }, 400)
        : c.json({ error: "store_unavailable" }, 503);
    }
    platform = "google";
    productId = body.productId;
    transactionId = verified.transactionId;
  } else if (
    body.platform === "mock" &&
    process.env.STORE_DEV_TOOLS === "1" &&
    typeof body.productId === "string" &&
    typeof body.key === "string" &&
    /^[A-Za-z0-9_-]{1,64}$/.test(body.key)
  ) {
    // The tier-2 test path (bits-store.md § testing): full client flow, fake
    // receipt, dev API only — the route arm doesn't exist in production.
    platform = "mock";
    productId = body.productId;
    transactionId = body.key;
  } else {
    return c.json({ error: "invalid_receipt" }, 400);
  }

  const signets = SIGNET_PACKS[productId];
  if (!signets) return c.json({ error: "unknown_product" }, 400);
  const result = await creditIapSignets(db, { playerId, signets, platform, transactionId, productId });
  return c.json({ ...(await walletOf(playerId)), credited: result === "ok" ? signets : 0 });
});

/**
 * Account linking (bits-accounts.md): the optional Clerk account that makes
 * purchases survive a device change. Routes exist only while accounts are on
 * — CLERK_SECRET_KEY set and ACCOUNTS_ENABLED not 0; the client learns via
 * /store's `accounts` flag and hides every door when off.
 */
if (accountsEnabled) {
  console.log("🔗 Clerk accounts on — /account/link + /restore + /unlink live");

  /** The body's Clerk JWT, verified → clerkUserId, or null → 401. */
  const clerkUserFrom = async (c: Context): Promise<string | null> => {
    const body = (await c.req.json().catch(() => ({}))) as { clerkToken?: unknown };
    if (typeof body.clerkToken !== "string") return null;
    return verifyClerkToken(body.clerkToken);
  };

  /**
   * Stamp the caller's player with the signed-in Clerk user. Three answers:
   *  - `{ linked: true }` — stamped (or already was); identity unchanged.
   *  - `{ linked: true, identity, merged }` — this account already owns a
   *    player: the caller's purchases were merged into it and the client MUST
   *    adopt `identity` (overwrite SecureStore, refetch wallet/armory).
   *  - 409 `already_linked` — this player belongs to a different account.
   */
  app.post("/account/link", async (c) => {
    const playerId = await authedPlayer(c);
    if (!playerId) return c.json({ error: "unauthorized" }, 401);
    if (overLimit(`account:${playerId}`, 10)) return c.json({ error: "rate_limited" }, 429);
    const clerkUserId = await clerkUserFrom(c);
    if (!clerkUserId) return c.json({ error: "invalid_account_token" }, 401);
    const outcome = await linkAccount(db, { playerId, clerkUserId });
    if (outcome.result === "conflict") return c.json({ error: "already_linked" }, 409);
    if (outcome.result === "restored") {
      return c.json({ linked: true, identity: outcome.identity, merged: outcome.merged });
    }
    return c.json({ linked: true });
  });

  /**
   * New-device restore — the only route a device with no identity can call
   * besides /register (hence the IP bucket). The calling device gets its OWN
   * bearer token; every other device's keeps working (per-device tokens,
   * bits-accounts.md § A4 — one sign-in per device, ever).
   */
  app.post("/account/restore", async (c) => {
    if (overLimit(`restore:${callerIp(c)}`, 10)) return c.json({ error: "rate_limited" }, 429);
    const clerkUserId = await clerkUserFrom(c);
    if (!clerkUserId) return c.json({ error: "invalid_account_token" }, 401);
    const identity = await restoreAccount(db, clerkUserId);
    if (!identity) return c.json({ error: "not_linked" }, 404);
    return c.json(identity);
  });

  /**
   * Account deletion (App Store 5.1.1(v)): delete the Clerk user FIRST —
   * only Clerk's confirmation clears the local link, so a half-deleted
   * account can't exist. The player + purchases survive as pure-anonymous.
   */
  app.post("/account/unlink", async (c) => {
    const playerId = await authedPlayer(c);
    if (!playerId) return c.json({ error: "unauthorized" }, 401);
    if (overLimit(`account:${playerId}`, 10)) return c.json({ error: "rate_limited" }, 429);
    const clerkUserId = await linkedClerkUserId(db, playerId);
    if (!clerkUserId) return c.json({ linked: false }); // idempotent no-op
    if (!(await deleteClerkUser(clerkUserId))) {
      return c.json({ error: "accounts_unavailable" }, 503);
    }
    await unlinkAccount(db, playerId);
    return c.json({ linked: false });
  });
}

/**
 * Dev-only store tools (bits-store.md § testing): purchase resets so the
 * Signet→unlock flow is testable end to end (plus the mock IAP arm on
 * /store/iap above). The routes DO NOT EXIST unless STORE_DEV_TOOLS=1 —
 * never set in prod.
 */
if (process.env.STORE_DEV_TOOLS === "1") {
  console.log("🛠  STORE_DEV_TOOLS on — /dev/reset-purchases, /dev/grant-deed, /dev/reset-deeds + mock IAP live");

  /** Forget every store purchase (entitlements bought with Signets) — deed
   * grants are untouched; Signet balances stay as they are. */
  app.post("/dev/reset-purchases", async (c) => {
    const playerId = await authedPlayer(c);
    if (!playerId) return c.json({ error: "unauthorized" }, 401);
    await db.execute({
      sql: "DELETE FROM entitlements WHERE player_id = ? AND source LIKE 'purchase:%'",
      args: [playerId],
    });
    return c.json({ ok: true });
  });

  /**
   * Grant ANY deed to the caller, rewards included, exactly as a settle
   * would record it (bits-dev-menu.md § deeds): the unlock row, the Glory,
   * every entitlement — same writer, same idempotency shape, so a granted
   * Tidecaller IS a Tidecaller (the spell lands, the title lands, the
   * Deeds screen replays the ceremony). A milestone's counter is raised to
   * its threshold so the codex bar reads full. Never a game-server path:
   * real awards only ever come from ranked settles.
   */
  app.post("/dev/grant-deed", async (c) => {
    const playerId = await authedPlayer(c);
    if (!playerId) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null)) as { id?: unknown } | null;
    const id = typeof body?.id === "string" ? body.id : null;
    const def = id ? ACHIEVEMENT_DEFS.find((d) => d.id === id) : undefined;
    if (!def) return c.json({ error: "unknown deed" }, 404);
    const counters = await achievementCounters(db, playerId);
    if (def.trigger.kind === "milestone") {
      const { counter, threshold } = def.trigger;
      counters[counter] = Math.max(counters[counter] ?? 0, threshold);
    }
    const rewards = def.rewards ?? [];
    const glory = rewards.reduce((sum, r) => (r.kind === "glory" ? sum + r.amount : sum), 0);
    const entitlements = rewards.flatMap((r) =>
      r.kind === "entitlement" ? [r.itemId] : r.kind === "title" ? [`title:${def.id}`] : [],
    );
    await applyMatchAchievements(db, {
      matchId: `dev:grant:${def.id}:${Date.now()}`,
      playerId,
      counters,
      unlocks: [{ id: def.id, ...(glory > 0 ? { glory } : {}), ...(entitlements.length > 0 ? { entitlements } : {}) }],
    });
    return c.json({ ok: true, id: def.id, entitlements });
  });

  /** Forget every deed: unlocks, counters, and every achievement-granted
   * entitlement (titles and secrets alike). Purchases and the Glory ledger
   * stay — a re-granted deed's Glory row is idempotency-keyed and won't
   * pay twice, which is the honest dev behaviour. */
  app.post("/dev/reset-deeds", async (c) => {
    const playerId = await authedPlayer(c);
    if (!playerId) return c.json({ error: "unauthorized" }, 401);
    await db.batch(
      [
        { sql: "DELETE FROM achievement_unlocks WHERE player_id = ?", args: [playerId] },
        { sql: "DELETE FROM achievement_counters WHERE player_id = ?", args: [playerId] },
        { sql: "DELETE FROM entitlements WHERE player_id = ? AND source LIKE 'achievement:%'", args: [playerId] },
      ],
      "write",
    );
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

/**
 * Redeem a promo / tester code (bits-redeem-codes.md). LINKED players only —
 * the anti-farm rule: a redemption keyed to an account, never an install, so
 * reinstalling can't earn a code twice and a merge can never double-pay. The
 * client hides the field from unlinked players; this is the check that
 * matters. 10/min/player: enumeration is pointless at that rate.
 */
app.post("/codes/redeem", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  // No codes on iOS (bits-redeem-codes.md § Platforms): App Review rejected
  // them under guideline 3.1.1 on 2026-09-11 — a code pays Signets, and
  // Signets are bought with In-App Purchase. The iOS client shows no door
  // and never calls this; the stamp holds the line for one that does.
  if (c.req.header("x-client-platform") === "ios") return c.json({ error: "not_available" }, 403);
  if (overLimit(`codes:${playerId}`, 10)) return c.json({ error: "rate_limited" }, 429);
  const clerkUserId = await linkedClerkUserId(db, playerId);
  if (!clerkUserId) return c.json({ error: "not_linked" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.slice(0, 64) : "";
  const result = await redeemCode(db, { playerId, clerkUserId, code });
  switch (result.result) {
    case "invalid":
      return c.json({ error: "code_invalid" }, 404);
    case "already":
      return c.json({ error: "already_redeemed" }, 409);
    case "expired":
      return c.json({ error: "code_expired" }, 410);
    case "ok":
      return c.json({
        ...(await walletOf(playerId)),
        credited: { glory: result.glory, signets: result.signets },
      });
  }
});

/**
 * Feedback + bug reports (bits-feedback.md): one row per report, stamped
 * with the caller's identity and whatever version context the client sends.
 * Everything free-text is length-capped here AND clipped again in the
 * persistence layer; the kind is a closed set. 10/hour/player — no person
 * files more, a script does.
 */
app.post("/feedback", async (c) => {
  const playerId = await authedPlayer(c);
  if (!playerId) return c.json({ error: "unauthorized" }, 401);
  if (overLimit(`feedback:${playerId}`, 10, 3_600_000)) return c.json({ error: "rate_limited" }, 429);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (key: string, max: number): string | null => {
    const v = body[key];
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };
  const kind = body.kind;
  if (typeof kind !== "string" || !(FEEDBACK_KINDS as readonly string[]).includes(kind)) {
    return c.json({ error: "invalid_kind" }, 400);
  }
  const message = text("message", FEEDBACK_MESSAGE_MAX);
  if (!message) return c.json({ error: "empty_message" }, 400);
  const id = await recordFeedback(db, {
    playerId,
    kind: kind as FeedbackKind,
    message,
    contactEmail: text("contactEmail", FEEDBACK_EMAIL_MAX),
    playerName: text("playerName", FEEDBACK_STAMP_MAX),
    platform: text("platform", FEEDBACK_STAMP_MAX),
    osVersion: text("osVersion", FEEDBACK_STAMP_MAX),
    appBinary: text("appBinary", FEEDBACK_STAMP_MAX),
    appBundle: text("appBundle", FEEDBACK_STAMP_MAX),
    // The reporter's last measured ping (bits-regions.md § Stage 1) —
    // a bounded non-negative number or nothing.
    rttMs:
      typeof body.rttMs === "number" && Number.isFinite(body.rttMs) && body.rttMs >= 0
        ? Math.round(Math.min(body.rttMs, 60_000))
        : null,
  });
  return c.json({ ok: true, id });
});

/**
 * The one reader of the feedback table (Tom). Exists only when
 * FEEDBACK_ADMIN_TOKEN is set; the bearer is compared in constant time
 * against the env value and the route is IP-limited so the secret can't be
 * guessed at wire speed. `?before=<id>&limit=<n>` pages newest-first.
 */
const digest = (s: string): Buffer => createHash("sha256").update(s).digest();
/** An admin bearer check against one env secret: constant-time compare of
 * digests (so lengths never leak either) and IP-limited. True = refused
 * (the caller has already been answered). */
const adminRefused = (c: Context, expected: Buffer): Response | null => {
  if (overLimit(`admin:${callerIp(c)}`, 30)) return c.json({ error: "rate_limited" }, 429);
  const header = c.req.header("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!timingSafeEqual(digest(presented), expected)) return c.json({ error: "unauthorized" }, 401);
  return null;
};

const feedbackAdminToken = process.env.FEEDBACK_ADMIN_TOKEN ?? "";
if (feedbackAdminToken) {
  console.log("📬 FEEDBACK_ADMIN_TOKEN set — GET /admin/feedback live");
  const expected = digest(feedbackAdminToken);
  app.get("/admin/feedback", async (c) => {
    const refused = adminRefused(c, expected);
    if (refused) return refused;
    const before = Number(c.req.query("before"));
    const limit = Number(c.req.query("limit"));
    const reports = await listFeedback(db, {
      before: Number.isFinite(before) ? before : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return c.json({ reports });
  });
}

/**
 * Code minting and oversight (bits-redeem-codes.md § API). Same gate shape
 * as the feedback reader, its own secret: CODES_ADMIN_TOKEN. Rule
 * violations from the persistence layer (a promo without limits, an empty
 * payout, an authored code that already exists) come back as 400 with the
 * rule's name — an admin path, so loud beats lenient.
 */
const codesAdminToken = process.env.CODES_ADMIN_TOKEN ?? "";
if (codesAdminToken) {
  console.log("🎟️  CODES_ADMIN_TOKEN set — /admin/codes live");
  const expected = digest(codesAdminToken);
  const optionalInt = (v: unknown): number | null | undefined => {
    if (v === undefined || v === null) return v as null | undefined;
    return typeof v === "number" && Number.isInteger(v) ? v : Number.NaN;
  };
  app.post("/admin/codes", async (c) => {
    const refused = adminRefused(c, expected);
    if (refused) return refused;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const maxRedemptions = optionalInt(body.maxRedemptions);
    const expiresAt = optionalInt(body.expiresAt);
    const count = optionalInt(body.count);
    if ([maxRedemptions, expiresAt, count].some((n) => Number.isNaN(n))) {
      return c.json({ error: "invalid_number" }, 400);
    }
    try {
      const codes = await mintCodes(db, {
        kind: body.kind as CodeKind,
        glory: typeof body.glory === "number" ? body.glory : 0,
        signets: typeof body.signets === "number" ? body.signets : 0,
        note: typeof body.note === "string" ? body.note.slice(0, 200) : null,
        maxRedemptions,
        expiresAt,
        display: typeof body.display === "string" ? body.display : undefined,
        count: count ?? undefined,
      });
      return c.json({ codes });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });
  app.get("/admin/codes", async (c) => {
    const refused = adminRefused(c, expected);
    if (refused) return refused;
    return c.json({ codes: await listCodes(db) });
  });
  app.post("/admin/codes/active", async (c) => {
    const refused = adminRefused(c, expected);
    if (refused) return refused;
    const body = (await c.req.json().catch(() => ({}))) as { code?: unknown; active?: unknown };
    if (typeof body.code !== "string" || typeof body.active !== "boolean") {
      return c.json({ error: "invalid_body" }, 400);
    }
    const found = await setCodeActive(db, body.code, body.active);
    return found ? c.json({ ok: true }) : c.json({ error: "code_invalid" }, 404);
  });
}

Bun.serve({ port, fetch: app.fetch });
console.log(`⚔️  blood-in-the-sand API listening on port ${port} (db: ${dbUrl})`);
