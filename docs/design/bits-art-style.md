# Blood in the Sand — art style: the Sun-Forged Relic pass

**Status: designed 2026-08-06 (replaces the dark-fantasy woodcut direction of 2026-07-14);
refined 2026-08-07 — era pushed back from late-90s pre-rendered to EARLY-90s VGA crunch
(Tom: first results "too clean"): hard palette budgets + Bayer ordered dithering + hard alpha
added to the pipeline.**
Owner doc for the game's visual brand language. The Forge style bible
(`apps/realmsmith/forge/styleBible.ts`) is the executable form of this doc — the two must move
together.

## Why the change

The woodcut direction (heavy black ink, sepia-bronze wash, hatching) converged on "brown object
on black" — every icon the same monochrome mud, and the look grated over weeks rather than
growing. Meanwhile the **app icon** — a pre-rendered pixel-art gladiator helmet half-buried in
blood-soaked sand — has stayed loved since day one. The fix is to make the app icon the brand
anchor and grow the whole asset language out of it.

## The aesthetic in one line

**Early-90s retro pixel art**: detailed miniatures modeled in light, crushed onto a chunky
pixel grid under a hard palette budget with checkerboard (Bayer) dithering — the VGA DOS /
16-bit Amiga lineage, not flat modern vector-pixel art and not the silky late-90s pre-rendered
look. (The app icon supplies the *content* recipe — dimensional light, true materials, grounded
subject; the 2026-08-07 refinement supplies the *texture*: limited colours and ordered dither.)

## Style pillars

1. **Modeled in light, not line.** Forms are dimensional — specular glints on metal, warm
   bounced light from the sand, deep shadow pooling in recesses. No ink outlines, no hatching.
   The craft signature is the pixel grid, not the pen. In the limited palette, "soft" light
   becomes hard stepped colour ramps and dithered transitions — that's the point, not a loss.
2. **True materials in full colour.** Steel is grey steel, blood is saturated crimson, sand is
   honey-gold, leather is leather-brown, bronze is reserved for things actually made of bronze.
   The sepia-wash-over-everything rule is dead — colour variety IS the point.
3. **A real pixel grid AND a hard palette budget, both enforced in the pipeline.** gpt-image-1
   fakes pixel grids and shades with thousands of colours, so the Forge save step snaps every
   asset to a true grid, then crushes it to the family's colour budget with our own median-cut
   quantizer + 4×4 **Bayer ordered dithering** (the authentic VGA checkerboard; libimagequant's
   error-diffusion reads organic/modern — and its quality-floor semantics silently skip
   quantization when a colour cap makes the floor unreachable, learned 2026-08-07). Alpha is
   hard-thresholded — a pixel is in or out, crisp retro silhouettes, no fringe. Every asset in
   a family shares the same grid and budget — consistency is guaranteed by the pipeline, never
   begged from the model.
4. **Warm desert light on grim subjects.** The mood stays grim, sun-scoured, blood-and-sand —
   but lit warm: a low golden desert sun, honey ambience. Grim content, inviting light. Never
   gothic-damp, never cold.
5. **Background-agnostic cut-outs** (Tom, 2026-08-06). The game is WIP and surfaces will gain and
   lose backgrounds — every generated cut-out must look good floating on ANY surface. Nothing
   baked outside the silhouette: no backdrop, no glow, no vignette, no cast shadow onto
   surrounding ground. Grounding a subject in sand is allowed **only inside the silhouette**
   (a compact drift the subject sits in, part of the cut-out — the app icon's trick) and only
   where the subject's brief calls for it.

## Palette anchors

Not a strict palette (pre-rendered shading needs gradients) — these are the recurring notes the
prompts name:

| Note | Hex | Use |
| --- | --- | --- |
| Honey sand-gold | `#dcb96f` | sand, warm ambience |
| Battle-grey steel | `#9aa0a6` | armour, weapons |
| Bone highlight | `#f2e9d4` | hottest specular glints |
| Dried-blood crimson | `#a32c22` | blood, cloth (carried over — established game red) |
| Umber shadow | `#4a3520` | warm dark shadow, never pure black |

Category accents (loadout icons) and tier colours (rank badges) carry over unchanged from the
woodcut era — they're game systems, not style: `ICON_ACCENTS` (gold/red/blue/green) and
`BADGE_ACCENTS` (the six-tier colour ladder) in the style bible.

## Pixel grids + palette budgets per family

Grid and budget are per-type fields in the style bible (`pixelGrid`, `paletteColours`), applied
by the Forge save step (`apps/realmsmith/forge/images.ts`). Saved PNG size is unchanged — the
grid is baked into it as uniform blocks (RN's Image can't be trusted to nearest-neighbour
upscale, so the pipeline does). The prompt names the same colour budget so the model composes
for it — but the pipeline is what guarantees it.

| Family | Saved | Grid | Block size | Palette |
| --- | --- | --- | --- | --- |
| Loadout icons | 256² | 64² | 4px | 32 |
| Deed icons | 256² | 64² | 4px | 32 |
| Rank badges | 256² | 64² | 4px | 32 |
| Title sprites | 512² | 128² | 4px | 48 |
| Mode/bracket cards | 900×360 | 300×120 | 3px | 64 |
| Home backdrop | 1024×1536 | 256×384 | 4px | 64 |

Both are tunable in one place; bump a family's grid if detail reads muddy on device, or its
palette if materials lose their identity (the badge tier-colour must always survive the crush).

## What carries over from the woodcut era (hard-won lessons, still true)

- **Isolation is stated as what surrounds the subject** — "every pixel outside the shape is
  transparent"; merely allowing alpha makes the model paint grounds.
- **No frames** — no circle/plate/badge backing/border; separation and framing are the GAME's
  job, composited per surface (v5 rule, 2026-08-04).
- **No text ever** in generated art; badges carry no numerals (game composites III/II/I), deeds
  carry no tier marks (map composites bronze/silver/gold frames).
- **Badge colour-dominance rule** — at 24px rank is read by colour before shape; the tier colour
  floods the shield.
- **Mode-card composition contract** — focal content in the right two thirds, quiet left third
  (UI text sits over it), top/bottom quarters sacrificial to the 5:2 crop.
- **Sprites arrive clean** — full figure, margin on all sides, no ground/cast shadow (painted
  scenes composite their own contact shadows), all title fighters face right.
- **32px acceptance test** — loadout icons must read at roster-row size (panel shows it).

## The home backdrop (added 2026-08-08)

The HomeScreen's hand-painted Skia scene retires in favour of a forged full-bleed portrait
backdrop (`home-bits` type; `HOME_ART` in `src/screens/homeArt.ts`, painted-scene fallback while
null). Composition contract, portrait twin of the mode cards' rules: **top third = only quiet
sky** (title sits over it), **bottom third = only open raked sand** (menu + the sprite duel
stand there), focal content (arena wall, crowd, banners) in the band between, and **everything
essential inside the central two thirds of the width** — phones cover-crop the 2:3 canvas to
~19.5:9, eating the outer sixths. Surviving living layers over the art: sprite duel, dust
motes, swallows, dust-storm shader. Retired with the painted scene: banner ribbons and the
crowd glint (bound to its geometry).

## Regeneration scope

Everything visual re-forges in the new language (~42 subjects × 2 candidates): 15 loadout icons,
10 deed icons, 6 rank badges, 4 title sprites, 7 mode/bracket cards. Subjects (WHAT each asset
depicts) are unchanged — only the style language (HOW) changed. The app icon itself is already
the target style and stays.

## Open items

- On-device pass of the first snapped generations (does 64-grid read at 52pt? does the Bayer
  dither shimmer at small render sizes?). Alpha fringing is solved by design — the crush
  hard-thresholds alpha.
- Dither strength (`DITHER_SPREAD` in forge/images.ts, currently 28) is a taste knob — tune
  against real generations.
- The in-game splat/blood decal colours were tuned against woodcut-era assets; check they still
  sit well next to the more saturated new art.
