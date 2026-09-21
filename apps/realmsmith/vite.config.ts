import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { forgePlugin } from "./forge/plugin";
import { tilesetServerPlugin } from "./tilesetServer/plugin";
import { zonesServerPlugin } from "./zonesServer/plugin";

const here = dirname(fileURLToPath(import.meta.url));

// Resolve @heroic/core to its TypeScript source (it has no build step — it's pure
// TS consumed directly by the Bun/Expo workspaces). Aliasing to the source makes
// Vite compile it as part of the app, so the editor shares the EXACT same zone
// logic (loadZone/greedyMesh) + palette as the game — the basis of map accuracy.
export default defineConfig({
  // forgePlugin: the Asset Forge's dev-only endpoints (docs/design/asset-forge.md).
  // tilesetServerPlugin: serves atlas PNGs from the games' asset folders (tilesets.md).
  // zonesServerPlugin: lists/reads/writes the repo's zone files + "New arena" (bits-arenas.md).
  plugins: [react(), forgePlugin(), tilesetServerPlugin(), zonesServerPlugin()],
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
