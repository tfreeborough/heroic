# Triggers

Status: **building (v1) — enter-the-gauntlet first** · Applies to: **both games**
(shared authoring primitive) · Last decided: 2026-07-03

A **trigger** is an invisible rectangular region a designer paints in
[Realmsmith](./realmsmith.md). It does nothing until the player walks into it, then it **fires an
action**. v1 ships exactly one action — **show text on screen** — but the action is modelled as an
open type so `spawn monsters`, `grant a temporary stat`, `open a door`, `play a sting` slot in later
without reshaping anything. See [world-representation](./world-representation.md) for the tiles /
collision / objects a trigger rides on, and [spawners](./spawners.md) for the per-object-state
pattern it copies.

## Intent: authored moments, not just authored geometry

Everything a zone can say today is *spatial* — where the walls are, where the nest is, which door is
red. A trigger is the first thing that lets a zone **react to the player** — "when you cross this
line, *this* happens." The cheapest, most useful first instance is **text**: a line of narration or
warning the moment you step somewhere ("The air grows cold…", "Turn back."). It costs the designer
one drag-out and one sentence, and it turns a silent room into a scripted beat.

The point of shipping the *mechanism* now — even with only one action — is that the region-entry
plumbing (place a hidden rect, detect the player entering it, fire once) is the reusable half. Once
it exists, adding "spawn an ambush" or "buff the player for 10s" is a new **action variant**, not a
new system.

## A trigger is a region ZoneObject

The key architectural move, mirroring how a [door is a locked breakable](./doors-and-keys.md): a
trigger reuses the existing **`ZoneObject`** pipeline wholesale rather than inventing a parallel
`triggers[]` array. A `ZoneObject` already carries `id`, `kind`, `x`, `y`, the optional **region**
fields `w`/`h` (they were reserved in the format for "an exit trigger area"), and a free `props`
bag. So a trigger is:

```
{ kind: "trigger", x, y, w, h, props: { action: "text", text: "…", durationMs, repeat } }
```

- **`x`/`y`/`w`/`h`** — the region, as a centre + size `Aabb` (the same convention as a breakable
  `box` and a free collision rect). The designer drags it out and resizes it by its corners in
  Realmsmith.
- **`props`** — the action config, flat scalars, exactly like a spawner stores its config in `props`
  and parses it with `parseSpawnerConfig`. A trigger has `parseTriggerConfig(props)` → a typed
  `TriggerConfig`, so an unset/garbled prop always resolves to a concrete default and a stale file
  can never crash a run.

This reuse means placement, selection, hit-testing, undo, save/load, and the Inspector are all the
existing object paths — the only genuinely new code is (a) drawing a *region* marker instead of a
point dot, (b) generalising the breakable-only corner-resize to region objects, and (c) the runtime
enter-detection. **No format-version bump:** the kind is additive and `w`/`h` already exist; older
loaders that don't know `"trigger"` simply ignore the object (the game already ignores `exit`/`poi`).

### Why not a dedicated `triggers[]` array with a typed action union?

It types the polymorphic action more cleanly, but it forces a second rendering / placement /
selection / hit-test / load path in the editor for **zero v1 payoff**. We take the flat-props route
now (the spawner precedent) and reserve the right to graduate to a structured `action` object **when
a single trigger needs to compose multiple effects** (show text *and* spawn *and* buff at once) —
that's the point where flat props actually hurts, and not before. Tracked under Open tunables.

## The action model

```
TriggerAction (v1)  =  { type: "text";  text: string;  durationMs: number }
                       // later: { type: "spawn"; creature; count; … }
                       //        { type: "buff";  stat; amount; seconds }
                       //        { type: "sound"; clip } …

TriggerConfig       =  { action: TriggerAction;  repeat: boolean }
```

`type` is the discriminator. v1 parses only `"text"`; an unknown `action` value falls back to the
default text action, so forward-authored files degrade gracefully rather than throwing.

## Firing: once per visit, with a repeat toggle *(decided 2026-07-03)*

A trigger is **edge-triggered on entry**. The default is **fire once per visit**: the first time the
player's centre crosses into the region it fires, then it's spent for the rest of the run — the same
"destroyed-this-visit" transience as a [spawner](./spawners.md) or an opened door, so **nothing new
for the save system**. A per-trigger **`repeat`** flag flips it to **re-arm on exit**: every entry
fires, leaving the region re-arms it. Default off (one-shot narration is the common case; repeat is
for ambient/looping text).

This is a tiny pure FSM in core, `stepTrigger(state, config, { inside })`, matching the
`stepSpawner` split — the game computes whether the player is inside the region each step and feeds
it in; the reducer decides whether this step *fires*:

```
             enter = inside && !was-inside          (rising edge)
  fire  =  enter && (config.repeat || !state.fired)
  state =  { fired: state.fired || fire,  inside }
```

Pure and deterministic (no RNG, no clock), so it's replayable and unit-tested like the rest of core.
"Inside" is a **point-in-rect test on the player's centre** — the designer sizes the region to the
felt trigger line; we don't inflate by the player radius (predictable and simple).

## Showing text: a centered banner *(decided 2026-07-03)*

On-screen UI in enter-the-gauntlet is **React overlays**, not Skia (health/damage are drawn into the
world picture; the HUD — thumbstick, weapon, dash, keys, XP — is React). A fired text action pushes
its message into a `useState`, and a **`TriggerBanner`** — a centered, fading overlay modelled on the
existing `LevelUpBanner` (reanimated `FadeIn`/`FadeOut`) and the `DoorNotice` bubble — renders it for
the action's `durationMs`, then auto-dismisses. The sim writes the state **only on the fire edge**
(like `setLockedNeed`), so there's no per-frame churn.

- **Placement:** centered (the dramatic read), capped width, italic prose in a dark bubble for
  legibility over any floor.
- **Duration:** authored per trigger (`durationMs`, default ~3s). A follow-up timer clears it.
- **Overlap:** if two triggers fire on the same frame the later one wins the banner (rare on a real
  map; a message queue is a future nicety, not v1).

## Where this lives (for implementation)

- **`@heroic/core` (pure, deterministic, testable) — `trigger/trigger.ts`:** the `TriggerAction` /
  `TriggerConfig` types, `TRIGGER_DEFAULTS`, `parseTriggerConfig(props)`, the `TriggerState` +
  `initTriggerState()` + `stepTrigger()` FSM, and `regionContains(region, point)`. Plus `"trigger"`
  added to `ZoneObjectKind` in `zone/format.ts`. Unit-tested (`trigger.test.ts`).
- **Realmsmith (`apps/realmsmith`):** `"trigger"` in `OBJECT_KINDS`; a `trigger` branch in
  `defaultObjectProps` + a default region size in `placeObject`; a dashed-rectangle region marker
  (with its text labelled) in `zoneRenderer.ts` and a rect selection outline; the breakable-only
  corner-resize machinery (`resizeBox` / `handleAt` / the resize drag branch) generalised to region
  objects; and Width/Height/Action/Text/Duration/Repeat fields in `Inspector.tsx`. Triggers are
  abstract regions, so — unlike solid-avoiding object markers — they may be placed over collision.
- **Game (`apps/enter-the-gauntlet`):** a `TriggerRuntime[]` built in the mount `useMemo` next to
  spawners/keys (per-object `state` + parsed `config` + region `Aabb`); a per-step region-enter pass
  in `onStep` beside the spawner loop, calling `stepTrigger` and `setTriggerText` on fire; the new
  `TriggerBanner` overlay mounted in the play-area JSX with an auto-dismiss effect.
- **Persistence:** trigger fired-state is **transient world state** — reset each visit, like
  spawners/doors. Nothing new for the save system.

## Open tunables / deferred (own decisions later)

- **More actions** — `spawn` (an authored ambush on entry), `buff`/`debuff` (a timed stat effect),
  `sound` (a sting, once the audio system has a sound-event layer — see [audio](./audio.md)),
  `door`/`gate` (script a wall open). Each is a new `TriggerAction` variant + a case in the runtime
  switch; no change to placement or detection.
- **Composite triggers** — one region firing *several* effects at once. This is the trigger to
  graduate `props`-flat → a structured `action[]` on the object (see "Why not a dedicated array").
- **Conditions** — fire only if a key is held / a nest is destroyed / on the Nth entry. A `when`
  predicate on the config.
- **Message queue** — if simultaneous/rapid triggers become common, queue banners instead of
  last-wins.
- **Enter vs. exit vs. dwell** — v1 fires on *enter*. A trigger could also fire on *leave*, or after
  dwelling inside for N seconds. A `on: "enter" | "exit" | "dwell"` field when needed.
- **Non-rectangular regions** — circles/polys. Rect covers the vast majority; defer.

## Glossary

- **Trigger** — an invisible rectangular `ZoneObject` (`kind: "trigger"`) that fires an **action**
  when the player enters it. Visible/editable in Realmsmith, never drawn in-game.
- **Action** — what a trigger *does* when it fires; a discriminated `TriggerAction`. v1: `text`.
- **Fire** — the rising-edge event when the player's centre crosses into the region and the trigger
  is armed. Once per visit by default; every entry if `repeat`.
- **Region** — the trigger's footprint, a centre + size `Aabb` (`x`/`y`/`w`/`h` on the object).
- **`repeat`** — per-trigger flag: off = one-shot for the visit; on = re-arms each time the player
  leaves the region.
