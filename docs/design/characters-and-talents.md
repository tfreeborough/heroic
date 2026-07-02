# Characters, Classes & Talents

Status: **draft (v1) — headline choices agreed 2026-07-01/02, details for review** · Applies to:
both games · Last decided: 2026-07-02

The system [progression](./progression.md) v2 points at: how a character is created, how XP/levels
work, and where Talents/abilities come from. Headline choices (Tom): **full classes** · **hybrid
Talents** (a minor pick every level from tiered chains + authored major picks at milestones) ·
**an early weapon-style specialisation** (any class can spec into any weapon family) · **no level
cap** · **gold does not buy character growth** (it stays the gear/upkeep economy — growth is
purely XP-driven).

## Classes

Three classes for v1 (count is a placeholder — author 3, ship what feels good; 2 is a valid
launch):

| Class | Fantasy | Stat lean (base + offer weights) | Starting kit |
| --- | --- | --- | --- |
| **Warrior** | melee bruiser: wade in, trade hits | Vitality / strength | 1H sword + shield (Worn) |
| **Ranger** | kiting skirmisher: speed + spacing | agility | bow (Worn) |
| **Mage** | glass cannon: burst + control | intellect / wisdom | staff (Worn) |

**Classes differ only across the six core attributes** (vitality / strength / agility /
intellect / wisdom / renewal — decided 2026-07-02). Dodge, parry, block, armor, luck, reach and
speed start neutral for every class: those axes are *grown* through Talent chains and gear, not
picked at creation.

A class defines:

- **Base stats + a growth lean** — the class's weights over which minor-Talent chains get
  offered (no manual point-buy in v1; the decisions live in the per-level picks).
- **An ability kit** — active abilities granted at fixed levels (below).
- **Talent pools** — a class pool + a shared generic pool that milestone offers draw from. The
  class dictates *some* of the majors you'll see; the spec (below) dictates others.
- **The starting kit** — maps directly onto [equipment](./equipment.md)'s weapon categories.

**Gear stays classless.** No class-locked items — class identity comes from abilities, Talents,
and stat growth; encumbrance + stat leans naturally sort who wears what. This keeps itemization
un-forked (one loot table serves all classes) and is the main cost-control on the classes
decision.

**Authoring budget (recorded honestly):** full classes multiply content — v1 scope is ~4 actives
+ ~20 authored **major** Talents per class. The ~80 **minor chains** are mostly shared across
classes (class identity comes from offer weighting) and are data-cheap to author — a name, a
stat, a value ladder. A class ships only when its kit feels good.

## Specialisation: your class's take on a combat style

The **first major-Talent pick (level 5, placeholder)** is your spec. It's a **stat
specialisation**, not a weapon unlock: each class has three authored spec talents — one per
combat style — and each one uniquely **re-wires how that class's stats feed that style**
(conversions, conditional damage, procs). Any class can swing any weapon from level 1 (gear is
classless, no off-style penalty); the spec is your class's *signature take* on the style you
want to build into.

**The baseline the specs bend** — the shape×school power split ([combat](./combat.md), decided
2026-07-02): **melee ← `strength` · ranged physical ← `agility` · magic ← `intellect`.**

**The spec design rule** — every spec must be a build axis, not just a bonus:

- **Off-class styles** (off the diagonal): the spec first **re-wires scaling** so the class's
  primary stat feeds the style (viability — a Battlemage casts with muscle), then adds a
  smaller **signature rider**.
- **Home styles** (the diagonal — the style your stats already feed): no conversion needed, so
  the entire budget goes into one **big signature mechanic**.

The 3×3 (names + mechanics drafted 2026-07-02, pending Tom's sign-off; numbers placeholder;
mechanic *types* deliberately never repeat):

| | Melee | Ranged physical | Ranged magic |
| --- | --- | --- | --- |
| **Warrior** | **Berserker** — deal up to 30% more damage the lower your health | **Ballista** — ranged weapons scale from strength, and their hits knock back | **Battlemage** — spells scale from strength; enemies slain by a spell erupt in a shockwave |
| **Ranger** | **Bladedancer** — melee weapons scale from agility; the first strike after a roll deals double damage | **Deadeye** — deal up to 30% more damage the further your target | **Spellslinger** — magic weapons scale from agility, and cast faster as it grows |
| **Mage** | **Spellblade** — physical weapons deal magic damage (intellect-scaled), and melee arcs reach further | **Arcane Archer** — ranged hits deal bonus damage from intellect, and pierce one extra enemy | **Echomancer** — every cast has a chance to echo, instantly repeating for free |

What each builds around (the axis the spec opens):

- **Berserker** — vitality + dodge/parry chains to live on the red line; *skipping* Renewal is
  a deliberate anti-synergy choice. **Ballista** — pure strength density + knockback
  spacing: tanky artillery. **Battlemage** — the point-blank caster: strength + vitality,
  chaining kill-shockwaves (reuses the explosion/knockback systems).
- **Bladedancer** — roll-cooldown chains (*Swift Roll*) + attack speed: the roll becomes part
  of the damage loop, not just the escape. **Deadeye** — reach + move-speed chains, kiting
  discipline; weak up close by design. **Spellslinger** — agility double-dips damage and
  cadence: the machine-gun caster.
- **Spellblade** — intellect + reach melee, mana interplay once mana exists. **Arcane
  Archer** — the two-stat hybrid: drafts agility *and* intellect chains wide instead of one
  deep. **Echomancer** — cast-rate stacking to fish echoes; later majors upgrade the echo.

- Mechanically these ride the modifier & effect system: conditional damage = rule/hook
  modifiers, procs = hook effects, and conversions ("50% of strength added to intellect") need
  **stat-linked modifiers** — a modifier whose value derives from another stat, which needs an
  evaluation order (source stat computes first, no cycles). Flagged in
  [modifiers-and-effects](./modifiers-and-effects.md).
- **The spec re-leans your offers** — minor chains start favouring stats that serve the build
  (a Battlemage Warrior starts seeing intellect chains), and later majors draw from the spec's
  pool.
- **School conversion note:** Spellblade turns physical weapons magic — they then scale from
  intellect and crit from the magic channel (and will cost mana once mana exists).

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
| **2, 8, 12, 16** | new **active ability** from the class kit |
| **5** | **Specialisation** — pick 1 of your class's 3 style specs (the first major) |
| **every 5th from 10** (10, 15, 20, …) | **authored major-Talent pick** — 1 of 3 offered |

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
  next tiers of chains you've started + tier I of chains you haven't. Offers are **seeded** per
  character + level (deterministic, testable in core); weights follow class, then re-lean
  toward your weapon style once you spec (level 5).
- **Depth vs breadth is the conscious optimization** — finish *Mighty* for a strength build, or
  spread wide. Same-level characters differ by their *choices*; the randomness is only in which
  chains show up, never in what a tier is worth.
- Rule-tweak chains (cooldowns etc.) don't pass through the diminishing curve — their safety
  cap is the finite, authored tier list itself.

**Major Talents — authored, picked.** At milestone levels you pick **1 of 3**, offered from the
class pool + generic pool (style-weighted once you spec), chosen live in-game (a bottom-sheet
at a safe moment, not a separate screen). These are the build-defining ones: hook effects
("on kill → …"), rule changes, attack-scoped style bonuses, upgrades to kit abilities ("Dash
leaves a flame trail"). Owned Talents are never re-offered.

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

- Class count at launch (2 vs 3); Tom's sign-off on the 9 spec names + mechanics; how kit
  abilities behave under an off-class spec (style-agnostic actives vs per-style variants);
  appearance customization depth.
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
- **Specialisation (spec)** — the first major pick: 1 of your class's 3 authored style talents
  (e.g. Warrior → Berserker/Ballista/Battlemage), each re-wiring how your stats feed that
  combat style; also re-leans later rolls/offers.
- **Attack-scoped modifier** — a modifier conditional on an attack's shape/school tags (vs a
  plain stat modifier). **Stat-linked modifier** — a modifier whose value derives from another
  stat ("50% of strength added to intellect"); needs ordered evaluation.
- **Minor Talent** — a tier of a **chain**: fixed-value stat bump / small tweak, picked 1-of-N
  every level. **Chain** — a tiered minor-Talent family (*Mighty I → … → XIV*); the next tier
  unlocks for offer once you own the previous. **Major Talent** — an authored pick-1-of-3 at
  milestone levels.
- **Talent pool** — the set (chains, class majors, generic majors) that offers are drawn from.
- **Milestone** — a level that triggers a choice (major Talent, ability, or spec).
- **Roster** — the character-select screen (see [progression](./progression.md)).
