# Locked Doors & Keys

Status: **built (v1) — shipped in enter-the-gauntlet; SFX deferred** · Applies to: **both games**
(shared world mechanic; built for enter-the-gauntlet first) · Last decided: 2026-06-29

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
2. **The tease.** A locked door is **see-through for you** — it blocks movement (and *enemy* sight)
   but not *your* sight (see ["Doors are a one-way window"](#doors-are-a-one-way-window) below), so
   your lit radius passes through it. You *see* the room — and the threats — waiting behind it,
   which is exactly the "I want in" pull.
3. **Free enemy-gating.** A locked door is a wall to *movement* — enemies can't path through it,
   and can't even *detect* you through it — so the room behind it is unreachable *and* dormant
   until you open it. You, meanwhile, see straight in and can scout it safely; opening the door is
   what lets the dungeon spill out. It falls out of modelling the door as a one-way window.

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
- **A one-way window — blocks movement and *enemy* sight, but not *your* sight.** A door is
  *defined* by its `lock`, so the game keeps it in the enemy/projectile occluder set but drops it
  from the player's vision set (regardless of the authored `occludes` flag) — your lit radius passes
  straight through it while enemies stay blind to you. See
  ["Doors are a one-way window"](#doors-are-a-one-way-window).

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

## Doors are a one-way window

A locked door is **see-through for the player only**. It blocks *everything* a wall does —
movement, **enemy line-of-sight, projectiles, targeting** — **except** the player's own fog of war.
So your lit radius spills through the door into the room beyond, but the enemies in there **can't
detect or shoot you back through it**, and you can't shoot them either: it's a window, not an
arrow-slit.

This needs **two occluder sets** (in the game's `computeDynamicGeometry`), differing only by doors:

| set | doors? | feeds |
| --- | --- | --- |
| `occluders` | **in** | enemy LOS, auto-target, projectiles, spawner reveal |
| `visionOccluders` | **out** | the player's fog-of-war polygon only |

A door is a door by virtue of its `lock`, so it's filtered into/out of each set regardless of its
authored `occludes` flag — existing authored doors need no re-saving. Movement is unaffected: a door
is always in the movement-blocker list.

The payoff is **safe anticipation**. The door is a window onto what you'll face once you find the
key — you see the layout and the waiting horde, size up the room, plan — and none of it can touch
you (or even know you're there) until you open the door, at which point it all spills out. That
asymmetry ("I can watch them; they're blind to me… until I choose otherwise") is the whole appeal.

This is **doors only**. A breakable **wall** (`wood-wall`) still occludes both ways — opaque until
you break through — which keeps "break through to reveal the nest" a surprise
([spawners](./spawners.md)). Permanent walls are opaque as ever. Behaviors:

- **permanent wall** — opaque, both ways.
- **breakable wall** — opaque both ways, until you break it.
- **locked door** — see-through for the player, opaque to enemies/projectiles, until you open it.

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
  breakable-removal + navgrid-rebuild — no new pathing code. A door's one-way-window-ness is two
  occluder sets in the geometry build: doors stay in the enemy/projectile set, drop from the
  player-vision set.
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

- **Do doors occlude sight?** — *resolved 2026-06-29:* a **one-way window**. A door blocks enemy
  line-of-sight, projectiles, and targeting (enemies can't detect or shoot you through it) but
  **not** the player's fog of war (you see the room beyond). Two occluder sets, split by `lock`,
  ignoring the authored `occludes` flag. Breakable walls still occlude both ways. (An earlier
  peek-behind experiment was removed — see "Doors are a one-way window".)
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
- **See-through door (one-way window)** — a locked door blocks movement, enemy line-of-sight, and
  projectiles, but **not** the player's fog of war: the game keeps doors in the enemy/projectile
  occluder set and out of the player-vision set (by virtue of the `lock`, ignoring the authored
  `occludes` flag). You see in; enemies can't see out. Breakable *walls* still occlude both ways.
- **Occluder** — anything that blocks line of sight. Two sets now: the enemy/projectile set
  (permanent walls, occluding breakables, **and locked doors**) and the player-vision set (the same,
  **minus locked doors**). A `void` blocks movement but neither sight set.
- **Solvability** — the property that the keys reachable before a door are enough to open every
  door on the critical path; consumed keys make this a counting constraint.
