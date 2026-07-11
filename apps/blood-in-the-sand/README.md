# Blood in the Sand — running the LAN/online 1v1 (M1)

Design + decisions: [docs/design/pvp-arena.md](../../docs/design/pvp-arena.md).

## Server on Render (the fixed address)

Dashboard → **New → Web Service** → connect this repo, then:

| Field | Value |
| --- | --- |
| Language | **Node** (Bun is preinstalled in Render's Node environment) |
| Root Directory | *(leave blank — repo root, so the workspace packages resolve)* |
| Build Command | `bun install` |
| Start Command | `bun apps/blood-in-the-sand-server/src/main.ts` |
| Health Check Path | `/` |
| Instance Type | Free (spins down after ~15 idle min, ≈1 min cold start; Starter keeps it warm) |

Auto-deploy on push is Render's default. The server reads Render's injected
`PORT` automatically. Optional: pin the runtime with an env var
`BUN_VERSION=1.2.23` to match local.

**Env convention** (the app connects on launch — no address screen; names are
picked on the rooms screen). `.env*` files are **never committed** (repo-wide
gitignore) — build-time config lives in committed config files:

- **EAS/cloud builds** → `EXPO_PUBLIC_DEFAULT_SERVER` in eas.json's per-profile
  `env` blocks (the Render hostname; it's an EXPO_PUBLIC value baked into every
  shipped bundle, so it's not a secret — it's just config).
- **Local dev** → `.env.local` (gitignored) with your LAN server, e.g.
  `EXPO_PUBLIC_DEFAULT_SERVER=192.168.1.230:7777`. Metro reads it; a local
  `.env` also works (Metro prefers `.env.local` over `.env`). Dev-loop extras:
  `EXPO_PUBLIC_AUTO_HOST=localhost` (override the target entirely),
  `EXPO_PUBLIC_AUTO_JOIN=first`, `EXPO_PUBLIC_AUTO_START=1` — all three plus
  one bot (`bun run bot -- --create`) = a running match on every reload. With
  expo-dev-client installed, the simulator needs `expo start --ios --go`.

The server hosts up to 20 rooms in memory; set a passcode on yours if
strangers finding the URL would bother you.

## Phones (dev builds, same workflow as the gauntlet)

One-time: `eas init` in this directory (links the app to the Expo account and
writes the projectId into app.json — everything else is already scaffolded:
eas.json profiles, the `.dev` variant in app.config.ts, owner).

```sh
bun run --cwd apps/blood-in-the-sand ios:device   # local build, once per phone, cable in
bun run --cwd apps/blood-in-the-sand start        # dev sessions thereafter
```

Or cloud builds (no cable — install from the EAS link; iOS needs the phone
registered once via `eas device:create`):

```sh
bun run --cwd apps/blood-in-the-sand build:ios:dev
```

EAS cloud builds bake the hostname from eas.json's `env` blocks (env files
are gitignored so they never reach EAS). Caution: a *local* release build on
your Mac still picks up your `.env.local` — real env vars beat `.env` files,
so eas.json's value wins whenever EAS is involved, but plain `expo run:ios
--configuration Release` is not.

In the app: create a room (optional passcode) or join one from the list / by
its 4-letter code. The room is the lobby — the host (👑) starts the match, and
after first-to-3 everyone lands back in the lobby for a rematch on the host's
say-so. First to 3 rounds, one life per round; dash (») has i-frames — dodge
the red telegraph wedge with it. A disconnect never pauses the match: your
body idles (and can be killed); rejoin the room to take it back over. Rooms
live in server memory only — empty ones vanish after ~2 minutes.

## Local server (LAN fallback / offline dev)

```sh
bun run --cwd apps/blood-in-the-sand-server dev
```

Point the app at it with `EXPO_PUBLIC_AUTO_HOST=<LAN IP or localhost>` (the
app has no address entry — the server target is baked in; plain `ws://` on
port 7777 is inferred for IPs/localhost/*.local, hostnames get `wss://`).

## Dev conveniences

- **Simulator auto-play**: the `EXPO_PUBLIC_AUTO_*` vars (see the env
  convention above) — with all three set, one bot gives you an instant match
  on every reload.
- **Bots** (full matches with no phones — the server's integration test):

  ```sh
  bun run --cwd apps/blood-in-the-sand-server bot -- --name rex --strategy seek --create --matches 0
  bun run --cwd apps/blood-in-the-sand-server bot -- --name fifi --strategy circle --matches 0
  ```

  `--create` hosts a room and auto-starts whenever the lobby fills
  (`--nostart` to hold the lobby open); no room flag = join the first open
  room; `--room KRVX [--pass x]` targets one.

- **Spectate snapshots in a terminal**: `bun apps/blood-in-the-sand-server/scripts/spy.ts`.
- Sim rules/tuning all live in `packages/blood-in-the-sand-sim/src/config.ts` — one file, PvP-only
  numbers (PvE tables are untouched).
