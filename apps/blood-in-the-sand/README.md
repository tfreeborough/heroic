# Blood in the Sand — running the LAN/online 1v1 (M1)

Design + decisions: [docs/design/pvp-arena.md](../../docs/design/pvp-arena.md).

## Server on Render (the fixed address)

`render.yaml` at the repo root is a Render Blueprint: dashboard → **New →
Blueprint** → connect this repo, and every push to master auto-deploys the
match server (Docker, Frankfurt, free plan — spins down after ~15 idle
minutes, ≈1 min cold start on the next connect; bump to `starter` to keep it
warm). Put the resulting hostname in `apps/blood-in-the-sand/.env`:

```sh
EXPO_PUBLIC_DEFAULT_SERVER=blood-in-the-sand.onrender.com
```

The join screen pre-fills it — nobody types an address on game night. Note
this is one public room on a guessable URL; join codes arrive with M2.

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

Note for EAS cloud builds: `.env.local` isn't committed, so the baked-in
default server comes from the `env` blocks in eas.json — update those if the
Render hostname differs.

First to 3 rounds, one life per round. Dash (») has i-frames — dodge the red
telegraph wedge with it. A disconnect pauses the match; rejoining resumes it.

## Local server (LAN fallback / offline dev)

```sh
bun run --cwd apps/blood-in-the-sand-server dev
```

It prints its LAN IP — type that into the address field (plain `ws://` on
port 7777 is inferred for IPs/localhost/*.local; hostnames get `wss://`).

## Dev conveniences

- **Auto-join from the simulator**: `EXPO_PUBLIC_AUTO_HOST=localhost bunx expo start --ios`
  skips the join form (see `.env.example`).
- **Bots** (full matches with no phones — the server's integration test):

  ```sh
  bun run --cwd apps/blood-in-the-sand-server bot -- --name rex --strategy seek --matches 0
  bun run --cwd apps/blood-in-the-sand-server bot -- --name fifi --strategy circle --matches 0
  ```

- **Spectate snapshots in a terminal**: `bun apps/blood-in-the-sand-server/scripts/spy.ts`.
- Sim rules/tuning all live in `packages/blood-in-the-sand-sim/src/config.ts` — one file, PvP-only
  numbers (PvE tables are untouched).
