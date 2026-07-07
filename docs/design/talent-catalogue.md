# Talent Catalogue (v1 authored set)

Status: **draft — for Tom's review** · Applies to: enter-the-gauntlet first · Last decided:
2026-07-06 (majors rebuilt around the nine reworked subclasses)

The authored content behind [characters-and-talents](./characters-and-talents.md): the minor-chain
rarity split, the Rare effect chains and Epic gems, and the first cut of **major Talents** (8 per
spec + a generic pool). System rules (offer generation, pity, the level-up moment) stay in
characters-and-talents.md — this doc is the content it draws from. All numbers placeholder.

## Rarity

Talents reuse the game's one rarity colour language ([equipment](./equipment.md)), skipping Green —
three tiers is enough tension for a 3-card offer:

| Colour | Tier | What it marks | Offer-weight multiplier |
| --- | --- | --- | --- |
| **White** | **Common** | stat ladders (the workhorse chains) | ×1.0 |
| **Blue** | **Rare** | effect chains — picks that visibly change behaviour | ×0.35 |
| **Purple** | **Epic** | single-tier **gems** — unusual, rule-bending one-offs | ×0.12 |
| **Gold** | — | *styling, not a tier*: chain **capstones** and all **majors** render gold | — |

Rarity multiplies with the class/spec stat weighting and decides **which cards appear and how they
dress** — never what a tier is worth (the fixed-values rule stands). `luck` nudges Rare+ odds
(finally making Fortune a fun chain), and a **pity rule** guarantees a Rare-or-better card when
none has shown for 3 straight picks (see characters-and-talents.md).

## Minor Talents

### Common — stat ladders (the existing 15)

Unchanged from `packages/core/src/progression/chains.ts`: Mighty, Stalwart, Nimble, Keen Mind,
Sage, Mending (4 flat tiers + percent capstone), Ironhide, Elusive, Riposte, Bulwark, Fortune
(4 flat tiers), Fleet, Long Arm, Quickhand (multiplier ladders). Swift Roll moves to Rare below.
The catalogue grows toward the ~80-chain target mostly here — Commons are the data-cheap bulk.

**Hybrid ladders (new).** Two stats per tier, each under-budget but over-budget in total —
pure ladders are *focus*, hybrids are *efficiency*, and that's a real choice. They also quietly
serve the off-class specs, whose builds want two stats at once. Values per tier: **+6 / +7 /
+9 / +12 of both stats**, capstone **+3% both** (vs 10/12/15/20 + 5% pure — placeholder).

| Chain | Stats | Serves |
| --- | --- | --- |
| **Brawn** | strength + vitality | Barbarian, Sentinel |
| **Warcaster's Blood** | strength + intellect | Spellblade |
| **Spellsight** | agility + intellect | Summoner off-builds, hybrid casters |
| **Battle Meditation** | intellect + wisdom | Priest |
| **Lifeblood** | vitality + renewal | the sustain identity |
| **Weapon Master** | strength + agility | off-style melee builds |
| **Crusader's Creed** | strength + wisdom | Paladin |
| **Wildheart** | agility + wisdom | Warden |

### Rare — effect chains (visible behaviour, small numbers)

Each is a short 3-tier ladder; tiers deepen the same effect. The point is that the very next fight
*looks different* after the pick. Implementation column is honest about what each needs — "hooks"
means the [modifiers-and-effects](./modifiers-and-effects.md) hook dispatch, which core doesn't
have yet (Swift Roll's `TalentEffect` shape is the seed it grows from).

| Chain | Effect (tier I → III)                                                                     | Needs |
| --- |-------------------------------------------------------------------------------------------| --- |
| **Swift Roll** *(exists)* | −0.1 / −0.1 / −0.2s dash cooldown                                                         | done |
| **Sure Feet** | +0.05 / +0.05 / +0.1s of i-frames on dash                                                 | dash tweak |
| **Heavy Hands** | attacks knock back +15 / +25 / +40% harder                                                | knockback multiplier read at swing |
| **Bloodletter** | kills restore 2 / 3 / 5 HP                                                                | `onKill` |
| **Adrenaline** | kills grant +8 / +10 / +12% move speed for 2s                                             | `onKill` + timed status |
| **Battle Trance** | crits grant +10 / +15 / +20% attack speed for 3s                                          | `onCrit` + timed status |
| **Second Wind** | dropping below 30% HP bursts 3 / 4 / 6 HP of regen over 3s (30s internal cooldown)        | `onHitTaken` + status |
| **Spiked Hide** | melee attackers take 1 / 2 / 3 damage                                                     | `onHitTaken` |
| **Red Harvest** | heal 1 HP per 30 / 25 / 20 damage dealt                                                   | `onHitDealt` accumulator |
| **Executioner** | +10 / +18 / +25% damage to enemies below 25% HP                                           | defender-HP check in `resolveAttack` |
| **Momentum** | +4 / +6 / +9% damage while moving                                                         | move-state conditional |
| **Ambusher** | +15 / +25 / +40% damage to enemies at full health (the opener — Executioner's mirror)     | defender-HP check |
| **Rampage** | kills grant +4 / +6 / +8% damage for 3s, stacks 3×                                        | `onKill` + stacking status |
| **Vengeance** | taking a hit grants +8 / +12 / +18% damage for 3s                                         | `onHitTaken` + status |
| **Bloodrush** | crits restore 1 / 2 / 3 HP                                                                | `onCrit` |
| **Staggering Blows** | hits have a 5 / 8 / 12% chance to stagger (brief stun + flinch)                           | stagger state on creatures |
| **Opportunist** | +10 / +16 / +25% damage to staggered or knocked-back enemies (Heavy Hands' dance partner) | stagger/knockback state check |
| **Runner's High** | dashing grants +8 / +10 / +14% move speed for 1.5s                                        | dash hook + status |
| **Steadfast** | knockback you take is reduced 20 / 35 / 50%                                               | player knockback intake (verify it exists) |

### Epic — gems (single-tier, rule-bending, very rare)

One tier, one weird promise, purple glow. Seeing one should be an event — the pool stays small
on purpose (eight for v1) so each stays memorable.

| Gem | Effect | Needs |
| --- | --- | --- |
| **Ghost Step** | dash passes through enemies | collision flag during dash |
| **Impact Wave** | every 4th attack releases a small shockwave (knockback, no damage) | the level-up shockwave tech, reused |
| **Piercing Volley** | projectiles pierce one extra enemy | projectile pierce count |
| **Glass Soul** | +25% damage · −10% max HP | pure modifiers (a `more` + a negative) |
| **Stone Soul** | +25% armor and max HP · −10% move speed (Glass Soul's opposite) | pure modifiers |
| **Reaper's Step** | kills reset your dash cooldown | `onKill` + dash reset |
| **Split Shot** | projectiles fork into two at 60% damage | projectile fork (medium cost) |
| **Retaliation Wave** | taking a hit has a 20% chance to emit a knockback shockwave | `onHitTaken` + shockwave tech |

*(Deliberately cut for now: anything needing dodge/parry/block procs — the intake pipeline isn't
rolled in `resolveAttack` yet. Those gems come free once it is.)*

## Major Talents

Offered 1-of-3 at 10, 15, 20… from **your spec's pool + the generic pool**; each spec gets eight
majors that push its axis harder ([characters-and-talents](./characters-and-talents.md) §Spec).
Majors are gold cards and may use the reserved **`more` multiplier** category. Mechanic types
deliberately vary within each pool: *amplifiers* (the axis, harder), *converters* (a new loop
the axis unlocks), *payoffs* (jackpot moments), and at least one *defensive/utility* pick — so
no milestone offer is ever three damage cards.

### Warrior

**Barbarian** *(was Berserker)* — deal more damage the lower your health:

- **Death Wish** — below 30% HP, the Barbarian's damage bonus is doubled and melee swings
  cleave the full arc.
- **Bloodthirst** — kills heal 3% max HP — doubled while below 30% HP (the sustain that makes
  living on the red line playable).
- **Last Stand** — lethal damage instead leaves you at 1 HP; once per 90s. *⚠ Design tension: a
  free cheat-death sits right on top of the lives economy ([progression](./progression.md)) —
  it's the strongest fantasy in the pool AND a monetization interaction. Flagged for Tom.*
- **Pain Engine** — taking a hit grants +8% attack speed for 4s, stacks 3× (incoming pain
  becomes output).
- **Red Mist** — kills while below 30% HP erupt in a blood nova (small AoE damage — reuses the
  nova/shockwave tech).
- **Reckless Swings** — your attacks cost 2% max HP and deal +25% damage (rage spends blood —
  and walks you *toward* your own Death Wish threshold on purpose).
- **Warpath** — each kill within 3s of the last grants +5% move and attack speed, stacks 5×
  (the rampage that ends only when the room is empty).
- **Deathless Fury** — while below 30% HP you cannot be staggered or knocked back (nothing
  interrupts the ending). *(player knockback intake — verify)*

**Sentinel** — the immovable wall (per-hit damage cap · −10% damage dealt):

- **Entrench** *(migrated from Ballista)* — while standing still, take 20% less damage.
- **Wallbreaker** *(migrated)* — enemies knocked into walls take impact damage and are briefly
  stunned (the shield-shove becomes a damage loop).
- **Immovable Object** — immune to knockback and stagger; enemies that hit you are slowed 20%
  for 2s. *(needs enemy slow + player knockback intake — verify)*
- **Spiteful Bastion** — reflect 20% of the damage you take. (`onHitTaken`)
- **Living Fortress** — +15% max HP (`more`) and your per-hit cap tightens to 20%.
- **Stone Stance** — while standing still, regenerate 1% max HP per second (the wall repairs
  itself).
- **Answered Blow** — whenever your per-hit cap actually clamps a hit, your next attack deals
  double damage (the signature becomes a trigger: they hit the wall, the wall hits back).
- **Grand Bulwark** — your knockbacks are 50% stronger and stagger (the shield-shove as crowd
  control — pairs with Wallbreaker).

**Paladin** — holy knight; every 4th melee hit Smites (wisdom-scaled magic damage, heals half):

- **Zealotry** — Smite every 3rd hit instead of every 4th.
- **Consecration** — Smites scorch the ground with holy fire for 2s. *(ground patches —
  medium cost)*
- **Aegis of Faith** — Smiting grants a stacking +armor buff for 3s.
- **Devotion Aura** — enemies near you deal 10% less damage. *(aura tech)*
- **Lay on Hands** — dropping below 25% HP heals 25% max HP; once per 90s (Last Stand's
  merciful cousin — the same lives-economy flag applies).
- **Divine Storm** — Smites strike every enemy in your melee arc (judgement, wholesale).
- **Benediction** — Smite healing is doubled (faith sustains the sword arm).
- **Holy Vengeance** — taking a hit has a 20% chance to instantly ready a Smite (your next
  strike, regardless of count). (`onHitTaken`)

### Ranger

**Deadeye** — more damage the further the target:

- **Headhunter** — hits beyond 80% of your reach always crit.
- **Give Ground** — hitting an enemy at range grants +15% move speed for 2s (the kite loop feeds
  itself).
- **Longshot** — +20% reach (`more`) and max-range hits knock back.
- **Double Nock** — hits beyond 80% of your reach loose a second arrow at 50% damage.
- **Patience** — not attacking builds +6% damage per second (max +30%), spent entirely on your
  next shot (the held-breath kiting rhythm).
- **Called Shot** — your first hit on any enemy deals +30% damage (every target opens with an
  answer — pairs with the Ambusher chain).
- **Piercing Gale** — hits beyond 80% of your reach pierce one extra enemy (at that distance,
  they're standing in a line whether they like it or not).
- **Bullseye** — crits beyond 80% of your reach deal +50% crit damage (`more`) (the spec's
  two conditions, stacked into one perfect shot).

**Trickster** — untouchable skirmisher (+1 dash charge · dashes drop a taunting decoy):

- **Blade Rush** *(migrated from Bladedancer)* — dashing through enemies slashes them for
  weapon damage (the dash *is* an attack).
- **Smoke Bomb** — taking a hit bursts smoke: enemies near you miss 30% more often for 2s.
  *(enemy accuracy debuff — status)*
- **Caltrops** — dashes scatter caltrops that slow enemies who cross them 30%. *(ground
  patches)*
- **Quicksilver** — +10% move speed (`more`) and +0.1s of dash i-frames.
- **Phantom Twin** — your decoy detonates when it expires, staggering enemies around it (bait
  becomes a weapon).
- **Misdirection** — while your decoy lives, you deal +20% damage (they're looking the wrong
  way).
- **Vanish** — dropping below 30% HP drops a decoy and makes you untargetable for 1s; 30s
  internal cooldown (the classic disappearing act). *(needs aggro-drop/untargetable state)*
- **Trickster's Tempo** — kills reduce your dash cooldown by 1s (the exit is always ready —
  Reaper's Step's little cousin; if both feel samey in play, cut one).

**Warden** — nature's blade (agility melee · Verdant Aura slows nearby enemies):

- **Thorn Aura** — enemies inside your aura take damage over time (stand your ground and the
  forest eats them).
- **Entangling Growth** — your hits have a 15% chance to root the target for 1s. *(enemy
  status — root)*
- **Healing Bloom** — kills inside your aura restore 3% max HP.
- **Bark Skin** — +armor while at least one enemy is inside your aura (rooted for battle).
- **Wildwrath** — the aura's slow deepens to 30% and its radius grows 50%.
- **Sap Strike** — melee hits steal 5% move speed from the target for 2s (it slows, you
  quicken — the forest drinks).
- **Grove's Embrace** — while no enemies are inside your aura, regenerate HP quickly (step
  out of the fight and the green knits you closed).
- **Overgrowth** — enemies inside your aura also deal 10% less damage (everything the aura
  touches is diminished).

### Mage

**Priest** — holy wrath; spell hits build **Wrath**, full Wrath erupts as **Retribution**:

- **Fervor** — spell crits grant double Wrath.
- **Circle of Radiance** — Retribution consecrates the ground it strikes for 2s. *(ground
  patches)*
- **Absolution** — Retribution heals you for 10% max HP.
- **Martyrdom** — taking damage grants Wrath (pain accelerates judgement).
- **Holy Nova** — dropping below 30% HP triggers Retribution instantly, free of Wrath; 30s
  internal cooldown.
- **Penance** — enemies that survive a Retribution take +20% damage for 4s (judgement is
  merely postponed).
- **Swift Judgement** — Retribution requires 20% less Wrath (the verdict comes faster).
- **Exalted Wrath** — Retribution's radius grows 50% and it knocks enemies back (make room
  for the divine).

**Summoner** — an imp fights beside you, firing ranged bolts (v1 familiar decided 2026-07-06):

- **Twin Imps** — a second imp.
- **Empowered Bond** — your imp deals 50% more damage and grows visibly larger.
- **Soul Burst** — a slain imp explodes in an AoE before it resummons.
- **Soul Tether** — dropping below 25% HP consumes your imp to heal you 20% max HP.
- **Spirit Ward** — while your imp lives, you take 10% less damage.
- **Searing Bolts** — your imp's bolts burn, dealing damage over time. *(enemy status — burn)*
- **Overseer** — you deal +15% damage to whatever your imp is attacking (call the target,
  finish it together).
- **Quick Rebinding** — a fallen imp resummons in 3s instead of 10s, and returns with an
  opening volley.

**Spellblade** — intellect melee, extended arcs:

- **Sweeping Wards** — +15% reach (`more`) and the melee arc widens 15°.
- **Runic Edge** — every 3rd melee hit bursts in an arcane nova (small AoE magic damage).
- **Blade Ward** — melee hits grant a stacking +armor buff for 3s.
- **Blade Bolt** — while above 70% HP, melee swings launch a short-range magic wave (the sword
  fires — reuses projectile tech on a melee weapon).
- **Runeburst** — taking a hit has a 25% chance to detonate the arcane nova in self-defense
  (Runic Edge's tech, defensively).
- **Mindsteel** — gain armor equal to 15% of your intellect (the mind hardens the body — a
  stat-linked modifier, same tech as the spec conversions).
- **Blink Strike** — your dash becomes a short-range *teleport* (the arcane swordsman doesn't
  roll — he's simply elsewhere). *(position jump + collision check — medium cost)*
- **Arcane Momentum** — melee kills grant +15% attack speed for 3s (each felled enemy feeds
  the tempo).

### Generic pool (class-agnostic, any milestone)

- **Juggernaut** — +10% max HP (`more`).
- **Battle Rhythm** — +5% attack speed (`more`).
- **Fortune's Favor** — +15 luck, and Rare+ minor Talents appear noticeably more often (the
  meta-pick: invest in future level-ups).
- **Windfall** — enemies drop 20% more gold. *(ships when gold drops exist in-game)*
- **Thick Skin** — every hit you take deals 1 less damage (flat, floored at the game's
  min-damage — huge early, fades naturally with level).
- **Fleet of Foot** — +8% move speed (`more`).
- **Veteran's Instinct** — +10% XP from kills. *⚠ Design tension: growth is meant to be paced
  by content, and an XP major compresses it — the classic pick everyone takes. Flagged for
  Tom; cut freely.*

### Retired pool (2026-07-06 spec rework — parked, not deleted)

Authored for the six specs the rework replaced; the mechanics are sound, so they wait here for
a second home. **Prime Relic-signature candidates** ([equipment](./equipment.md)) — a Relic
carrying one of these is a found version of a build that no longer exists as a spec:

- **Ballista:** Heavy Bolts · Cannonade · Siege Engine *(Entrench + Wallbreaker migrated to
  Sentinel)*.
- **Battlemage:** Point-Blank Doctrine · Arcane Bulwark · Chain Reaction · Gravity Well ·
  Aftershock *(its ground-scorch tech ships anyway as Paladin's Consecration)*.
- **Bladedancer:** Flow State · Perfect Step · Twin Fangs *(Blade Rush migrated to Trickster;
  Dancer's Grace was absorbed into Trickster's signature)*.
- **Spellslinger:** Overcharge · Slipstream · Rapid Fire · Hot Streak · Ricochet Casts.
- **Arcane Archer:** Prism Shot · Twin Disciplines · Seeking Bolts · Arcane Quiver · Hex Shot
  *(the whole suite is a natural bow-Relic family)*.
- **Echomancer:** Resonance · Amplify · Chorus · Echo Chamber · Encore *(the echo suite is the
  flagship Relic candidate — an echoing staff as a legendary find)*.

## Where this lives (for implementation later)

- **`@heroic/core`:** `rarity` field on `TalentChain`; gems as single-tier chains; rarity/pity in
  `generateOffers` (past offers are recomputable from the pick history — pity needs no new
  state); hook/effect dispatch (`onKill`, `onCrit`, `onHitTaken`, `onHitDealt`) + timed status
  effects; majors as a new authored list with spec/generic pool tags + milestone offer logic.
- **App:** effect handlers wired into the sim (knockback scaling, dash flags, shockwaves,
  pierce); rarity card styling; the major-pick moment (same sheet, gold dressing); the
  new-systems bill the reworked specs add — summons, auras, decoys, ground patches, meters —
  is recorded in [characters-and-talents](./characters-and-talents.md) §Specialisation.

## Open / deferred

- Tom's sign-off: the three-tier rarity split; **Last Stand + Lay on Hands** vs the lives
  economy; **Veteran's Instinct** (XP major) vs content pacing; the 72 major names/mechanics
  (first drafts — expect to cut/replace freely); generic-pool size; hybrid-ladder budget (both
  stats at ~60% vs pure ladders); which retired talents graduate to Relic signatures.
- Numbers: all values above; rarity weight multipliers; pity window; luck's Rare+ nudge; `more`
  magnitudes.
- Later: dodge/parry/block-proc talents once the intake pipeline rolls in combat; mana-touching
  talents once mana exists; growing Commons toward ~80 chains; per-spec minor chains.
