# Locked Doors & Keys

Status: **built (v1) — shipped in enter-the-gauntlet; SFX deferred** · Applies to: **both games**
(shared world mechanic; built for enter-the-gauntlet first) · Last decided: 2026-06-28

Borrowed from Gauntlet (1985), the game's namesake: **locked doors opened by matching keys**. A
light puzzle layer that turns a dungeon from a corridor you run down into a space you *read* —
"where's the red key for that red door?" The reward is exploration: you can't just sprint to the
exit, you have to look around. See [world-representation](./world-representation.md) for tiles /
collision / objects, [spawners](./spawners.md) for the reveal-on-break beat this builds on, and
[enemy-behaviour](./enemy-behaviour.md) for how doors gate enemy pathing.

## Intent: a reason to look around

Full top-down visibility (the thing that makes [spawners](./spawners.md) work) has a cost: there's
nothing to *find*. A locked door is the cheapest possible "find" — it's a wall that asks a
question. The answer (a key) is somewhere else in the zone, so the player has to leave the optimal
line and explore to get it. That's the whole pillar: **doors create curiosity, keys reward
satisfying it.**

Three things make it more than a fetch-quest:

1. **Choice under scarcity.** Keys are **consumed** on use. Find one red key but see two red
   doors, and you have to *pick* — which is the choice we want. Keys are a small economy, not a
   permanent unlock.
2. **The tease.** A locked door is **see-through** — it blocks movement but not sight (see
   ["Doors don't occlude"](#doors-dont-occlude-see-through) below), so your lit radius passes
   through it. You can *see* the room — and the threats — waiting behind it, which is exactly the
   "I want in" pull.
3. **Free enemy-gating.** A locked door is a wall to *movement* — enemies can't path through it —
   so the room behind it is unreachable until you open it. Because it's see-through, you can scout
   what's coming; opening the door is what lets the dungeon spill out. No extra system; it falls
   out of modelling the door as a (see-through) blocker.

## The four decisions (locked)

- **Color-matched, always.** A red key opens a red door — no ambiguity, instant readability. (We
  diverge from original Gauntlet's generic keys; this is the Doom keycard model, which reads
  better.)
- **Consumed on use.** One key opens one door, then it's gone. Inventory is a **count per color**
  (you can carry two reds). This is what creates the choice in (1) above.
- **Walk-into-unlock.** Touch a door while holding its color → it opens. No button, no prompt —
  mobile-friendly (your input is a thumbstick) and pure Gauntlet.
- **Full color system from the start**, with an on-screen **HUD strip** showing held keys by
  color and count. No single-key slice.

## A door is a locked breakable

The key architectural move: **a door reuses the [breakable](./world-representation.md) system
almost wholesale.** A breakable already has a footprint (`box`), `occludes` (blocks sight),
collision, and — crucially — a destruction path (`breakOne`) that drops its collision *and rebuilds
the navgrid*. "Opening a door" **is** "destroying a breakable," just triggered differently:

```
BreakableDef + lock:{color}  ──player contacts it…
                                    │
            ┌── holding matching key ┴── no matching key ──┐
            ▼                                              ▼
   OPEN: consume 1 key, run breakOne()            LOCKED: stays solid,
   (collision drops, navgrid rebuilds,            play rattle + surface
   unlock sound)                                  the door's color on HUD
```

What's new versus a normal breakable:

- A new `lock?: { color }` field on `BreakableDef` / `Breakable`.
- A locked door is **invulnerable to weapon damage** — hits do nothing but a dull *clink* (else
  keys would be pointless; you'd just shoot the door). No HP bar shown.
- The open trigger is **contact + matching key**, not HP-to-zero. Because the door has collision
  the player can't literally overlap it, so "contact" = within a small unlock margin of its `box`.
- **Default `occludes: false` — a door blocks movement but not sight.** The player's lit radius
  passes straight through it (like a `void`/gate in
  [world-representation](./world-representation.md)), so you see the room — and the threats —
  beyond. (The Occludes box can still override for an opaque door.)

Everything else — removal and the navgrid rebuild — is the **existing breakable destroy path**,
unchanged.

**Enemies never open doors.** Doors are a player-only affordance; an opened door is open for
everyone (enemies path through the rebuilt navgrid and can chase you back out), but a *locked* door
seals enemies out. That's the safe-room property, and it's why enemies must not be able to break or
open them.

**Per-run, like spawners.** A door opened this visit stays open this visit; next run (Gauntlet) /
next visit (Journey) it's locked again. Keys held reset the same way. This matches the
"destroyed-this-visit" model in [spawners](./spawners.md) — **nothing new for the save system.**

## Keys

- **Authored** as a `ZoneObject` of kind `"key"` with `props.color` — the same point-entity path
  as `creature` / `spawner` objects, so [Realmsmith](./world-representation.md) can already place
  them; we just add the kind and a color prop. (Doors, being breakables, are authored on the
  breakable path instead — see below.)
- **Pickup on contact.** Walk over a key → `inventory[color] += 1`, the key is removed from the
  world, a pickup chime plays, the HUD pip flashes. Keys don't block movement or sight — they're
  floor pickups.
- **Discovered by sight.** Keys render as a colored glyph clipped to the vision polygon like
  enemies, so you find them by exploring / seeing them, not through walls.

## Inventory & the HUD strip

- **State:** a per-run `keys: Record<color, count>` on the run/combat runtime. Not persisted
  across runs. Decremented when a door opens.
- **HUD strip:** a screen-space React overlay (there is no Skia HUD today — health/damage are
  drawn into the world picture; the on-screen UI is React: thumbstick + weapon + dash). A small
  horizontal strip, anchored top and camera-independent, shows **one pip per color currently
  held**, each a colored key glyph with a count badge when >1. Picking up flashes a pip in;
  spending drops the count / fades the pip out.
- **Locked-door feedback doubles as a hint:** bump a door you can't open and we briefly surface
  its required color (e.g. a greyed pip of that color) — so the player learns *what to hunt for*,
  not just "locked." *(A rattle SFX would pair with this, but the audio system only plays music
  beds today — there's no sound-event layer yet — so v1 ships **silent** with hook points left in;
  see [audio](./audio.md).)*

## Doors don't occlude (see-through)

A locked door blocks **movement** but not **sight**: it's authored `occludes: false`, so it never
joins the occluder set the player's vision (and projectiles, and enemy line-of-sight) is solved
against. Mechanically it's the existing `void` material — impassable, but see/shoot-across —
wearing a door's color and keyhole.

The payoff is anticipation. Your lit radius spills through the door into the room beyond, so a
locked door isn't a blank wall — it's a window onto what you'll face once you find the key. You see
the layout and the waiting horde; they can see you too (and, if ranged, shoot through), but they
**can't reach you** until the door opens — then they pour out. That tension ("I can see them, they
can't get me… yet") is the whole appeal, and it falls out of one flag.

This is **doors only**. A breakable **wall** (`wood-wall`) still occludes — opaque until you break
through — which is what keeps "break through to reveal the nest" a surprise
([spawners](./spawners.md)). Permanent walls are opaque as ever. Three coherent behaviors:
permanent wall = opaque; breakable wall = opaque until broken; locked door = see-through gate.

*(An earlier build tried a "peek-behind" sliver that leaked a band of sight past breakable
occluders. It was the wrong tool — see-through doors are simpler and what we actually wanted, and a
peek would have spoiled the nest-reveal beat — so it was removed.)*

## Colors / palette

A **fixed palette** keeps matching instant. *Resolved 2026-06-28:* **six** colors —
red / gold / green / cyan / blue / purple — spread around the hue wheel so any two read as
clearly different. The HUD only ever shows the colors you're *holding*, so the full set never
crowds it. Defined once in core as `KEY_COLORS` (id → label + hex); doors and keys both reference
a color by id, so a door and its key are guaranteed to match because they name the same palette
entry. Extend by adding one entry.

## Where this lives (for implementation later)

- **`@heroic/core` (pure, deterministic, testable):** the `lock` field on `BreakableDef` /
  `Breakable`; the `KeyColor` palette; the inventory type + consume/pickup rules; the unlock rule
  (contact + matching key → open + decrement, else locked). Opening a door reuses the existing
  breakable-removal + navgrid-rebuild — no new pathing code; a door's see-through-ness is just
  `occludes: false`, which the existing occluder build already honors.
- **`@heroic/engine` / app:** key rendering; door visuals (colored frame + lock glyph,
  invulnerable so no HP bar); the React HUD strip; door body removal on open (existing breakable
  path). Unlock / locked / pickup **SFX are deferred** — the audio system only plays music beds
  today; v1 leaves hook points and ships silent ([audio](./audio.md)).
- **Content / data (Realmsmith):** add `door` to the breakable kinds (with a `lock.color`
  picker) and `key` to the object kinds (with a `color` prop). Author doors + at least enough
  reachable matching keys for the **critical path** (see solvability below).
- **Persistence:** keys-held and doors-opened are **run-scoped** — resets each run, like
  spawners. Nothing new for the save system.

## Solvability (a consequence of consumed keys)

Because keys are consumed, *count balance matters*: clearing **N** red doors needs **≥ N**
reachable red keys. Not every door must be openable (some can gate optional bonus rooms), but the
**critical path to the exit must always be solvable** with the keys reachable before it. This is an
authoring discipline first; a later Realmsmith **lint** ("door color X has fewer reachable keys
than doors on the path") would catch mistakes automatically. Tracked as a tunable, not v1-blocking.

## Open tunables (your calls)

- **Do doors occlude sight?** — *resolved 2026-06-28:* **no.** A door blocks movement but not sight
  (`occludes: false`), so the lit radius passes through and you see the room beyond. Breakable
  walls still occlude. (An earlier peek-behind experiment was removed — see "Doors don't occlude".)
- **Door unlock reach** — how far past touching a door opens (`DOOR_UNLOCK_MARGIN` in core). Set to
  40px so you open a door by walking *up to* it, not pressing into it. Tunable.
- **Palette size** — *resolved:* six (red/gold/green/cyan/blue/purple); see Colors above.
- **Locked-door hint** — confirm surfacing the required color on a failed bump (rec: yes).
- **The reward behind the door** — *resolved 2026-06-26:* it's the **level designer's call**. The
  system just provides colored doors/keys as an authoring primitive; what's behind any given door
  (safe room, shortcut, nothing, or eventually treasure) is content, not mechanic. A dedicated
  **treasure-chest system** is a future doc; doors don't block on it.
- **Death & keys** — drop held keys on death, or keep them? (rec: keep — simpler, less punishing.)
- **Multi-zone keys** — keys only ever matter within their own zone (v1), or can a key carry to a
  later zone? (rec: zone-scoped v1.)

## Open / deferred (own docs)

- **Treasure / item pickups** — the general "reward you find" system doors most want to point at.
- **Realmsmith solvability lint** — reachable-key vs. door-count checking.
- **Special doors** — one-way doors (open from one side to make a loop), boss-room "great doors"
  that need a unique named key, levers/switches as a non-key opener.

## Glossary

- **Locked door** — a breakable with a `lock: { color }`, invulnerable to weapons, opened only by
  touching it while holding a matching-color key. Blocks movement but **not** sight (see-through).
  Opening it runs the normal breakable-destroy path (collision drops, navgrid rebuilds).
- **Key** — a colored floor pickup (`key` object) that adds one to the player's count of that
  color; **consumed** when it opens a door.
- **Key inventory** — per-run count of held keys per color; shown on the HUD strip; resets each
  run.
- **See-through door** — a locked door is authored `occludes: false`: it blocks movement but not
  sight, so the player's lit radius passes through it (like a `void`). Breakable *walls* still
  occlude.
- **Occluder** — anything that blocks line of sight (permanent walls, and breakables with
  `occludes: true`). Distinct from a movement blocker (a `void`, or a locked door, blocks movement
  but not sight).
- **Solvability** — the property that the keys reachable before a door are enough to open every
  door on the critical path; consumed keys make this a counting constraint.
