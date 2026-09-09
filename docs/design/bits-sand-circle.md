# The Closing Sands — the shrinking safe circle

*Designed 2026-09-03 (Tom + Claude). Status: BUILT (same day) — on-device pass +
forged SFX owed.*

## Why

Rounds have no clock. Nothing in the rules forces a fight to end: two cautious
players (or a player and a bot) can circle each other indefinitely, and the
bots' "impatience" dial exists precisely to fake the urgency a real clock would
supply. A match is *expected* to resolve inside a minute; anything past that is
the stall case. The Closing Sands is the honest fix: after a delay, the playable
area shrinks to a small circle at a randomized spot, and everything outside it
is a swirling blood tide that damages anyone standing in it. Fight, or bleed.

It reads instantly to anyone who has seen a battle royale — and a wall of
churning blood fits this game better than a blue force field ever would.

## Naming (decided 2026-09-09)

Players never hear "sands" or "circle". The thing is **the Blood Tide** —
in banners, deed names and descriptions, codex copy, the Primer, and title
announcements. Nobody "drowns": they are *taken by the Blood Tide* or *die
to the Blood Tide*. "The Closing Sands" and every `sands*` identifier stay
as the INTERNAL name (code, docs, wire) — no rename churn on protocol
fields.

## The rules

- **Per round, not per match.** Every round arms its own circle; the round
  reset clears it. It runs in every mode — ranked, skirmish, **and practice**
  (players should learn it against bots) — but never in the target-dummy range
  (`state.training`: rounds there deliberately never end).
- **Timing** (defaults; env-tunable, below): the circle rolls at **45s** of
  active round time and closes over **45s** to a final radius of **200px**,
  then holds there until the round ends. `round.elapsed` accrues only while the
  phase is `"active"` — countdowns and end plates don't burn the fuse.
- **The center is random but fair.** Rolled from the sim RNG (deterministic —
  the seed/rngDraws contract holds): a fixed number of candidate draws, first
  candidate whose *final* circle sits fully on walkable sand (inside the arena
  margin, clear of every collision box) wins; if none qualifies, the best
  clearance among them does. The final ring can never center on a rock.
- **The blood damages on a ramp.** A tick every 0.5s to every living player
  whose body is outside the ring. Damage per tick scales with close progress
  (2 → 8 as the circle shrinks, i.e. 4 → 16 dps): early blood is a warning,
  endgame blood out-damages a Blood Font's 8/s heal — you cannot healturtle in
  the tide. Ticks are **ambient damage** like bleed: they ignore dash i-frames
  and Ironhide (the blood is already on you), tint red, and never ring/haptic.
- **The sands claim kills, credit no one.** Circle ticks carry
  `SANDS_ATTACKER_ID` (−1). Stats/deeds ignore an unknown attacker by
  construction; the client skips kill-streak/announcer calls for it (no
  "FIRST BLOOD" by the environment) but still ends the victim's own chain.
  *Future:* credit the last real attacker within ~5s, so circle-camping can't
  deny kills.
- **Bots respect it.** The circle rides `RoundSnapshot`, so every brain reads
  it off the same wire as humans (`BotWorld.round`). One steering term: outside
  the ring (or within a margin of the edge) a strong nav-routed pull toward the
  center joins the blend — dominant when standing in blood, a lean when near
  the edge. New micro-pauses are suppressed while in the blood. The impatience
  dial stays (it matters *before* 45s) but the circle now supplies the real
  endgame urgency.

## The moment it starts

One additive event, `{ type: "sandsStart", cx, cy }`, fired the tick the circle
rolls:

- **Banner**: the kill-announcement banner shows **THE BLOOD TIDE RISES** on
  every client.
- **Sound**: catalogue event `sandsClose` → clip `sands_close_1` (owed from the
  Forge: a deep war-horn over a rising wet churn — dread, not a jump scare;
  master it hot like `quake_rumble`, it must read on a phone speaker).

## Wire (protocol v31)

`RoundSnapshot` gains `sands: { cx, cy, r, p } | null` — center, current
radius (server-computed each tick, so clients never need the timing config and
env-tuned servers stay authoritative), and close progress 0→1. A handful of
numbers, only while a circle is live. Old clients ignore the field and the
event (the additive-event rule), but they'd render no circle and die to
invisible blood — hence the version bump.

## Rendering — the performance contract

Budgeted per the June perf pass (JS-thread record cost, GPU raster cost,
viewport culling). Three layers:

*V2 after the first playtest (2026-09-03): v1 drew orbiting blood discs around
a clean circle — Tom's wife read it as a possible HEAL zone. Root cause: a
clean ring + circling blobs is the Blood Font's exact visual grammar, and
zone-shaped geometry in this game means "ability", not "hazard". The rule that
came out of it: the tide draws **liquid and inward threat, never geometry or
orbits** — no clean circle may survive anywhere, and all motion points AT the
player's space (orbiting motion is aura language).*

1. **The blood (always, ~free).** The outside tinted in the floor-blood
   palette — wet arterial at the shore, congealing near-black past ~90px
   (deeper = deadlier at a glance) — as two even-odd path fills (viewport
   rect minus shoreline / minus circle; v8 — never clips). The boundary is a *lapping shoreline*: one 48-vertex wavy path per
   frame (offscreen-arrow scale, nowhere near a crack web) that doubles as
   the tint's clip and the stroked, pulsing arterial edge. Its wobble sits
   strictly OUTWARD of the honest damage radius, so the safe sand is never
   overpainted. Drawn OVER bodies (the sandstorm's overlay rule — the tide
   obscures), radius stepped per snapshot at 30Hz.
2. **The surge (disciplined).** ~34 blood streaks rushing INWARD with a shared
   tangential curl — a maelstrom spiralling at the barrier, dominant component
   always the inward rush (the sinkhole infall grammar: closed-form phase
   from time, no particle state) — plus ~22 boiling flecks blinking in the
   shore band and spray popping off the current wave crests. Each element
   culled to the viewport. Ring edge off-screen → layer 2 draws nothing.

*V3, same day ("I want a scary maelstrom the circle seems to be barely
holding back" — Tom): the shoreline shape moved into `sandsWob` — a base line
sitting TIGHT to the honest radius (+3px) with fast 13/21-lobe chop and two
counter-travelling wave trains whose cubed crests rear to ~+35px and slam
along the barrier (crest slams spray at the rearing points); the streaks
gained the curl, the boil and spray were added, and the deep near-black band
pulled in to ~90px. All still closed-form, ~90 cheap ops when the edge is
on-screen.*

*V4, same day (Tom): baseline chop halved — the line itself was vibrating; the
violence belongs to the rearing crests, not a wobbling circle — and a DEBRIS
layer added: gobbets circulating slowly in the body of the tide (one shared
handedness, smeared along their travel, living off the barrier on lazy
circuits — wreckage in a whirlpool, not an aura ring, so the wife-test rule
holds: irregular depths, mixed sizes, never a clean band, never queueing at
the edge).*

*V5 → V6, same day: v5 tried a baked GORE ATLAS of blobPath gobbet sprites
(drawAtlas-stamped chunks + motes, the crowd idiom) — Tom binned it on sight
("look kinda crap") and chose PURE LIQUID over floating objects. V6: the body
of the tide is CURRENTS — ~26 long curved current-lines sweeping on the
maelstrom's one handedness with real maelstrom physics (fast water hugging
the barrier, lazy in the deep; each line breathes in radius so nothing tracks
a fixed lane), plus ~14 short bright FOAM breaks riding the fastest water
just off the shoreline. The sandstorm's animated-arc idiom: one addArc path
per line per frame, culled by radius band against the visible annulus.
Lesson recorded: in this game's top-down flat-shaded look, "stuff floating in
the blood" reads as clip-art — liquid must be drawn as FLOW, not objects.*

*V7 — production perf pass (Tom's OnePlus 12 dropped frames in real matches,
2026-09-03): rebuilding ~40 small paths inside recordArena every rendered
frame was the scar-cache lesson repeated. The tide now re-records on a 25Hz
beat (`TIDE_REBUILD_MS` 40) into its own cached world-space SkPicture — the
scarLayer idiom — and recordArena replays ONE op per frame; culls inside the
recording pad by `TIDE_PAD` 50 so camera drift between rebuilds never pops an
edge element. Counts also trimmed: currents 26→16, streaks 34→22, flecks
22→14, foam 14→9, shoreline verts 72→56. The tide is animated texture, not
tracked geometry — 25Hz reads identically. Rule going forward: nothing in the
tide may build paths per rendered frame.*

*V8 — the FLAT-LIQUID tide (2026-09-09, players reported a hard frame drop
the moment the tide enters, even after v7). Root cause: the v7 picture cache
only saved JS *recording* time — the GPU still replays every op in the
picture each frame, and layer 1's two `clipPath(Difference, antiAlias)`
calls (the 56-vertex shoreline and the r+90 circle) under full-viewport rect
fills were the wall. A non-rect anti-aliased path clip makes Skia rasterise
a viewport-sized coverage MASK and sample it for the fill — every frame, at
device resolution. The blood is now ONE even-odd filled path (viewport rect
+ shoreline contour) and the deep band the same with a circle: plain path
draws through the tessellating renderer, no clip stack, no mask; the blood
fill is non-antialiased (the stroked shoreline hides its edge). Layer 2 was
cut to the bone: boil flecks, foam breaks and crest-slam spray are GONE;
8 current arcs drawn with `canvas.drawArc` (no path allocation at all) and
12 inward streaks (`drawLine`) keep the maelstrom read; the pulsing
shoreline stroke keeps "no clean circle anywhere". A view wholly out in the
blood (past the widest crest) draws two plain rects and no shoreline. Rule
going forward, joining v7's: nothing in the tide may CLIP — a path clip
under a fill is a per-frame mask; subtract shapes with even-odd fills.
Sim side, same day: the bots' flow field for the tide centre re-flooded the
whole arena every 6 resolves although the centre never moves (`nav.ts`
staleness backstop) — a goal that has not moved at all now never
re-sweeps, which also covers planted fonts and mines.*

*V8.1 (2026-09-09, Tom: "really choppy until it gets to its smallest
size"): the ring is ~2500px when it rolls, so 48 fixed verts were ~330px
chords — a visible polygon — and the wave lobes were authored in ANGLE
space, so at that size one "crest" was a kilometre-long swell sweeping at
~1700px/s. Now (a) shoreline vertices are spent by arc length, `SANDS_EDGE_SEG`
10px chords on the stretch the viewport can see (`visibleArc`, capped at
`SANDS_EDGE_MAX` 720) and coarse every 7.5° off-screen where the contour
only has to close the fill; (b) `sandsWob(a, t, r)` quantises each lobe
count to a whole number per radius, anchored at `SANDS_WOB_REF_R` 200 (the
final ring, exactly the v4 shape) and scales the phase speeds with it, so
wavelength and crest speed are constant in PIXELS from roll to hold.*

*V8.2, same day (Tom: "jumps around like electricity … a few smooth lines
rather than linking hundreds"): two fixes. (1) v8.1 had also scaled the
waves' TEMPORAL rate with the lobe count — wrong: crest speed is ω·r/n px/s
and with n ∝ r a constant ω is already constant px/s — so at the opening
radius the chop ran at ~90 rad/s and aliased on the 25Hz beat into jitter.
Rates are constant again. (2) The visible shoreline is now sampled every
~26px (cap 240) and emitted as cubic Béziers with Catmull-Rom tangents
(`emitShorelineCurves`, samples in a reused Float32Array) — a few dozen
smooth curves, shared tangents at every join, no corners. Off-screen arc
stays straight coarse verts.*

*V8.3, same day (Tom: "still quite fast … lines instantly snap … make it
super smooth and slow moving, a smooth creeping line"): (1) the v8.1 lobe
ROUNDING was the snap — every time the shrinking radius crossed a rounding
boundary the whole pattern re-phased at once; `sandsLobe` now crossfades
between the two neighbouring whole lobe counts by the fractional part, so
the count hands over as a slow amplitude beat, never a jump. (2) Curve
samples sit on a WORLD-anchored angular grid (multiples of `da` from angle
0) instead of the viewport's edges, so camera drift never re-samples the
shape — the curve moves only because the waves move. (3) Every rate cut
~4×: trains 0.7 / −1.0 rad/s (a crest creeps ~45px/s at any radius), chop
1.5 rad/s with the 21-lobe term dropped, shoreline pulse 0.5Hz, current
arcs ~9°/s, streaks ~2.5× slower. Sample spacing 22px. V8.4 ("a touch
slower"): everything ~30% slower again — trains 0.5 / −0.7, chop 1.0,
pulse 0.35Hz, arcs ~6.5°/s, streaks 0.18 base (crest ≈ 33px/s).*
3. **In the blood (local, bounded).** When the LOCAL player stands outside the
   ring: a red radial-gradient vignette in the post-camera screen-space pass.
   At most one instance, ever.

**Constraints (hard):** no blur/mask filters, no path CLIPS (v8 — an AA
path clip under a fill is a per-frame coverage mask; subtract with even-odd
fills), no per-frame vector webs (the cracks-v1 mistake — the one 48-vertex
shoreline path is the sanctioned exception), no full-screen RuntimeEffect
shaders. Streak count / current count / shoreline vertices / opacities are
on-device tuning knobs (`SANDS_STREAKS`, `SANDS_CURRENTS`, `SANDS_EDGE_PTS`);
the two tint fills + the stroked shoreline alone are an acceptable shipping
floor.

Sim cost: one distance check per player per tick plus a tick accumulator —
noise next to `stepDeployables`.

## Env tuning (the test loop)

`configureSafeCircle(overrides)` mutates the `CLOSING_SANDS` table:

- **Server** (Render env / local shell): `SANDS_DELAY_S`, `SANDS_CLOSE_S`,
  `SANDS_FINAL_RADIUS`, and the `SANDS_ENABLED` kill switch — off on `0`,
  `off`, or `false` (case-insensitive; the `RANKED_BOT_BACKFILL` dialect),
  anything else (or unset) is on. Read once at boot in `main.ts`, logged.
- **Client (practice mode runs the sim in-process — there is no server to
  configure offline)**: `EXPO_PUBLIC_SANDS_DELAY_S`, `EXPO_PUBLIC_SANDS_CLOSE_S`,
  `EXPO_PUBLIC_SANDS_FINAL_RADIUS`, `EXPO_PUBLIC_SANDS_ENABLED=0` — set them in
  `.env.local` (e.g. delay 5 to see the circle immediately vs practice bots).
  `__DEV__`-gated (the store dev-tools rule): a production binary runs the
  shipped defaults no matter what env it was built with, and `.env.production`
  never sets these (bits-ota-env-gotcha.md). Online matches ignore client env
  entirely — the radius comes off the wire, so this dial could never touch a
  real match even un-gated.

## Files

Sim: `config.ts` (`CLOSING_SANDS` + `configureSafeCircle` + `SANDS_ATTACKER_ID`),
`state.ts` (`round.elapsed`, `round.sands`), `round.ts` (accrual + reset),
`sands.ts` (roll + tick), `step.ts` (call), `events.ts`, `protocol.ts`,
`snapshot.ts`, `bot.ts` (steering), `sands.test.ts`. Server: `main.ts` (env).
Client: `render.ts` (three layers), `GameScreen.tsx` (banner/SFX/kill-guard),
`audio/catalogue.ts`, `net/practice.ts` (env), `audio/killstreaks.ts`
(`endChain`). Forge: `styleBible.ts` brief + `soundSet.ts` flow row.
