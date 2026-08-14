# BITS — Writ Deeds: signature achievements for the store shelf

Status: **DESIGNED 2026-08-14 — nothing built.** All titles are
PLACEHOLDERS in the house voice (Tom owns the naming pass, as ever) ·
Applies to: **Blood in the Sand** ·
Companion to [achievements.md](./achievements.md) (the deed engine and
board these join), [bits-store-arms.md](./bits-store-arms.md) (the seven
items these celebrate), [bits-store.md](./bits-store.md) (why owned items
deserve deeds at all).

> **The brief (Tom, 2026-08-14):** every writ item already has one generic
> ladder (rounds won with the weapon / casts of the spell) — templated
> volume climbs. Premium arms deserve better: at least TWO sets of unique
> deeds per item, so a buyer has something to *work towards* that only
> their weapon can do. A deed you can only earn with the Fang is also an
> advert for the Fang — the rented-steel logic again.

## The shape: one FEAT set + one MASTERY chain per item

Two sets per item, same pattern across all seven so the codex reads
consistently:

1. **The feat set** — 2–3 one-off deeds that celebrate the item's
   *signature mechanic* (the thing the codex card sells: the venom that
   kills after you've left, the volley that all lands, the shell that
   doesn't care whose feet). One per item is allowed to be a joke feat
   (the loss-streak precedent: joke TITLES are fair game, payouts are
   not).
2. **The mastery chain** — a 3-tier lifetime ladder on the item's
   signature STAT (poison damage, full volleys, enemies swallowed…), not
   another volume count. Distinct identity ramp from the existing
   rounds/casts chain, hand-authored per the defs.ts rule.

Standing rules inherited from achievements.md, restated because they bind
here:

- **Never pay out for losing.** Feats below that don't require a win are
  gated on the *deed itself* being an accomplishment (landing a full
  volley is a feat whoever wins). None reward throwing.
- **Visible to all, climbable once owned** — the trident/writ-chain rule.
  A locked feat card in the codex IS the store advert.
- **Feat predicates read MatchSummary only.** Every deed below is
  annotated with its engineering cost tier:
  - **[T0]** derivable from today's summary — predicate only.
  - **[T1]** the accumulator grows a stat from events *already emitted*
    (summary.ts's own rule: "THIS class grows it") — no sim change.
  - **[T2]** the sim must grow an event field or emit a new signal
    (usually a one-flag change; each is called out). No protocol bumps —
    events are server-side, none of this touches snapshots.
- **Board placement:** feats branch off the item's existing chain (the
  return-to-sender precedent); mastery chains take new rows in the
  item's cluster. The layout debt lands on the M3 chain-layout helper
  like everything else.

## New event plumbing, shared across items *(the whole T2 bill up front)*

Five small sim additions unlock every T2 deed below:

- `hit.titan?: true` — attacker was grown when the blow resolved (the
  damage factor is already read at that exact spot in resolvePlayerHit).
- `hit.overreach?: true` — a projectile that connected beyond its
  weapon's reach band (scorpion maxRange 480, bombard's lobbed edge).
- `hit.stacks?: number` — on poison ticks, the victim's stack count.
- `zoneEvent` — `{ type: "zone"; kind: "sinkhole" | "tar"; casterId;
  event: "caught" | "death-inside"; targetId }` emitted by
  stepDeployables when a player enters a hole's drag / dies inside a
  zone / dies gripped by tar. One event shape serves both zone spells
  and any future zone drop.
- `beamEvent` — `{ type: "beam-link"; casterId; seconds }` emitted when a
  lifeline link BREAKS, carrying its unbroken length (the sim already
  holds `beamLink`; this just reports it at teardown + round end).

Everything else is T0/T1.

---

## Fang — the venom does the killing

*Signature: get in, stab, get out — the poison works while you're gone.*

**Feats** (branch off `rounds-fang-5`):

| id | title (placeholder) | deed | cost |
|---|---|---|---|
| `parting-gift` | The Parting Gift | Kill an enemy with the venom itself — the killing blow is a poison tick, not the knife. | **[T1]** lethal hit with `poison: true` → new `poisonKills` stat |
| `four-fangs-deep` | Four Fangs Deep | Bring a victim to full stacks — four fangs' venom burning at once. | **[T2]** `hit.stacks` |
| `the-plague` | The Plague | Have three enemies poisoned at the same moment. | **[T2]** derivable from poison-tick hits in one step batch (3 distinct `targetId`s with `poison: true`, same attacker) — accumulator-side once ticks are batch-grouped, so effectively **[T1]** |

**Mastery chain** — `venom-damage`, counter `poison_damage:fang`
**[T1]** (poison-flagged hit damage, credited to the attacker like bleed):

- 250 — "Slow Acting" — *Deal 250 poison damage.*
- 1500 — "The Long Goodbye" — *Deal 1500 poison damage.*
- 5000 — "Death by a Thousand Drips" — *Deal 5000 poison damage.*
  `rewards: [{ kind: "title" }]`

## Scorpion — the volley that all lands

*Signature: three re-aiming bolts; the premium is landing all three.*

**Feats** (branch off `rounds-scorpion-5`):

| id | title | deed | cost |
|---|---|---|---|
| `full-spread` | The Full Spread | Land all three bolts of a single volley on the same enemy. | **[T1]** three same-attacker weapon hits inside one burst window — accumulator groups per-batch hits; needs a `volley` grouping stat. If batch boundaries prove unreliable, fall back to **[T2]** (a `volleyComplete` flag on the third bolt's hit, which the sim knows for free) |
| `run-down` | No Second Wind | Kill a fleeing enemy with a bolt beyond the 240 band — loosed at the edge, carried to the kill. | **[T2]** `hit.overreach` |

**Mastery chain** — `full-volleys`, counter `volleys:scorpion` **[T1/T2
per full-spread above]**:

- 10 — "Grouped Tight" — *Land 10 full volleys.*
- 75 — "The Metronome" — *Land 75 full volleys.*
- 300 — "Third Time's the Charm" — *Land 300 full volleys.*
  `rewards: [{ kind: "title" }]`

## Bombard — artillery doesn't care

*Signature: indirect fire, blast hits EVERYONE — the game's only
friendly fire.*

**Feats** (branch off `rounds-bombard-5`):

| id | title | deed | cost |
|---|---|---|---|
| `clustered` | Bunched Like Cattle | Hit three enemies with a single shell. | **[T1]** same-batch distinct-victim hits from one attacker → `bestMultiHit` stat. (Needs 3v3+ — acceptable: the doc's own line is that artillery scales with team size.) |
| `danger-close` | Danger Close | Wound yourself with your own shell — and win the round anyway. | **[T1]** self-hit (`attackerId === targetId`) → `selfHits` stat; joke feat, title only, the win requirement keeps it un-farmable from losses |
| `fire-for-effect` | Fire for Effect | Kill an enemy with a shell they never saw launched — a max-band lob. | **[T2]** `hit.overreach` (shared with the scorpion's) |

**Mastery chain** — `shellfire`, counter `shell_hits:bombard` **[T1]**
(enemy hits landed while wielding the bombard — the wielder's weapon
damage IS shell damage):

- 25 — "Ranging Shots" — *Land 25 shells on the enemy.*
- 250 — "The Barrage" — *Land 250 shells on the enemy.*
- 1000 — "Sky Falls, Sand Burns" — *Land 1000 shells on the enemy.*
  `rewards: [{ kind: "title" }]`

## Lifeline — the thread that holds

*Signature: the ramping link — protecting it is the team's job. Allies
or nothing; it deals no damage, ever.*

**Feats** (branch off `rounds-lifeline-5`):

| id | title | deed | cost |
|---|---|---|---|
| `unbroken` | The Unbroken Thread | Hold a single unbroken link for 10 seconds. | **[T2]** `beamEvent` |
| `clean-hands` | Clean Hands | Win a ranked match dealing zero damage and 400+ healing. The pit has never seen anything like you. | **[T0]** `damageDealt === 0 && healingDealt >= 400 && wonMatch` |
| `the-placebo` | The Placebo | Win a 1v1 wielding the Lifeline. It links nothing. It heals no one. You won anyway. | **[T0]** `teamSize === 1 && weapon === "lifeline" && wonMatch` — the joke feat, title only. HOW (Tom asked, 2026-08-14): the beam contributes zero, so the whole kill must come from the two SPELL slots (Tremor / Sandtrap / Harpoon damage) — spells-as-only-weapons IS the joke. Known sharp edge, pre-existing but now advertised: a 1v1 Lifeline + two no-damage spells (e.g. Sinkhole + Tar Pit) is a legal loadout that literally cannot end a round — no round clock exists (the standing open question from bot-brains.md, not a problem this deed creates, but it invites the cursed loadout) |

**Mastery chain** — `thread-of-gold`, counter `beam_healing:lifeline`
**[T1]** (healingDealt accrued in matches wielding the lifeline —
counterDeltas already knows the weapon):

- 1000 — "Triage" — *Restore 1000 health down the thread.*
- 10000 — "The Golden Hour" — *Restore 10000 health down the thread.*
- 50000 — "Spinner of Fates" — *Restore 50000 health down the thread.*
  `rewards: [{ kind: "title" }]`

> **Naming collision flagged for Tom's pass:** the generic healing
> chain's 10000 tier is currently titled **"Lifeline"** (defs.ts) — now
> also the weapon's name. Worth renaming one of them.

## Sinkhole — the hole does no damage; the deaths are still yours

*Signature: the setup piece — it kills nothing, it FEEDS kills.*

**Feats** (branch off `casts-sinkhole-10`):

| id | title | deed | cost |
|---|---|---|---|
| `the-undertaker` | The Undertaker | An enemy dies inside your sinkhole. The hole takes no credit. You may. | **[T2]** `zoneEvent` death-inside |
| `mass-grave` | Standing Room Only | Drag three enemies with a single sinkhole. | **[T2]** `zoneEvent` caught (distinct targets per deployable) |

**Mastery chain** — `the-swallowing`, counter `dragged:sinkhole` **[T2]**
(lifetime enemies caught in your holes):

- 25 — "Loose Ground" — *Drag 25 enemies into your sinkholes.*
- 150 — "Subsidence" — *Drag 150 enemies into your sinkholes.*
- 600 — "The Desert Eats Well" — *Drag 600 enemies into your sinkholes.*
  `rewards: [{ kind: "title" }]`

## Tar Pit — the path you painted

*Signature: the roster's only movement-expressed ability; it spares
no one, your own boots included.*

**Feats** (branch off `casts-tar-pit-10`):

| id | title | deed | cost |
|---|---|---|---|
| `long-black-mile` | The Long Black Mile | Sprint a full laying window — eight or more blobs from a single cast. | **[T2]** blob count per cast (the sim counts them as it drops them; report on window close via `zoneEvent` or a cast-scoped stat) |
| `stuck-pig` | Tarred and Feathered | An enemy dies while gripped by your tar. | **[T2]** `zoneEvent` death-inside (kind `tar`) |
| `own-goo` | Cobbler's Boots | Spend ten cumulative seconds of one round stuck in your own tar. | **[T2]** self time-in-zone — joke feat, title only |

**Mastery chain** — `black-wake`, counter `tar_seconds:tar-pit` **[T2]**
(lifetime enemy-seconds gripped by your tar):

- 60 — "Sticky Fingers" — *Grip enemies for 60 total seconds.*
- 300 — "The Slow March" — *Grip enemies for 300 total seconds.*
- 1500 — "Nothing Outruns the Black" — *Grip enemies for 1500 total
  seconds.* `rewards: [{ kind: "title" }]`

## Titan's Draught — five seconds of giant

*Signature: the moment — everything you do while grown is the show.*

**Feats** (branch off `casts-titans-draught-10`):

| id | title | deed | cost |
|---|---|---|---|
| `two-beneath-the-heel` | Two Beneath the Heel | Kill two enemies during a single draught. | **[T2]** `hit.titan` (lethal, grouped per active window — the accumulator opens a window on the cast event) |
| `worth-every-drop` | Worth Every Drop | Deal 60 damage during a single draught — the whole bottle, spent. | **[T2]** `hit.titan` (same plumbing) |

**Mastery chain** — `colossus-road`, counter `titan_kills:titans-draught`
**[T2]** (lifetime kills while grown):

- 5 — "Big for a Moment" — *Kill 5 enemies while grown.*
- 25 — "The Looming" — *Kill 25 enemies while grown.*
- 100 — "They Built Statues Smaller" — *Kill 100 enemies while grown.*
  `rewards: [{ kind: "title" }]`

**Bonus counter-deed (everyone's, not the buyer's):** `giant-slayer` —
"Giant Slayer": *kill an enemy while they're grown.* **[T2]** needs a
`hit.targetTitan` twin flag. Deliberately earnable WITHOUT owning the
draught — the deed that makes fighting a titan aspirational, and every
unlock ceremony that fires it has just shown the loser's weapon to the
winner. Cheapest store advert on this page.

---

## Codex & board notes

- **Chapters:** feats join their item's existing chapter (The Arsenal
  for weapons, the three Arts for spells); mastery chains slot beside
  their item's generic chain. No new chapters.
- **Coverage test:** achievements.test.ts's per-item coverage rule
  stays chain-per-item — these are ADDITIONS, so no test gate forces
  them. Consider extending the test to require ≥2 deed sets per writ
  item once built, so future drops (Boomerang) inherit the standard.
- **Boomerang pre-note:** its signature stat writes itself — the return
  catch (kills on the way BACK, wall-bounce kills). Author its two sets
  with the drop, per the extended coverage rule above.
- **Icons:** every set is a new forge icon row (deed icons derive from
  chains — feats need hand rows, the return-to-sender precedent). The
  standing content tax applies.

## Build order (proposed)

1. **T0/T1 wave** — predicate-only + accumulator-growth deeds (Clean
   Hands, The Placebo, Parting Gift, The Plague, venom chain, shellfire
   chain, thread-of-gold chain, Danger Close, Bunched Like Cattle,
   Full Spread if batch-grouping holds). No sim changes; ships alone.
2. **Flag wave** — `hit.titan` / `hit.targetTitan` / `hit.overreach` /
   `hit.stacks`: four flags, unlocks both titan feats + chain,
   Giant Slayer, No Second Wind, Fire for Effect, Four Fangs Deep.
3. **Zone/beam wave** — `zoneEvent` + `beamEvent`: everything sinkhole,
   tar, and Unbroken Thread. The largest lift; both event shapes are
   reusable for every future zone/beam item.

## Open questions (deliberately undecided)

- **Thresholds** — all first-pass knobs in the Tom-tunes-in-place style.
- **Titles** — all placeholders; Tom's naming pass owns them, including
  the Lifeline/healing-chain collision above.
- **Rewards** — beyond the flagged `title` tiers, unset pending the
  economy pass, per the defs.ts standing rule.
- ~~Do writ feats pay Glory?~~ — **DECIDED 2026-08-14 (Tom): no Glory
  for these deeds.** Writ deeds pay titles/cosmetics only — a
  purchased-item deed paying currency is a soft pay-for-Glory loop.
  Whatever the economy pass grants FREE deeds, this rule holds for the
  writ sets (extend the loss-streak-style test guard to enforce it when
  built).
