# Enter the Gauntlet — Structure

Status: **agreed (v2)** · Applies to: **Enter the Gauntlet** (ships first) · shares all systems with
Journey to Greatness · Last decided: 2026-07-01

> Renamed from "Enter the Arena" — the on-rails gauntlet concept fits the name better. *(Codebase
> folder/package/app.json rename is a pending mechanical follow-up.)*
>
> **v2 (2026-07-01):** updated for the [progression](./progression.md) pivot — one persistent
> character + purchasable lives replaces the Glory/run death loop.

## The shape: same realms, linear topology

Both games are the **same realm system** ([realms-and-overworld](./realms-and-overworld.md)) with
different connectivity:

- **Journey** = realms as an **open, branching web** (wander; soft-gated by danger).
- **Gauntlet** = realms as a **linear, on-rails sequence** of **zones** — forward-only, each zone a
  higher level band.

Same realm unit, same combat / loot / level-gap / progression. The Gauntlet is the ship-first game
because it's a tighter, bounded slice of the shared foundation — no overworld to build.

## The climb loop

```
roster (create / pick character) → climb zones (level up live, loot)
   → die → spend a life → respawn at your furthest camp, everything intact
   → out of lives → Fallen: buy lives and continue at your level, or start a new character
```

- **The character persists** — level, Talents, gear, gold all survive death. What death costs: a
  **life**, the **Bag** (unsecured loot), a **durability hit**.
- **Forward-only** — you commit to advancing; no backtracking through cleared zones.
- How deep a character gets is their story; a new character is a new build down the same gauntlet.

## Difficulty: the level-gap, expressed linearly

Each zone is a higher band than the last, so pushing forward *is* walking into the level-gap.

- Under-level enemies give **trivial XP** (the level-gap on XP), so you **can't safely farm** early
  zones — you're naturally pushed forward for meaningful progress.
- You push as deep as you dare — deeper zones are where real XP and loot live, and where **lives
  get spent**. Gear + Talents are what let you reach further.
- **Milestone life grants** (first-time zone clears, bosses) are placed along the climb — the free
  player's supply, tuned so a wall doesn't pin them (see [progression](./progression.md)).
- **Finite, authored gauntlet** with an end (a final challenge/boss) for v1 — a clear "beat it"
  goal and a bounded content scope. *(A persistent character consumes the climb once — what a
  finished character does next is a raised-priority open item.)*

## Camps (the Gauntlet's lightweight settlements)

Small **camps between zones** — the linear equivalent of settlements:

- **checkpoint** (respawn point) · **repair** · **buy consumables** · the **Bank** (4-slot stash —
  protects loot from the Bag wipe). All paid with gold (persistent, but repair + consumables keep
  it drained).
- **No Waystone / fast-travel** — the Gauntlet is forward-only, so there's no travel network.
- Because **checkpoints are camps and the Bank is at camps**, you respawn *at* a camp and can bank
  fresh finds immediately.

## Checkpoints

On death you respawn at the **furthest camp you've reached** — your level persists, so there's no
survivability gate and no re-grinding earlier zones. (v1's `starting_level`-gated checkpoint logic
is gone with the pivot.)

## Screens vs in-world

- **In-world — everything:** leveling, Talent picks, repair, consumables, the Bank. There is no
  out-of-world upgrade spending.
- **Out-of-world — two screens only:** the **roster** (create/select character) and the **fallen
  screen** (buy lives to revive, or start a new character).
- **Gear:** handled via your **inventory** — equip-level requirements only bite on over-level
  *finds* now (you never de-level), which sit at-risk in the Bag until you grow into them or bank
  them.

## Shares with Journey / drops vs Journey

- **Shares (unchanged):** combat, enemy behaviour & roster, equipment, the Modifier & Effect
  system, progression (characters / Talents / lives / the fallen loop), and the **realm unit**.
- **Drops:** the overworld web, the multi-settlement network, Waystone fast-travel. Quests are
  likely minimal/absent in v1 (it's a linear combat climb).

## Gold economy here

Earned in zones, spent at camps (repair / consumables) — persistent on the character, drained by
upkeep. Camp merchants are the vendors. Inflation sinks are a shared tuning concern with Journey
(see [progression](./progression.md)).

## Where this lives (for implementation later)

- **Reuses** all the core/engine systems already designed.
- **Gauntlet-specific:** the linear zone-sequence data, camp/checkpoint logic, and the
  roster/fallen screen flow. The zone sequence is authored content (realm data in a line).

## Open / deferred

- **What a finished character does** — endless zones, prestige/new-game+, harder difficulty loops
  (raised in priority: the persistent character consumes the finite gauntlet once).
- Whether **quests / mounts / companions** appear at all in the Gauntlet.
- Exact **zone count** and pacing; camp frequency; milestone life-grant placement.
- The **arena→gauntlet codebase rename** (folder, `package.json`, `app.json`, README, App.tsx title).

## Glossary

- **Gauntlet** — the linear, on-rails sequence of realms that *is* Enter the Gauntlet.
- **Zone** — one realm in the sequence (a level band).
- **Camp** — a lightweight settlement between zones: checkpoint + repair + consumables + Bank.
- **Checkpoint** — the camp a character respawns at (the furthest one reached).
- **Roster / fallen screen** — the only out-of-world screens: character create/select, and the
  revive-or-restart choice for a character with no lives.
