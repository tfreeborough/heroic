# Characters, Classes & Talents

Status: **draft (v1) — headline choices agreed 2026-07-01/02, specs reworked 2026-07-06** ·
Applies to: both games · Last decided: 2026-07-06

The system [progression](./progression.md) v2 points at: how a character is created, how XP/levels
work, and where Talents/abilities come from. Headline choices (Tom): **full classes** · **hybrid
Talents** (a minor pick every level from tiered chains + authored major picks at milestones) ·
**an early subclass specialisation** (three authored fantasies per class — reworked 2026-07-06,
below) · **no level cap** · **gold does not buy character growth** (it stays the gear/upkeep
economy — growth is purely XP-driven).

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
+ 24 authored **major** Talents per class (8 per subclass). The ~80 **minor chains** are mostly shared across
classes (class identity comes from offer weighting) and are data-cheap to author — a name, a
stat, a value ladder. A class ships only when its kit feels good.

## Specialisation: your class's three subclasses (reworked 2026-07-06)

The **first major-Talent pick (level 5, placeholder)** is your spec. **Reworked 2026-07-06
(Tom):** the original 3×3 — each spec a stat re-wire of one combat style — is replaced by
**three authored subclass fantasies per class**. The old grid guaranteed every class a spec for
every weapon style, but the specs read as scaling math; the new nine optimize for **flavour
distance** — each should land as its own class fantasy in one line.

**Trade-off recorded:** weapon-style coverage is sacrificed (there is no ranged-Warrior spec
any more). Gear stays classless — any class still swings/shoots/casts anything — but the spec
no longer promises support for every style. Distinct flavour > symmetric coverage.

**The baseline the specs bend** — the shape×school power split ([combat](./combat.md)):
**melee ← `strength` · ranged physical ← `agility` · magic ← `intellect`.**

The nine (names Tom's + proposed, mechanics drafted 2026-07-06; numbers placeholder):

| Class | Spec | Fantasy | Signature (the level-5 pick) |
| --- | --- | --- | --- |
| **Warrior** | **Barbarian** *(was Berserker)* | rage incarnate — trade blood for power | deal up to +30% more damage the lower your health |
| | **Sentinel** | the immovable wall — soaks what would kill anyone else | no single hit can remove more than 25% of your max HP · −10% damage dealt |
| | **Paladin** | holy knight — sword in one hand, faith in the other | every 4th melee hit is a **Smite**: bonus wisdom-scaled magic damage that heals you for half |
| **Ranger** | **Deadeye** | pure ranged execution | deal up to +30% more damage the further your target |
| | **Trickster** | untouchable skirmisher — wins by not being there | +1 dash charge · dashes leave a **decoy** that draws enemies for 2s |
| | **Warden** | nature's blade — the green fights back | melee weapons scale from **agility** · emanate **Verdant Aura**: nearby enemies are slowed 15% |
| **Mage** | **Priest** | holy wrath — judgement made manifest | spell hits build **Wrath**; at full, your next cast erupts as **Retribution** (a large holy nova) |
| | **Summoner** | never fights alone | an **imp** fights beside you, firing ranged bolts (intellect-scaled; resummons 10s after it falls) |
| | **Spellblade** | arcane swordsman | physical weapons deal intellect-scaled **magic damage** · melee arcs reach further |

*(Names locked 2026-07-06.)*

What each builds around (the axis the spec opens):

- **Barbarian** — vitality + dodge/parry chains to live on the red line; *skipping* Renewal is
  a deliberate anti-synergy choice. **Sentinel** — vitality/armor/block density (Ironhide and
  Bulwark finally have a home); its power comes from gear and attrition, never from the spec.
  **Paladin** — strength + **wisdom's first real home**; Smite's sustain makes it the
  self-sufficient middle road.
- **Deadeye** — reach + move-speed chains, kiting discipline; weak up close by design.
  **Trickster** — speed/dodge/luck; deliberately the lowest damage of the nine — mobility and
  utility *are* the power budget. **Warden** — agility double-duty (melee + crit) with wisdom
  feeding aura potency; fights standing inside his own slow.
- **Priest** — intellect + wisdom; the crit channel accelerates Wrath. **Summoner** —
  intellect (the familiar inherits it) + vitality (you are the anchor it protects); plays a
  positioning game. **Spellblade** — intellect + reach melee, mana interplay once mana exists.

**The spec design rule survives the rework** — every spec is a build axis, not a bonus:
conversions where the fantasy demands them (Warden's agility melee, Spellblade's magic blades,
Paladin's wisdom Smite — the **stat-linked modifier** cases flagged in
[modifiers-and-effects](./modifiers-and-effects.md)), and signature *mechanic types* that never
repeat across the nine (Barbarian/Deadeye's mirrored conditional-damage pair is deliberate:
low-health ↔ long-range). The spec still **re-leans your offers** — a Paladin starts seeing
wisdom chains — and later majors draw from the spec's pool.

**The new-systems bill (recorded honestly — what the nine buy that v1 tech doesn't have):**

1. **Summons / ally AI** (Summoner) — the big one, but scoped down 2026-07-06: the v1
   familiar is an **imp firing ranged bolts**, so it reuses the wizard creature's
   ranged-caster brain *and* its summon tech with a faction flip — no melee body-blocking AI
   needed. Plus ally targeting and a HUD marker.
2. **Auras** (Warden; Paladin majors) — a per-sim-step radius status application; cheap
   against the existing status-effect design.
3. **Decoys / taunt targets** (Trickster) — a fake combatant inserted into enemy targeting.
4. **Ground patches** (Paladin, Trickster, Priest majors) — one tech, three users.
5. **Meters** (Priest's Wrath) — a counter + HUD pip.
6. **Per-hit damage cap** (Sentinel) — a clamp in `resolveAttack`; trivial.

**Holy and nature are cosmetic schools in v1** — VFX/audio flavour on magic, not new scaling
channels (the shape×school split is unchanged; Paladin's wisdom-scaled Smite is the one
stat-linked exception). And with three specs leaning wisdom, the HP/mana **regen tick moves up
the priority list** — wisdom must do something before Paladin/Warden/Priest ship.

## Character creation & the roster

Roster screen ([progression](./progression.md)) → **New Character** → pick **class** → pick
**name** (+ minimal appearance: portrait/palette pick, placeholder) → spawn at the gauntlet start
with the class kit + starting lives. Class and name are permanent. The roster shows living and
fallen characters; selection is where you switch.

## XP & levels

- **XP from kills only in v1** (quests later), scaled by the level-gap — under-level kills give
  trivial XP, which is what pushes you forward; fighting *above* your level pays a small capped
  bonus.
- **Kill XP is percent-based** (decided 2026-07-03): a creature is authored as a *fraction of a
  level* (`xpFrac` — "a zombie is worth 8% of a level"), paid against the player's **current**
  level requirement, then bent by the level-gap multiplier. Kills-per-level stays constant as the
  character grows, and balancing a roster of hundreds of creatures is one relative number per
  creature instead of retuning absolutes against the curve. Pacing knobs: per-creature `xpFrac`
  and content density, not the curve.
- **Curve:** escalating and **uncapped** — `XP_to_next = base × level^exp` (placeholder). With
  percent-based kill XP this is bookkeeping (awards scale with it), but the absolute ledger keeps
  saves simple and the XP bar honest.
- **No level cap.** The curve plus the level-gap *is* the cap: once you out-level the frontier
  zone, kills go trivial-XP and progress asymptotes. The content caps you, not a number — and
  future endless/prestige content raises the effective ceiling without touching this system.
- **Every level offers a minor-Talent pick** (below), delivered through **the level-up moment**
  (its own section below) — leveling should feel great live; that tactility is the point of the
  v2 pivot.

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
- **Rarity (decided 2026-07-04, tiers/weights placeholder):** every chain carries a rarity —
  **Common** (White: stat ladders) · **Rare** (Blue: effect chains that visibly change
  behaviour) · **Epic** (Purple: single-tier rule-bending *gems*); chain **capstones** and all
  majors dress **Gold**. One colour language with [equipment](./equipment.md). Rarity multiplies
  the class/spec offer weight (×1 / ×0.35 / ×0.12 placeholder), `luck` nudges Rare+ odds, and a
  **pity rule** forces one Rare+ card into the offer when none has appeared for 3 straight picks.
  Because offers are seeded and past offers are recomputable from the pick history, pity stays
  deterministic with **no new persisted state**. Rarity decides *which* cards show and how they
  dress — never what a tier is worth. The catalogue (chains, gems, majors) lives in
  [talent-catalogue](./talent-catalogue.md).

**Major Talents — authored, picked.** At milestone levels you pick **1 of 3**, offered from
**your spec's pool + the generic pool**, chosen live in-game (a bottom-sheet at a safe moment,
not a separate screen). These are the build-defining ones: hook effects ("on kill → …"), rule
changes, attack-scoped style bonuses, upgrades to kit abilities ("Dash leaves a flame trail") —
and they may use the reserved **`more` multiplier** category. Owned Talents are never
re-offered. The v1 authored set (5 per spec spanning *amplifier* / *converter* / *payoff* /
*defensive-utility*, + a generic pool) lives in [talent-catalogue](./talent-catalogue.md).

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

## The level-up moment (the WOW — designed 2026-07-04, timings placeholder)

Leveling is the game's core reward beat, and it happens mid-combat — the moment must land as
power *felt*, not a menu appearing. The sequence, on the killing blow that levels:

1. **Impact frame** — ~100ms hitstop + screen flash (the world acknowledges you).
2. **Shockwave** — a gold ring erupts from the player (~3 tiles): every enemy in radius takes a
   heavy knockback + brief stagger (reuses the melee knockback impulse). Mechanical, not just
   cosmetic — it *creates* the safe pocket the pick happens in.
3. **Full heal** — HP refills with a visible sweep. *Proposed, needs Tom's call: it makes
   pushing for the level a live tactical play (the Diablo trick) and softens death-stakes
   pressure at the exact moment we celebrate — but it's a real difficulty/economy lever, not
   just juice.*
4. **Banner** — "LEVEL 12" slams in with an audio sting ([audio](./audio.md)).
5. **The sheet** — over the frozen run, cards deal in staggered (~80ms apart) wearing their
   rarity dress: white plain, blue glow, purple glow + particles, gold (capstones/majors)
   shimmer + its own sting. A Rare+ reveal should be audible before it's readable.
6. **The take** — the chosen card flares and flies into the HUD; the stat delta pops over the
   player in-world ("+12 STR"). Un-pause into enemies still staggered from the shockwave.

Multi-level bursts: the shockwave/heal/banner fire **once**; the sheet then chains the queued
picks (the existing owed-picks flow). Milestone levels use the same sequence with the gold
major cards — the sheet itself is the celebration, no separate screen.

## Screens (kept minimal)

- **Roster** — create/select; shows fallen characters with their revive offer.
- **Creation** — class → name/appearance. Two steps, no stat fiddling.
- **In-game** — the level-up moment (above); the Talent-pick sheet; ability buttons appearing as
  they unlock.
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

- Class count at launch (2 vs 3); how kit abilities behave under each subclass (shared class
  kit vs per-spec variants); appearance customization depth. *(Decided 2026-07-06: spec names
  locked; the v1 Summoner familiar is a ranged-bolt imp.)*
- Manual stat allocation; respec; ability loadouts (when kits outgrow buttons); Talent rarity
  tiers; class-specific Relic synergies.
- **Offer feel:** rarity pity is designed (above); still open — build-starvation pity/weighting
  so the chain you're building actually shows up (3 random picks from ~80 chains could starve a
  build; a *focus/pin* mechanic is the candidate); what happens when the eligible pool runs dry
  at very high level (fallback grant).
- **Level-up moment calls for Tom:** the **full heal** (step 3); **Last Stand** (Berserker
  cheat-death major) vs the lives economy — see [talent-catalogue](./talent-catalogue.md).
- **Numbers to tune:** XP `base`/`exp`; chain count, tier depths, value ladders + increment
  creep; offer count per level; milestone cadence; ability unlock levels; major-pool sizes; spec
  offer-weighting; starting-kit stats; rarity weight multipliers + pity window + luck's Rare+
  nudge; shockwave radius/knockback; hitstop + card-deal timings.

## Glossary

- **Class** — the permanent creation choice: stat lean + ability kit + Talent pools.
- **Kit** — the class's set of active abilities, granted at fixed levels.
- **Specialisation (spec)** — the first major pick: 1 of your class's 3 authored subclasses
  (e.g. Warrior → Barbarian/Sentinel/Paladin), each with a signature mechanic and its own
  major pool; also re-leans later offers.
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
