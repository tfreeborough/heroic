# Enter the Gauntlet — Structure

Status: **agreed (v1)** · Applies to: **Enter the Gauntlet** (ships first) · shares all systems with
Journey to Greatness · Last decided: 2026-06-11

> Renamed from "Enter the Arena" — the on-rails gauntlet concept fits the name better. *(Codebase
> folder/package/app.json rename is a pending mechanical follow-up.)*

## The shape: same realms, linear topology

Both games are the **same realm system** ([realms-and-overworld](./realms-and-overworld.md)) with
different connectivity:

- **Journey** = realms as an **open, branching web** (wander; soft-gated by danger).
- **Gauntlet** = realms as a **linear, on-rails sequence** of **zones** — forward-only, each zone a
  higher level band.

Same realm unit, same combat / loot / level-gap / progression. The Gauntlet is the ship-first game
because it's a tighter, bounded slice of the shared foundation — no overworld to build.

## The run loop

```
post-death screen (spend Glory) → respawn at your furthest survivable camp
   → fight forward through zones (level 1→N, loot) → die → cash out levels → Glory → repeat
```

- **Death = cash-out** (levels → Glory), exactly like Journey. **Lives** gate runs/day.
- **Forward-only** — you commit to advancing; no backtracking through cleared zones.
- Each run re-levels from your start; how far you get = how much Glory.

## Difficulty: the level-gap, expressed linearly

Each zone is a higher band than the last, so pushing forward *is* walking into the level-gap.

- Under-level enemies give **trivial XP** (the level-gap on XP), so you **can't safely farm** early
  zones — you're naturally pushed forward for meaningful progress.
- You push until the gap kills you. `starting_level` (Glory) + gear are what let you reach further.
- **Finite, authored gauntlet** with an end (a final challenge/boss) for v1 — a clear "beat it" goal
  and a bounded content scope. *(Endless mode = possible later; see open items.)*

## Camps (the Gauntlet's lightweight settlements)

Small **camps between zones** — the linear equivalent of settlements:

- **checkpoint** (respawn/start point) · **repair** · **buy consumables** · the **Bank** (4-slot,
  cross-run). All paid with that run's gold (earned in the preceding zone).
- **No Waystone / fast-travel** — the Gauntlet is forward-only, so there's no travel network.
- Because **checkpoints are camps and the Bank is at camps**, you respawn *at* a camp and can bank
  your unequippable gear immediately.

## Checkpoints

On death you restart from the **furthest camp you can survive at**, gated by `starting_level` — the
linear mirror of Journey's "advance your respawn-bind forward as Glory lets you." Avoids re-grinding
trivial early zones every run while keeping the two games' logic parallel.

## Meta vs in-run (the corrected split)

- **Post-death screen — character upgrades *only*:** spend **Glory** (Masteries) and choose respawn
  camp / character. Glory is *never* spent in the world.
- **In-run, at camps:** repair, consumables, the **Bank**.
- **Gear:** handled via your **inventory** — equip-by-level as you climb; on respawn, gear you no longer
  meet the level for drops into the **Bag**; secure pieces via the Bank at the camp you spawn at.

## Shares with Journey / drops vs Journey

- **Shares (unchanged):** combat, enemy behaviour & roster, equipment, the Modifier & Effect system,
  progression (Glory / levels / lives / death loop), and the **realm unit**.
- **Drops:** the overworld web, the multi-settlement network, Waystone fast-travel. Quests are likely
  minimal/absent in v1 (it's a linear combat climb).

## Gold economy here

Earned in zones, spent at the next camp (repair / consumables) — run-scoped, "spend before you die."
Camp merchants are the vendors. No persistent gold (starts at 0 each run, as everywhere).

## Where this lives (for implementation later)

- **Reuses** all the core/engine systems already designed.
- **Gauntlet-specific:** the linear zone-sequence data, camp/checkpoint logic, and the post-death
  screen flow. The zone sequence is authored content (realm data in a line).

## Open / deferred

- **Finite vs endless** gauntlet (v1 = finite with an end boss).
- Whether **quests / mounts / companions** appear at all in the Gauntlet.
- Exact **zone count** and pacing; camp frequency.
- The **arena→gauntlet codebase rename** (folder, `package.json`, `app.json`, README, App.tsx title).

## Glossary

- **Gauntlet** — the linear, on-rails sequence of realms that *is* Enter the Gauntlet.
- **Zone** — one realm in the sequence (a level band).
- **Camp** — a lightweight settlement between zones: checkpoint + repair + consumables + Bank.
- **Checkpoint** — the camp a run restarts from (furthest survivable, gated by `starting_level`).
- **Post-death screen** — character-upgrade screen (Glory/Masteries + respawn/character choice) only.
