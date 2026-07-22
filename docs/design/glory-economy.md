# Blood in the Sand — Glory, Identity & Persistence

Status: **designed 2026-07-22 · v1 BUILT same day** (persistence pkg + Hono API +
client identity/balance chip; needs a dev-client rebuild for expo-secure-store) ·
Applies to: **Blood in the Sand** (topology intended to serve the whole monorepo later) ·
Last decided: 2026-07-22

> First persisted-data milestone. Establishes the anonymous player identity, the Glory
> currency, and the service topology they live in. Companion to
> [monetisation.md](./monetisation.md) — that doc owns *what money buys*; this one owns
> *how balances and identity actually persist*. The currency formerly called "coins"
> there is now named **Glory**.

## v1 scope (deliberately tiny)

A player opens the app and sees **0 Glory**, served from the database.

- New Bun service `apps/blood-in-the-sand-api` (HTTP, **Hono** — decided 2026-07-22) —
  register + balance endpoints; bearer-token auth as Hono middleware.
- New `packages/blood-in-the-sand-persistence` — Turso client, schema, migrations, query helpers.
- Client: silent registration on first launch, Glory balance rendered in the UI.
- Game server: **untouched** in v1.

Everything else in this doc is design-ahead so v1's shapes don't box us in.

## Topology: game server and API are separate services

The WebSocket game server (Render, in-memory rooms, 30Hz sim) stays exactly as it is.
Business logic (identity, wallet, store, achievements) lives in a second, stateless
HTTP service. Reasons, in order:

1. **Deploy isolation.** The game server holds live one-life matches in memory; every
   deploy drops them. Store/economy code will iterate far more often than netcode —
   shipping an earn-rate tweak must not kill running matches.
2. **Tick protection.** The sim shares one JS thread. Wallet reads are cheap, but future
   endpoints (receipt validation, achievement scans) shouldn't share its frame budget.
3. **They scale differently.** Rooms pin to an instance; an API scales as stateless
   copies. This is the natural seam — cut it while there's nothing to migrate.

**The two services share the Turso database via `packages/blood-in-the-sand-persistence`** — no
service-to-service HTTP. When a match ends (post-v1), the game server writes the ledger
row itself; the API serves reads and client-initiated flows. Shared-DB-between-services
is acceptable here because it's one monorepo, one schema package, two processes — the
coupling is contained in one package if it ever needs revisiting.

## Identity: anonymous-first, forever

Per [monetisation.md](./monetisation.md): **no signup, ever required.**

- First launch → client calls `POST /register` → API mints a **player id** + **secret
  token**, stores the token hashed. Client persists both (iOS: Keychain, survives
  reinstall; Android: device-bound storage — accepted limitation until linking exists).
- All API calls authenticate with the token (bearer). Later, the same token rides the
  WebSocket join so the game server knows which wallet to credit — the game server
  verifies it against the DB via `packages/blood-in-the-sand-persistence`, no call to the API.
- The anonymous player id is the **primary identity forever**. Wallet, ledger, and
  entitlements hang off it and never move.

### Clerk linking (future, designed now)

Linking is insurance, not a gate — nudged after a first purchase.

- Link = verify the Clerk session JWT server-side, stamp `clerk_user_id` (nullable
  column) onto the existing player row. Nothing about the wallet moves.
- Recovery on a new device: sign in with Clerk → API finds the player row by
  `clerk_user_id` → issues that device a fresh token.
- **Merge case** (played anonymously on device B, then signed in): two player rows
  exist. Policy: re-parent the newer row's ledger entries onto the linked player —
  append-only makes this a safe row update; balances just follow. Decide edge details
  (entitlement dupes) when linking is actually built.
- Apple rule (from monetisation.md): offering any third-party login requires
  Sign in with Apple — Clerk supports it; enable both from day one of linking.

## Glory: ledger, not a balance column

Append-only transaction log; balance = `SUM(amount)` per player (cache later if it
ever matters — it won't for a long time).

```
players        id (pk) · token_hash · clerk_user_id (nullable) · created_at
glory_ledger   id (pk) · player_id (fk) · amount (signed int) · source (text)
               · idempotency_key (unique) · created_at
```

- **Credits positive, debits negative.** Purchases (post-v1) are a debit row written by
  the API after checking the sum.
- **`source` is an open namespace** — this is what keeps "earn Glory from anything"
  future-proof. Match wins, achievements, app-review rewards, promo grants: all just new
  writers with new source strings. The schema never changes.
- **Idempotency key** (a unique id the DB rejects duplicates of, so retries can never
  double-credit) — convention: derive from the source event, e.g.
  `match:<roomId>:<round>`, `achievement:<playerId>:first-blood`,
  `app-review:<playerId>` (once-per-player falls out of uniqueness).
- Each future earn source designs its own **verification story** when built
  (server-observed vs client-claimed); the ledger doesn't care.

## v1 API surface

```
POST /register            → { playerId, token }        (no auth)
GET  /wallet              → { glory: 0 }               (bearer token)
GET  /                    → { ok: true }               (health check)
```

## v1 as built (2026-07-22)

- `packages/blood-in-the-sand-persistence` — `createDb` / `ensureSchema` (idempotent boot-time DDL;
  promote to real migrations when a destructive change first needs one),
  `registerPlayer` / `findPlayerByToken` (sha256 token hashes), `gloryBalance` /
  `recordGlory` (INSERT OR IGNORE on the idempotency key). Tested against `:memory:`.
- `apps/blood-in-the-sand-api` — Hono on Bun, port **7780** (game server owns 7777).
  Env: `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`; unset falls back to local
  `file:dev.db` (gitignored) so local dev needs no credentials.
- Client — `src/net/api.ts`: `EXPO_PUBLIC_API_URL` (same convention as
  `EXPO_PUBLIC_DEFAULT_SERVER`; unset = wallet features off), silent register on
  first title-screen mount, identity in **expo-secure-store** (⚠️ new native module —
  needs a dev-client rebuild), Glory pill top-right on HomeScreen (renders only once
  a real balance loads — no error states for the wallet).

## Deferred (designed elsewhere or later)

- **Entitlements** (unlocks for weapons/abilities/announcer packs): one table,
  `player_id + unlock_id` — slots in beside the ledger; announcer packs become the
  first validated entitlement. Practice-mode-uses-everything rule stands.
- **Earn rates & prices** — price against retention data; keep numbers server-side.
- **IAP / receipt validation, account-linking UI, achievements, review rewards.**
