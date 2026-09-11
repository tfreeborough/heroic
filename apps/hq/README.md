# HQ — the studio console

Next.js app for **one person** (the studio Google account) to see how the
games are doing and do the handful of admin jobs each needs. Design and
decisions: [docs/design/hq.md](../../docs/design/hq.md).

Reads the games' Turso database directly through the persistence packages
(the same "services share the database" rule the API and game server
follow) and polls the game server's `/stats` for the live picture.

## Run locally

```sh
bun run --cwd apps/hq dev          # http://localhost:7790
```

Env (a gitignored `apps/hq/.env.local`):

| Var | What |
|---|---|
| `AUTH_SECRET` | any long random string (`openssl rand -base64 32`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | the Google OAuth client (below) |
| `HQ_ALLOWED_EMAILS` | optional; comma-separated. Default: `tom@harewood.io` |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | same values as the API. Unset = the repo's local `db/dev.db` |
| `BITS_SERVER_URL` | the game server, e.g. `https://blood-in-the-sand.onrender.com` |
| `BITS_STATS_TOKEN` | must equal the game server's `STATS_TOKEN` env |

Without Google creds the sign-in page renders but the button fails with
`Configuration`. Without `BITS_*` the live tiles say "not configured".

## Google OAuth client (one-off)

Google Cloud console → APIs & Services → Credentials → **Create OAuth client
ID**, type **Web application**:

- Authorised JavaScript origins: `http://localhost:7790` and the Render URL
  (`https://hq-….onrender.com`, or the custom domain).
- Authorised redirect URIs: `<origin>/api/auth/callback/google` for each
  origin above.

The consent screen can stay in **Testing** with the studio address as the
only test user — nobody else is ever meant to sign in, and the app's own
allowlist refuses them anyway. (Testing mode expires refresh tokens after
7 days; HQ sessions are 30-day JWTs and don't use refresh tokens, so this
doesn't bite. Publish the consent screen if it ever does.)

## Deploy (Render Web Service)

| Setting | Value |
|---|---|
| Root Directory | *(blank — repo root, so the workspace packages resolve)* |
| Build Command | `bun install && bun run --cwd apps/hq build` |
| Start Command | `bun run --cwd apps/hq start` |
| Env | everything in the table above (`PORT` is Render's) |

Then on the **game server's** Render service add `STATS_TOKEN` (any
random string) so `GET /stats` exists, and put the same value in HQ's
`BITS_STATS_TOKEN`.

Free-tier spin-down is fine for a dashboard (a cold open takes ~30 s); a
paid instance stays warm.

## Adding a page

Queries live in the game's persistence package (`stats.ts`, tested against
`:memory:`); a page under `src/app/(hq)/<game>/` reads them in a server
component with `export const dynamic = "force-dynamic"`. Admin actions are
server actions that call `currentUser()` first — a server action is a
public POST, the proxy alone is not enough.

A second game = a new folder under `src/app/(hq)/`, a block in
`Shell.tsx`, a card on the overview.
