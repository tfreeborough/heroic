# Progression, Characters & Lives

Status: **agreed (v2, numbers placeholder)** · Applies to: both games · Last decided: 2026-07-01

The meta-game that ties everything together: **one persistent character on a single progression
track, with purchasable lives as the stakes** — WoW's world and RPG clothing, without a roguelite
reset. Pulls in the stats that [combat](./combat.md) and
[player-movement-and-targeting](./player-movement-and-targeting.md) consume, and is the home for
the canonical stat list.

## The v1 → v2 pivot (2026-07-01)

v1 was a roguelite death loop: die → this run's levels convert to **Glory** → buy permanent
**Masteries** → restart at level 1, with timed life-refills gating runs per day. v2 removes the
run/meta split entirely. Why:

- **The purchase moment is stronger.** Players pay far more to *keep* something they've built
  than to buy extra play time (loss aversion). "Your level-20 character has fallen — revive, or
  start again?" is the classic point-of-loss converter; v1's refills only sold sessions.
- **One track is simpler and more tactile.** No in-game/out-of-game leveling split, no conversion
  currency, no post-death shopping screen — every upgrade decision happens live, in the world.

Trade-offs accepted (recorded so future-us remembers this was deliberate):

- **Content consumption** — a persistent character climbs authored content *once*. Replay must
  come from new characters with different builds; endless/prestige content moves up the
  priority list.
- **Run variety is gone** — v1's per-run Perk re-picks were the variety engine; variety now
  lives across characters (and a possible respec sink later).
- **Difficulty must respect loss aversion** — death now has real stakes, so level-gap tuning and
  life-grant placement must avoid pinning a player between "risk permadeath" and "farm nothing"
  (see Lives).

Gone from v1: Glory, Masteries, per-run levels, `starting_level`, the post-death upgrade screen,
run-scoped gold, the timed lives refill.

## Characters & the roster

You create **characters**; the character-select screen is a **roster** of them, living and
fallen. A character owns *everything*: level & XP, stat growth, **Talents**, equipment, gold,
**lives**, checkpoints/Waystones, discovered map & quest state. Nothing is account-level except
the roster itself (whether *purchased* lives are account-wide or per-character is open, below).
Build variety = rolling a new character down a different Talent path.

## The spine: one timescale (plus buffs)

| Layer | Ends when | Contains |
| --- | --- | --- |
| **Character** | permadeath (fallen — revivable) | level/XP · stat growth · Talents · equipment · gold · lives · checkpoints/Waystones · map & quest state |
| **Temporary** | timer / expiry | consumables & status effects (timed buffs/debuffs) |
| **At-risk** | wiped on death | the **Bag** (unequipped, unbanked loot — see [equipment](./equipment.md)) |

## Death & lives (the loop)

**Death with a life available:** spend **1 life** → respawn at your checkpoint with level,
Talents, gear, and gold intact. Death still costs: the life, your **Bag** (unsecured loot), and
a **durability hit** to equipped gear (placeholder — a gold sink and a sting, not a reset).

**Death with no lives → Fallen.** The character becomes **fallen**: unplayable, parked on the
roster, never auto-deleted. From the roster you choose:

- **Revive** — buy lives and continue at your level with everything intact. No time limit — a
  fallen level-20 sitting on the roster *is* the standing offer.
- **Start again** — create a new character at level 1 (and try a different build).

**Where lives come from** (all numbers placeholder):

- **New-character stock** — start with **3**.
- **Milestone grants** — first-time achievements: clearing a zone, downing a boss, level
  milestones. Earned and finite per character — the free player's supply. *Placement is the
  tuning knife-edge:* grants must land often enough that a walled free player isn't pinned
  between "risk permadeath" and "farm trivial XP."
- **Purchase** — the monetization surface (below).
- **No timed refill** — v1's +1/6h energy gate is cut. Scarcity is what makes a life worth
  paying for; a timer would quietly revive every fallen character for free.

## Leveling & Talents (all in-world, all live)

Kill creatures → XP → levels (under-level kills give trivial XP — the level-gap applied to XP).
**There is no level cap** — XP-to-next escalates forever, and the trivial-XP rule means the
frontier zone is the real ceiling (the content caps you, not a number).

1. **Every level → pick a minor Talent** (1 of a few offered) from **tiered chains** with
   fixed, authored values (*Mighty I → II → …*) — stat growth itself rides the Talent system,
   and depth-vs-breadth across chains is the player's optimization game.
2. **Milestone levels → pick a major Talent** (1 of N, authored) — the build-defining choices.

Talents replace *both* v1 systems (run-scoped Perks and Glory-bought Masteries) with one:
permanent picks made live at level-up. Pick-1-of-N keeps choices interesting; permanence makes
them weighty — Talents *are* character identity now. (**Respec** — paying to re-pick — is open:
gold sink, paid, or absent.) Classes, the milestone schedule, and the Talent catalogue live in
[characters-and-talents](./characters-and-talents.md).

## One currency: gold

**Gold is persistent on the character** (no more start-at-0 runs). Earned from kills, loot, and
quests; spent on **repair**, **consumables**, and **gear** — gold does **not** buy character
growth (decided 2026-07-01: levels/Talents/abilities are purely XP-driven; camp ability-trainers
were considered and cut). Persistence brings **inflation risk** — sinks (repair costs,
consumable prices) must scale with earnings, a real tuning surface v1's spend-before-you-die
economy didn't have.

## The layered stat model (bridge to combat)

Your effective stats at any moment are the sum of three layers — this is what combat reads:

```
effective stat = character  (base + per-level growth + Talents)
               + equipment  (gear bonuses, durability-gated)
               + temporary  (consumables / status effects)
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

*(`strength`'s fatigue + carry-capacity roles imply an encumbrance/exertion system — its own
future doc. Combat only uses the physical-power part. v1's `starting_level` stat is gone — there
are no resets to start from.)*

## Equipment & durability

Equipment persists trivially now (the character never resets), so the tension moves entirely to
**loot risk** and **upkeep**:

- The **Bag** (fresh, unequipped loot) is **wiped on death** — equip it or bank it to keep it.
- **Durability is use-based** — gear wears as you fight (plus the on-death hit above); a
  worn-out item is **disabled until repaired** (never destroyed) — repair costs gold at a
  settlement.
- The loop: **find better gear** + **keep what you have working** + a steady **gold sink**.

Full system (slots, item levels, rarity) in [equipment](./equipment.md).

## Settlements / hubs

Each realm has 1-2 settlements — the in-world hub:

- **repair** gear · **buy** consumables / gear / mounts / companions · **heal & rest** safely ·
  **quest** givers · the **Bank** (4-slot stash, pay a fee — protects loot from the Bag wipe) ·
  **save checkpoint** · **Waystone** (attune + bind respawn).

There is no out-of-world spending anymore — the only screens outside the world are the
**roster** (create/select character) and the **fallen screen** (revive or start again).

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

Net curve: **3-4 above = harder, 5-9 = much harder, 10+ = basically impossible** — emergent from
the modifiers, softened by gear/Talents but never nullified. The gap now **prices your lives**:
deeper is where meaningful XP and loot live, and where lives get spent — tuning must remember
that death costs real scarcity, not a cash-out.

## Monetization surface

**Lives are the single paid lever.** The flagship moment is the **fallen revive** — "continue
your level-20 character, or start again." Deeper characters make stronger offers, which aligns
the business with the player's own investment. Pack sizes, pricing, and store integration are
open. Perception risk (recorded): a paywall at the point of loss converts *and* irritates — the
free player's milestone-life supply is what keeps it feeling fair; tune it generously first.

## Quests

Optional, NPC-given (at settlements / in the world), often routing you to dangerous places — a
reason to push into higher-level realms. Its own system/doc later.

## Where this lives (for implementation later)

- **`@heroic/core` (pure, deterministic, testable):** XP curve + level-up math; Talent
  application (rides the [modifier system](./modifiers-and-effects.md)); lives accounting + the
  alive/fallen state machine; level-gap modifier math; durability bookkeeping.
- **App / persistence layer (new — not in core/engine yet):** the **character roster is the save
  unit** — level, stats, Talents, gear, gold, lives, checkpoints, map/quests per character.
  Simpler than v1 (no real-time refill timer). **New flag: IAP/store integration** for life
  purchases — its own piece of work.

## Open / deferred (own docs or tuning)

- Respec (gold sink / paid / absent); purchased lives account-wide vs per-character;
  **endless/prestige content** for characters that finish the authored climb (raised priority
  by the pivot); gold-inflation sinks; size of the on-death durability hit.
- Equipment system details; full gold economy; quests; mounts/companions; `strength`'s fatigue
  & carry/encumbrance system.
- **Numbers to tune:** starting lives; milestone-grant placement & counts; XP curve; Talent
  milestone levels & the Talent pool; life pack pricing; level-gap damage/miss/crit curves;
  durability wear & repair costs.

## Glossary

- **Character** — the persistent unit of progression; owns level, Talents, gear, gold, lives.
- **Roster** — the character-select screen: all your characters, living and fallen.
- **Talent** — a permanent modifier/ability gained on level-up: **minor** chain-tier picks every
  level, authored **major** picks at milestones (replaces v1's Perks and Masteries).
- **Lives** — the respawn resource: spent on death, earned at milestones, purchasable. No timed
  refill.
- **Fallen** — dead with no lives: unplayable but never deleted; revive by buying lives, or
  start a new character.
- **Durability** — how much wear gear can take before it's disabled until repaired.
- **Level-gap** — the difficulty swing from fighting things above/below your level.
- **Waystone** — a travel monument at a settlement (attune to unlock fast-travel + bind respawn).
  **Recall** — returns you to your bound Waystone on a cooldown. (See
  [realms-and-overworld](./realms-and-overworld.md).)
