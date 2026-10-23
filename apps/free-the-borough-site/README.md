# free-the-borough-site

The studio's brochure site + legal pages for **free-the-borough.com** — one static
site shared by every Free the Borough game. Built with [Astro](https://astro.build);
the output is plain HTML, no client framework, no cookies of our own.

- `/` — landing page (the games)
- `/log/` — dev log: the YouTube videos written up as articles (only linked once there's a post)
- `/privacy/` — privacy policy (App Store + Play Store privacy-policy URL)
- `/terms/` — terms of service
- `/delete-account/` — how to request account/data deletion (Play Console data-deletion URL)
- `/support/` — contact, purchases, community (App Store Connect support URL)
- `/robots.txt`, `/sitemap-index.xml` (pages + `/sitemap-video.xml`, the posts' videos) — generated; `/404.html` is Render's not-found page

URLs are folder-style with a trailing slash (`trailingSlash: "always"`), exactly as
the old hand-written site had them. The store forms and Apple's review link to
`/privacy/` and `/delete-account/`, so these must never change.

## Layout of the source

```
src/layouts/Base.astro      head (title, description, canonical, Open Graph, Twitter,
                            JSON-LD), header, nav, footer — every page uses it
src/pages/*.astro           the pages; the legal ones are the old HTML bodies verbatim
src/pages/log/              dev log index + article page
src/content/log/<slug>/     dev log posts, one folder each (see below)
src/content.config.ts       the post schema
src/components/YouTube.astro click-to-play player: nothing loads from YouTube until play
src/lib/log.ts              fetches posts without Astro's empty-collection warning
src/styles/site.css         the one stylesheet (bundled + hashed by the build)
public/                     copied as-is: img/, fonts/, robots.txt
old-html/                   the pre-Astro site, kept for comparison — delete when happy
```

The only JS is the homepage's trailer facade + screenshot carousel and the same
facade on dev log posts. Game art in `public/img/<game>/` is copied (and shrunk to
JPEG) from the game's assets and `apps/bits-promos/out/store/`; Cinzel is
self-hosted from `public/fonts/`.

## SEO

Every page gets a canonical URL, description, Open Graph + Twitter cards (default
image `/img/bits/og.jpg`, 1024×500) and the sitemap. The homepage carries
`Organization` + `VideoGame` structured data; dev log posts carry `Article` and,
when they have a video, `VideoObject`. The 404 page and an empty dev log are
`noindex` and left out of the sitemap.

One-off after the first deploy: verify the domain in **Google Search Console**
(DNS TXT record) and submit `https://free-the-borough.com/sitemap-index.xml`.
Bing Webmaster Tools can import the Search Console setup.

## Dev log posts

One folder per post in `src/content/log/`; the folder name is the URL
(`timing-not-aiming/` → `/log/timing-not-aiming/`). Inside: `index.md`, the
`cover.jpg` and the pictures the body uses. Delete the folder, the post is
gone. The Desk's Site stage writes these (docs/design/desk-writeup.md); by
hand, the frontmatter is:

```yaml
---
title: Title as it should read in search results
description: One or two sentences for the listing, meta description and social cards.
date: 2026-10-23
youtube: dQw4w9WgXcQ   # optional — the video id; adds the player + VideoObject
cover: ./cover.jpg     # optional — poster for the player + social image (1280×720)
updated: 2026-11-01    # optional
draft: true            # optional — builds nowhere while true
---
```

Pictures in the body are ordinary markdown images beside the file
(`![what it shows](./1.jpg)`): Astro sizes and optimises them and adds the
width and height. Without a `cover` the player shows a plain plate so nothing
is fetched from YouTube until play (the privacy policy promises this). The
"Dev log" nav link and the `/log/` sitemap entry appear automatically once the
first post exists.

## Local preview

`bun run site` from the repo root → http://localhost:7790 (Astro's dev server,
hot reload). `bun run --cwd apps/free-the-borough-site build` writes `dist/`;
`… preview` serves that build on :7790. Scripts run Astro under Bun's runtime
(`bunx --bun`) because Astro 7 wants a newer Node than the one installed here.

## Deploying (Render Static Site)

| Setting | Value |
|---|---|
| Root Directory | *(blank — repo root, so the workspace install works)* |
| Build Command | `bun install && bun run --cwd apps/free-the-borough-site build` |
| Publish Directory | `apps/free-the-borough-site/dist` |
| Build filter (optional) | include `apps/free-the-borough-site/**` so other apps' commits don't redeploy it |

Render runs the build on every push, which is where the sitemap and robots come
from — no GitHub Actions step is needed. Custom domains: **free-the-borough.com**
and **www.free-the-borough.com**.

**DNS caution:** `clerk.free-the-borough.com` is CNAMEd to Clerk for production
auth — leave that record untouched; the site only claims the apex + www.

## Store forms

- **App Store Connect** → App Privacy → privacy policy URL:
  `https://free-the-borough.com/privacy/`
- **App Store Connect** → App Information → support URL `https://free-the-borough.com/support/`,
  marketing URL `https://free-the-borough.com/`
- **Play Console** → Store listing → privacy policy:
  `https://free-the-borough.com/privacy/`
- **Play Console** → App content → Data safety → account deletion URL:
  `https://free-the-borough.com/delete-account/`
- Terms URL (optional fields / support pages): `https://free-the-borough.com/terms/`

## Editing

Legal pages carry an effective date under the title — bump it on any material
change. The privacy policy's **per-game appendix** is where a new game's specifics
get added; keep the body generic to all games.
