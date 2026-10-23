// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { readdirSync } from "node:fs";

// The dev log index only earns a sitemap entry once there is something in it.
const hasLog = readdirSync("./src/content/log").some((f) => f.endsWith(".md"));

export default defineConfig({
  site: "https://free-the-borough.com",
  // Folder-style URLs with a trailing slash, exactly as the old static site had
  // them. The store forms and Apple review link to /privacy/ and
  // /delete-account/, so these must never change.
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [
    sitemap({
      filter: (page) => !page.endsWith("/404/") && (hasLog || !page.endsWith("/log/")),
    }),
  ],
});
