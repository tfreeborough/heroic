# Blood in the Sand — Cosmetics: finishers, blood, trails

Status: **ideation agreed 2026-09-19; six dev-menu PROTOTYPES built same day**
(§ Prototypes) · **device passes 1 + 2 done**: both finishers and Roses
approved, **Ichor CUT** (replaced by Starblood, rebuilt as v2), trails retuned
(40% / 1.3s — Tom's numbers), **Starblood v2 approved**, a third finisher
prototyped (Among the Stars — "looking pretty good"; wreath swapped for
Scorpion + Eagle, sky made ragged) · five finishers approved · **Finishers v1
F1 BUILT 2026-09-20** (wire + entitlements + server grant in ranked AND
skirmish, plus F4's reward/mark/back-grant — § Finishers v1) · owed: the
wardrobe (F2), the Armory trade (F3), sound (F5) · Applies to: **Blood in the Sand**

> A third thing to sell in the Armory beside arms ([bits-store.md](./bits-store.md))
> and announcer packs. Builds on the blood system ([bits-blood.md](./bits-blood.md))
> and the cosmetics line in [monetisation.md](./monetisation.md) ("must be visible
> to other players", "blood trails are information").

## The problem

The game is top-down and the body is spoken for: team colour, status rings and
facing all live on it. So customisation can't be a skin. It lives in three places
the body doesn't use:

- **Finisher** — a short flourish over the body when you kill someone.
- **Blood** — what *you* bleed: drips, hit splashes, the death spray, the pool.
- **Trail** — a short wake behind you as you move.

Each is one slot, one item equipped at a time, 1 Signet each like everything else
on the shelf. They have to feel worth £1.99 and cost nothing in frame rate.

## Decisions (Tom, 2026-09-19)

- **The killer owns the finisher.** You see it in your moments of triumph, and it
  matches the announcer-pack rule (the killer's pack voices the call).
- **Blood identity leak is accepted.** Custom blood tells a team match whose trail
  it is. That's a small cost the buyer takes on; it's part of the flex.
- **Bots never wear cosmetics.** Seeing one must mean a person bought or earned it.
- **One item per slot is deed-earned**, so free players get a taste. Which deeds
  gate them is Tom's pass (candidates below).
- **No poppies** anywhere in flower cosmetics — First World War / Remembrance
  Sunday connotation. That also rules out red anemones, which read as poppies
  from above.

## Rules every item obeys

### Readability

- **Air belongs to the killer, floor belongs to the victim.** The finisher plays
  in the air over the body; the victim's own blood still lands on the sand. The
  two slots never fight over the same pixels.
- **Blood keeps its footprint.** Decal positions, sizes and contrast against the
  sand are identical for every blood — tracking a wounded runner is gameplay.
  Only the material changes. Pale bloods (silver, frost) carry a dark rim to hold
  contrast.
- **Trails are thin, mostly transparent and under the body.** 1.3s of movement at
  40% opacity (Tom's numbers off the dev-menu dials), far narrower
  than the body, drawn beneath it, fading out when you stand still. The team ring
  stays the team read.
- **Nothing may look like an ability.** Rejected on those grounds: black / ink /
  oil anything (reads as Tar Pit), a lightning trail (the chain spell), afterimage
  trails (ghost bodies muddy targeting), a frost trail (reads as a slow zone).
  Circles on the floor mean danger in this game, so ring-shaped cosmetics stay
  small and pale or don't ship.

### Performance

- **Floor marks are free.** Dried blood is already baked into the splat map (one
  texture, one draw per frame). Custom blood is a different colour ramp or stamp
  on decals we already draw; a finisher's leftover mark is one more stamp.
- **Nothing allocates per frame.** Trails are a fixed ring buffer of recent
  positions per player; particles come from fixed pools.
- **Motion is a pure function of age** — the trick flying blood already uses. No
  per-particle simulation state.
- **One draw per effect.** Particles go through a sprite atlas (many small sprites
  in a single GPU call). A ribbon trail is one draw per player.
- **No blur filters, no `saveLayer`.** Glow is faked: a wide faint additive stroke
  under a thin bright one.
- **Animate on the beat we already pay for.** Wet-blood shimmer rides the 200ms
  fresh-rebuild beat of the scar cache, never a per-frame pass.
- **Caps.** Cull to the view; at most 3 finishers live at once (the oldest
  fast-forwards). ~~A "reduced effects" setting~~ — dropped (Tom, 2026-09-19):
  make the effects cheap enough instead.
- **Budget to hold:** a six-way brawl with every trail on plus two finishers adds
  under ~1ms to the frame's recording cost. Check with the perf overlay.

### Premium feel

- Every finisher carries its own **kill sting and haptic**; bloods may swap the
  wet-footstep sound. These go on the Forge sound checklist per
  [bits-audio.md](./bits-audio.md).
- Items **react to play** where they can (a trail flaring on dash, blood cooling
  over its wet clock).
- The Armory sheet shows a **live looping preview** — and that's the whole
  pitch: cosmetics are NOT usable in practice (Tom, 2026-09-19), unlike arms.

## Finishers

1. **Butterflies** — the body bursts into ~40 butterflies that scatter and flutter
   off. The gentlest thing in a gore game is the rudest. Two-frame atlas sprite.
2. **Snuffed** — the body snaps to a black silhouette and goes out like a candle:
   one wisp of smoke, an ember dot. The tasteful one. Cheapest to build.
3. **Smite** — a single bolt from off-screen at the kill frame; leaves a
   glassy scorch-star baked into the sand. The loudest; your kill sites stay
   marked all match.
4. **Medusa** — the victim turns to stone, holds ~600ms, cracks (CrackField tech)
   and crumbles. The only finisher with a held beat — everyone looks.
5. **Ferryman's Due** — a pale soul rises towards the camera; two coins drop where
   the body fell and bake in. On-theme, leaves a small permanent signature.
6. **Paid in Full** — the body bursts into spinning gold coins that bounce and are
   gone within ~1.2s (so nobody chases them as pickups). Fits the Signet fiction.
7. **Roses from the Stands** — petals arc in from the crowd onto the kill site and
   stay. The only finisher that moves inward: the crowd reacting to you.
8. **Carrion** — big bird shadows sweep the whole arena floor and circle the
   corpse for ~2s. A top-down-only trick; 3–5 low-alpha silhouettes.
9. **Dragged Under** — spectral hands rise from the sand and pull the body down;
   the sand closes. Dark, mythic, ties to the game's name.
10. **Among the Stars** (id `constellation`; Tom's brief, 2026-09-19) —
    catasterism, the Greeks' word for a fallen hero being set among the stars. A
    disc of night opens in the sand under the body; stars ignite one by one from
    the figure's heart outward while a line of light runs from star to star just
    ahead of them (connect-the-dots, drawn by an unseen hand); the finished
    figure holds, then every star flares at once and it RISES toward the camera
    as the sky closes — leaving the same figure, small and dark, etched into the
    sand for the rest of the match. Four figures, picked per kill: the
    Gladiator (an Orion with a raised sword and a shield), the Gladius, the
    Scorpion, the Eagle. **Prototyped 2026-09-19** (§ The Constellation
    finisher).

## Blood

The premium lives in the 16s wet window (it animates) and in what it dries into
(baked, free).

1. ~~**Ichor** — gold.~~ **CUT 2026-09-19** after two device passes: translucent
   gold liquid on tan sand "kinda just looks like piss" (Tom). No shading fixes
   a yellow stain. Gold stays a finisher / trail idea (Paid in Full, Midas
   Steps), never a liquid on the floor. Same goes for any warm, pale or yellow
   blood — see § Device pass 2.
2. **Roses** — drops land as crimson petals; kill pools open into clusters of rose
   heads via the existing pool-seep growth. Fiction: Aphrodite's blood turned the
   white rose red; Romans threw rose petals at triumphs. The spiral silhouette
   can't be mistaken for a poppy. Fallback if it reads too romantic: **violets**
   (dark purple, Attis myth, Roman Violaria).
3. **Molten** — lands white-orange, cools to ember red then ash over the wet
   clock. The cooling is just a different colour ramp on a timer we already run.
4. **Acid** — green; pools fizz while wet, dry to a pale etched pit. Check on
   device against Fang's green body wash (floor vs body should separate them).
5. **Starblood** — a hole into the night sky: smoky indigo arms with breaths of
   magenta and teal nebula, sparse four-point stars, kill pools as small
   nebulae, and every star igniting as it lands. **Prototyped 2026-09-19** as
   Ichor's replacement; v2 same day (§ Device pass 3).
6. **Quicksilver** — chrome beads that sit on the sand rather than soak in. Needs
   the dark rim.
7. **Rime** — freezes; frost ferns crawl out during the pool seep; footprints
   crunch instead of squelch. Needs the dark rim.
8. **Paint** — every wound bleeds a different bright colour; by match end the
   floor is a Pollock. The joke one.

## Trails

1. **Your Colours** — a three-band ribbon like a legion standard; pick three from
   a curated palette (~16 swatches, so nothing is ugly or invisible on sand). The
   only item in the store that's truly the player's own; friend groups will match.
   One ribbon with a gradient across its width = one draw. The customiser with a
   live preview is a selling moment in itself.
2. **Comet** — white-hot tapered core with coloured falloff; brightens with
   speed, flares on dash.
3. **Prism** — a hard-edged scrolling rainbow band. The loud one.
4. **Scorched Steps** — discrete glowing footprint cracks that cool in ~0.6s.
   Stamps, not a ribbon: reads as weight.
5. **Midas Steps** — footprints gild the sand for a second with a glint sweep.
6. **Petal Wake** — petals kick up and settle behind you (24-sprite pool).
7. **Constellation** — steps leave stars joined by thin lines, then fade.
8. **Ripples** — small rings spread as if the sand were shallow water. Must stay
   small and pale (circles = danger). The one most likely to die on device.

## Sets

Three-piece sets map onto the 3-Signet pack:

- **Midas** — ~~Ichor~~ (cut — needs a new blood or becomes a two-piece) · Paid
  in Full · Midas Steps
- **Garden** — Roses · Roses from the Stands · Petal Wake
- **Night** — Starblood · Among the Stars · Constellation (the trail). Shares one
  star shape (`starArt.ts`) and one palette, so it reads as one hand. Carrion
  is now a free agent.
- **Vulcan** — Molten · Smite · Scorched Steps

## Proposed launch shelf

Finishers: Butterflies, Smite, Medusa · Blood: Roses, Starblood (if it
survives the device), one more TBD — Molten is warm-on-sand and now suspect ·
Trails: Your Colours, Comet, Midas Steps.

**Deed-earned candidates** (one per slot, kept out of the sets so they don't
undercut a set sale): Snuffed or Dragged Under · Acid · Prism. Open question:
today's deed items are *secrets* (hidden until owned). A "taste for free players"
wants the opposite — shown, with the deed named — so cosmetics probably need a
visible deed gate. Tom's call, along with which deeds.

## Plumbing (when we build)

- Entitlements: `finisher:<id>` / `blood:<id>` / `trail:<id>` rows beside
  `weapon:` / `ability:` in sim `items.ts`, split deed vs signet the same way;
  signet ones join `SIGNET_ITEM_IDS`.
- One **cosmetics blob** on join/create → public room state, carrying all three
  slots (plus Your Colours' three swatch indices) and folding in the announcer
  pack. One protocol bump. Effects stay client-derived, never networked — every
  client draws the killer's finisher and the bleeder's blood from the shared
  event stream, same as announcer calls.
- **Server-side entitlement check on the blob** — this closes the announcer-pack
  gap flagged in the store security audit (any client can claim any pack today).
  Unknown or unowned ids fall back to default, so old clients never break.
- Blood: a material id per decal; the splat-map bake stamps each decal in its own
  dried colours.
- Armory: a third trade beside STEEL / SORCERY (name is Tom's pass), and an
  equip surface somewhere owned cosmetics live (the Armory never shows owned
  items, so not there).

## Prototypes (BUILT 2026-09-19)

Two per slot, worn from the dev menu ([bits-dev-menu.md](./bits-dev-menu.md)
§ Tool 8): **Butterflies** + **Smite**, **Ichor** + **Roses**, **Your
Colours** (four colour presets standing in for the picker) + **Comet**. Local
only — nothing rides the wire, no entitlements. `WEAR EVERYONE` dresses every
fighter, bots included, for the worst-case perf read (a dev preview, not the
product — bots never wear cosmetics).

Where it lives (`apps/blood-in-the-sand/src/game/`):

- `cosmeticIds.ts` — slot ids + colour presets (moves to sim `items.ts` later).
- `bloodMaterials.ts` — the floor-blood renderer, **moved out of render.ts**
  and made material-aware. `BloodDecal` / `FlyingDrop` carry a `mat`;
  `BloodField.materialOf(playerId)` dresses the drips; `splatter` / `deathBurst`
  take the victim's material. Footprints carry the blood of the POOL stepped
  in, not the walker's own. Default blood draws exactly as before.
- `finishers.ts` — `FinisherField`: spawn on a lethal hit when the KILLER is
  dressed (never a straw man, a suicide or the weather); ground pass (hot
  marks, butterfly shadows) + air pass; cold scorch-stars are harvested into
  the splat map on the scar beat, the settled-quake-web handoff.
- `trails.ts` — `TrailField`: ring buffer per fighter → one per-vertex-colour
  triangle mesh (`drawVertices`) per trail per frame.

As built, against the perf rules: Butterflies = 2 `drawAtlas` calls (wings +
shadows) from a 5-cell atlas baked once; Smite = paths built once at spawn, a
four-stroke stepped halo, unit radial gradients for ground light and burnt
sand; Ichor's glints ride the scar cache's 200ms beat (`hasShimmer` holds the
fresh cadence for 8s after an ichor mark lands); Roses = unit petal rings built
once, the rose turns as the pool seeps so it visibly opens. No blur, no
`saveLayer` anywhere. *(Ichor's glints and this first roses build were both
replaced after the device pass — see below.)*

**Off-device previews:** `bun run cosmetics:preview` (in the app) runs the real
modules against Skia's CanvasKit build under Bun and writes contact sheets to
`cosmetics-preview/` (gitignored). A first look before the phone, not a
substitute. It earned its keep on day one:

- **Warm glow vanishes on sand.** The first Comet (white → gold → ember) and the
  first additive lightning halo both disappeared into the tan / saturated to
  cream. Comet is now violet-pink plasma; Smite's light is a COLD blue-white
  SrcOver wash. Rule for every future item: check it against `#b39763` first.
  Same reason Ichor dries to a bronze DARKER than the sand and its drops wear a
  dark hairline.
- **`drawVertices` blends against the paint colour**, and a fresh paint is
  black → a black ribbon. The trail paint is white; Modulate then yields the
  vertex colours untouched.
- **A flung streak isn't a petal.** Rose streaks first drew as red needles; a
  streak now strews 1–4 petals along its line instead (same reach).

### Device pass 1 (Tom, 2026-09-19)

- **Butterflies + Smite: approved** — "awesome… super premium".
  Untouched since. These two set the bar for every other finisher.
- **Ichor: twinkle cut.** "Really cheap and low frame-rate and also incredibly
  distracting." It rode the scar cache's 200ms beat, so it could never be
  smooth. **Rule: nothing animates on the scar-cache beat.** Motion gets a
  per-frame pass over the few marks still moving, or it doesn't happen. Ichor
  is now static: gold, dark hairline, a small fixed pale highlight per drop.
- **Roses: rebuilt (v2).** v1 (a petal per droplet) "reads as a bunch of pink
  blood… I would expect a bloom of actual flowers". Cause: the previews were
  drawn at 1.6× when the phone's follow camera is ~0.5× — a droplet is about
  two points wide, no petal survives that, and small reddish specks ARE what
  blood looks like. What reads as flowers at that size is **foliage and
  flower heads**. v2: every mark is a sprite from a 4-cell atlas baked once
  (full rose, bud, leaf sprig, loose petal), Modulate-tinted; greens draw under
  reds, so the whole material is 2 `drawAtlas` calls and builds no paths at
  all. Streaks become leafy sprigs along their line, about half bud-tipped;
  pools are full roses on a collar of leaves; drops are buds (never under
  4.6 world px), foliage or petals. Deep reds only — no pink. The wither is
  gentle (the dried state is what's baked and seen all match; browning right
  down read as old blood). The air spray mixes leaves in with the petals.
  **And it blooms:** marks open from nothing with a little overshoot,
  staggered by seed so a kill's spray opens as a ripple — drawn PER FRAME
  (`drawBloomingBlood`) only for marks younger than ~0.7s, then handed to the
  scar cache (`hasBlooming` holds its fresh beat so the adoption is prompt;
  the cache skips anything still opening — never absent, never doubled).
  This does bend "blood keeps its footprint": a bud is bigger than the drop
  it replaces. Accepted — a flower nobody can see isn't a product.
- **Trails: far subtler.** Your Colours was "waayy too distracting in a
  fight"; Comet "could still use some toning down, maybe… some opacity". Now:
  default opacity **40%** (Comet ×1.4, it's soft-edged already), Your Colours
  22 → 12 wide, Comet 15 → 11, length 0.65 → 0.48s, flutter more than halved,
  Comet's head glow shrunk — and both **fade in with travel speed**
  (70 → 190 px/s), so the short steps of a melee scrap draw next to nothing
  and the trail shows when you're actually running. A **TRAIL OPACITY** dial
  on the dev menu (20 / 30 / 40 / 55 / 70%) finds the number on device.
- **Preview script now renders at TRUE PHONE SCALE** (`PHONE` = 0.495 zoom ×
  3 device px). Judge the phone-scale sheets; the 5× close-ups are for
  checking the art only.

### Device pass 2 (Tom, 2026-09-19)

- **Roses v2: approved** — "Roses look good".
- **Ichor: CUT.** Even static, gold liquid on this sand "looks like piss".
  Third time the same lesson landed (the gold Comet, Smite's additive glow):
  **on `#b39763`, cold and dark reads; warm, pale and yellow vanish or read as
  something worse.** Every future blood gets checked against that before it's
  drawn. Replaced in the dev menu by **Starblood**: indigo body, bright violet
  rim (the rim is what separates it from the Tar Pit's flat brown-black), one
  fixed white star per drop big enough to hold it and a six-star constellation
  per pool. Static. Same liquid renderer as default blood, different ramps.
- **Trails: opacity right, too short, and they blinked out on stopping.** The
  blink was a bug in pass 1's speed fade: the whole ribbon was scaled by the
  fighter's CURRENT speed, so stopping zeroed all of it at once. Strength (and
  the Comet's width/heat) is now **frozen per sample when it's laid** — a
  stretch of wake only ever fades by age, and the body end borrows the newest
  sample's clock so the wake stays attached and dissolves as one piece. Length
  0.48 → 0.8s with a **TRAIL LENGTH** dial (0.5 / 0.8 / 1.0 / 1.3s) beside the
  opacity one — and Tom's pick off the dial is **1.3s** ("it's what looks
  best"), now the default. Settled numbers: **40% opacity, 1.3s**. The preview's trail sheet now shows running, then
  stopped for 150 / 400 / 700ms.

### Device pass 3 (Tom, 2026-09-19) — Starblood v2

Starblood v1 "looks much better [than Ichor]" but "reads as just purple blood
with specks of white in it". Same mistake as the first Roses: the default
liquid renderer with new ramps is still blood. **A recolour is never a
product; the marks themselves have to become something else.** v2:

- **Two layers from one atlas baked once.** UNDER, every mark lays soft dark
  smoke (no rim, no solid heart) so crowded marks melt into smoky galaxy arms;
  kill pools lay a proper void. OVER, the lights: a nebula (magenta + teal
  cloud, pinpricks, three stars) on every pool, a breath of magenta or teal on
  ~a quarter of the small marks, a four-point star on ~30% of them — sized to
  sit inside its smoke, mostly pinpricks with a rare big one — and a few thin
  constellation lines (some long streaks, some neighbouring stars). Soft
  glowing edges cost nothing at runtime: the gradients are paid for at bake
  time. Two `drawAtlas` + one `drawPath`; no paths built per mark.
- **It ignites.** Each mark opens under a white flare that dies away,
  staggered by seed — a kill's spray comes out like stars at dusk. Same
  per-frame machinery as the rose bloom (`drawBloomingBlood`, ~0.7s, then the
  scar cache adopts it). Nothing twinkles afterwards.
- **What the phone-scale preview killed on the way** (worth remembering): a
  rimmed void-with-a-star per mark read as a pile of identical beads, and a
  line per streak read as hatching (a jet is dozens of parallel streaks);
  then stars sized ABOVE their voids read as white glare on the sand. At
  ~0.5× zoom only MASSES OF COLOUR and a few bright points read — so: soft,
  generous, overlapping, sparse lights, wide size spread.

### The Constellation finisher (built 2026-09-19, Tom's brief)

`src/game/constellation.ts`, driven by `FinisherField` like the other two.
1.35s (was 2.7s until the 2026-09-20 tempo pass — see § Tempo + naming):
sky opens (0.17s, overshoot) → the drawing (from 0.06s, a star every
42ms, each line ARRIVING as its star ignites) → hold (the figure breathes,
slow and slight) → ascent at 0.8s (one shared flare, then scale 1 → 1.5, 60px
up-screen, fading) → the etching surfaces as the figure leaves and is baked
into the splat map when the show ends (`FinisherMark` is now a union:
`scorch` | `etch`, each with its own `coldMs`).

Built straight to the rules the bloods paid for: **light needs dark** — the
night disc is first on stage and everything pale sits over it, every line has a
dark backing; the disc draws in the GROUND pass (under bodies) so a fight on
top of it stays readable, only stars and lines are in the air. Perf: one
`drawAtlas` for every star, flare and pinprick (3-cell atlas baked once); the
disc and its two nebula clouds are unit radial gradients built once; lines are
≤ 12 `drawLine` pairs while drawing, then one prebuilt path. No blur, no
`saveLayer`, no per-frame paths. Preview bug worth keeping: a unit gradient
drawn as a SMALLER circle is cut off mid-falloff (hard-edged disc) — scale the
canvas to the circle instead.

**Device pass (Tom, 2026-09-19): "looking pretty good"**, two notes, both
fixed same day:

- *"Wreath is a bit boring, it just looks like a circle."* The Laurel is
  gone. **A figure needs a silhouette and a drawing that goes somewhere.** In
  its place: the **Scorpion** (claws, the bright heart, then the long tail
  curling round to the stinger — drawn last, so the figure ends on it) and the
  **Eagle** (the legion's standard: breast first, then both wings drawn outward
  together, so the figure spreads).
- *"The whole star circle behind looks a bit too perfect… less circle-y."* The
  night is now a CLOUD: a core (0.8 of the radius) plus nine smokier lobes
  stratified round the rim at random sizes and reaches, the whole thing
  squashed and turned a little — ragged-edged and different on every kill. All
  one soft unit gradient (two, the lobes have no solid heart), and the violet
  lives only in the outer falloff, so overlaps are just deeper night, never
  rings. The lobes billow out a beat behind the core as it opens. ~12 scaled
  circles a frame for 2.7s; still no blur. (First lobed cut in the preview:
  lobes with solid hearts read as a bunch of dark balls — hence the smokier
  lobe gradient and heavier overlap.)

The preview grew a `finisher-constellation-variety` sheet: all four figures,
each under its own sky.

Owed: Tom's second device look; its sound (a rising chime run for the drawing, one
bell for the ascent) once it survives.

Not done: sounds (a silent bolt will undersell Smite on device — kill stings go
on the Forge checklist once a finisher survives the device pass), view culling
of finishers, the "reduced effects" setting, anything in the Primer.

## Shipping plan: FINISHERS FIRST (Tom, 2026-09-19)

Finishers ship as the first cosmetic line. Blood (Roses, Starblood) and trails
(Your Colours, Comet) are approved-or-settled prototypes and **stay in the dev
menu** until finishers are out and selling. Keep iterating on more finishers in
the meantime — same loop as the first three: build → `cosmetics:preview` at
phone scale → Tom's device look.

**Roster.** Approved (5): Butterflies, Smite, Among the Stars, Medusa,
Snuffed (the earned one). Original plan, for the record — next to
prototype, picked so every finisher MOVES differently from the ones we have
(burst outward · strike down · rise up): **Medusa** (a held beat — the statue,
then the crumble; CrackField tech), **Carrion** (arena-wide — bird shadows
sweep the whole floor) and **Dragged Under** (downward — hands, then the sand
closes). **Snuffed** as the cheap, tasteful deed-earned freebie. Suspect until
previewed: **Paid in Full** (gold on this sand — the Ichor lesson). Target a
launch shelf of ~5 to buy + 1 to earn.

**Tom's rulings (2026-09-19):**

- **No try-before-buy.** Unlike Signet arms, finishers are NOT usable in
  practice. The Armory's looping preview is the whole sales pitch — and the
  product is other people seeing it, which practice can't show anyway.
- **Enforced everywhere — skirmish AND ranked.** Otherwise people claim what
  they don't own and cheapen it for everyone who paid. (Arms are only enforced
  in ranked today; cosmetics are stricter because being SEEN is the product.)
- **Their own place to equip**, not the loadout: finishers / blood / trails are
  set-and-forget, the War Table is per-match. A separate wardrobe-style area
  (name: Tom's pass), built for all three slots even though only finishers
  ship first.
- **No "reduced effects" setting for now** — the answer to a weak phone is that
  the effects are cheap enough, not a switch. (Struck from Hardening below.)
- **The earned one: SNUFFED, from GRAVEDIGGER** ("Strike 25 killing blows",
  the ranked kills ladder's second tier — reachable for most, not instant).
  Ships as one more reward on that deed: `{ kind: "entitlement", itemId:
  "finisher:snuffed" }`. **Shown as earnable on the deed** (Tom, 2026-09-19) —
  NOT a hidden secret like the Trident / Call the Tide: the deed card names
  the finisher as its reward, so free players can see there's one to earn.
  That needs a VISIBLE gate kind beside today's secret `deed` one.

**Prototyped since (2026-09-19) — both now APPROVED on device:**

- **Medusa** (`game/medusa.ts`, 1.5s) — v5 was approved on device 09-19, then
  **REOPENED 2026-09-20** (Tom: "it really doesn't feel medusa-y and doesn't
  really earn its place as a premium buy") → **v6 APPROVED 2026-09-20** ("Looks
  awesome now!").
  *Diagnosis:* v2 cut the snakes because they looked awful, but the snakes are
  what makes her HER — two green eyes and a grey disc is a generic evil eye.
  *v6:* the HAIR is back, built the opposite way to v1's worms. Seven THICK
  tapered serpents rooted on the brow over the eyes (eyes + crown = one head,
  the gorgoneion off a Greek shield): each is two chains of discs down a spine
  — near-black edge discs under rim-free shaded body discs, so they melt into
  a smooth outlined tube — plus a viper-wedge head with slit eyes; motion is a
  closed-form travelling sine; all seven are ONE drawAtlas (~150 sprites). They
  rear up as the eyes open, STRIKE outward and go rigid on the frame the
  pupils slit (the show's big shape-change), coil slowly through the hold (the
  eyes and the stone stay frozen — scarier next to movement), and RETRACT into
  the dark at the crumble (never fade: translucent stacked discs show every
  overlap). Drawn in the GROUND pass with the dark. Also: a gout of slate dust
  at the crumble, and 1.8s → 1.5s. Preview lessons: rimmed discs in one chain
  = caterpillars; round dot eyes + blunt snout = a cartoon worm, slits + a
  pointed wedge = a viper. If v6 still isn't enough, next levers: the statue
  itself (a disc in stone is the weakest read left) and sound (hiss + stone
  crack will carry a lot).
  The v5 description, still true of everything but the hair: a
  pool of near-black gathers over the victim → at 0.06s two serpent EYES SNAP
  open in it, right over the body — glaring, heavy-lidded — and hold dead
  still → at 0.25s the pupils snap to slits → at 0.33s a judder, a cold flash,
  and the player's own circle is a statue → the hold: SHE DOESN'T LEAVE — the
  eyes stay over the statue, dimmer, unblinking, looming very slightly nearer
  (0.9× → 1.35× on an ease-out) while cracks snap across the stone in three
  jolts → at 1.15s it crumbles, and only now do the eyes narrow and shut and
  the dark disperse → the rubble stays, baked into the splat map. Stone is a
  cold SLATE, not grey (real stone grey is the sand's own value). The dark
  pool draws in the GROUND pass (under every body — a fight across it stays
  readable); only eyes and statue are in the air. Everything is a path or unit
  gradient built once.
  **What "scary" turned out to be made of** (v4 → v5, Tom: "we need to make it
  scarier, the eyes are also growing too much"): (1) the SLOPE — v4's eyes
  rose toward the nose (/ \), which is worry; pulled down toward the nose
  (\ /) under a heavy black upper lid it's a glare; (2) darker, sicker irises
  in a much blacker, bigger pool, with a poisonous glow; (3) SNAPS and
  STILLNESS instead of easing — snap open, hold, pupils snap to slits, a
  judder; (4) a slow loom instead of a 2.6× swell; (5) she STAYS and watches
  the statue until it falls — being watched is the frightening part.
  *History:* v1 opened with seven snakes slithering in — Tom on device:
  "everything looks good except the snakes, they look awful". Lesson: **thin
  organic squiggles are the worst thing to draw at phone size** (a uniform
  stroke is a worm, not a serpent) — reach for bold geometry; and the snakes
  were only ever her hair, the gaze is the myth's mechanism. v2 hung the eyes
  still over the victim and spread a patch of cracked slate across the sand —
  Tom: "getting there… two eyes that expand quickly towards the player… I
  don't think we need the cracked slate, the player's circle will be good
  enough". v3 did that with the eyes opening far off and TRAVELLING to the
  victim on an ease-in — Tom: "they should start right over the statue and
  just expand towards the player, but have it on an ease-out basis". v4 did
  that (0.7× → 2.6×, fading as they passed the glass) — then v5, above, which Tom approved.
- **Snuffed** (`game/snuffed.ts`, 1.8s) — **APPROVED on device** ("pretty happy
  with snuffed"). The earned one, understated on
  purpose: a pool of shadow drops, the body snaps to a black silhouette, one
  small flame gutters on it and is pinched out, an ember dies, a single wisp
  of smoke curls away up-screen as the shadow lifts. No floor mark. It should
  feel like a reward without upstaging the paid ones.
- Later finishers live one-per-file behind a small `FinisherShow` interface
  (`drawGround` / `drawAir` by age, optional `markAlpha` / `stampMark`);
  `FinisherField` owns lifetime, the MAX_LIVE cap and the mark → splat-map
  handoff. Adding one = a file + two lines in `spawn`.

**What shipping needs** (outline — the full design is § Finishers v1 below):

1. **The wire.** `finisher?: string` rides createRoom / joinRoom / queueJoin →
   public room state, exactly as `announcer` does; GameScreen reads the
   KILLER's row instead of `devFlags`. Unknown id → none, so adding finishers
   later never needs a protocol bump. One bump for the field.
2. **Entitlements.** `finisher:<id>` beside `weapon:` / `ability:` in sim
   `items.ts` (deed vs signet split, signet ones join `SIGNET_ITEM_IDS`).
   Server check when the seat is taken, in EVERY room (Tom's ruling): unowned
   → none. Today gated picks are only enforced in RANKED rooms (accounts load
   at queue time); skirmish create/join already carry an optional `token`, so
   the skirmish path needs an entitlement lookup on that token at seat time —
   no token, no cosmetics. The same check closes the announcer-pack gap from
   the store security audit.
3. **Equip.** A persisted device setting (the `bits.announcerPack` pattern) and
   its own wardrobe-style area (Tom's ruling — not the War Table, not the
   Armory, which never shows owned items). Owned items only, live looping
   preview per item, three slots laid out from day one.
4. **Armory.** A third trade beside STEEL / SORCERY (name: Tom's pass). The
   item sheet's hero is a LIVE looping preview — the finisher modules already
   render into any Skia canvas (the preview script proves it), so no forged
   hero art is owed per item. NO practice use (Tom's ruling) — the preview is
   the pitch.
5. **Sound.** A kill sting + haptic per finisher through the Forge
   (bits-audio.md done-tick) — they're all silent today, and silence undersells
   them. Launch-blocking.
6. **Hardening.** Off-screen cull, a worst-case pass on a weak Android with WEAR EVERYONE in a six-way brawl (perf overlay),
   check the splat-map bake of marks over a long room.
7. **Deed-earned one.** Snuffed on Gravedigger, shown on the deed (above) — so
   the deed card / codex needs to render an item reward that isn't owned yet,
   which the secret-items path deliberately never does today.

## Tempo + naming pass (Tom, 2026-09-20)

"We don't want finishers distracting from the arena combat too much,
especially if players are grouped together, so they need to play through
quick, like Smite." **The rule: a finisher is over in ~1.5s or less.**

| Finisher | was | now | how |
| --- | --- | --- | --- |
| Smite | 0.48s | 0.48s | the benchmark |
| Butterflies | 2.7s, out to 430px | 1.3s, out to 360px | `FLY_LIFE_MS`, `FLY_DIST*`, fade from halfway; flap/wobble are per-second so wings don't speed up |
| Among the Stars | 2.7s | 1.35s | same beats, twice the pace: star step 88→42ms (the figure is one quick ripple), hold ~0.3s, ascent 1.0→0.55s |
| Medusa | 1.8s | 1.5s | shorter hold + crumble |
| Snuffed | 1.77s | 1.77s | untouched — Tom's call if it wants the same |

**Jove's Verdict → SMITE** ("who the hell is Jove?"). Id `smite`, entitlement
`finisher:smite`. Nothing had shipped, so the id was renamed outright — no
alias. Names want to be understood instantly by someone who's never read a
myth; "Among the Stars" and "Snuffed" pass, "Jove" didn't.

## Finishers v1 — shipping design (drafted 2026-09-19; F1 + most of F4 BUILT 2026-09-20)

Branch `feat/finishers-v1`. Grounded in a survey of the code as it stands; file
references are to that survey. Five milestones, each shippable on its own.

**The shelf.** To buy, 1 Signet each: **Butterflies, Smite, Among the
Stars, Medusa**. To earn: **Snuffed** (Gravedigger). Default for everyone: none.

**The precedent to clone is the worn TITLE, not the announcer pack.** Titles
already ride createRoom / joinRoom / queueJoin / the automatic rejoin, land on
the public player row, and are ownership-checked in BOTH ranked (at queue time)
and skirmish (`claimSkirmishSeat`, off the optional bearer token). Announcer
packs have no check anywhere. Finishers take the title path with one
deliberate difference, below.

### F1 — the wire, the sim, the server check

- **Sim `items.ts`:** `FINISHER_IDS` moves here from the client's
  `cosmeticIds.ts`; `SIGNET_FINISHERS` (the four), `DEED_FINISHERS` (snuffed),
  `finisherEntitlement(id)` → `finisher:<id>`; the four join
  `SIGNET_ITEM_IDS` (the API's unlock endpoint is a string allow-list and the
  Signet debit is item-agnostic — **no API or persistence change at all**);
  `ITEM_NAMES` entries; the `items.test.ts` fences mirrored (every signet
  finisher on the shelf, no deed finisher on it, no signet finisher paid by a
  deed).
- **Sim state:** `finisher: string` on `Player` (default `"none"`), projected by
  `toRoomStatePlayers` onto `RoomStatePlayer`.
- **Protocol:** `finisher?: string` on the three client messages + the public
  row. ADDITIVE, no version bump (the `title` precedent): an old client ignores
  the row field and never sends one; an old server ignores the claim.
- **Server — DEFAULT-DENY (the difference from titles).** A title is seated
  as claimed and stripped a beat later if unowned — and with no token, never
  checked at all. For something people pay for that's the wrong way round
  (Tom: enforce everywhere, or it's cheapened). So a seat ALWAYS starts at
  `"none"` and the finisher is GRANTED only after the ownership read comes
  back: ranked at queue time (one extra test on the entitlement read it already
  does; carried on `QueueEntry` / `RankedSeatAccount`, and across a void
  re-queue), skirmish inside `claimSkirmishSeat` (no token, no DB, unknown id,
  unowned → stays none). A finisher only matters at the moment of a kill, so
  the beat of latency is invisible. Ranked reclaim resumes the verified value;
  skirmish reclaim is re-verified. Bots: always none. `finisher` joins the
  `syncRoomState` diff key or a grant never reaches the room.
- **Client:** `deeds/wornFinisher.ts` (clone of `wornTitle.ts`; `bits.finisher`,
  loaded at boot beside the title), read at the four send sites;
  `GameScreen` plays the KILLER's row value instead of the dev flag. The dev
  menu's FINISHER row stays as a local-only override (your own kills, dev
  builds) so new finishers can still be iterated without owning them.
- **Practice:** your worn finisher plays only if the local entitlement cache
  says you own it (Tom: no free use in practice). Offline and unseen by anyone
  else, so the client-side check is enough.
- **Tests:** ranked grant/deny (clone of the title strip test), ranked-reclaim
  ignores a claimed finisher, and — new ground — a skirmish grant/deny test.

**F1 AS BUILT (2026-09-20)** — everything above, with these differences:

- **One ownership test, in the sim:** `grantedFinisher(claim, ownedItemIds)`
  (+ `ownableFinisher(claim)`) in `items.ts`. The ranked queue, the skirmish
  seat claim, practice and the client renderer all go through it, so
  "unknown id / `none` / unowned → none" can't drift between them.
- **`Room.setFinisher` is the only writer** and `Room.seat` never takes a
  finisher at all — a seat CANNOT be born dressed. Ranked: granted at
  `verifyAndEnqueue`, applied right after seating. Skirmish: granted when
  `claimSkirmishSeat`'s token lookup lands (one entitlement read now serves
  the title strip and the finisher grant).
- **Skirmish reclaim KEEPS the seat's finisher rather than re-verifying it**
  (the draft said re-verify). The client's automatic rejoin (`rejoinSeat`)
  carries no bearer token, and on a cold launch may fire before
  `bits.finisher` has loaded — a strict re-verify would undress a paying
  owner mid-match. It's safe: the seat's value was only ever written by a
  verified grant and only the seat-token holder can reclaim it. A reclaim
  that does bring a token + claim is verified again; a bare seat can't be
  dressed by a rejoin without owning the item (tested).
- **Client:** `deeds/wornFinisher.ts`; `GameScreen.finisherOf(killerId)` reads
  the killer's roomState row (absent on an older server → none); the dev
  FINISHER row overrides locally in dev-menu builds only. Until the wardrobe
  exists the only equip surface is the dev menu's **WORN (WIRE)** row
  (bits-dev-menu.md § Tool 8) — so a production build can't wear one yet.
- The four signet finishers are in `SIGNET_ITEM_IDS`, so the API will already
  sell them to a raw `/store/unlock` call; no client surface does until F3.
- Titles were left as they are (open question 4 stands).

**F4 AS BUILT (same day)** — `killing-blows-25` pays `finisher:snuffed`
(the `items.test.ts` fence "every deed finisher is paid by exactly one deed"
forces it); locked deed rows show an `EarnableMark` (*Unlocks the "Snuffed"
finisher*) for `finisher:` rewards only; back-grant =
`bun run entitlements:backfill` in the server app (dry run by default,
`--apply` to write; `grantOwedEntitlements` in persistence, item rewards
only, same rows/source as the live award). **Owed at deploy:** run it against
Turso AFTER the server is out.

### F2 — the wardrobe (where you put one on)

A new screen, its own route — not the War Table (per-match), not the Armory
(never shows owned items). Laid out for three slots; only FINISHER is live, the
other two simply aren't drawn until they ship (no "coming soon").

- Top half: a **live looping preview** of the selected finisher on a patch of
  sand — the real `FinisherField` in a small Skia canvas (the preview script
  proves the modules render anywhere). Below: tiles for NONE + every finisher
  you own; tap to wear (takes effect next room, the title rule).
- Snuffed, until earned, shows as one locked tile — "Earned from Gravedigger ·
  strike 25 killing blows" — tapping through to Deeds. Unbought finishers are
  NOT listed (that's the Armory's job); one quiet "More in the Armory →" door.
- A reusable `FinisherPreview` component (`loop` for hero/sheet, `frozenAtMs`
  for a still) — F3 reuses it everywhere.

### F3 — the Armory trade

- `ArmoryItem` grows a `kind: "weapon" | "ability" | "finisher"` discriminator
  (today it's `isWeapon: boolean` and everything assumes "else ability"); a
  small client finisher catalogue (name, one-line pitch, band colour) feeds
  `nameOf` / `hintOf` / `bandColor`; a third stock section beside STEEL /
  SORCERY.
- **No forged art owed.** Tiles show a STILL of the finisher at its signature
  moment (`FinisherPreview frozenAtMs`); the sheet's hero and the daily
  featured slot run it live and looping. The sheet says what it is in one
  line — "plays over every kill you make; everyone in the arena sees it" —
  and drops the ability meta row and the practice note.
- The seal-break ceremony plays the finisher once, full size, where the icon
  used to be; copy becomes "Yours, forever — it waits in your wardrobe", with a
  WEAR IT NOW button (one tap from purchase to equipped).
- The footnote "every arm is free to try in practice" stays true for arms; the
  finisher section carries none.

### F4 — Snuffed on Gravedigger, shown

- `killing-blows-25` gains `{ kind: "entitlement", itemId: "finisher:snuffed" }`
  beside its existing 10-Glory bounty.
- **Visible by kind:** the rule is "a `finisher:` reward is never a secret"
  (weapons/abilities stay hidden as today). A locked deed row gains an
  `EarnableMark` beside `BountyMark`: *Unlocks the "Snuffed" finisher*. The
  unlock ceremony card already renders it ("UNLOCKED — SNUFFED").
- **Back-grant:** anyone who already has Gravedigger won't get the entitlement
  from a rule added later — a one-off script grants `finisher:snuffed` to every
  account holding the unlock (the deed-Glory back-pay pattern).

### F5 — sound, hardening, launch

- A kill sting per finisher through the Forge (five briefs), one sound event
  each, played positionally by every client at spawn; the killer gets a
  matching haptic. **Launch-blocking** — they're silent today.
- Off-screen cull; worst-case perf pass on a weak Android (six-way brawl, WEAR
  EVERYONE, perf overlay); a long-room check of mark bakes.
- Store listing / promo clips via `bits-promos` once it's real.

**Build order:** F1 → F2 → F4 → F3 → F5. After F1+F2+F4 Snuffed is earnable
and wearable end to end with no store work; F3 then sells the other four.

**Open for Tom:**
1. Names — the wardrobe area, and the Armory's third trade.
2. The wardrobe's door — a fourth glyph in the home screen's icon dock
   (recommended: cheap, and "set and forget" suits a small door) vs a card on
   mode select (owes forged card art).
3. Tile art — stills rendered from the effect itself (recommended) vs forged
   icons.
4. While in `claimSkirmishSeat`: flip TITLES to the same default-deny? Today a
   skirmish join with no token wears any title unchecked. Small, same code.

## Build order

1. ~~Dev-menu prototypes, two per slot~~ — BUILT 2026-09-19 (§ Prototypes);
   Tom's on-device verdict decides what survives.
2. Cosmetics blob + entitlement check + protocol bump.
3. Armory trade, preview, equip surface.
4. The rest of the launch shelf, sounds through the Forge, deed gates.
