# Progression & the Death Loop

Status: **agreed (v1, numbers placeholder)** · Applies to: both games · Last decided: 2026-06-09

The meta-game that ties everything together: a **roguelite** (permanent progression that
accumulates across deaths) wearing **WoW's** world and RPG clothing. Pulls in the stats that
[combat](./combat.md) and [player-movement-and-targeting](./player-movement-and-targeting.md)
consume, and is the home for the canonical stat list.

> **Roguelite / meta-progression** = upgrades that *persist across runs and deaths*, so you get
> permanently stronger over many attempts (vs. a roguelike where death resets everything).

## The spine: three timescales, hinged on death

| Timescale | Resets? | Contains |
| --- | --- | --- |
| **Per-run** | resets on death | your level (starts at 1 or your bought `starting_level`); Perks picked this run; consumables; **gold (starts at 0)**; current HP/mana |
| **Permanent** | survives death | **Glory** + the stat upgrades it buys; **equipment** (kept, with durability); mounts/companions; saved **respawn point**; attuned **Waystones**; raised **lives cap**; unlocked Masteries |
| **Daily-gated** | refills over real time | **lives** (default max 3, +1 / 6h — placeholder) |

**Death is the hinge.** On death: convert this run's levels → **Glory**, end the run, **spend a
life**, then a **post-death screen** — for **character upgrades only**: spend Glory (Masteries) and
choose where to respawn / which character. Then respawn (if a life is available; else wait). Glory
is **never** spent in the world — always this screen. **Gear and the Bank are *not* here:** gear
goes to your **inventory**, and the **Bank** is accessed in-world at **settlements/camps** (below).

## Two currencies, two jobs

- **Glory** — permanent power. Granted on *every* death (deeper run = more Glory → faster
  permanent growth: the push-further incentive). Spent on permanent upgrades (base stats,
  `starting_level`, speed, reach, attack_speed, dodge, parry, block, luck, lives cap…).
- **Gold** — the run-scoped economy. **You start every run at 0**; a Mastery can grant
  starting gold ("begin each run with +X gold"). Buys consumables, gear, mounts, companions.

## The layered stat model (bridge to combat)

Your effective stats at any moment are the sum of four layers — this is what combat reads, and
the real job of "stats" as a system:

```
effective stat = permanent (Glory upgrades)
               + per-run    (levels gained this run + Perks)
               + equipment  (gear bonuses, durability-gated)
               + consumables(active temporary buffs)
```

### Canonical character stats

| Stat | Role |
| --- | --- |
| **Vitality** | max HP |
| **strength** | physical base power (melee/bow) · fatigue · carry capacity |
| **agility** | physical crit chance (melee/bow) |
| **intellect** | magic base power + magic crit chance |
| **wisdom** | mana regen |
| **Renewal** | HP regen |
| **speed** | movement speed |
| **reach** | universal attack range (melee arc / bow / spell) |
| **attack_speed** | attack-cycle cadence |
| **dodge / parry / block** | the damage-intake pipeline (block needs a shield) |
| **luck** | small nudge to crit *and* to dodge/parry/block |
| **starting_level** | (Glory) the level a run begins at |

*(`strength`'s fatigue + carry-capacity roles imply an encumbrance/exertion system — its own
future doc. Combat only uses the physical-power part.)*

## In-run leveling = the variety engine

Within a run you level by killing creatures. Leveling does two things:

1. **Every level → a stat boost** (run-scoped; gone on death).
2. **Milestone levels → pick a Perk** (1 of N) — a temporary, this-run-only modifier.

The Perk picks are what make each run feel different and let players **try different
strategies** run to run (the roguelite "boon pick" pattern — Hades/Vampire-Survivors-style).
Three customization layers, cleanly separated:

- **Glory** → permanent, slow forever-growth.
- **Perks** → per-run build variety (from leveling).
- **Gold** → gear / consumables / mounts / companions.

## Equipment & durability

Equipment **persists through death** (you keep what you've equipped — losing hard-won gear each
death would feel awful). To keep *discovery* meaningful without making gear run-scoped:

- **Durability is use-based** — gear wears as you fight.
- A worn-out item is **disabled until repaired** (not destroyed) — repair costs *this run's* gold
  at a settlement. Destroying finds felt too punishing.
- The loop: **find better gear** + **keep what you have working** (repair) + a steady **gold sink**.

The full gear system (slots, item levels, rarity — "like WoW") is **its own doc later**; here we
only fix how it sits in the death loop and that it feeds the stat layers.

## Settlements / hubs

Each realm has 1-2 settlements. Run-scoped gold + durability make settlements the **in-run hub**
where you turn *this run's* gold into staying power **before you lose it**:

- **repair** gear · **buy** consumables / gear / mounts / companions · **heal & rest** safely ·
  **quest** givers · the **Bank** (4-slot, cross-run) · **save respawn point** (a *permanent* checkpoint
  advance) · **Waystone** (attune + bind respawn).

(Glory-spending is **not** here — that's the post-death screen above. The **Bank** and gear *are*
in-world: Bank at settlements/camps, gear via your inventory.)

No cross-run hoarding (no gold/gear squirreling) — settlements earn their place through the
spend-it-before-you-die economy, not storage.

## Lives (the gate)

- Default **max 3**, **+1 every ~6h** (placeholder numbers).
- A **life is spent on death**; respawning requires an available life; out of lives → wait.
- **Permanently raisable cap** (to 4, 5…) as an unlock — *the limit exists primarily as the
  monetization surface* (life-cap and/or refills are the paid levers). Design the cap as an
  upgradeable number from day one.

## Level-gap difficulty (the world's risk dial)

Realms are **level-banded**; venturing above your band is the core risk/reward. The gap bites
through the **combat pipeline + a damage multiplier**, *not* raw stat-multipliers alone — so
power raises your ceiling but never erases the gap (you can't brute-force a probability wall):

- **Your damage output is scaled down** vs higher-level enemies (illustrative: toward ~20% at a
  large gap) — you *chip*, visibly progressing but slowly.
- **Modest miss-chance increase** (illustrative: +20%, not crippling) — hits still mostly land
  and feel impactful; avoids the "constant whiffing feels like cheating" problem.
- **Enemy crits you more + your dodge/parry/block work less** — the *incoming* danger is what
  says "you shouldn't be here."

Net curve (matches the brief): **3-4 above = harder, 5-9 = much harder, 10+ = basically
impossible** — emergent from the modifiers, softened by Glory/gear but never nullified. All
numbers are placeholders to tune.

## Quests

Optional, NPC-given (at settlements / in the world), often routing you to dangerous places — a
reason to push into higher-level realms. Its own system/doc later.

## Where this lives (for implementation later)

- **`@heroic/core` (pure, deterministic, testable):** the stat-layering computation; Glory
  conversion; level-gap modifier math; Perk application; durability bookkeeping; lives
  accounting.
- **App / persistence layer (new — not in core/engine yet):** saving *permanent* state (Glory,
  gear, spawn point, lives, unlocked Masteries) to device storage; the **real-time lives timer**.
  Flag: we don't have a save/persistence system yet — it's a new piece this introduces.

## Open / deferred (own docs or tuning)

- Equipment system (slots/item-level/rarity); full gold economy; quests; mounts/companions;
  `strength`'s fatigue & carry/encumbrance system.
- Monetization specifics beyond "lives are the surface."
- **Numbers to tune:** Glory conversion rate (linear vs escalating with run depth); Perk
  milestone levels & the Perk pool; level-gap damage/miss/crit curves; durability wear &
  repair costs; lives cap/refill cadence; starting-gold Mastery values.

## Glossary

- **Glory** — permanent-upgrade currency; your levels convert to it when you die.
- **Perk** — a temporary, this-run-only modifier picked at certain levels.
- **Mastery** — a permanent character upgrade bought with Glory.
- **Meta-progression** — permanent growth that persists across deaths/runs.
- **Durability** — how much wear gear can take before it's disabled until repaired.
- **Lives / energy gate** — the daily-refilling cap on how many times you can die & return.
- **Level-gap** — the difficulty swing from fighting things above/below your level.
- **Waystone** — a travel monument at a settlement (attune to unlock fast-travel + bind respawn).
  **Recall** — returns you to your bound Waystone on a cooldown. (See [realms-and-overworld](./realms-and-overworld.md).)
