import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));

// Resolve @heroic/core to its TypeScript source (it has no build step — it's pure
// TS consumed directly by the Bun/Expo workspaces). Aliasing to the source makes
// Vite compile it as part of the app, so the editor shares the EXACT same zone
// logic (loadZone/greedyMesh) + palette as the game — the basis of map accuracy.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@heroic/core": resolve(here, "../../packages/core/src/index.ts"),
    },
  },
  server: {
    port: 5174,
    // Allow reading the aliased core source, which lives outside this app's root.
    fs: { allow: [resolve(here, "../..")] },
  },
});
