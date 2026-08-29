# Blood in the Sand — promo video factory

Remotion templates that turn the game's real assets and sim numbers into
vertical (1080×1920) marketing videos for TikTok, Reels and Shorts. The
marketing plan these feed lives in [docs/marketing.md](../../docs/marketing.md).

## The idea

Templates are code, content is data. `bun run sync` copies the game's icon
PNGs + Cinzel font into `public/` and regenerates `src/data/roster.json`
straight from `@heroic/blood-in-the-sand-sim` — so names, cooldowns, charges
and reach in the videos can never drift from the shipped game. Producing a
video is picking a template and passing props.

## Templates

| Composition | What it makes | Props |
| --- | --- | --- |
| `WeaponSpotlight` | 9s spotlight: icon slam → name → tagline → stat chips → end card | `{kind:"weapon", id:"blade"}` |
| `AbilitySpotlight` | Same, for the ability roster | `{kind:"ability", id:"sinkhole"}` |
| `GameplayClip` | Your screen recording + hook banner + watermark + end card | `{clip, hook, durationSeconds, startFrom?, muted?}` |

Taglines live in `src/data/copy.ts` (keyed by id); brand tokens in
`src/brand.ts` mirror `docs/design/bits-art-style.md`.

## Use it

```sh
cd apps/bits-promos
bun run studio                  # live preview, edit props in the UI

# one video
bunx remotion render AbilitySpotlight out/sinkhole.mp4 --props='{"kind":"ability","id":"sinkhole"}'

# every weapon + ability (~23 videos into out/)
bun run render:roster           # or: bun scripts/render-roster.ts --only harpoon,sinkhole

# a gameplay clip: record on-device, AirDrop into public/clips/, then
bunx remotion render GameplayClip out/clutch.mp4 \
  --props='{"clip":"recording.mp4","hook":"He had one HP left. Then the Harpoon.","durationSeconds":12,"startFrom":4}'

# thumbnails / static posts (also great for Reddit + Discord announcements)
bunx remotion still WeaponSpotlight out/blade.png --frame=120 --props='{"kind":"weapon","id":"blade"}'
```

One render works everywhere: TikTok, Instagram Reels and YouTube Shorts all
take the same 9:16 MP4. Upload natively to each platform (don't cross-post
watermarked exports).

On a headless box, point Remotion at a Chrome/Chromium headless-shell build
with `REMOTION_BROWSER_EXECUTABLE=/path/to/headless_shell`; locally it
downloads its own.

## Adding a new weapon/ability video when the game grows

1. Ship the item in the sim + its icon in the game app (already the dev loop).
2. Add a tagline for its id in `src/data/copy.ts`.
3. `bun run render:roster -- --only <id>`.
