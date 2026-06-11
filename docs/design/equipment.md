# Equipment

Status: **agreed (v1, numbers placeholder)** · Applies to: both games · Last decided: 2026-06-10

Equipment is mostly "connect the wires" — it satisfies systems already designed:
- feeds the **stat layers** ([progression](./progression.md)'s `equipment` term),
- grants the player's **attack** (the attack configs from [combat](./combat.md)),
- drives the **loot → durability → repair → gold** loop,
- is how players express **builds** (physical / magic / tank / ranged, via the school-segmented stats).

## Slots (lean, mobile-friendly)

- **Main-hand** · **Off-hand** · **Head** · **Chest** · **Legs** · **Feet** · **Accessory ×1-2**

Rules:
- **No dual-wield (v1)** — the off-hand never holds a weapon (too complex to handle initially).
- **Off-hand** = **shield** (enables the `block` stat) or **focus** (caster stats).
- A **two-handed weapon or a bow disables the off-hand slot** — so 1H+shield (tanky, can block)
  vs 2H (more damage, no block) is a core build lever.

## Weapons grant attacks

Each weapon carries **one basic attack config** (`shape` + `school` + ranges from combat.md) plus
stat bonuses. Your equipped main-hand *is* your auto-attack; **unarmed** falls back to a default
fist attack. One attack per weapon in v1 (weapon *abilities*/specials are deferred).

| Category | Hands | Attack |
| --- | --- | --- |
| 1H melee (sword, mace) | 1H + off-hand | `{arc, physical}` |
| Wand | 1H + off-hand | `{projectile, magic}` |
| 2H melee (greatsword) | 2H (no off-hand) | `{arc, physical}`, bigger |
| Staff | 2H (no off-hand) | `{projectile, magic}`, bigger |
| Bow | 2H (no off-hand, no quiver) | `{projectile, physical}` |

## Armor & the `Armor` stat

This resolves combat.md's vestigial `defense`: **`Armor` is a damage-reduction stat**, mostly from
armor pieces, *distinct* from the avoidance trio (dodge/parry/block reduce *whether/how much* a hit
applies; Armor is always-on reduction once a hit lands; `Vitality` is the HP pool).

The reduction curve has three properties (all standard, exact numbers are tuning):
1. **Strong early, heavily diminishing** — can't stack to immunity. The classic family is
   `DR = Armor / (Armor + K)`; our desired curve is *steeper* than vanilla (≈100 armor → 20%,
   200 → 30%, 400 → 35%), so a sharper/soft-capped variant.
2. **Soft-capped** — building tanky stays worth it, but never trivialises damage.
3. **Level-relative** — `K` scales with the *attacker's* level, so 100 armor at L5 ≫ at L30.

> **Unification:** that level-relative scaling is the *same mechanism* as progression's level-gap
> ("your defences work less against higher-level enemies"). One principle now covers dodge/parry/
> block **and** Armor. *(Action: fold `Armor` into combat.md's defensive stats + note this.)*

## Itemization: base × level-band × rarity

The model that avoids retail-WoW's hollow "same item, bigger number" treadmill:

- A **base item** is authored with a **level band `[X, Y]`** — it only drops in realms whose level
  overlaps that band. Outgrow the band and you find *different* items, not a bigger-numbered copy.
  Progression feels like **discovery**, not number inflation.
- An **instance** rolls a **level** inside the band + a **rarity**; both feed magnitude, but level is
  **capped by the band** — no infinite scaling.
- **Stats are fixed at drop** — items never self-scale with the player. You replace, you don't watch
  numbers grow.
- **Rarity sets the stat roll min/max** — a rarer copy of the same base item rolls from a higher
  range, so a handful of base items per band feels rich (finding a rarer version is a real upgrade).

### Rarity tiers

| Colour | Name (item prefix) | Notes |
| --- | --- | --- |
| **White** | Worn | base rolls; usually stats-only |
| **Green** | Fine | higher stat rolls; may carry a **minor effect** |
| **Blue** | Superior | higher rolls; better minor-effect odds |
| **Purple** | Masterwork | high rolls; a strong minor effect likely |
| **Gold** | **Relic** | unique name (no prefix); a powerful **signature effect** (below) |

Example: *Worn Iron Sword → Fine → Superior → Masterwork Iron Sword*; a Relic is *"Bandit's Last Breath."*

## The Modifier & Effect system (bigger than accessories)

> Full design lives in [modifiers-and-effects](./modifiers-and-effects.md); this is the summary.

Special accessories (a ring that **+i-frame duration**, or **+speed burst on kill**) can't be plain
stats — they need logic. And the *same* system powers Perks, Masteries, consumables, and (later) set
bonuses, so it's a shared substrate, not a one-off. Two kinds of modification:

- **Stat & rule modifiers (pure data)** — "+10 Strength" (stat), or "+0.3s i-frames" / "+10° arc"
  (a tweak to a tunable). The i-frame ring is this kind.
- **Event-triggered effects (code hooks)** — "*on kill* → +20% speed for 2s". Needs a **hook**: a
  named moment the game emits — `onAttack`, `onHitDealt`, `onCrit`, `onKill`, `onHitTaken`, `onDodge`,
  `onTick`, `onRunStart` … — that an effect subscribes to ("when X, do Y"). The speed-burst ring is this.

**Effects aren't gated to Relics — any item can carry a hook.** What differs is the *kind*:
- **Pooled minor effects** roll on ordinary items (Green and up), drawn from a shared pool like a stat
  affix but with logic, scaling up in odds/strength with rarity — e.g. "heal 2 HP on kill", "10% chance
  on hit to slow". Mundane but flavourful; they stop non-Relic drops feeling like spreadsheets.
- **Signature effects** are bespoke, hand-authored and build-defining, unique to **Relics** (alongside
  their custom name) — e.g. "on kill, your next attack chains to 3 enemies".

Same data-vs-code pattern as enemy brains and attack configs; most effects stay pure `@heroic/core`
state (even "speed burst" is a temporary speed modifier with a timer).

## Weight & encumbrance

All weapons **and** armor carry a **weight**. **`Strength` = carry capacity.**

- total equipped weight **≤ capacity** → no penalty;
- **over capacity** → a **ramping movement-speed penalty** (soft cap — you *can* over-equip, you just
  slow down further the more over you are). **Speed-only for v1.**

This is the warrior-vs-ranger fantasy made mechanical: the Strength-warrior shrugs off plate; the
Agility-ranger who piles it on goes sluggish and loses their kiting edge.

## The death / inventory loop

Three containers, deliberately bounded so the armory never bloats:

| Container | Persists? | Holds |
| --- | --- | --- |
| **Equipped** | survives death | what's on your body. On **respawn**, pieces you still meet the level for stay equipped; the rest drop to the **Bag** |
| **Bag** | run-scoped | fresh loot + consumables + un-equippable gear. **Deleted on death.** |
| **Bank** (Banker) | across runs | **4 slots**, pay a **fee**, **universal across all settlements** |

- **Items have an equip-level requirement.** Since runs restart at level 1 (or `starting_level`),
  your high-level gear is unusable until you re-level into it — each run is a genuine re-climb.
- **Equipping is how you keep a find** — an upgrade above your level sits in the at-risk Bag until you
  survive long enough to equip it. (Drops are level-matched to the realm, so most finds are securable
  soon; the occasional over-level find is the fragile, exciting case.)
- **The Banker** softens the loss: bank up to 4 pieces you can't use yet and reclaim them in any future
  run. The cap forces a choice — you can't protect everything. Interlocks with `starting_level`: more
  Glory in starting level → more gear stays *equipped* on respawn → less to bank. And early levels get
  trivial as you power up, shrinking the loss window.

## Acquisition

- **Drops** (primary) — level/realm-scaled; **`luck` boosts rarity odds**.
- **Vendors** in settlements — guaranteed but plainer gear, bought with (run-scoped) gold.
- **Quest rewards** — fixed special pieces; a natural home for some Relics.

## Durability (from progression)

Use-based wear; a worn-out item is **disabled until repaired** (gold, at a settlement) — not destroyed.
Repair cost scales with item level/rarity (a gold sink). Loop: find better + keep what you have working.

## Where this lives (for implementation later)

- **`@heroic/core` (pure, deterministic, testable):** item data model; stat-layer integration; the
  Armor reduction curve; encumbrance math; durability; the Modifier & Effect resolution (hooks + mods);
  rarity roll logic (seeded RNG → reproducible drops).
- **Persistence / save system (new):** the **Equipped loadout** and the **4-slot Bank** are persistent
  state to store; the **Bag** is transient.
- **App / UI layer:** inventory & comparison UI, equip/unequip, the Banker screen.

## Open / deferred (own docs or tuning)

- Set bonuses; crafting; weapon abilities/specials; `strength`'s separate **fatigue** role.
- Accessory count (1 vs 2); final slot list; whether encumbrance ever bites `dodge`/`attack_speed` too.
- **Numbers to tune:** armor curve & its level-`K`; weight values & capacity-per-Strength; rarity roll
  ranges; Bank fee (flat vs scaling); drop rates & luck's rarity influence; durability wear/repair costs.

## Glossary

- **Slot** — an equip position (Main-hand, Head, …). **Off-hand** — shield or focus; disabled by 2H/bow.
- **Level band `[X,Y]`** — the level range a base item exists in; it ages out rather than scaling up.
- **Rarity** — quality tier (White→Gold); sets the stat roll min/max. **Relic** — top tier, unique effect.
- **`Armor` stat** — always-on damage reduction (diminishing, level-relative), vs the dodge/parry/block trio.
- **Modifier** — a stat/rule change from an item/Perk/etc. **Effect / hook** — logic that runs on a named
  game event (`onKill`, …). **Encumbrance** — the speed penalty for carrying over your Strength capacity.
- **Equipped / Bag / Bank** — survives-death / run-scoped-and-wiped / 4-slot-cross-run-stash.
