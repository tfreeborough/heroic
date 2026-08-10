# BITS — The Writ Shelf: launch arms & the drop pool

Status: **designed 2026-08-09 · Fang (v21) + Scorpion (v22) BUILT 08-09,
Bombard (v23) BUILT 08-10 — items 4–7 owed** ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-08-09 ·
Companion to [bits-store.md](./bits-store.md) (the Writ economy these stock),
[pvp-abilities.md](./pvp-abilities.md) (the ability layer the spells join),
[monetisation.md](./monetisation.md) (never a flat paid advantage),
[bot-brains.md](./bot-brains.md) (bots never draft these, but must face them),
[bits-audio.md](./bits-audio.md) + [bits-art-style.md](./bits-art-style.md)
(the per-item content tax).

> **The brief (Tom, 2026-08-09):** stock the Writ shelf for the end-of-August
> launch. 16 raw candidates were triaged in one sitting; this doc records the
> picks, the numbers proposed for each (all first-pass — nothing here is
> playtested), and why the rest were deferred or cut.

## The launch seven *(Tom, 2026-08-09 — names DECIDED same day)*

**Weapons:** Scorpion · Fang · Bombard · Lifeline
**Spells:** Sinkhole · Tar Pit · Titan's Draught

Proposed ids: `scorpion` / `fang` / `bombard` / `lifeline` (WeaponId),
`sinkhole` / `tar-pit` / `titans-draught` (AbilityId). Naming register
(deliberate, from the existing roster): weapons are stark single nouns
(Blade, Bow, Hammer… Trident), spells carry the flavour (Blood Font,
Warding Shout). Titan's Draught deliberately steps clear of MTG's
"Giant Growth"; Ballista's name stays unspent for its own future drop.

All seven ship `gate: "writ"` (WRIT_WEAPONS / WRIT_ABILITIES in `items.ts`),
1 Writ each, fully usable in practice (try-before-buy), hidden from the
Arming wizard until owned, always visible in the Armory.

**First post-launch drop: the Boomerang** (Tom, 2026-08-09 — held back
deliberately so month one has a marquee drop; see the drop pool below).

## The three selection lenses

Every candidate was judged against three constraints our own systems impose:

1. **No aim is networked — weapons auto-fire at the auto-target.** A weapon
   fantasy that needs aiming must either work as "fires at the lock-on" or
   move to the spell slot (spells may use facing, like Warding Shout).
2. **Rooms run 1v1–4v4.** Ally-dependent items degrade at 1v1. Acceptable
   when it's a *loadout choice* (Tom: you just don't pick the Lifeline in
   1v1), unacceptable when the item is dead weight the buyer discovers late —
   free practice use defuses this.
3. **Bots never draft gated items but still FACE them** (bits-store.md
   standing rule). No cast-rule/archetype tax ever, but effects that break
   bot assumptions (zones, displacement) owe a zone-awareness pass in
   botThink. Items that would break the flow-field nav itself (the ice/rock
   wall) are engine projects, not items.

## Poison vs bleed — the status rules *(decided 2026-08-09)*

Both are fixed-damage riders outside crit/defense/rng (the BleedConfig
pattern — the seed/rngDraws contract stays untouched). The difference is the
victim's story:

- **Bleed** (exists): a fixed drip attached by a hit. Chance-based or
  guaranteed, flat damage per tick, `refresh` or queue per weapon. *Punishes
  getting tagged once.*
- **Poison** (new): **stacking intensity**. Every application adds a stack
  (cap per weapon), damage per tick = perStack × stacks, the shared timer
  refreshes on every application, and **all stacks expire together** when it
  runs out. *Punishes letting someone keep touching you.*

Visual language: poison gets its own status ring colour (green pulse beside
bleed's red / slow's existing ring); pulse rate = time left, the protocol v5
convention. Ring + stack count are snapshot fields.

```ts
/** A stacking-intensity DoT rider (the poison family). */
interface PoisonConfig {
  maxStacks: number;      // cap on concurrent stacks
  interval: number;       // seconds between ticks
  damagePerStack: number; // per tick, per stack — fixed, rng-free
  duration: number;       // shared clock, refreshed on every application
}
```

---

## Launch weapons

All numbers are proposals against the current tables (`config.ts`) — tune on
device. Every weapon keeps the standard shape: stats overlay on
PLAYER_STATS, engagementRadius = reach + margin, windups readable enough to
dash.

### Scorpion — the burst repeater *(was Chu Ko Nu; renamed for the Roman
bolt-thrower + the desert creature — the historical chu ko nu remains the
mechanical inspiration)*

The ranged identity the roster lacks: bow is one big earned hit, staff is
slow homing pressure, this is **three fast bolts in quick succession** on a
slow cycle. Each bolt **re-aims at the target's position at its own release
instant** — that's what makes the burst "harder to dodge than a bow shot"
without any aim being networked; dash i-frames through the middle of the
burst remain the clean answer.

- Projectile, physical. reach 240 — a MID-RANGE band, well under staff's
  320, above melee (Tom's device pass 2026-08-09: 320 was too dangerous;
  bolt speed 750 → 850 as the trade). Bolt radius 5, **maxRange 480** —
  deliberately breaking the roster's reach+60 idiom (Tom, same day): the
  band gates where a volley may BEGIN, but loosed bolts carry to double
  it, past the bow's 420 arrow, so an edge-of-band volley still runs down
  a fleeing mark. Acquisition stays the balance lever; flight is flavour.
- Burst of 3, ~0.12s apart. Per-bolt attack 8 → full burst (24) slightly
  out-damages one bow hit (20) — the premium for landing all three — but a
  strafing target sheds bolts and a dodged burst is a whole slow cycle lost.
  At 240 reach it has to hold the seam between the melee bracket and the
  true ranged weapons: bow and staff outrange it, melee out-brawls it.
- windup 0.45, recovery ~1.3 (Tom's spec: slow fire rate), knockback ~80 per
  bolt (three taps, not a launch).
- Engine: a `burst` field on the attack (count + interval) — the swing fires
  N projectiles on a timer instead of 1. Small, reusable.

### Fang — the skirmisher's poison dagger

The get-in-stab-get-out melee the roster lacks; seeds the poison system. Low
raw damage; the kill is the poison working while you're already gone.

- Arc, physical. reach 60 (shortest in the game — well inside blade's 90),
  arcWidth ~35°, windup 0.15 / recovery 0.3 (fastest cycle), knockback 0
  (it wants to stay in), attack 5 — the raw hit is a formality. *(Tom's
  device pass 2026-08-09: down from 70 / 0.53s cycle / atk 7.)*
- Poison: maxStacks 4, interval 1s, damagePerStack 3, duration 5s (refreshed
  per hit). *(Venom pass, Tom 2026-08-09 — up from 2/stack on a 4s clock:
  the first tune read as a rider, not a weapon.)* Three quick stabs = 9/s
  burning for 5s — 45 damage delivered after you've already left, which IS
  the loop: get in, stab a few times, get out. Full stacks = 12/s,
  deliberately OVER Blood Font's 8/s heal — the fang is the roster's
  anti-heal pressure. The clock refreshes only while the knife keeps
  touching you, so disengaging remains the whole counterplay.
- Counterplay: hammer/trident out-space it brutally; its whole game is
  closing through telegraphs. Dash-shove peels it off.

### Bombard — indirect fire *(was Mortar; Bombard is the period-correct
artillery noun)*

Fills the AOE-artillery gap. Auto-target solves its aiming: it lobs at the
target's **fire-time position**; flight time makes it dodgeable by walking.
Terrifying vs groups holding ground, honest vs individuals — scales with
team size without being dead at 1v1.

- Lobbed projectile, physical. reach 380 — longest in the game, just past
  the bow's 360 (400 → 360 → 380 across Tom's device pass 2026-08-10,
  paired with the ARTILLERY ZOOM:
  the client zooms the follow camera out just far enough that a shell
  weapon's whole range ring fits the screen width, derived from the
  followed player's weapon so spectating a gunner shows their game too).
  **minReach ~120** — the trident's floating-band plumbing reused as a
  close-quarters dead zone: get inside the bombard's arc and it cannot
  fire at you at all. That's the dive counterplay, engine-free.
- Shell flight SCALES WITH LAUNCH DISTANCE (Tom, 2026-08-10 — a closer
  shell needn't travel as far): 0.55s at point-blank → 0.9s at full reach,
  linear. The 0.55 floor is a balance line, not flavour: a dead-centred
  target needs ~0.49s to walk clear of the blast, so the floor keeps the
  walk-out barely alive at every range — cut below it and close shells
  become dash-or-eat. The arc is render flavour; the sim runs a landing
  timer at a marked point, which also gives the client a free telegraph
  decal at the impact spot.
- Blast on landing: radius 120, damage ~22, radial knockback ~400 — the
  sandtrap blast helper reused, with ONE deliberate break (Tom, 2026-08-10,
  after play): **the blast hits EVERYONE in the zone — enemies, allies, and
  the gunner**. The game's first friendly-fire source, scoped to this one
  weapon: artillery doesn't care, and a diver inside the dead zone now
  forces a real choice — hold fire, or shell your own feet.
- windup 0.55, recovery ~1.4. Landing-spot ring is the readable telegraph;
  it must render for BOTH teams (an unmarked artillery hit would feel like
  cheating).
- Bot-facing note: shells need a snapshot representation bots can read
  (impact point + time-to-land) so high-tier dodge logic treats them like
  projectiles — the marked landing ring IS that data.

### Lifeline — the heal beam that can be hijacked

Tom's specialist-healer fantasy (2026-08-09), made honest by the **enemy
snap** (Tom's own fix): the beam prefers enemies at close range, so a diver
doesn't have to kill the healer to win the fight — standing near them
silences the healing.

- New `beam` attack shape in core — no windup/recovery cycle; a continuous
  link that ticks every 0.5s while the target stays in range. The one real
  engine lift of the launch set; beams are reusable forever after.
- Targeting: any enemy inside **snapRadius 160** → beam snaps to the nearest
  enemy, token damage ~2/s (a target-painter and a 1-hp-runner finisher,
  never a real gun). Otherwise → the **most-wounded ally** in beamRange 300
  (most-wounded, not nearest — that's the healer fantasy).
- The ramp: heal starts at 3/s, +1/s per full second of unbroken link,
  capped at 8/s (Blood Font parity). ANY break — range, ally topped off, an
  enemy forcing the snap — resets the ramp to base. Protecting the link is
  the team's job; breaking it is the dive's whole purpose.
- 1v1: degrades to a feeble damage beam by design — a loadout choice, not a
  trap (free practice use means nobody pays to discover this).
- Monetisation posture: a support *role*, not a stat advantage — sits inside
  the never-a-flat-paid-advantage rule the same way spells do.
- Bot-facing note (tuning question, not launch-blocking): high-tier
  focus-fire already prefers weakest — a beam-healed target stops being
  weakest, which naturally drags bot attention around. Watch whether an
  explicit healer-priority rule is needed; do nothing until observed.

---

## Launch spells

All three join ABILITIES with the standard lifecycle (charges + cooldown,
LOADOUT_ABILITY_COUNT stays 2 — a spell slot is a real cost, which is the
balance backstop for all of them).

### Sinkhole — the group-displacer *(was Gravity Well; renamed desert-native —
"gravity" read sci-fi beside Blood Font and War Drums)*

Nothing in the roster displaces *groups*; every zone we have is stand-here.
Thrown ~200px along the facing (Warding Shout's aimable-so-whiffable rule);
a deployable that **pulls everything** — both teams — toward its centre with
strength ramping over 4s.

- radius 260, total life ~6s (4s ramp + 2s at peak). Pull is knockback
  plumbing with the sign flipped: an inward accel ramping 60→360 px/s²,
  with the resulting inward speed capped ~240 (under PLAYER_MAX_SPEED 280 —
  at full strength you can still *barely* walk out at the rim; dash always
  escapes). No damage — it's a setup piece (a sinkhole feeding a teammate's
  bombard is the combo the store can sell on sight).
- category offensive, charges 1, cooldown 16.
- Bot-facing: zone-awareness pass — treat like a tremor zone (leave early,
  don't fight uphill against the pull).

### Tar Pit — the creeping zone *(was Pitch Barrel; the zone is the item,
not the barrel you throw)*

Reworked from a cut (Tom, 2026-08-09): not a big instant slow field (that
was Tremor's job) but a **slowly expanding** one — placed small, it creeps
outward and *zones off part of the map*, and everyone watches the arena
shrink. Costing a spell slot is the point: knowing when to pour it is the
skill.

- Dropped at the facing offset (straw-man drop rules). radius 80 growing
  ~20px/s to cap 400 (~16s to full bloom), lifetime 30s, **no damage**,
  slowFactor 0.7 on EVERYONE inside — both teams; pitch doesn't care whose
  boots. Self-inclusive slow is what makes placement a decision, not a bomb.
- category support, charges 1.
- Render wins already on the shelf: the blood splat-map bake is exactly the
  tech for a spreading black slick, and the bloody-footprints system
  (squelch bank included) gives sticky pitch footprints nearly free.
- Future hook, noted not built: pitch is flammable — a later fire-flavoured
  drop igniting a slick is an item-synergy moment that advertises both.
- Bot-facing: same avoidance class as tremor (don't loiter, don't flee
  through it), plus don't path the flee route across a slick.

### Titan's Draught — the moment *(was Elixir of Giant's Growth; renamed to
keep the drink fantasy and step clear of MTG's "Giant Growth")*

The cheapest spectacle of the seven: drink, grow, hit harder — and become a
bigger target for every telegraph in the game, which is the built-in
downside that keeps it honest.

- Self-buff, duration 5s: sizeFactor 1.6 (radius 18→~29, crowd/hit circles
  scale with it), damageFactor 1.35. Nothing else — no speed, no armour;
  the trade is pure reach-and-power vs hittability.
- category offensive, charges 2, cooldown 14.
- A giant mid-arena is the kill-feed advert (the rented-steel logic from
  bits-store.md): every opponent who sees one has seen the store.

---

## The drop pool (post-launch, in rough order)

1. **Boomerang — FIRST DROP (Tom, 2026-08-09).** Pierces through enemies,
   returns along its path, wall-hits bounce it home, and you can't fire
   again until it's back — a built-in rate limiter that makes tuning
   forgiving. Held from launch deliberately so month one has a marquee
   weapon ("the weapon that comes back" as the first content drop).
2. **Poison Dart Gun** — nearly free once the dagger ships PoisonConfig
   (poison + a stacking slow at range), but launching both poison items at
   once muddies each identity; and its slow treads near the hammer's — tune
   with distance.
3. **Ballista** — the best fantasy in the candidate list and the highest
   risk: a stand-still siege weapon in a game whose defensive language is
   dash-and-strafe needs real playtesting, and deploy/undeploy movement
   states (deploy after 1s still; slow-then-recovering movement if you
   break setup) are the biggest weapon-engine lift proposed. A flagship
   drop, not a launch gamble.
4. **Chain Lightning** — great spectacle; arcing through *allies* would
   introduce friendly fire (a rule the game doesn't have) so the buildable
   version arcs enemy-only with damage falloff per jump — which is weak at
   1v1. A 3v3/4v4-era drop.
5. **Turret/Guardian spell** — Straw Man plumbing plus an acting brain;
   "deployable that attacks" needs its own counterplay design first.

## Cut, for the record *(2026-08-09)*

- **Ice/rock wall** — dynamic obstacles mean mid-round flow-field rebuilds,
  auto-target occlusion, and bots pathing into it: an engine project wearing
  a spell's clothes. Revisit only as its own project.
- **Wobbling orb** — a worse-telegraphed staff shot; not a Writ's worth of
  identity.
- **Teleport-to-ally** — cheap but low desire, dead at 1v1, and
  repositioning is dash's territory.
- **Fire/water expanding wave** — sat between staff zoning and Tremor
  without beating either; its expanding-ring idea lives on in Pitch Barrel's
  bloom (and a future fire drop can inherit the flavour).
- *(The Lifeline and Tar Pit were cut in the first triage — as "Healing Gun"
  and "Pitch Barrel" — and rescued by Tom's redesigns: the enemy-snap and
  the creeping expansion respectively, both recorded above.)*

## Build order (proposed, smallest-first; Healing Gun last)

1. **Poison system + Fang** — smallest item, ships PoisonConfig + the green
   ring for everything after. **BUILT 2026-08-09** (protocol v21): core
   `StackingDotState`/`applyStackingDot`/`stepStackingDot` beside DotState;
   fang in WEAPONS (60px / 35° / 0.15+0.3s cycle / atk 5 after Tom's
   device pass / poison 4×3@1s, 5s clock after the venom pass — full
   stacks out-drip a Blood Font) + WRIT_WEAPONS + ITEM_NAMES (the
   shelf's `/store` list grew it automatically); poison applied like the
   slow (no rng draw, no Ironhide gate — a damage rider like bleed),
   stepped beside stepDots, cleared on round reset + respawn; snapshot
   `poisonLeft`+`poisonStacks`; acid-green status ring (#a2c437, fixed
   width) between bleed and taunt (taunt/mirror stepped out 4px) with the
   STACK read as a greening body wash (alpha 0.11/stack over the team
   colour — Tom rejected stack-scaled ring width, it stole ring radius),
   green ambient tick numbers (no ring/
   haptic/strike-SFX, the bleed rules); codex card + POISON chip; practice
   wizard now shows writ items to everyone via `sortedWeaponIds(entitled,
   practice)` + `LobbyClient.practice` (the flagged catalogue gap); Deed Map
   fang chain (Just a Scratch / Venomous / The Adder's Kiss — placeholders)
   with the glory/healing clusters shifted down a row. Owed: forge icon
   (blade.png stands in), `hit_fang_1` SFX (rows auto-derived on the forge
   checklists), on-device feel pass, and the tuning pass.
2. **Scorpion** — the `burst` attack field. **BUILT 2026-08-09** (protocol
   v22): `BurstConfig` on WeaponConfig (sim-side, beside `projectile`) —
   the struck instant looses bolt 1 via a shared `fireShot` helper, then
   follow-ups fire on their own clock DURING recovery (before the cycle
   step, so the arming tick never advances the clock), each re-aimed at
   the mark's live position; the volley dies EAGERLY the moment the mark
   dies or smokes (windup-lock rules). Bolts ride snapshots as projectile
   kind `scorpion` (bots' in-flight dodge reads them free; Mirror Guard
   reflects each individually), drawn as a shorter thinner dart. Codex:
   VOLLEY/BOLT chips + the DAMAGE bar shows `3×8` and normalises on the
   volley total (a per-bolt bar would lie). One `shoot` event per bolt →
   `fire_scorpion_1` plays three times ~0.13s apart (forge ONE dry clack).
   Owed: forge icon (bow stands in) + fire/hit SFX, on-device + tuning
   pass. Deed chain (Three of a Kind / Bolt-Counter / The Rain of Barbs,
   placeholders) — glory/healing clusters shifted again (975 → 1090).
3. **Bombard** — lob timer + landing telegraph; sandtrap blast + trident
   minReach reused. **BUILT 2026-08-10** (protocol v23): `ShellConfig` on
   WeaponConfig + an `ArenaShell` state entity — launched at the mark's
   fire-time position, lands on a fixed 0.9s clock, NO collision in
   flight; snapshots gain `shells` (launch/landing points + clock + blast
   radius — the client's telegraph ring at true blast size for BOTH
   teams, firming as the shell falls; shell sprite arcs on a derived sine
   hump, interp passes rows straight through like deployables). Blast is
   the sandtrap detonate idiom (fixed 22 via applyFixedHit so Ironhide
   tanks it, dash i-frames dodge it, radial 400 shove, reuses the detonate
   event's boom FX/SFX) — amended 2026-08-10 after Tom's play pass: the
   blast hits EVERYONE in the zone, self and allies included (the game's
   first friendly fire, deliberately scoped to this weapon). Blast numbers are
   copied onto the shell BY VALUE at launch (a freed seat mid-flight
   can't orphan it). minReach 120 = the close-quarters dead zone chip
   (DEAD ZONE, not the trident's BITE). Codex DAMAGE bar reads
   shell.damage. Owed: forge icon (sandtrap charge stands in) +
   fire/hit SFX (subjects in the styleBible), on-device + tuning pass,
   and the BOT shell-dodge pass — bots read snapshot projectiles but not
   shells yet, so practice bots currently eat every shell. Deed chain
   (Fire in the Hole / The Long Arm / Rain of Ruin, placeholders);
   glory/healing shifted again (1090 → 1205).
4. **Sinkhole** — inverted-knockback pull zone.
5. **Tar Pit** — growing zone + slick/footprint render.
6. **Titan's Draught** — buff + scale plumbing.
7. **Lifeline** — the core `beam` attack shape; biggest lift, so last, with
   the six others already banked for the shelf if time bites.

Each item's done-tick (the standing new-content tax): WRIT_* + ITEM_NAMES
registry rows, catalogue card (icon + flavour quote + stat bars), forge icon
+ cast/hit SFX per bits-audio.md, Armory hero art per bits-art-style.md,
codex copy, zone-awareness pass where flagged, and a protocol bump where
snapshots grow fields (poison stacks, beam links, sinkhole/tar zones,
bombard impact markers, size factor).

## Open questions (deliberately undecided)

- ~~Names~~ — **DECIDED 2026-08-09** (Tom picked from shortlists): the seven
  above, plus **Boomerang keeps its own name** (the marquee "weapon that
  comes back" drop sells on instant recognition).
- **Numbers** — every figure above is first-pass; the on-device tuning pass
  per item is where they get real.
- **Healer-priority bot rule** — observe first (see Lifeline note).
- **Tar ignition** — which future fire item lights a Tar Pit, if any.
