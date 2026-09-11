# HQ — the studio console

Status: **designed + BUILT 2026-09-11** (`apps/hq`, Next 16 + Auth.js; M2
data additions built the same day) — owed: Tom's Google OAuth client +
Render service + env (§ Deploy), `STATS_TOKEN` on the game server, a first
real-data look · Applies to: **every Free the Borough game** (Blood in the
Sand is the only tenant today) ·
Companions: [bits-redeem-codes.md](./bits-redeem-codes.md) (the admin routes
HQ replaces as the everyday door), [bits-feedback.md](./bits-feedback.md)
(the inbox nobody could read without curl), [glory-economy.md](./glory-economy.md)
(the two-service topology HQ joins as a third), [bits-regions.md](./bits-regions.md)
(the rtt data Stage 3 is gated on — HQ is where it gets read).

> **The need (Tom, 2026-09-11):** codes were the tipping point — minting and
> retiring them by curl is fine once, not weekly. Beyond codes, there's no
> way to see how the game is doing: player counts, matches a day, what sells,
> what people report. One web app, HQ, that only Tom can open, that grows a
> section per game.

## What HQ is

A Next.js web app at `apps/hq` (org-level, unprefixed — same rule as
`free-the-borough-site`, see the naming convention), signed into by exactly
one Google account, reading the games' databases and carrying the handful of
admin actions each game needs. Internal tool: plain, dense, dark, fast to
add a page to. No public surface, no player-facing anything.

Two decisions shape it and are hard to reverse, so they're laid out here.

## Decision 1 — how HQ reaches the data

| | A · direct database (recommended) | B · through the game API's `/admin/*` routes |
|---|---|---|
| Shape | HQ is a third service on the existing rule: *services share the Turso database through `@heroic/blood-in-the-sand-persistence`, never each other's HTTP* (glory-economy.md). Server components query; server actions write. | HQ is a pure client of `blood-in-the-sand-api`; every stat and action is a bearer-gated route there. |
| Adding a stat | one SQL function in the persistence package (tested `:memory:` like everything else) + a page. One deploy. | persistence function + API route + token plumbing + HQ page. Two deploys, in order. |
| Secrets | HQ holds `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` (same as the API and game server already do) | HQ holds one admin token per capability (`CODES_ADMIN_TOKEN`, `FEEDBACK_ADMIN_TOKEN`, …) |
| Blast radius | a bug in HQ can write to production data — mitigated by HQ importing only read queries plus the same guarded writers the API uses (`mintCodes`, `setCodeActive`) | HQ can only do what the API exposes |
| Rich analytics (joins, windows, cohorts) | natural — it's SQL against the source | each shape needs its own route |

**Decided (Tom, 2026-09-11): A.** The repo already made this call for the
game server; HQ is the same kind of citizen. The existing `/admin/*` curl
routes stay as they are — a backstop, not the door.

## Decision 2 — who can sign in

Requirement: only `tom@harewood.io`, via Google (changed from the studio Gmail 2026-09-11 — that address is not in a Google Workspace, so Tom uses his own).

| | Clerk, separate HQ app (was recommended) | Auth.js (next-auth) + Google provider — **chosen** |
|---|---|---|
| Setup | new Clerk application "Free the Borough HQ" (NOT the players' Heroic instance — its users are gladiators, and one-player-per-Clerk-account logic lives there). Google is on by default in dev with Clerk's shared creds; production needs a Google OAuth client — Tom did this once for BITS. | Google OAuth client + consent screen for HQ, `AUTH_SECRET`, session cookie code ours. |
| The gate | Clerk's sign-up restrictions/allowlist where the plan allows it, **and always** a server-side check in `proxy.ts`: session email ∈ `HQ_ALLOWED_EMAILS` or 403. The server check is the real lock; Clerk settings are belt. | the same server-side email check, in the Auth.js `signIn` callback. |
| Familiarity | Tom runs Clerk already; `clerk` CLI installed; agent skills present | new surface |
| Dependency | a second Clerk app to keep alive (free tier) | none beyond Google |

**Decided (Tom, 2026-09-11): Auth.js.** Tom took the no-third-party door
over the recommendation — HQ is a one-user tool and a Google client is a
five-minute job he's done before. Same email check either way, so switching
later is a two-file change (`auth.ts`, `proxy.ts`), not an architecture
change. Auth.js v5 (`next-auth@beta`), stateless JWT sessions, no user
table: the `signIn` callback refuses any Google profile that isn't verified
AND on the list, the `authorized` callback backs the proxy, and every page
under `(hq)/` plus every server action calls `currentUser()` again.

## What the data can already say (M1) and what it can't (M2)

Everything below reads tables that exist today, no schema change:

| Section | Reads | Shows |
|---|---|---|
| Players | `players`, `player_tokens` | total, new per day, linked-account share, devices per player |
| Ranked | `ranked_matches`, `ranked_match_players`, `ranked_ratings` | matches per day by bracket, human vs bot-backfilled share, ladder top N, rating spread, **rtt median** (the bits-regions.md Stage 3 gate), loadout pick/win rates |
| Economy | `glory_ledger`, `signet_ledger`, `entitlements` | Glory minted/burned by source per day, Signet flows, **IAP purchases per SKU per day** (`iap:<platform>:<sku>` sources; revenue estimated at list price, since prices live in the store consoles), unlocks per item |
| Deeds | `achievement_unlocks` | unlock count per deed = a rarity table |
| Feedback | `feedback` | the inbox: kind, message, version stamps, ping |
| Codes | `codes`, `code_redemptions` | mint (promo/tester), list with redemption counts, switch off |

What it couldn't, and the additions Tom approved and that are **built**
(all three, 2026-09-11):

- **Daily/weekly/monthly active players.** Nothing recorded "seen". Now:
  `players.last_seen_at` (additive column, `addColumnIfMissing`, indexed),
  bumped by `GET /wallet` through `touchPlayerSeen` — fire-and-forget, and
  the UPDATE only fires when the stamp is older than ten minutes
  (`SEEN_THROTTLE_S`), so a session's many wallet reads cost one row write.
  Active-day/week/month read straight off `players`. The per-day chart is
  a *floor* (each player sits on their last visit's day only) and says so.
- **Skirmish / brawl matches per day.** Only ranked wrote match rows. Now:
  `match_log` (id, mode, bracket, team_size, team_count, humans, bots,
  rounds, duration_s, created_at), `recordMatchLog` INSERT OR IGNORE on the
  match id. The game server's `RoomManager.logMatch` fires at the top of
  BOTH settle paths (`settleRanked`, `settleSkirmish` — before the
  skirmish deed gate, so solo-vs-bots matches land too); duration comes
  from `Room.matchStartedAtMs`, stamped the tick the sim leaves the lobby.
  Ranked still reads `ranked_matches` on the charts (complete history);
  the log fills in skirmish and brawl from the day it first ran. Practice
  is offline and stays invisible by design.
- **Players online right now.** Lives in the game server's memory. Now:
  `GET /stats` on the game server, existing only when `STATS_TOKEN` is set,
  constant-time bearer compare (the API's admin posture): open sockets
  (`server.pendingWebSockets`), rooms / mid-match / ranked, seated humans,
  honest (un-fuzzed) queue sizes per bracket, pending accepts. HQ fetches
  it per page load with a 4 s timeout; unreachable renders as "offline",
  unconfigured says so.

## Shape of the app (as built)

```
apps/hq
  src/auth.ts                      Auth.js: Google only, allowlist callbacks, currentUser()
  src/proxy.ts                     the front door (Next 16 proxy = middleware)
  src/lib/allowed.ts               HQ_ALLOWED_EMAILS, default = the studio address
  src/lib/db.ts                    createDb + ensureSchema once, cached on globalThis
  src/lib/live.ts                  GET <BITS_SERVER_URL>/stats with BITS_STATS_TOKEN
  src/lib/bits.ts                  names from the sim (WEAPONS/ABILITIES/ACHIEVEMENT_DEFS),
                                   SKU list prices (USD, the one thing the sim doesn't hold)
  src/app/sign-in/                 the only public page
  src/app/api/auth/[...nextauth]/  Auth.js handlers
  src/app/(hq)/layout.tsx          second lock + Shell (sidebar nav, sign-out, db label)
  src/app/(hq)/page.tsx            studio overview — one card per game + live pill
  src/app/(hq)/blood-in-the-sand/  dashboard · players · ranked · economy ·
                                   deeds · feedback · codes (+ actions.ts)
  src/components/                  Shell, NavLink, Stat/Tiles, Bars (inline SVG)
```

Every data page is `force-dynamic` (nothing is snapshotted at build) and a
server component reading `packages/blood-in-the-sand-persistence/src/stats.ts`
— 17 read-only query functions, tested against `:memory:` like the rest of
the package, clock passed in. Codes use the existing `mintCodes` /
`setCodeActive` / `listCodes` writers (same rules and errors as the API's
`/admin/codes`); minted codes come back once in a banner. No chart library:
`Bars` is a stacked-bar SVG with hover titles. Bots (`bot:` subject ids) are
excluded from every player-shaped number.

Verified 2026-09-11: `next build` clean; every page rendered 200 against
the local dev.db with a forged allowed-session cookie; a forged stranger
cookie and no cookie both bounce to `/sign-in`; 123 persistence tests pass.
Not yet exercised: the real Google round-trip (needs Tom's client).

Deploy: Render web service beside the API and game server — the README in
`apps/hq` has the exact settings, the Google OAuth client steps and the env
table (`AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `HQ_ALLOWED_EMAILS`,
`TURSO_*`, `BITS_SERVER_URL`, `BITS_STATS_TOKEN`; plus `STATS_TOKEN` on the
game server). Free-tier spin-down is acceptable for a dashboard; a paid
instance removes the cold start.

## Not in scope

Player-facing anything · a Realmsmith tab (this replaces that idea from
bits-redeem-codes.md § Later) · alerting/notifications · per-player editing
beyond codes (a "grant Glory to player X" door is a natural M2 once the
players page exists).
