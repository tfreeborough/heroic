# Realms & the Overworld

Status: **agreed (v1)** · Applies to: the **realm unit** is shared; the **overworld** is
**Journey to Greatness** only (Enter the Gauntlet uses a linear realm sequence — see
[enter-the-gauntlet](./enter-the-gauntlet.md)) ·
Last decided: 2026-06-10

## A realm (the shared unit)

A **realm** is the spatial unit both games use — Arena is simply a single one. Each realm is:

- **Level-banded** — sits in a level range; the [progression](./progression.md) level-gap is what makes
  fighting above your band deadly.
- Populated by **enemy archetypes** scaled to its band ([enemy-behaviour](./enemy-behaviour.md); the
  roster & spawning is its own future doc).
- A **loot pool** = the item level-bands that overlap the realm's band ([equipment](./equipment.md)).
- **Handcrafted geography** (fixed, authored — *not* procedural), with **dynamically repopulating
  enemies** so the world stays alive across runs.

## The overworld (Journey to Greatness)

A **persistent, handcrafted, continuous world** of connected realms — the WoW-zones inspiration. The
character resets each run; the *world* does not.

- **Soft-gated open world.** No hard "you may not enter" walls — you *can* walk into a level-30 realm at
  level 5; the level-gap just punishes you. **The difficulty is the gate.** This directly serves
  "quests send you to scary, dangerous places."
- **Connectivity:** a general **low→high level gradient** with **branching** — several realms around the
  same band give route choice. Adjacency = walkable; danger (not gates) shapes where you can go.

## Settlements

Each realm has **1-2 settlements** — the in-run hubs (from progression/equipment):
**repair · vendors · heal & rest · quest-givers · the Bank (4-slot, cross-run) · a Waystone**.

## Waystones & travel

Two distinct things sharing the root word:

- **Waystone (a place)** — a travel monument at a settlement. **Attune** it by reaching it → it's
  **permanently unlocked for that character**.
- **Fast-travel** — **any-to-any between attuned Waystones**, free, performed *at* a Waystone. Reach a
  level-20 settlement and you can hop straight back to the starting realm. This is what stops re-leveling
  being a tedious walk.
- **Respawn bind** — you **bind your respawn to one** attuned Waystone (rebindable at any). That's where
  you appear on death.
- **Recall (item/ability)** — returns you to your **bound** Waystone from out in the field on a cooldown
  — the "get home / escape" button, *separate* from the between-nodes fast-travel. (This is the function
  the earlier docs called the "Waystone item.")

## The respawn ↔ restart-at-level-1 reconciliation

The tension: respawns advance *forward*, but runs restart at **level 1 / `starting_level`** — so a hearth
bound in a level-20 realm would drop you into instant death. The resolution ties several systems together:

- Your hearth is a **rebindable choice** among settlements you've reached — "permanent" means the
  settlement stays unlocked, not that you're forced to the frontier.
- **You advance your bind forward only as fast as `starting_level` (Glory) lets you survive restarting
  there.** *How aggressively to push your respawn forward* becomes a real, self-gated player decision — no
  system enforcement needed.
- The **fast-travel network** removes backtrack tedium: hop to an appropriate-level settlement, re-level,
  push your frontier.
- So each run = re-level from the start, climb back via the network, push further.

Interlock: **realms ↔ settlements ↔ respawn ↔ `starting_level` ↔ fast-travel ↔ level-gap** all lock together.

## World-state persistence

Permanent per character (the save system stores it, alongside Glory/stats/gear/Bank/lives):
**attuned Waystones / unlocked settlements**, the **discovered map**, and **quest state**. Geography is
static; enemy population is dynamic.

## Where this lives (for implementation later)

- **Content/data:** handcrafted realm layouts, level bands, connectivity graph, per-realm loot & enemy
  tables.
- **`@heroic/engine` / sim:** spatial movement & collision in a realm (Matter), rendering.
- **`@heroic/core` + persistence:** attunement/fast-travel/respawn-bind logic; world-state save/load.

## Open / deferred (own docs or tuning)

- Dungeons / bosses / points-of-interest within realms; exact realm count & the world map.
- **Quest system**; **enemy roster & spawning**; **mounts** (field traversal speed) — each its own doc.
- Whether fast-travel has any constraint (e.g. in-combat lockout).
- **Enter the Gauntlet's structure** (linear realm sequence) — see [enter-the-gauntlet](./enter-the-gauntlet.md).

## Glossary

- **Realm** — a level-banded spatial unit (shared by both games). **Overworld** — Journey's connected
  world of realms. **Soft gate** — difficulty, not a wall, limits where you go.
- **Settlement** — an in-realm hub (repair/vendor/heal/quest/Bank/Waystone).
- **Waystone (place)** — a travel monument; **attune** to unlock it for fast-travel and respawn-binding.
- **Fast-travel** — free movement between attuned Waystones. **Recall** — return to your *bound* Waystone
  on a cooldown.
- **Bind / hearth** — your chosen respawn Waystone.
