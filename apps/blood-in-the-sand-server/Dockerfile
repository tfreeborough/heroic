# Blood in the Sand match server — built from the repo root context
# (render.yaml sets dockerContext: . so the workspace packages are visible).
#
# Only the three needed workspaces are copied; bun.lock is deliberately NOT —
# with the Expo apps absent the lockfile wouldn't validate, and the server's
# whole dependency tree is workspace-local pure TS (nothing to download beyond
# the root devDependencies).
FROM oven/bun:1.2

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/blood-in-the-sand-sim packages/blood-in-the-sand-sim
COPY apps/blood-in-the-sand-server apps/blood-in-the-sand-server

RUN bun install --ignore-scripts

# Render injects PORT; main.ts reads it (falls back to 7777 locally).
CMD ["bun", "apps/blood-in-the-sand-server/src/main.ts"]
