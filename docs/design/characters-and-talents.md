# Characters, Classes & Talents

Status: **draft (v1) — headline choices agreed 2026-07-01, details for review** · Applies to: both
games · Last decided: 2026-07-01

The system [progression](./progression.md) v2 points at: how a character is created, how XP/levels
work, and where Talents/abilities come from. Headline choices (Tom, 2026-07-01): **full classes**
· **hybrid Talents** (a minor pick every level from tiered chains + authored major picks at
milestones + a mid-level specialisation) · **no level cap** · **gold does not buy character
growth** (it stays the gear/upkeep economy — growth is purely XP-driven).

## Classes

Three classes for v1 (count is a placeholder — author 3, ship what feels good; 2 is a valid
launch):

| Class | Fantasy | Stat lean (base + offer weights) | Starting kit |
| --- | --- | --- | --- |
| **Warrior** | melee bruiser: wade in, trade hits | Vitality / strength | 1H sword + shield (Worn) |
| **Ranger** | kiting skirmisher: speed + spacing | agility / speed | bow (Worn) |
| **Mage** | glass cannon: burst + control | intellect / wisdom | staff (Worn) |

A class defines:

- **Base stats + a growth lean** — the class's weights over which minor-Talent chains get
  offered (no manual point-buy in v1; the decisions live in the per-level picks).
- **An ability kit** — active abilities granted at fixed levels (below).
- **Talent pools** — a class pool + a shared generic pool that milestone offers draw from.
- **Two specialisations** (placeholder names): Warrior → *Berserker / Guardian* · Ranger →
  *Sniper / Skirmisher* · Mage → *Stormcaller / Warden*. Specs theme Talent offers; they don't
  add new damage schools (combat stays physical/magic).
- **The starting kit** — maps directly onto [equipment](./equipment.md)'s weapon categories.

**Gear stays classless.** No class-locked items — class identity comes from abilities, Talents,
and stat growth; encumbrance + stat leans naturally sort who wears what. This keeps itemization
un-forked (one loot table serves all classes) and is the main cost-control on the classes
decision.

**Authoring budget (recorded honestly):** full classes multiply content — v1 scope is ~4 actives
+ ~20 authored **major** Talents per class. The ~80 **minor chains** are mostly shared across
classes (class identity comes from offer weighting) and are data-cheap to author — a name, a
stat, a value ladder. A class ships only when its kit feels good.

## Character creation & the roster

Roster screen ([progression](./progression.md)) → **New Character** → pick **class** → pick
**name** (+ minimal appearance: portrait/palette pick, placeholder) → spawn at the gauntlet start
with the class kit + starting lives. Class and name are permanent. The roster shows living and
fallen characters; selection is where you switch.

## XP & levels

- **XP from kills only in v1** (quests later), scaled by the level-gap — under-level kills give
  trivial XP, which is what pushes you forward.
- **Curve:** escalating and **uncapped** — `XP_to_next = base × level^exp` (placeholder) — early
  levels come fast (the tutorial rush) and every level costs more than the last.
- **No level cap.** The curve plus the level-gap *is* the cap: once you out-level the frontier
  zone, kills go trivial-XP and progress asymptotes. The content caps you, not a number — and
  future endless/prestige content raises the effective ceiling without touching this system.
- **Every level offers a minor-Talent pick** (below), with a level-up moment in-world
  (toast + a burst of juice — leveling should feel great live; that tactility is the point of
  the v2 pivot).

### The milestone schedule (all placeholder)

| Levels | What happens |
| --- | --- |
| every level | a **minor-Talent pick** — 1 of 3 offered from eligible chain tiers |
| **2, 5, 8, 12** | new **active ability** from the class kit |
| **every 5th** (5, 15, 20, … — 10 is the spec) | **authored Talent pick** — 1 of 3 offered |
| **10** | **Specialisation choice** — 1 of your class's 2 specs |

## Talents (minors & majors)

**Minor Talents — tiered chains, one pick per level.** Class stat growth *is* this system. The
pool is ~**80 chains** (placeholder), each a family of tiers with **fixed, hand-authored
values** — e.g. *Mighty I (+10 strength) → Mighty II → … → Mighty XIV*, or *Swift Roll I
(−0.1s roll cooldown) → II (−0.1s) → III (−0.2s)*. Rules:

- **Values are fixed per tier** — *Mighty I* is +10 strength whether taken at level 8 or 28;
  nothing scales with your level. **Increments creep upward at higher tiers** — that creep is
  the counterweight to the flat-fade curve ([modifiers-and-effects](./modifiers-and-effects.md):
  flat points fade in relative value as you level), and is what keeps finishing a chain worth
  it. Deep tiers of stat chains may shift from flat to **percent** (which applies after the
  curve, so it scales forever) — an authoring option per chain, not a rule.
- **Tier-gated offers** — a chain's next tier can only be *offered* once you own the previous
  tier.
- **Each level: pick 1 of 3 offered** (count placeholder), generated from the eligible pool —
  next tiers of chains you've started + tier I of chains you haven't. Offers are
  **class/spec-weighted** and **seeded** per character + level (deterministic, testable in
  core).
- **Depth vs breadth is the conscious optimization** — finish *Mighty* for a strength build, or
  spread wide. Same-level characters differ by their *choices*; the randomness is only in which
  chains show up, never in what a tier is worth.
- Rule-tweak chains (cooldowns etc.) don't pass through the diminishing curve — their safety
  cap is the finite, authored tier list itself.

**Major Talents — authored, picked.** At milestone levels you pick **1 of 3**, offered from the
class pool + generic pool (spec-weighted after 10), chosen live in-game (a bottom-sheet at a
safe moment, not a separate screen). These are the build-defining ones: hook effects
("on kill → …"), rule changes, upgrades to kit abilities ("Dash leaves a flame trail"). Owned
Talents are never re-offered.

Both kinds are permanent bundles riding [modifiers-and-effects](./modifiers-and-effects.md).
**Respec** (re-picking) remains open, per progression.md.

## Abilities

- **Granted by level from the class kit** — XP-driven, like everything else (gold stays out of
  character growth, per the 2026-07-01 decision; camp trainers were considered and cut).
- Abilities ride the existing **skills architecture**: generic lifecycle in `@heroic/core`
  (`stepAbility`) + per-skill effect code in the app's `skills/` folder — dash is the worked
  example, and dash remains universal (not class-gated).
- **Button budget:** the mobile HUD fits ~3 action buttons + dash (placeholder) — v1 kits are
  sized to fit, so there's no loadout management yet (kit > slots → a loadout picker, deferred).

## Screens (kept minimal)

- **Roster** — create/select; shows fallen characters with their revive offer.
- **Creation** — class → name/appearance. Two steps, no stat fiddling.
- **In-game** — level-up toast; the Talent-pick sheet; ability buttons appearing as they unlock.
- **Character sheet** — stats (final effective values), Talents taken, kit. Read-only in v1.

## Where this lives (for implementation later)

- **`@heroic/core` (pure, deterministic, testable):** class definitions as *data* (offer
  weights, kit schedule, Talent pools/tags); the minor-chain catalogue (name + value ladder per
  chain); XP curve + level-up; milestone schedule; seeded offer generation (tier-gating +
  weighting) for minors and majors; Talent application via the modifier system.
- **App:** creation/roster UI; the Talent sheet; per-skill ability effects (`skills/` folder);
  character sheet.
- **Persistence:** the character record (class, level/XP, Talents taken, spec, kit state) — the
  roster save unit from progression.md.

## Open / deferred (own docs or tuning)

- Class count at launch (2 vs 3); spec names/identities; appearance customization depth.
- Manual stat allocation; respec; ability loadouts (when kits outgrow buttons); Talent rarity
  tiers; class-specific Relic synergies.
- **Offer feel:** pity/weighting so the chain you're building actually shows up in offers (3
  random picks from ~80 chains could starve a build); what happens when the eligible pool runs
  dry at very high level (fallback grant).
- **Numbers to tune:** XP `base`/`exp`; chain count, tier depths, value ladders + increment
  creep; offer count per level; milestone cadence; ability unlock levels; major-pool sizes; spec
  offer-weighting; starting-kit stats.

## Glossary

- **Class** — the permanent creation choice: stat lean + ability kit + Talent pools.
- **Kit** — the class's set of active abilities, granted at fixed levels.
- **Specialisation (spec)** — the level-10 fork inside a class that weights later Talent rolls
  and offers.
- **Minor Talent** — a tier of a **chain**: fixed-value stat bump / small tweak, picked 1-of-N
  every level. **Chain** — a tiered minor-Talent family (*Mighty I → … → XIV*); the next tier
  unlocks for offer once you own the previous. **Major Talent** — an authored pick-1-of-3 at
  milestone levels.
- **Talent pool** — the set (chains, class majors, generic majors) that offers are drawn from.
- **Milestone** — a level that triggers a choice (major Talent, ability, or spec).
- **Roster** — the character-select screen (see [progression](./progression.md)).
