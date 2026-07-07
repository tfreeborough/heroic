# Creature levels & the con system

How creatures get levels, and how a level *difference* becomes difficulty. Companion to the
level-gap section of [progression](./progression.md) — this doc turns that sketch into the
mechanic — and to [spawners](./spawners.md) and [realms-and-overworld](./realms-and-overworld.md)
for where the levels come from.

Approved and built 2026-07-03 (core: `progression/levelGap.ts`, `resolveAttack` mods + miss;
app: `Enemy.level`, gap mods on every hit path, con rings, "Miss" floaters). All numbers remain
placeholder tuning.

## The core decision: levels are relational, not statistical (2026-07-03)

A creature's level does **not** scale its stats. A zombie's authored stat block (hp 40, attack 6,
slow, relentless) *is* the zombie, at level 1 and at level 30. What a level does is feed **one
global set of percentage modifiers** applied at combat resolution, driven purely by the gap
`creatureLevel − playerLevel` — the same for every creature in the roster.

Why relational-only works here, and what it buys:

- **It's what progression.md already specifies** — "the gap bites through the combat pipeline +
  a damage multiplier, *not* raw stat-multipliers alone." You can't brute-force a probability
  wall with gear; the gap prices your lives.
- **One set of numbers balances every creature, forever.** Same argument as percent-based XP
  (characters-and-talents.md): with hundreds of creatures, per-creature-per-level stat curves
  are a tuning treadmill; one gap table is not.
- **The stat system was built for it.** The player's rating curve is level-relative
  (`K = kPerLevel × level` — modifiers-and-effects.md), so player percent-power holds roughly
  stable at-level instead of inflating. Flat creature stats stay meaningful at every level;
  nobody needs 40× hp zombies.
- **Creature identity survives.** Within any nest, the wolf is still the fast fragile one and
  the charger still the telegraphed truck — relative danger between *creatures* is authored,
  relative danger between *levels* is the gap table.
- **Absolute difficulty across the world is authored, not formulaic:** deeper realms field
  *different, beefier creatures* (new roster entries with bigger base stats), while the con
  system handles how any one of them reads against you. Two clean, separate dials.

## Where levels come from (2026-07-03: range ∩ range, not band + spread)

Two authored ranges intersect, and the spawn rolls uniformly inside the overlap:

- **The zone's range is the content gate** (`band`–`bandMax` in the zone file; realm-00 is
  1–10). Nothing in the zone spawns outside it, whatever the species could otherwise be.
- **The creature's own bounds are the species' identity** (`CreatureDef.levels`; zombie 1–4,
  wizard 5–12). A wizard in realm-00 (1–10) spawns 5–10; the same wizard in a 9–15 realm-01
  spawns 9–12. Where a species can live is authored here; how hard it hits at a given gap is
  still the global table's job.
- **Authored per-placement overrides are the micro-cosm dial**: a placed creature or spawner
  can carry `levelMin`/`levelMax` props (edited in Realmsmith's inspector; empty = zone range).
  The override **replaces the zone window** — so a nest at the zone's far end runs hotter than
  the door you came in through, and a placed boss may exceed the zone range outright — but the
  creature's bounds always still clamp.
- **Empty intersection = an authoring mismatch**; species identity wins — the spawn clamps to
  the creature's nearest edge (a 1–3 bat in a 9–15 zone spawns at 3) rather than breaking what
  the species means.
- **Seeded roll** through the sim rng, like every other input — deterministic for tests and
  replays. Summons roll plain zone ∩ species (no override).

## The gap table (one tunables block, all placeholder)

Everything below keys off `Δ = creatureLevel − playerLevel`, with the XP grace band
(`±fullValueGap`, currently 2) as the "even match" zone. Illustrative starting numbers,
per level of gap beyond the grace band:

| Direction | Modifier | Per level | Bound |
| --- | --- | --- | --- |
| **You attack UP** (Δ > grace) | your damage scaled down | −15% | floor ~20% (you chip, visibly) |
| | your miss chance | +7% | cap ~35% (mostly still land — no whiff-fest) |
| **It attacks you** (Δ > grace) | its damage scaled up | +10% | uncapped-ish (this is the "leave" signal) |
| | its crit chance vs you | +5% | cap ~40% |
| **You attack DOWN** (Δ < −grace) | your crit chance vs it | +15% | toward ~95% — lowbies pop |
| | your damage scaled up | +10% | modest; the crits carry the fantasy |
| **It attacks you** (Δ < −grace) | its damage scaled down | −20% | floor ~10% — a grey mob can barely scratch you |

- Net feel target (progression.md): **3–4 above = harder, 5–9 = much harder, 10+ = basically
  impossible** — emergent from the table, softened by gear/Talents but never nullified.
- **Miss is a new mechanic**: combat currently has no miss. A missed swing deals nothing and
  floats "Miss" (the damage-number channel already exists). Kept modest on purpose.
- The dodge/parry/block-efficacy reduction from progression.md joins the table **when the
  avoidance intake pipeline lands** (combat.md's i-frames → dodge → parry → block order — still
  an open build item); the table just gains rows.
- XP already uses the same gap (progression/xp.ts `gapMultiplier`): trivial-XP taper fighting
  down, capped punch-up bonus fighting up. One gap definition, three consumers — combat, XP,
  con color — so the readouts can never disagree.

## Con colors (the read)

Derived from the **same thresholds** as the table — never authored independently:

| Con | Δ (creature − player) | Meaning |
| --- | --- | --- |
| **Grey** | ≤ −6 (XP at/near the trivial floor) | free kill, worthless |
| **Green** | −5 .. −3 | easy, tapered XP |
| **Gold** | −2 .. +2 (the grace band) | even match, full value |
| **Orange** | +3 .. +4 | harder — pick your moment |
| **Red** | ≥ +5 | you shouldn't be here |

- **Presentation is app-side** (core exposes the con *tier*, the app maps it to pixels). Color
  alone fails on small shapes and for color-blind players, so the con rides an existing
  structural cue — the enemy's outline/hp-bar tint — with intensity ordered grey→red so it
  still reads in greyscale. Exact treatment found in playtest.
- The mixed-level nest is the gameplay payoff: a spawner spitting gold-and-orange zombies with
  the odd red turns a mob pile into a triage decision (kill the golds, kite the red) — extra
  challenge with zero new creature AI.

## Build seams (core vs app)

- **`@heroic/core`:** `GAP_TUNING` + `gapCombatMods(attackerLevel, defenderLevel)` (pure,
  tested); `resolveAttack` grows optional attacker/defender levels (absent → neutral, existing
  behaviour untouched); `conTier(delta)`; the seeded spawn-level roll. Lives beside
  `progression/xp.ts` so XP and combat share the gap constants.
- **App:** `Enemy.level` (rolled at `makeEnemy`), passed into hits both directions; the kill
  hook feeds the instance level (replacing today's `ZONE.band`) into `xpForKill`; con tint in
  the enemy render + "Miss" floaters.

## Numbers to tune

Zone ranges per realm; each species' level bounds; every per-level percentage and its
cap/floor; the grace band (shared with `XP_TUNING.fullValueGap`); con thresholds (derived —
tune via the shared constants); whether grey creatures still aggro (v1: yes, they're just
harmless).
