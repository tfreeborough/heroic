# Combat

Status: **agreed (v1)** · Applies to: both games (shared mechanic) · Last decided: 2026-06-09

Builds on [player-movement-and-targeting](./player-movement-and-targeting.md) (the attack
*cycle* and *whiff* rules) and [enemy-behaviour](./enemy-behaviour.md) (who's attacking).
Consumes — but does not define — the character stats (a future *Character Stats &
Progression* doc owns those; here we only reference what combat reads).

## Mental model: *when* × *where* × *how much* × *did it land*

- **When** a hit happens → the **attack cycle** (Windup → Strike → Recovery), already designed.
- **Where / what** it touches → the **hitbox** (this doc).
- **How much** damage → the `combat.ts` formula (kept; swappable placeholder).
- **Did it land on me** → the player's **damage-intake pipeline** (this doc).

A **hitbox** is just *the region an attack checks for victims* (its partner, a **hurtbox**, is
the region on a body that can be hit — for us both are basically the entity's circle).

## Attacks have two independent axes

An attack is defined by two orthogonal tags, plus timing/range:

**Shape** — what geometry the hit uses:
- **`arc`** (melee) — a cone in front of the player at Strike. **Cleaves**: damages *every*
  hostile within range + arc width. Detected as pure geometry (distance + angle) in core.
  Hits where you face, with a forgiving arc (see whiff rules in the movement doc).
- **`projectile`** (ranged) — a small entity spawned toward the target (auto-aimed at
  fire-time), travels, damages the first hostile it overlaps (optionally `pierce`s more).
  Stopped by walls.

**School** — physical or magic. School *and shape* together decide where the numbers come from
— the three combat styles each scale from their own stat *(revised 2026-07-02 for the class
specialisations in [characters-and-talents](./characters-and-talents.md); specs exist to bend
exactly this table)*:

| Style | Base power from | Crit chance from | Mana cost |
| --- | --- | --- | --- |
| **melee** (`arc·physical` — swords) | `strength` + weapon | `agility` (+ `luck`) | none |
| **ranged physical** (`projectile·physical` — bows) | `agility` + weapon | `agility` (+ `luck`) | none |
| **magic** (any shape — spells) | `intellect` (+ spell) | `intellect` (+ `luck`) | yes (regened by `wisdom`) |

The axes are independent, so any combination works: sword cleave = `{arc, physical}`,
firebolt = `{projectile, magic}`, arrow = `{projectile, physical}`. The attack config carries
both tags; at resolve time the damage step reads the right stats off the school.

**`reach`** is the universal range knob — it sizes the arc radius, the bow range, and the
spell range alike. **`attack_speed`** scales the cycle (Windup/Recovery) cadence.

### Attack config (data-driven)

Every attack — player *or* enemy — is one record:

```
{
  shape: 'arc' | 'projectile',
  school: 'physical' | 'magic',
  reach,                 // range (from stat)
  arcWidth,              // arc only
  projectileSpeed,       // projectile only
  pierce,                // projectile only — how many enemies it passes through
  projectileCount,       // projectile only — shots per strike (default 1)
  flight,                // projectile only — named pattern from the flight bank (below)
  windup, recovery,      // cycle timing (attack_speed scales these)
  knockback,             // optional impulse on hit
  manaCost,              // magic only
  // damage numbers are pulled from school + stats at resolve time, not hardcoded
}
```

**Flight patterns (decided 2026-06-11):** projectile *movement logic* lives in a shared,
named bank in core (`straight`, `pincer`, …) — the same data-refs-code pattern as enemy
brains and effect hooks. A weapon (or later a modifier) just names a pattern; the math
exists once. Pincer rules: curved arms converge exactly on the aim point, straighten and
scissor onward after converging (no orbits), and each projectile damages independently —
landing both arms on one victim is double damage by design.

**One attack library, assigned to any entity.** There is no separate "enemy attack" system —
enemies draw from the same config set the player does (a skeleton archer uses the same
projectile a player bow would). This is the mirroring we wanted: maximum variety, one system.

**Roguelike hook:** treat each config as a *base*; upgrades layer modifiers on top (more
damage, faster attacks, wider arc, extra projectiles, +pierce, knockback, status effects).
We don't build the upgrade system now — just keep attacks as data so it can plug in.

## How enemies deal damage

A mix, by archetype:
- **Contact damage** (dumb enemies, e.g. zombies) — no attack cycle; they hurt you by
  *touching* you, on a **per-enemy hit cooldown** (a touching enemy hits, then can't hit *you*
  again for ~0.5s, so it doesn't drain HP every frame).
- **Telegraphed attacks** (wolves, casters, specials) — run the full attack cycle with an
  attack config. The **Windup is the telegraph** — the visible wind-up that warns "dodge now."
  Shared, telegraphed attacks are what keep a dodge-and-kite game feeling fair.

## How the player takes damage: the intake pipeline

Every incoming hit runs this pipeline — hard gate → avoidance rolls → mitigation → apply:

```
incoming hit on player
  → i-frames active?     → ignore entirely
  → dodge roll  (dodge + luck)              → avoid; grant brief i-frames; done
  → parry roll  (parry + luck, melee only)  → negate; done   [counter window: future]
  → block       (if shield equipped)        → reduce damage (does not negate)
  → combat.ts resolve(...)  using school-sourced power & crit → subtract HP
  → on hit landed: grant i-frames + start that enemy's hit-cooldown
```

The three defences:
- **Dodge (evasion)** — chance to avoid a hit entirely (any attack).
- **Parry** — chance to negate a *melee* hit (a counter-attack window can come later).
- **Block** — with a shield, *reduces* incoming damage (doesn't negate it).
- `luck` adds a small nudge to all three.

**Default: these are passive** (automatic rolls / mitigation), to preserve the one-thumb
control scheme. *Open option:* make **block** an active hold-to-block input later — flagged,
not built.

**i-frames (invincibility frames)** — a short window after taking a hit (and after a
successful dodge) where you can't be hit again. Without them, standing in an overlapping swarm
= instant death with no counterplay; with them, "I got surrounded but escaped" is possible.

The same pipeline applies to **enemies** (they can have dodge/parry/block/armor), so there's
effectively **one Combatant stat block** shared by player and enemies.

## The damage formula (`combat.ts`)

Stays the swappable "how much" layer. Notes:
- It's a **placeholder** — flat-`defense` subtraction may not suit a fast action game; expect
  to revisit. The *system* here doesn't care which formula it calls.
- Mitigation has two parts: the **dodge/parry/block** pipeline (avoid/reduce per hit) and the
  **`Armor`** stat (always-on damage reduction). `Armor` replaces the formula's old flat-`defense`
  field — it's a diminishing-returns, **level-relative** reduction sourced mainly from armor pieces
  (see [equipment](./equipment.md)). The level-relative scaling is the same mechanism as the
  level-gap difficulty ("defences work less vs higher-level enemies").
- It will grow from today's `CombatStats` into the richer shared Combatant stat block, with the
  school deciding which stats feed power and crit.

## Stats combat consumes (full system is its own doc)

`reach` (range), `attack_speed` (cycle), `speed` (movement), `agility` (ranged physical power +
physical crit), `intellect` (magic power + crit), `strength` (melee power), `luck` (crit +
defence nudge),
`Vitality` (max HP), `Armor` (damage reduction), `dodge`/`parry`/`block` (intake pipeline). Combat
reads the *final numbers*;
deriving them from base attributes, leveling, mana/health regen (`wisdom`/`Renewal`), and
`strength`'s fatigue/carry role all belong to **Character Stats & Progression**.

## Where this lives (for implementation later)

- **`@heroic/core` (pure, testable, deterministic):** arc hit-detection (cone geometry); the
  intake pipeline (i-frames/dodge/parry/block ordering); the damage formula; attack resolution;
  per-enemy hit-cooldown bookkeeping.
- **`@heroic/engine` / app layer:** projectile movement through the sim/Matter world and its
  wall collisions; applying `knockback` impulses to bodies; reading positions to build hitboxes.

Keeping resolution in pure core (with seeded RNG) means combat is reproducible — replays, tests,
deterministic debugging.

## Open tunables (numbers to find in playtest)

- arc width; forgiving-arc generosity
- i-frame duration; per-enemy contact hit-cooldown (~0.5s)
- dodge / parry / block magnitudes; luck's nudge size
- projectile speed; pierce counts; knockback impulse
- windup (telegraph) vs recovery split per attack; mana costs per spell
- player damage vs enemy HP/damage curves (ties into kiting balance from the movement doc)

## Deferred / flagged

- active hold-to-block (vs the passive default)
- parry counter-attack window
- status effects (burn/slow/etc.) as attack-config fields
- whether `intellect` doing both magic power *and* crit needs balancing (stats doc)

## Glossary (new terms)

- **Hitbox / hurtbox** — region an attack checks for victims / region on a body that can be hit.
- **Cleave** — one attack hitting multiple enemies at once (our melee arc).
- **Pierce** — a projectile passing through an enemy to hit more behind it.
- **School** — physical or magic; decides which stats supply an attack's power and crit.
- **Telegraph** — the visible wind-up before an attack lands, giving the target time to react.
- **i-frames (invincibility frames)** — brief post-hit window where you can't be hit again.
- **Knockback** — an impulse that physically shoves a body on hit.
- **Mana** — the resource spells cost (regened by `wisdom`).
