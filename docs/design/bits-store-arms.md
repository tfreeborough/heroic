# BITS — The Writ Shelf: launch arms & the drop pool

Status: **designed 2026-08-09 · Fang (v21) + Scorpion (v22) BUILT 08-09,
Bombard (v23) + Sinkhole (v24) + Tar Pit (v25, redesigned to a TRAIL)
BUILT 08-10, Titan's Draught (v26) BUILT 08-11 — only the Lifeline owed** ·
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

- Lobbed projectile, physical. reach 360 — ties the bow (settled after a
  400 → 360 → 380 → 360 device pass, Tom 2026-08-10). Camera outcome: the
  **UNIVERSAL follow zoom** — every camera, every loadout, fits the
  roster's longest range ring across the screen width (derived from the
  WEAPONS table, so reach retunes re-fit it automatically). Born as a
  bombard-only artillery zoom and made universal the same day: a
  per-weapon zoom handed ranged players a wider view than melee — an
  information advantage nobody chose (Tom's fairness call).
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

- radius 260, total life ~6s (4s ramp + 2s at peak). The pull is a
  **position drag**, not a velocity impulse *(discovered at build: the
  mover's idle damping — PLAYER_DECEL 2800 — crushes any added velocity
  before it moves a body, so a force-based pull literally cannot budge an
  idle player)*: an inward drag speed ramping 60 → 240 px/s, always under
  the 280 sprint, so running straight out nets 40 px/s at full strength —
  barely — and dash always escapes. No damage — it's a setup piece (a
  sinkhole feeding a teammate's bombard is the combo the store can sell on
  sight).
- category offensive, charges 1, cooldown 16.
- Bot-facing: zone-awareness pass — treat like a tremor zone (leave early,
  don't fight uphill against the pull).
- **BUILT 2026-08-10** (protocol v24) — the first WRIT ability, so this
  build also grew the ability side of gating: FREE_ABILITY_IDS genuinely
  excludes an id for the first time (literal list in config — a runtime
  import cycle forbids reading items.ts; items.test.ts keeps the two files
  honest), `abilitiesByCategory(cat, entitled, practice)` mirrors the
  weapon picker's writ/practice split, and the server's setAbilities gate
  (built ready with the trident) now has a real id to catch. Deployable
  kind `sinkhole`, thrown along the facing clamped into the sand, drag in
  stepDeployables (both teams, Ironhide immune, dash-skipped, never
  crosses the centre); vortex render = honest boundary + darkening throat
  + INFALL LINES streaming rim → throat, quickening with the ramp (arc
  sweeps cut on Tom's device pass — the lines are the show; their phase
  is the closed-form INTEGRAL of the speed curve, never time/speed with a
  changing speed — the statusRings lesson, it strobed). Cast telegraph
  (Tom, same pass — the bombard's grammar): the cast THROWS A POT arcing
  to the spot over a 0.6s arm window under a closing ground sweep, THEN
  the hole opens — deployable armLeft carries it (no pull while arming,
  no protocol change; active duration preserved by seeding lifeLeft
  duration+arm). Deed chain (Undertow / The Ground Hungers / The Swallowing Sands,
  placeholders) joins the offensive cluster — ability rows reflowed.
  Owed: forge icon (sandstorm swirl stands in) + cast_sinkhole SFX,
  on-device + tuning pass, bot zone-awareness. NOTE for the tuning pass:
  the test arena taught us the 260-radius hole's 520px diameter is a THIRD
  of the real arena's width — on-device, watch whether radius or the
  1-per-round charge is the right lever if it dominates.

### Tar Pit — the trail you paint *(REDESIGNED at build, Tom 2026-08-10:
was "the creeping zone" — a placed circle expanding over the round. Tom's
call: too close to "ANOTHER circular ability"; instead the caster RELEASES
TAR BEHIND THEM as they run — the roster's only movement-expressed
ability, an anti-chase tool whose placement is literally your own path.
Original creeping-zone design below kept for the record.)*

**As built (v25):** cast opens a 2.5s laying window — a tar blob drops at
the feet plus one per 80px travelled (sprinting the window lays ~700px of
trail; standing still lays one puddle). Each blob spreads 20 → 60px over
1.5s, **grips for the REST OF THE ROUND** (Tom's second pass, same day:
thrown tar doesn't dry mid-fight — lifetime went 20s → round-long), and
slows EVERYONE inside 30% — both teams, the caster's own doubling-back
included (the spares-no-one rule). **The round reset stays the mechanical
clean-slate**: live tar never crosses it — instead the client DRIES each
cluster into a permanent matte stain (alpha 0.18 vs live 0.88 — Tom
faded it further same day: history, not signage; dark and glossy grips,
faint ghost is safe) baked
into an accumulating picture that persists ALL MATCH, the blood-scar
rule. Cross-round LIVE tar was considered and DECLINED: rounds snowball
into a maze, and tarring the enemy spawn late in a round is a degenerate
line nobody should lose to. Dash i-frames skip
it, Ironhide shrugs it. SUPPORT (recategorised from defensive same day,
Tom: terrain-shaping is the War Drums family), 1 charge, cooldown 14. Blobs are
deployables (kind `tar`) so rejoin/late clients resync free; ~9 blobs per
cast is the snapshot weight to watch. **Visuals (Tom: "sticky and chaotic
like the blood splatter", never circles):** client-side TarField (tar.ts)
on the blood system's own primitives — each sim blob grows a SEEDED SPLAT
CLUSTER (irregular wobbled body + satellite spatters breaching the rim +
outward teardrop streaks, frozen at birth, scaled live on the sim's exact
growth curve, wet sheen while spreading, dry-out fade on expiry) — plus
black droplets SPLUTTERING off the caster's heels through the laying
window, landing as capped long-lived specks. Deliberately NO splat-map
bake: blood bakes because of thousands of decals; ≤ ~10 clusters draw
live for nothing (revisit only if counts grow). Deed chain (Slow Going /
Black Wake / The Unfollowable, placeholders). cast_tar_pit forged as a 3-take random bank (2026-08-10). Owed: forge
icon (blood font stands in; subject = toppled cauldron pouring tar),
on-device + tuning pass, bot zone-awareness (the standing bucket).
ALSO fixed at this build: practice bots drafted hands from ABILITY_IDS,
not FREE_ABILITY_IDS — harmless until abilities gated, a leak since the
sinkhole; server-side fill was already correct.

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
- **BUILT 2026-08-11** (protocol v26): a status ability (the Ironhide
  family — the active window IS the effect), zero new wire shapes. Sim:
  `radiusOf(p)`/`damageFactorOf(p)` in statuses.ts — hurt circles, target
  views, and the mover's crowd/wall radius (re-stamped idempotently each
  tick) all read the grown size, so a titan is honestly bigger to every
  arc, bolt, blast and shove; `resolvePlayerHit` now takes the attacking
  PLAYER and folds outgoing ×1.35 beside Ironhide's incoming reduction
  (same rng draws either way — the stream never forks on a buff, verified
  by a same-seed test); a bombard shell stamps titan damage at launch.
  Damage factor deliberately touches WEAPON damage only — fixed ability
  numbers and dot riders never scale (the venom is the venom). MELEE
  REACH scales too (Tom's play pass, 2026-08-11): without it the grown
  crowd radius shoved enemies out while reach stayed fixed — melee
  giants got WORSE at their own range. Arc weapons only, reach AND
  minReach ×1.6 (bands keep their character; note: a giant trident's
  band outgrows dash's 75px hop — the dash-inside-the-prongs escape
  doesn't clear a titan's band); a giant's bow is the same bow, which
  keeps ranged balance and the universal camera fit intact. Client:
  body + every ring derive from a grow-in-eased radius read off the
  slot's broadcast active window (0.25s swell, pop back on expiry) —
  but telegraphs/range rings scale INSTANTLY (the sim doesn't ease;
  the drawn promise never under-states the strike). MENACE PASS (Tom,
  same day — "oh crap, run away"): the drink lands as a 70px tremor
  crack-slam, every ~90px stride fractures the ground (38px webs,
  permanent like all scars), and the giant presses a heavy contact
  shadow into the sand — ordinary bodies float, titans have WEIGHT. Deed
  chain (A Head Taller / Giant's Thirst / The Colossus of the Pit,
  placeholders) joins the offensive cluster. Owed: forge icon (ironhide
  stands in; subject = stone drinking horn) + cast SFX, on-device pass.
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
