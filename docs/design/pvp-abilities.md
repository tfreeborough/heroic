# Blood in the Sand — Abilities

Status: **agreed direction 2026-07-12 — numbers are first-pass, untested** ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-07-12

> Players pick **one weapon + one ability** in the lobby. Dash — until now the
> universal defensive tool — becomes one of the picks (Tom, 2026-07-12). The
> dash button *becomes* the ability button: one input, whatever you picked.
> This doc records the ten-ability roster, each ability's identity (name /
> description / icon / cast sound), first-pass numbers, and which sim systems
> each one reuses — so implementation starts from an agreed sheet.

## The design lens

Nothing in this game is aimed — no aim is networked, weapons auto-fire at the
auto-target, and fights are read through telegraphs (see
[pvp-arena](./pvp-arena.md)). So the interesting ability space isn't skill-shots;
it's **targeting, positioning, and timing**:

- **Zones** make ground matter (stand here / don't step there).
- **Target-pool tricks** (deny targeting, pollute it with decoys, drag a target
  to you) are this game's version of stealth and displacement.
- **Timing windows** (reflect up at the right moment, tank the hit you chose
  not to dodge) reward reading the same telegraphs dash already rewards.

Every ability below is deterministic (fixed numbers, no new RNG draws — the
`BleedConfig` fixed-damage pattern) and auto-target-native (self-cast, cast at
your feet, or fired at your current auto-target).

## The pick model

- Lobby pick: **1 weapon + 3 abilities** (Tom, 2026-07-12 — was 1 ability in
  the first draft). No duplicate abilities within a loadout; across players,
  duplicates are fine (same rule as weapons). The four picks ARE the build.
- **Three ability buttons** in the button column (which was built as "a column
  ready for 3 power buttons" — this is that). Pick order = button order, so
  arranging the kit is part of picking it. Presses latch between ticks exactly
  like dash today; `PlayerInput.dash` generalises to three latched ability
  flags.
- **Dash is a pick, not a given.** That deliberately makes "can I dodge this?"
  a lobby question — though with three slots, most loadouts will find room for
  it. Abilities that are hard to dodge (Harpoon) are balanced by cooldown and
  range, not dodgeability.
- Categories exist to help the pick UI read at a glance: **Offensive /
  Defensive / Support**. Current split is 3 / 4 / 3 (dash lands in Defensive);
  rounding out to 4 / 4 / 4 later is expected, not required.
- **The ability economy (DECIDED Tom, 2026-07-15, replacing the cooldown
  caveat):** three concurrent cooldowns made an ability spam-fest, so every
  ability now has a **finite number of charges that replenishes every round**,
  with the existing cooldown kept as the between-use gate. Spam is capped by
  the budget, back-to-back dumping by the cooldown, and nothing snowballs
  across rounds — a lost round never leaves you resource-starved for the next.
  First-pass budgets: **dash 4** (the metronome pick keeps the fattest
  wallet), **Mirror Guard / Ironhide / War Drums 3** (Tom, 2026-07-15 —
  the self-statuses can afford more swings), **blood font 1** (healing is
  enormous in a one-life mode), everything else **2**. Buttons show charge
  pips; a spent slot goes dark until the round reset. Charges ride
  `AbilityRuntime.chargesLeft` (rebuilt with the slots each round) and the
  slot snapshot.

### Picker UI (agreed via mockup, 2026-07-12)

- Lobby shows **two loadout slots** (WEAPON · ABILITIES); the abilities slot
  holds three mini icons. Tapping a slot opens a **bottom sheet**.
- Ability sheet: category-grouped card grid (colour-coded: red/steel/green)
  with a **3-slot tray pinned at the top** — tap a card to fill the next slot,
  tap a tray slot to clear it, list dims at 3/3, LOCK IN closes.
- Every card has a **? → codex** pane (slides sideways inside the sheet):
  flavour quote → brief factual overview → stat bars (weapons) / number chips →
  **raw effect data**. Copy rule (Tom): no superlatives, no cross-roster
  comparisons, no counterplay prose — nothing that rots as the roster grows.
  All numbers render from the sim config tables at runtime, never hand-copied.
- One shared `LoadoutSheet` component serves both the room lobby and Practice.

### The draft: pick → reveal → counterpick (Tom, 2026-07-12)

> **SUPERSEDED 2026-07-14** by the guided loadout flow
> ([pvp-loadout-flow](./pvp-loadout-flow.md)): casual testers bounced off the
> draft, so the default lobby becomes a weapon → 1 → 2 → 3 pick wizard with
> server auto-start and *no reveal* — enemy loadouts show only through
> in-game iconography. Kept for the record; ranked-mode candidate.

The host pressing START begins a four-beat draft, not the match:

1. **Blind pick (30s).** Everyone builds their loadout. Allies see each
   other's picks **live** (weapon icon + 3 ability mini-icons) plus a
   League-style **lock check**; the enemy column shows *only* the lock
   checks. Explicit **LOCK IN button** (it gets its own cast-worthy SFX —
   locking is a moment). Radial countdown ring depletes as time runs out,
   red for the last 10s. At zero: empty slots get **random fills**,
   everyone auto-locks. All locked early → phase ends early.
2. **The reveal.** A staged full-screen moment: the enemy team's locked
   loadouts flip up one by one (name + weapon + 3 ability icons), with its
   own reveal SFX. Both teams see each other simultaneously.
3. **Counterpick (30s).** Picking reopens knowing what they locked. The
   enemy roster keeps showing their *phase-1* picks with a "they may
   change" caveat. **Counterpick changes are hidden** — the reveal is
   intel, not a promise. The double-bluff is the game: counter theirs, or
   hold, knowing they're countering yours. Same lock/timeout rules.
4. **To the sand.** Final (possibly surprising) loadouts meet in round 1.

- Scout-proofing is a **server rule, not a client courtesy**: during pick
  phases the server sends the enemy team only lock states; the reveal is a
  one-time broadcast of phase-1 locks; counterpick edits are never sent
  cross-team. A modified client can't show what it never received.
- Sim/rooms impact: the room machine grows draft phases between "lobby" and
  "countdown" (phase + timer already exist in `RoundState` — the draft is
  more of the same shape). Practice mode skips the draft (no one to hide
  picks from) and keeps the plain sheet-then-play flow.
- **BUILT END-TO-END 2026-07-12** on the weapons pick ceremony's machinery
  ([pvp-pick-ceremony](./pvp-pick-ceremony.md)):
  - *Sim:* `pick` RoundPhase, `startMatch(sim, events, { pickSeconds,
    adjustSeconds })`, per-player `lockInPlayer` (complete-loadout gate,
    all-connected-locked ends a phase early), `setPlayerAbilities` (3
    distinct, button order), deterministic auto-fill of weapon + hand at each
    reveal, per-team ability filtering in `toRoomStatePlayers`.
  - *Wire/server:* `setAbilities` + `lockIn` messages; `startByHost` runs the
    full timed draft (`PICK_PHASE_SECONDS` + `REVEAL_ADJUST_SECONDS`).
  - *Client:* `LoadoutSheet` (bottom sheet, 3-slot tray, per-item codex with
    config-derived weapon stats), `RoomScreen` = the draft screen (team-split
    roster with lock checks, loadout slots, Skia radial pick timer, staged
    reveal overlay, LOCK IN with haptic — real SFX owed via Asset Forge),
    placeholder Skia line-glyph icons (`loadout/icons.tsx`, Asset Forge art
    owed).
  - *Practice runs the identical draft* (Tom: solo-testable on dev builds) —
    the bot drafts, locks, and bait-swaps in the counterpick on its own
    clock. Verified headlessly: full draft → counterpick → fight.
  - Match-side ability *effects* **BUILT 2026-07-14** (protocol v8, see "New
    sim machinery" below) — all ten castable, three buttons in the column.
    Still owed: the cooldown re-tune for 3-ability loadouts, per-ability cast
    SFX (Asset Forge), and real button/ability icon art (line glyphs stand in).

## Roster at a glance

| # | Ability | Category | Shape | Cooldown | Charges/round |
| --- | --- | --- | --- | --- | --- |
| 1 | Sandtrap | Offensive | deployable (explosive) | 10s | 2 |
| 2 | Tremor | Offensive | deployable (quake zone) | 9s | 2 |
| 3 | Harpoon | Offensive | instant chain (own lock-on) | 12s | 2 |
| 4 | Dash | Defensive | committed move + i-frames | 3s | 4 |
| 5 | Mirror Guard | Defensive | self status | 12s | 3 |
| 6 | Ironhide | Defensive | self status | 12s | 3 |
| 7 | Straw Man | Defensive | deployable (taunt decoy) | 14s | 2 |
| 8 | War Drums | Support | moving ally aura | 12s | 3 |
| 9 | Blood Font | Support | deployable (heal zone) | 16s | 1 |
| 10 | Sandstorm | Support | deployable (no-target zone) | 14s | 2 |
| 11 | Warding Shout | Defensive | instant cone peel | 7s | 3 |

Dash's 3s cooldown and four charges are deliberately the cheapest in the set:
it's the metronome pick — small value, often (but no longer *constantly*).
Everything else is a moment — big value, once or twice a round.

---

## Offensive

### 1 · Sandtrap

> *"Bury a powder charge beneath the sand. Two breaths to arm — then the
> ground itself turns on them."*

- **Flavour REVISED (Tom, 2026-07-15, after play):** an **explosive charge**,
  not a small blade trap — and sized WAY up. The blast is the identity now.
- **Mechanics:** buries a charge at your feet. Arms over **2s** (status circle
  counts it down), then erupts when any enemy enters the trigger radius.
  One live charge per player — placing a new one fizzles the old.
- **Numbers:** trigger radius **120px** · blast radius **240px** · damage
  **30 fixed** (no crit/defense — deterministic, like bleed ticks) · radial
  knockback impulse **700 px/s** · lives until triggered or round end.
  (Blast tuning walk: 90 → 160 → 320 → settled at **240**, Tom 2026-07-15
  "meet in the middle"; trigger settled at 120; was 40/90/500 at first build.)
- **Readability rule (REVISED Tom, 2026-07-14; was clearly-visible-to-all,
  2026-07-12):** the sandtrap is now the one deployable with **team-dependent
  rendering**. Your own team sees a clear, steady marker (it's your resource —
  one live mine, you need to know where it sits). To the **enemy** it's faint:
  a very dim trigger-radius ring plus a brief glint **every ~3s** — hard to
  spot in the middle of a fight, findable when nothing is going on. Counterplay
  shifts from "you can always see it" to two honest reads: the **plant is
  still telegraphed** (the cast + a dim arming arc for its 2s), and a calm
  moment lets you **scan for the glint**. Built as described (flash period
  3s, ~0.3s sine envelope, per-mine phase offset so two mines never blink in
  sync; spectators get the faint view of both teams).
- **Icon:** a glinting spike-trap half-buried in a sand mound.
- **Cast SFX:** gritty scoop of sand ending in a muffled metallic *click*.
  (Detonation is its own sound: sharp snap into a dry boom.)
- **Reuses:** new `Deployable` entity (below) · fixed-damage pattern from
  `BleedConfig` · knockback impulse from core.

### 2 · Tremor

> *"Split the earth beneath them. The ground gives way — and they are slow to
> leave it."*

- **REWORKED (Tom, 2026-07-17, thematic pass):** the instant slam is gone —
  tremor is now an **earthquake zone**: cast instantly at your feet, it shakes
  a wide circle of ground for its duration, chip-damaging and **slowing**
  every enemy inside. Pure **zoning** — hold a choke, guard a Blood Font,
  punish a dogpile by making the ground itself hostile. The old slam's peel
  role moved whole to **Warding Shout** (#11).
- **Mechanics:** the zone is **fixed where you stood** (it does not follow
  you). Enemies inside take fixed chip damage on a 1s tick and are slowed
  while they stand in it; the slow lingers ~0.3s past stepping out (a
  per-step refresh of the hammer's slow plumbing — **strongest factor wins**
  while a hammer slow overlaps). Dash i-frames dodge ticks and the slow
  refresh; Ironhide takes reduced ticks and ignores the slow.
- **Numbers:** radius **240px** (sized to genuinely zone — Sandtrap-blast
  big; was 110 as a slam) · duration **4s** · damage **3 fixed per 1s tick**
  (12 total — the old slam's burst, paid out over time, and deliberately
  *under* a Blood Font's 8/s heal: a quake pressures a font, it doesn't
  negate one) · slow **×0.75** move speed while inside.
- **Floor + VFX:** the cast still fractures the sand at the epicentre
  (cracked-earth decals, the blood-trail rule), and while the zone lives,
  **big crack bursts pop at random points inside it every ~150ms** (~27 over
  the life — enough to shatter most of the circle) — client-derived from the
  zone's presence in snapshots. Every quake crack (epicentre + pops)
  **persists past the zone and fades over ~20s** (Tom, 2026-07-17 second
  pass; per-decal TTL on `cracks.ts`, decal cap raised to 128 — the draw
  pass viewport-culls, so only the visible subset costs). An honest boundary
  ring marks the true edge, with a fast low-amplitude shudder (the font
  *breathes*; the quake *shakes*).
- **Icon:** unchanged — the stomping boot with cracked-earth rings still fits.
- **Cast SFX:** the existing sharp stomp stays as the cast tell. The quake
  itself gets its **own clip** (Tom, 2026-07-17): `quake_rumble`, a ~4s
  rolling earthquake bed fired alongside the cast (Forge, owed — silent
  until it lands, the catalogue rule).
- **Reuses:** the `Deployable` entity (a quake is Blood Font inverted: fixed
  ticks, enemies-only, zone at the caster's feet) · the hammer's
  `slowLeft`/`slowFactor` plumbing · `cracks.ts`.

### 3 · Harpoon

> *"Hurl a barbed harpoon at your mark. It does not miss, and it drags them
> straight to you."*

- **REWORKED (Tom, 2026-07-15, after play):** the projectile version whiffed
  constantly against ordinary strafing and was "too annoying to use". Now it's
  an **instant chain**: no flight time at all — the cast latches a mark (no
  mark in chain range, no cast), the near-zero windup plays, and the chain
  lands the moment it closes as **one complete line with a hook on the end**.
  Auto-locked, not dodgeable by movement.
- **The REEL (Tom, 2026-07-15, second pass):** landing doesn't teleport the
  victim — it starts a **haul**: they're dragged toward the caster at
  **360 px/s** (faster than a sprint, dragged *against their will* — their
  own input does nothing) while the **caster stands ROOTED**, pulling ("it
  doesn't make sense for the caster to still be able to move"). The chain
  **snaps** if: the victim gains dash i-frames (the roll cuts it) or Ironhide
  mid-haul · the **caster dashes** (letting go is the caster's out) · either
  side dies · line of sight breaks (geometry cuts it) · a 2.5s safety timeout
  (snagged on a corner). Arriving at the gap plants the victim. The taut
  chain renders for the whole haul (snapshot `reeling` field).
- **The three answers, by design:** dash **i-frames** — at the landing moment
  OR mid-reel — cut the chain · **Ironhide** blocks the haul (still counter-
  pick #1) · **Mirror Guard reflects it** — the guard catches the chain and
  **yanks the caster in instead** (instant: the guard isn't rooted by someone
  else's harpoon), barb damage included.
- **Numbers:** windup **0.1s** · landing **instant** · reel **360 px/s**,
  max **2.5s** · max range **550px** (checked at cast — a gated press costs
  nothing) · damage **8 fixed** · the haul ends **50px** in front of the
  puller.
- **Own lock-on (Tom, 2026-07-15):** 550px is past every weapon's engagement
  radius, so the harpoon **acquires its own mark at press time** — the current
  auto-target if the chain reaches it, else the nearest visible enemy (player
  or straw man) in chain range. LOS and sandstorm rules apply exactly as in
  weapon targeting; weapon lock-on distances are untouched.
- **Icon:** a barbed hook trailing a taut chain.
- **Cast SFX:** whip-crack launch with rattling chain; on hit, a meaty *thunk*
  and a dragging scrape through sand.
- **Reuses:** `targetView` for the mark · the wall-sampled pull · a transient
  `harpoon` event carries the chain-line endpoints for the client flash (drawn
  even on an i-frame whiff — the chain whips through empty air).

---

## Defensive

### 4 · Dash

> *"A short, sharp burst of speed — and a heartbeat where nothing can touch
> you."*

- **Mechanics & numbers:** exactly today's dash — **75px** hop over **0.1s**,
  **0.2s** i-frames, bowling-ball shove (46px sweep, 840 px/s cap), **3s**
  cooldown. Now a pick.
- **Icon:** three chevrons behind a motion-blurred figure.
- **Cast SFX:** tight whoosh over a scuff of kicked sand.
- **Reuses:** everything — it's the worked example the ability slot
  generalises from (`DashState` → per-ability state, see below).

### 5 · Mirror Guard

> *"Raise a polished shield. Arrows and orbs fly back where they came from.
> Swords, sadly, do not."*

- **Mechanics:** for the duration, any projectile that hits you is **reflected**:
  its `ownerId` becomes you, it retargets the original shooter with strong
  homing, damage unchanged. Melee passes straight through the shield — this is
  the counter-pick to bow/staff comps, not a panic button.
- **Numbers:** duration **2s** · cooldown **12s** · reflected shots get
  `homingTurnRate` **4 rad/s** (staff orb: 2.2) so the return fire is a real
  threat, not a gesture.
- **Body-effect ring:** pulsing ring just outside the player disc for the
  duration (see *Visual language*).
- **Icon:** a shield with an arrow bouncing off at a hard angle.
- **Cast SFX:** bright crystalline *shing*; each reflect adds a metallic ping
  with a reversed whoosh.
- **Reuses:** projectiles already carry `ownerId` + optional homing — the
  reflect is a field swap, not a new system.

### 6 · Ironhide

> *"Turn your flesh to iron. Shrug off blows, slows and shoves — but iron is
> heavy, and you'll move like it."*

- **Mechanics:** heavy damage reduction plus immunity to slow, knockback, and
  Harpoon's pull — but you're self-slowed while it's up. The opposite answer
  to dash: you don't dodge the hammer's telegraph, you *walk through it*.
- **Numbers:** duration **2.5s** · damage taken **×0.3** · immune to
  slow/knockback/pull · self move speed **×0.5** · cooldown **12s**.
- **Visual REVISED (Tom, 2026-07-15 — the pulse ring "didn't look cool
  enough at all"):** a proper **shield dome** around the player: translucent
  iron fill, a bold rim, and three plate arcs slowly orbiting the body,
  fading out over the last 0.4s. Replaces the body-effect ring for this
  ability only (Mirror Guard keeps its ring).
- **Icon:** a flexing arm turned to cracked iron.
- **Cast SFX:** grinding stone resolving into one deep, settling clang.
- **Reuses:** the slow plumbing (`slowLeft`/`slowFactor`) for the self-slow;
  damage reduction is a multiplier at `resolveAttack`'s call site.

### 7 · Straw Man

> *"Plant a convincing stand-in. Enemy eyes — and blades — snap to it while you
> slip away."*

- **REWORKED to a taunt (Tom, 2026-07-20, tester feedback):** the passive
  decoy underwhelmed — every tester who drew it said they'd repick. Root
  cause: as a plain nearest-candidate the lock hysteresis worked *against* it
  (it spawns at your feet — the same distance as you, never 15% closer, so it
  steals no locks), and being stationary meant enemies disengaged for free by
  walking on. The dummy now **forces** attention instead of politely offering
  itself.
- **Mechanics:** drops the dummy at your feet as before; every enemy inside
  the **taunt radius** of the drop point has their auto-target *forced* onto
  the dummy for the **taunt duration**. Feet stay free — a taunt hijacks aim,
  never movement. The forced lock releases early the moment the dummy stops
  being a valid mark for that enemy: it dies, a sandstorm smokes it, LOS
  breaks, or — the intended counterplay — the enemy **walks it out of their
  own weapon's engagement radius**.
- **Counterplay is two-lane by design:** burn it down (30hp ≈ 2 hits, so a
  taunted *group* shreds it in one swing cycle and frees itself — mass taunts
  self-cancel) or walk out of your own reach. A lone diver eats the full
  hold; a mob barely notices. That asymmetry is the point: an anti-dive peel,
  not a teamfight flip.
- **A moment, not a zone:** the taunt applies only to enemies inside the
  radius at the cast instant. Latecomers see a normal candidate dummy — no
  lingering CC field to overtune.
- **Mid-swing redirect (Tom, 2026-07-20):** a taunted enemy's *in-flight
  windup* retargets to the dummy too — the sword falls on straw. Cast it as
  the blow is coming down and you've bought the clutch save; the windup keeps
  tracking its (new) target exactly like any PvP windup, and the release
  range/cone rules are unchanged, so a swing can still whiff if its owner has
  walked the dummy out of reach.
- **Numbers:** taunt radius **310** (260 at first cut; bumped, Tom
  2026-07-20) · taunt duration **1.5s** · dummy hp **30** · lifetime **4s** ·
  cooldown **14s** · charges **2**. The radius is the balance dial: 310
  catches any melee in reach of you (blade 250, hammer 285) but a bow (380)
  or staff (340) at standoff distance never flips — it punishes divers, not
  shooters. The staff margin is only 30px, and that's fine (Tom, 2026-07-20):
  the melee/ranged line doesn't need to be crisp, because 30hp is the real
  guard — a flipped shooter just shoots the dummy down from where they stand
  (two bow hits) and is free. If it plays too strong, shrink radius or
  duration before touching anything else.
- **Client cue:** the victim's own aim ring snapping to the dummy carries
  most of the feedback; a per-player `tauntLeft` snapshot field drives a
  status-ring pulse (same plumbing as `slowLeft`/`bleedLeft`) so the flip
  reads as an effect, not a targeting bug. Protocol bump.
- **Presence pass (Tom, 2026-07-20):** the dummy is drawn BIG — a 24px straw
  body on a swaying cross-frame with arms past the disc, the painted chest
  target from the icon, and a taunt-yellow rim matching its victims' status
  ring (one colour = one story). Hurtbox unchanged (`PLAYER_RADIUS`): a decoy
  dressing bigger than it stands is honest advertising. Every hit it soaks
  throws a **puff of straw flecks** (client-derived from the hit event, like
  blood — never networked) so a redirected blow visibly falls on straw.
- **Icon:** a training dummy with a target painted on its chest (unchanged).
- **Cast SFX:** soft pop of dust with a canvas-and-rope creak, like a
  scarecrow snapping upright (unchanged — the creak now doubles as the
  "you've been taunted" cue).
- **Reuses:** `Deployable` entity · a `forcedTargetId`/`tauntLeft` pair on
  the player, consulted before `selectTarget` and validated by the same
  candidate rules (alive, LOS, sandstorm, own engagement radius) ·
  `resolveAttack` (a dummy is still just a combatant that can't act) ·
  status-ring plumbing for the victim cue.
- **Bots:** being taunted costs zero bot work — bots receive `targetId` from
  the same sim targeting step as humans. The `botCasts.ts` rule flips from
  paced to **reactive**: cast when pressured — enemies inside taunt radius
  with their lock on you (bot-brains.md cast-rule table needs the matching
  update).

### 11 · Warding Shout

> *"Fill your lungs and ROAR. The sand itself flees your voice — and so do
> they."*

- **NEW (Tom, 2026-07-17):** the old tremor slam's logic, promoted to its own
  defensive pick and reshaped from a circle into a **shout cone** — it comes
  out of your mouth, not your boots. Instant, no windup, **no damage**: every
  enemy caught in the cone in front of you is **hurled** back massively. The
  dedicated peel/panic button the roster lost when tremor became a zone — now
  aimable, and therefore whiffable: a shout you point wrong moves nobody.
- **Numbers:** range **170px** (a bellow carries further than the stomp's
  110 did — the cone pays for the reach and the hurl) · cone **90°** centred
  on facing · knockback impulse **2400 px/s** (the slam's 1500 "really hurl",
  turned up — *massive* is the identity) · damage none · cooldown **7s** ·
  **3 charges** (priced between dash's metronome and the big moments).
- **Counterplay:** dash i-frames ride straight through it · Ironhide plants
  (knockback immune, as everywhere) · standing **behind** the shouter is
  safe — flank the loudmouth. An enemy standing dead-centre on the caster is
  hurled along the facing (the slam's old rule).
- **VFX:** a white wedge flash blasting out to the true range on the cast
  event — client-derived, the honest-telegraph rule.
- **Icon (Forge, owed):** a helmeted gladiator head mid-roar, concentric
  shout rings bursting from the mouth. Tremor's boot stands in until forged.
- **Cast SFX (Forge, owed):** a huge chesty war-bellow with a bassy air
  punch. Authored as `cast_warding_shout` — silent until the clip lands (the
  catalogue rule).
- **Reuses:** the slam's radius resolve gated by a facing-dot-product cone ·
  `applyImpulse` (Ironhide immunity included) · the cast event drives the
  client cone flash, no new wire shape.

---

## Support

### 8 · War Drums

> *"Beat the drums. You and every ally in the circle surge while the rhythm
> lasts."*

- **Mechanics:** aura centred on (and moving with) you. You and allies inside
  gain a speed surge, re-checked per tick — step out, lose it.
- **Numbers:** radius **260px** (doubled from 130, Tom 2026-07-15 — a
  war-band's worth of ground, not a personal bubble) · duration **3s** · max
  speed **×1.35** · cooldown **12s**.
- **Visual (Tom, 2026-07-15):** the aura **drums** — beat rings pound outward
  from the drummer to the boundary at ~1.9 beats/s, two per cycle like
  alternating hands. The rings ARE the rhythm; the Asset Forge drum loop
  should lock to the same tempo when it lands.
- **Icon:** a war drum with radiating rings.
- **Cast SFX:** an accelerating drum loop — the sound IS the duration cue: the
  beat plays while the aura lives. Strongest audio identity in the set.
- **Reuses:** the slow plumbing, mirrored — a speed factor **>1** through the
  same max-speed multiplier path (`slowFactor` generalises to `speedFactor`).

### 9 · Blood Font

> *"Raise a font of lifeblood. Allies standing in its circle knit their wounds
> shut."*

- **Mechanics:** placed at your feet; allies (and you) inside heal on a fixed
  tick. Stationary on purpose — in a one-life mode healing is enormous, so the
  value demands holding ground: it *creates* fights over the circle.
- **Numbers:** radius **100px** · duration **4s** · **+4hp per 0.5s tick**
  (max 32hp for standing the full pour — about two weapon hits back) ·
  cooldown **16s** (longest in the set).
- **Visual (Tom, 2026-07-15):** the circle **pulses** on a slow heartbeat —
  the boundary ring stays fixed (the zone edge is information), the interior
  fill and an inner ring breathe.
- **Icon:** a chalice overflowing with red droplets inside a ring.
- **Cast SFX:** low choral hum under a liquid trickle.
- **Reuses:** `Deployable` entity · bleed-in-reverse (fixed tick, no RNG,
  interval/amount config shaped exactly like `BleedConfig`).

### 10 · Sandstorm

> *"Kick up a blinding whirl of sand. Nothing inside it can be marked — friend
> or foe."*

- **Mechanics:** cloud placed at your feet. Anyone inside **cannot be
  auto-targeted**: existing locks on them break (the lock-break rule treats a
  smoked target as lost, including mid-windup `lockedTargetId`), and no new
  locks acquire. **The blindness goes BOTH ways (Tom, 2026-07-15):** anyone
  standing inside can't take aim out either — no locks acquire *from* the
  cloud, and stepping in mid-windup breaks your own swing. No hiding inside
  while shooting out. Double-edged — enemies can stand in your storm too.
- **Numbers:** radius **120px** · duration **3s** · cooldown **14s**.
- **Visual (Tom, 2026-07-15):** an actual **swirling storm that obscures**:
  the cloud body draws OVER players and shots (dense sand fill + a dozen
  streak arcs orbiting at mixed radii/speeds/directions), so whoever stands
  in it is genuinely hard to make out. Tier-1 canvas particles; still the
  flagged tier-3 SkSL candidate if the profiler complains.
- **Icon:** a swirling cloud with a slashed-out eye.
- **Cast SFX:** harsh dry gust rising fast, then hissing sand falling back to
  earth.
- **Reuses:** `Deployable` entity · a filter clause in acquisition (both
  directions) + the existing lock-break check. Re-themed from "smoke" to sand
  (2026-07-12) so the cloud sits on the arena palette next to the blood
  decals.

---

## New sim machinery (shared, built once)

**BUILT 2026-07-14** — all three additions plus every ability's effect
(sim `abilities/` folder: lifecycle dispatch, dash, tremor, harpoon,
statuses, deployables; protocol v8; three `AbilityButton`s replace the
hardwired dash button; bots draft dash-first hands and cast via slot 0).
Implementation notes vs. the sheet: Ironhide's reduction re-scales the SAME
resolveAttack roll (identical rng draws buff or no buff); the harpoon pull
samples the drag path against wall colliders (the open question, answered the
cheap way); mine blasts are dodgeable by dash i-frames like the arc resolve.

Three additions carry all ten abilities:

1. **Ability slot.** `DashState` generalises to a per-player
   `AbilityRuntime`: the pick (`abilityId`), core's `AbilityState`
   lifecycle (already generic — ready/active/cooldown via `stepAbility`), plus
   per-ability scratch (dash keeps its committed direction; statuses keep time
   left). `PlayerInput.dash` → `PlayerInput.ability`. This is the
   [skills-architecture](./characters-and-talents.md) shape: generic lifecycle
   in core, per-skill effects in a `abilities/` folder in the sim.
2. **Deployables.** One new entity array on `ArenaState`, shaped like
   projectiles: `{ id, kind, ownerId, team, pos, radius, timers, hp? }` with
   monotonic ids (client lerps/keys by id), stepped after projectiles, cleared
   each round. Sandtrap, Straw Man, Blood Font and Sandstorm are all kinds of
   this one thing.
3. **Protocol v6.** Snapshots add: per-player `abilityId` + `abilityLeft`
   (drives cooldown UI + body-effect rings, exactly like `slowLeft`/
   `bleedLeft` drive status rings today) and a `deployables` array. Lobby
   messages add the ability pick beside the weapon pick.

Determinism holds throughout: every number above is fixed — no new RNG draws
anywhere, so the seed/`rngDraws` restore contract is untouched.

## Visual language

- **Body-effect rings (Tom, 2026-07-12):** self-statuses (Mirror Guard,
  Ironhide, War Drums' self-buff) render a ring **just outside the player
  disc**, not only as a tint on the disc — player dots are too small to carry
  state on their own. These join the `StatusPulses` system as new kinds:
  same accumulated-phase pulse, same speeds-up-near-expiry rule, drawn one
  radius step outside the slow/bleed rings so stacked states stay legible.
  Concentric ring order (inner → outer): slow · bleed · taunt · ability.
- **Zones** (Sandtrap, Blood Font, Sandstorm, War Drums' area) draw as a
  ground ring + interior effect, under players, over blood decals.
- **Deployables are clearly visible to all players** (Tom, 2026-07-12) — no
  team-dependent rendering, no subtlety. Counterplay requires seeing the
  thing; deployables are area denial and target pollution, not ambushes.
  **One exception since 2026-07-14: the sandtrap** — enemy-side it renders
  faint (dim trigger ring + a ~3s glint; see its readability rule above).
  Every other deployable keeps the uniform rule.
- **Particles** come in three tiers — see [pvp-particles](#particles) below.

### Particles

The renderer is React Native Skia recording one `SkPicture` per frame — and
Skia is already GPU-backed (Metal on iOS, Vulkan/GL on Android). "Add GL
particles" therefore does **not** mean adding a GL view (an `expo-gl` layer
would break the single-picture rule and reintroduce inter-layer jitter — the
exact thing the perf pass killed). It means choosing how much of the particle
work runs per-particle on the JS thread vs procedurally on the GPU:

| Tier | Technique | Cost model | Use for |
| --- | --- | --- | --- |
| 1 | Canvas particles — flat shapes drawn during record (the blood-decal pattern) | ~free to build; JS record time grows per particle; fine to ~low hundreds | v1 of everything: sand puffs, drum rings, font droplets, harpoon chain dots |
| 2 | `drawAtlas` — one batched draw of N sprites from a sprite sheet | positions still JS-side, but 1 draw call; comfortable at hundreds–thousands | promote hot effects if tier 1 shows up in the dev profiler overlay |
| 3 | SkSL `RuntimeEffect` shaders — procedural, zero per-particle CPU | GPU-only; hardest to author/debug (Android precision quirks) | 1–2 showpieces: Sandstorm's swirling interior, Ironhide's sheen |

Build order: **everything ships tier 1** (client-derived, never networked —
the blood-trail rule); promote by profiler evidence, not vibes; Sandstorm's
interior is the flagged tier-3 candidate because noise-swirl fog is exactly
what a fragment shader is for and exactly what per-particle drawing is worst
at.

## Open questions (answered in the 2026-07-14 build)

- **Bot brains:** cheapest v1 shipped — bots draft a dash-first hand and only
  ever cast dash (`BotDecision.dash` maps onto whichever slot holds it). A
  per-ability heuristic (when does a bot pop Ironhide?) is still future work.
- **Harpoon pull vs walls:** the drag path is sampled in half-radius steps
  against the wall colliders; the victim stops at the last clear spot.
- **Straw Man + Sandstorm interaction:** a smoked dummy simply drops out of
  the candidate pool — selectTarget handles an empty pool (null), no NaN.
- **Practice lobby:** the practice draft already picks abilities; the bot's
  hand is dash-first, and PracticeClient steps the same sim — deployables run
  offline before netplay.
