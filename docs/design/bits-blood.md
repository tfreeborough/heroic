# Blood in the Sand — blood v2: the persistent floor

2026-07-22. The blood system (`apps/blood-in-the-sand/src/game/blood.ts` +
the scar layer in `render.ts`) is the game's namesake and it has two problems
in practice:

1. **4v4 matches churn the decal cap.** `MAX_DECALS = 800` with oldest-first
   eviction was tuned for duels. A kill throws ~90 decals and eight players
   drip trails, so three kills plus a scrap evicts pools that were supposed to
   last 100 seconds after ~20. The bloodiest matches show the *least* blood —
   backwards.
2. **The death spray reads as airbrush, not gore.** The 80 droplets scatter
   *uniformly* across the back-cone (only distance-biased). Uniform random
   fill is exactly what makes it look like a shotgun stipple. Real flung blood
   has structure: a few distinct jets with droplets strung along them.

Everything below stays inside the existing contract: blood is **client-derived,
never networked** (events.ts rule), and per-frame cost stays one `drawPicture`
of the cached scar layer.

## 1. The splat map: bake dried blood into a persistent texture

The key observation: once a decal is past `BLOOD_DRY_MS` (16s) its appearance
never changes again — wetness has smoothstepped to 0, the ramps have bottomed
out, and (by construction: 16s < `FADE_START × ttl` for both drips and pools)
its ttl fade hasn't started. Re-recording it into every scar rebuild for the
rest of its life buys nothing.

So: keep a **world-resolution offscreen surface** (a *splat map* — a texture we
permanently stamp marks into, same technique as the baked floor image at
`render.ts:189`). On a scar rebuild, decals that have fully dried are
**harvested** — stamped once into the surface at their dried colours, snapshot
to an `SkImage`, and spliced out of the live array. The rebuild then draws:

    splat image  →  cracks  →  live (wet) blood

Consequences, all good:

- **The live array only ever holds the last ~16 seconds of wet blood** — a few
  hundred decals in the worst 4v4 bloodbath. `MAX_DECALS` stays as a backstop
  but stops being the thing that erases history. Scar rebuilds get *cheaper*
  as a match gets *bloodier*.
- **Blood persists for the whole match.** Baked marks can't fade individually,
  and we don't want them to: the arena is called Blood in the Sand, and the
  floor keeping every kill site is the fantasy. This extends the existing
  "arena remembers" rule (the field already survives rematches in a room).
- Ordering nuance: new tremor cracks now draw **over** ancient dried blood
  (they used to draw under all blood). An earthquake fracturing bloodied
  ground reads correctly; wet blood still covers everything.

Details:

- **Harvest batching.** `makeImageSnapshot()` on the 1600² CPU surface is a
  ~10MB copy (a few ms). Don't pay it per rebuild: harvest only when ≥24
  decals are dry or the oldest dry decal has waited >2.5s. During a sustained
  fight that's one snapshot every ~2.5s; in quiet stretches, none.
- **Anti-saturation wash.** Every 10s the surface is multiplied by a
  `DstIn` alpha wash (keep = 0.99 → half-life ≈ 11½ min). Invisible at match
  timescales; guards a marathon room from a solid-red floor. One constant to
  tune if we ever want visible fading back.
- **Surface ownership.** The surface is keyed to the `BloodField` instance —
  a new room (new field) clears it. Same lifetime the decals already have.
- **Fallback.** If `Skia.Surface.Make` fails, harvesting is skipped and the
  system degrades to exactly today's behaviour (ttl fades + FIFO cap).
- Memory: one 1600² RGBA surface + snapshot ≈ 10MB each — same budget the
  baked floor already spends. Revisit half-resolution if devices complain.

## 2. Death spray v2: tendrils, flight, anchors

`deathBurst` keeps its identity — small droplets, a lot of them, out the
victim's back ("small little droplets, just a lot more of it") — but gains
structure:

- **Jets, not mist.** 3–5 jet angles inside the 26° half-cone, each with its
  own length (one guaranteed long, ~230px). Droplets are strung *along* the
  jets — fatter and denser near the body, finer and sparser at the tips,
  lateral jitter widening with distance. A thin uniform mist (~15 tiny drops)
  stays underneath so the jets sit in a haze rather than on clean sand.
- **Anchor smears.** 1–2 heavy streaks running from the body along jet axes
  tie the spray to the corpse (today it starts 20px out and floats).
  The 5 bridging gouts and the `splatter()` pool are unchanged.
- **In-flight beat.** Jet and mist droplets no longer teleport onto the floor:
  each gets a landing time (~120–280ms, further = later) and lives in a
  `flying` list until then — drawn per-frame as airborne droplets (above the
  bodies; it's in the air) easing out from the corpse, converting to a floor
  decal where they land. Near drops land first, so the splatter *paints
  outward*. Anchors/gouts/pool still appear instantly — they're at the body.
  Landing pushes bump the epoch, so the existing 200ms fresh-rebuild path
  picks them up; the flying pass itself is ≤100 tiny circles for a third of a
  second, per-frame recording noise.

## 3. Bloody footprints

Walk through a still-wet pool (wetness > ~0.25, i.e. younger than ~10s) and
your next **6 steps** stamp small alternating footprint smears — regular
cadence, alternating sides, fading as the blood wears off. Regularity is the
tell: drips are deliberately irregular, footprints deliberately metronomic, so
the two read differently on the same sand.

This is the cheapest feature in the doc (a counter + side toggle on the
existing per-player `DripTracker`) and directly serves the design goal at the
top of `blood.ts`: hunting a wounded runner by their trail — now also hunting
whoever finished them and walked away. Re-crossing wet blood refreshes the
count. Wet-pool test is players × live wet pools, both small post-bake.

## 4. Directional hit splash

Non-lethal `splatter()` is omnidirectional around the impact point. It now
takes the same attacker→victim direction the death burst already gets from
GameScreen: ~60% of droplets exit in a ±45° fan on the far side of the victim
(through-wound), the rest stay radial (impact spatter). Every hit's geometry
becomes readable, and lethal hits stop being a different *kind* of physics —
just a bigger one.

## 5. Seeping death pools

The kill pool doesn't appear at final size: it spawns at today's size and
**seeps outward to `POOL_GROWTH`× its birth radius over `POOL_GROW_MS`**,
ease-out — blood runs fast at first, then slows as it soaks into the sand. Free by
construction: pools already draw their unit-baked silhouette under
translate+scale, so growth is one extra multiplier (`poolGrowth`), a pure
function of the decal's birth time like everything else in the material.
Details:

- Each blob in the pool cluster (main + 5 lobes) swells around its own
  centre, so the overlaps deepen and the mass spreads as one stain.
- The **clot stays at birth scale** — the thick core doesn't ride the
  thinning seep edge outward.
- While any pool is growing, the scar cache holds its FRESH (200ms) beat —
  at the 1Hz fade beat a 10s growth would pop ~2.4px per step instead of
  spreading. Costs a few extra rebuilds per kill, over a window where combat
  is usually forcing them anyway.
- Growth completes before BLOOD_DRY_MS by design, so the splat bake always
  stamps the final footprint, and the footprint wet-test uses the grown
  radius (a seeping pool inks feet further out).

## 6. Sound (per the audio done-tick rule)

One new static bank: **`squelch`** — wet footstep through blood. Played once
per pool-crossing (when the footprint counter refreshes from empty), proximity-
attenuated like other positional sounds, throttled by the director as usual.
Catalogue + Forge mirror rows land with this feature; the slot stays silent
until the clip is forged (standard lights-up-later behaviour).

## 7. Tremor cracks ride the splat map (added 2026-07-23)

The multi-tremor frame drop was the crack system fighting the scar cache:
every live quake popped a new crack decal each 150ms, every pop bumped the
epoch, and each 200ms rebuild re-recorded up to 128 crack paths (~10ms
measured) plus all live blood — sustained for every quake's 4-second life.

Cracks v2 removes cracks from the scar cache entirely:

- **One fracture web per quake** — born with the deployable (GameScreen
  tracks quake ids; a vanished id settles its web). The web is two paths: a
  primary skeleton of jagged radial arms (3px stroke) and a fine layer
  (1.6px) of branches, sub-forks and **broken concentric ring cracks** — the
  circumferential fractures real shattering has. The cast keeps its separate
  slam-sized web at the epicentre.
- **Live webs draw per frame**, outside the cache: a clip-reveal uncovers
  the web outward over the **zone's full duration** (animation time ==
  ability time — full radius lands exactly as the quake dies; slams race in
  `SLAM_EXPAND_MS`), advancing as a linear front mixed with discrete lurches
  (`LURCH_STEPS`) so the ground jolts open rather than wiping. Ring cracks
  surface as the front passes their radius, so new structure keeps appearing
  for the whole quake. When the zone dies the drama fades to the settled
  alpha over `CRACK_SETTLE_FADE_MS`; a zone that dies early freezes its
  front and bakes only what it cracked open. Cost: a few drawPath calls —
  bounded by simultaneous quakes, not accumulated pops.
- **Settled webs stamp into the splat surface** at exactly the alpha the
  live pass last drew (invisible handoff, same trick as dried blood) and
  leave the live list. A spent quake leaves its circle permanently
  shattered — "arena remembers" now covers earthquakes. The surface is
  chronological: later blood covers earlier scars and vice versa.
- The scar cache's dirty signal is now **blood epoch alone**; cracks never
  trigger a rebuild. If the splat surface can't be created, settled webs
  slow-fade out over 30s instead of baking (graceful fallback, mirrors
  blood's).
- Layering trade-off, accepted: a live web draws over this-second's wet
  blood (dark strokes over dark red for a few seconds); once baked it sits
  under everything later.

## Future / explicitly out of scope now

- **Weapon-flavoured kill sprays** — blade: an arced cast-off slash line;
  hammer: radial slam splat instead of a back-cone; bow: long narrow
  through-and-through jet. The killer's weapon is in the snapshot; it's an
  emission-pattern switch over the same decal system. Do after the above
  lands and reads well on device.
- **Visible long-term fading** — if persist-all-match turns out too dirty in
  playtests, tune the wash keep-factor; no new mechanism needed.
- Rejoiners/spectators still start with a clean floor (existing, accepted).

## Tuning constants (initial)

| Constant | Value | Meaning |
| --- | --- | --- |
| `BAKE_MIN_BATCH` | 24 decals | harvest when this many are dry… |
| `BAKE_MAX_WAIT_MS` | 2500 | …or the oldest dry one waited this long |
| `WASH_INTERVAL_MS` / `WASH_KEEP` | 10 000 / 0.99 | anti-saturation decay |
| `JETS` | 3–5 | tendrils per death burst |
| `JET_LEN` | 90–230px | per-jet reach (one long guaranteed) |
| `FLIGHT_MS` | 120–280 | droplet air time, scales with distance |
| `FOOT_STEPS` | 6 | footprints per wet-pool crossing |
| `FOOT_STEP_PX` | 26 | stride length between stamps |
| `FOOT_WET_MIN` | 0.25 | pool wetness needed to re-ink feet |
| `POOL_GROWTH` | 1.5× | death-pool seep: final radius multiple (Tom's tune) |
| `POOL_GROW_MS` | 1 200 | seep duration (ease-out; < BLOOD_DRY_MS) |
| `SLAM_EXPAND_MS` | 450 | cast-slam web reveal (quake webs use zone duration) |
| `LURCH_STEPS` | 9 | reveal jolts mixed over the linear front |
| `CRACK_SETTLE_FADE_MS` | 800 | quake death → drama fades to the baked stain |
