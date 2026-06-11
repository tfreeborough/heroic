# Modifier & Effect System

Status: **agreed (v1, numbers placeholder)** · Applies to: both games · Last decided: 2026-06-10

The shared substrate under almost everything dynamic. One system so these are all *content*, not
new code: gear stat bonuses, the pooled **minor effects** and **Relic signature effects**
([equipment](./equipment.md)), **Perks** and **Masteries** ([progression](./progression.md)),
**consumables**, and **status effects** (buffs/debuffs like burn/slow). Even the level-gap modifiers
can ride it.

## Two interlocking halves

- **Modifiers — the stat-aggregation pipeline (the math).** Anything that changes a *number*:
  `+10 Strength`, `+20% crit`, `+0.3s i-frames`, `+10° arc`. Sources dump modifiers into per-stat
  buckets; the pipeline combines them into a final value.
- **Effects — the event/hook system (the triggers).** Anything that *reacts*: an effect subscribes
  to a **hook** (a named game event) and runs a handler when the game emits it.

**They interlock:** most effects' job is to apply a modifier. *"On kill → +20% speed for 2s"* is an
`onKill` handler that adds a temporary speed modifier. Effects are the triggers; modifiers are usually
what they do.

## Keep three things orthogonal

Conflating these is what makes modifier systems rot. They're independent:

- **Lifecycle** — how long it lives: permanent (Mastery) / run (Perk) / while-equipped (gear) / timed
  (consumable, status). This is *persistence* only (the progression "layers").
- **Stacking** — how modifiers combine into a number (below).
- **Trigger** — always-on, or fires on a hook.

A modifier's *source* never changes its math — only its lifecycle. Computing a stat doesn't care where
a `+10` came from.

## The stat pipeline

### Rating stats vs pool stats

- **Rating stats** convert into a **percentage or chance** — `Strength, Agility, Armor, dodge, parry,
  block, crit`. These run through a **diminishing, level-relative curve** (below).
- **Pool / direct stats** scale **linearly** — `Vitality→HP, speed→movement, reach→range,
  attack_speed→cadence`. You *want* HP to grow with level; its relative shrink comes from enemies
  hitting harder at higher levels, not a curve.

### The curve (same mechanism as Armor)

For a rating stat, raw points convert to an effective bonus via the **Armor formula, generalised** —
one mechanism for Armor, Strength, Agility, dodge, …, each with its own ceiling and rate:

```
effective = MaxBonus × flat / (flat + K(level))
```

- `flat` = all flat points in that stat, summed (base + every +flat source)
- `K(level)` grows with level → the same +N is worth less as you climb
- `MaxBonus` = the soft ceiling raw points can reach

**Worked example** — Strength→damage, `MaxBonus = 200%`, `K = 50 × level`:

| | flat → effective | a +10 item gives |
| --- | --- | --- |
| **Level 1** (`K=50`) | 10 Str → 33.3%, 20 Str → 57.1% | **+24% damage** (game-changer) |
| **Level 20** (`K=1000`) | 200 Str → 33.3%, 210 Str → 34.7% | **+1.4% damage** (rounding error) |

Because stats *and* `K` scale with level, **baseline power stays stable while a fixed flat injection
shrinks in relative value.** That's the **engine behind the item-band treadmill** — a low-band item's
flat numbers are huge early and trivial later, so you *want* to replace it. The whole design coheres
around this one curve.

### Order of operations (per stat)

```
1. flatTotal = base + Σ(flat bonuses)
2. effective = MaxBonus × flatTotal / (flatTotal + K(level))    ← rating stats only
3. final     = effective × (1 + Σ percent) × Π(1 + each "more")
4. apply caps (e.g. a dodge cap)
```

- **Percent is applied *after* the curve** — so it **doesn't get eaten by diminishing returns.** This
  gives flat and percent distinct roles: **flat = front-loaded power that fades; percent = scales
  forever** (the late-game lever once flat has flattened).
- **`more` multipliers** are a **rare, reserved** category for *signature* Relic/Mastery effects — each
  multiplies separately, so "doubles your crit damage" feels build-defining instead of being one more
  additive number. Most percent bonuses are additive with each other.

## Effects & hooks

An effect subscribes to a **hook** and runs when the game emits it with context (attacker, target,
damage, …). Starting hook catalogue (extend as needed):

`onRunStart` · `onAttack` · `onHitDealt` · `onCrit` · `onKill` · `onHitTaken` · `onDodge` · `onParry` ·
`onBlock` · `onTick` · `onLevelUp` · `onEnterRealm` · `onDeath`

**Authoring = data + coded handlers.** An effect is data referencing a named, coded handler:

```
{ hook: "onKill", handler: "grantTempStat", params: { stat: "speed", pct: 20, seconds: 2 } }
```

Handlers are coded once; data instantiates them with params (this is how pooled minor effects are
authored cheaply). **Relic signature effects** get bespoke handlers — the data-vs-code escape hatch,
same as enemy brains and attack configs. A **fixed firing order** (by source, then registration) keeps
multi-handler hooks deterministic.

## Status effects (buffs & debuffs)

The recurring pattern — and just a composition of the two halves:

```
status effect = a bundle of modifiers
              + an optional onTick effect
              + a duration
              + a stacking policy
```

Examples: **burn** = `{ onTick: 3 dmg, duration: 4s, policy: stack }`; **slow** =
`{ modifier: -30% speed, duration: 2s, policy: refresh }`; the **speed-burst** ring grants
`{ modifier: +20% speed, duration: 2s, policy: refresh }`.

**Stacking policies:**
- **refresh** — re-applying resets the duration (e.g. freeze). *(default)*
- **stack** — each application adds an independent instance / proportional intensity (e.g. burn).
- **unique** — only one may exist; the **strongest** applies, others are ignored (no double-dipping the
  same buff). **Deferred** — refresh + stack cover v1; stacking two buffs is fine for now.

## Sources & lifecycle (what feeds the system)

| Source | Lifecycle | Typically provides |
| --- | --- | --- |
| Masteries (Glory) | permanent | flat/percent stat modifiers |
| Perks (level-up) | run | stat modifiers + some effects |
| Equipment | while equipped | flat/percent stats; minor effects; Relic signature effects |
| Consumables | timed | status effects (temporary buffs) |
| Status effects | timed | applied by procs, enemies, consumables |

Stats **recompute on change** (when a modifier set changes — equip/unequip, Perk picked, buff expires),
not every frame.

## Where this lives (for implementation later)

- **`@heroic/core` (pure, deterministic, testable):** the stat pipeline (curve + caps), the modifier
  buckets, effect/hook dispatch, status-effect lifecycles. Seeded RNG → procs and rolls are reproducible.
- **`@heroic/engine` / sim:** emits hooks from the combat/loop at the right moments; applies resulting
  state (e.g. a temp speed modifier) to the Matter body.
- **App / UI:** buff/debuff icons + timers; stat sheet showing final values.

## Open / deferred (own docs or tuning)

- The **`unique`** stacking policy; buff **stack limits** / UI; whether the **level-gap** modifiers route
  through this system (likely yes).
- Finalising the **hook catalogue** as combat/loop solidify.
- **Numbers to tune:** per-stat `MaxBonus` and `K(level)` curves; rating-stat caps; which effects exist
  in the **minor-effect pool**; `more`-multiplier sources.

## Glossary

- **Modifier** — a stat/rule change (flat, percent, or `more`). **Rating stat** — converts to a %/chance
  via the curve. **Pool stat** — scales linearly (HP, speed…).
- **`more` multiplier** — a separate-multiplying bonus, reserved for signature effects.
- **Hook** — a named game event (`onKill`…) effects subscribe to. **Effect** — logic run on a hook.
- **Handler** — the coded routine an effect's data points at, instantiated with params.
- **Status effect** — a timed bundle of modifiers (+ optional tick) — i.e. a buff or debuff.
- **Stacking policy** — refresh / stack / unique: what happens when the same effect re-applies.
