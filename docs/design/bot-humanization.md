# Blood in the Sand — Bot Humanization (Motor-Layer Texture)

Status: **BUILT 2026-08-01 — all five mechanisms (Tom picked "all five");
on-device feel pass owed** ·
Applies to: **Blood in the Sand** (bot brains v2, all modes: practice, casual
backfill, ranked backfill) ·
Last decided: 2026-08-01

Build-time deviations:

- **Greed (M3) is stronger than drafted**: a greedy bot doesn't just damp
  the detour weights — it drops detour *planning* entirely (walks the
  straight line), and a DIVING bot is exempt from the emergency shell too
  (the dive is the deliberate acceptance of the ground; a damped shell just
  re-created the rim-orbit equilibrium at the trigger radius). The pressing
  bot keeps a damped shell lean.
- Micro-pauses reset the unstick counter and gate the unstick call
  (deliberate stillness must not read as wedged).
- Verification: godlike beat novice **10/10** mirror matches post-change
  (gate was ≥8), and the wedge canary is baseline-equal (525 firings/10
  matches vs 565 BEFORE the change — the counter reads combat roots and
  round-transition freezes as "stuck"; pre-existing accounting noise, not
  nav regressions. A future cleanup could gate the counter on
  phase/attack-lock).
- One brittle test rewritten: the flee-budget walk sampled a single tick
  that raced the band-holding strafe orbit; it now asserts the charge-back.

> "the bot felt too obvious in its logic, it just doesn't have that human
> quality… when I put a Sandtrap down it seems to skirt around the edge in an
> unnatural way." (Tom, 2026-08-01)

## Diagnosis — why the bot reads as a machine

The brain (`bot.ts` v2) is *tactically* human — archetypes, dodge rolls,
flee budgets — but its **motor layer** is pure machine. Four artifacts:

1. **Equilibrium orbiting** (the Sandtrap tell). Movement is a *potential
   field*: every tick the brain sums weighted direction vectors (toward the
   target, away when hurt, strafe, "refuse hostile ground" `bot.ts:409-418`).
   When the pull-toward and a zone's radial push-out meet, the radial parts
   cancel and the leftover is tangential — the bot glides along a
   mathematically exact circle at `triggerRadius + 40`, full speed, never
   slowing, never committing to a side. No human traces geometry; humans
   pick a side, give it a sloppy personal margin, and occasionally clip the
   edge or barrel straight through.
2. **30 Hz re-optimization with no motor inertia.** The blend is recomputed
   from scratch every 33 ms and the emitted stick can flip 180° in one tick.
   A human thumb holds a direction for 200–500 ms and turns through the
   intermediate angles.
3. **Crisp thresholds.** Band-keeping flips at exactly `band.near`/`band.far`
   px; dive/flee/punish flip at exact hp fractions. The bot oscillates at
   band edges with machine regularity, and a player who learns the numbers
   sees the script.
4. **Uniform full-speed everything.** The stick is always normalized to
   magnitude 1 — no easing into a turn, no hesitation entering a fight, no
   slowing to size up ground. (The only texture today is tier-gated: wobble
   and dither exist solely at LOW tiers as *mistakes*.)

## Principles

- **Humanization ≠ difficulty.** These are texture, applied at EVERY tier —
  a godlike bot should move like a great human, not a machine. Mistakes
  (dodge odds, dither, wobble) stay tier-gated exactly as bot-brains.md
  built them; nothing here touches the even-stats rule.
- **Motor layer only.** Archetypes, cast rules, targeting, nav are
  untouched — we change how the feet *execute* decisions, not the decisions.
- **Deterministic.** All randomness through the existing per-bot
  `BotMemory` rng (mulberry32), so replays/tests stay reproducible. No sim,
  state, or protocol changes — this ships entirely inside `botThink`.

## Mechanisms

### M1 — Stick inertia (the foundation)

`memory.headX/headY`: the emitted intent TURNS toward the blend's desired
direction at a capped angular rate (~7 rad/s, mildly tier-scaled) instead of
snapping, and speed eases back in (~100 ms) after a big direction change.
**Reactive overrides snap instantly** — the approved dodge, shot evasion,
and unstick bypass smoothing entirely (survival reflexes are fast in humans
too; it's *steering* that's smooth). Kills the per-tick jitter, the instant
reversals, and gives every path a curved, thumb-driven look.

### M2 — Committed hazard detours (the Sandtrap fix)

Replace the standing radial push with an **episode**: the first tick a
hostile zone blocks the corridor ahead, the bot commits — picks a side
(whichever is closer to its current heading), rolls a personal margin
(`radius + 30 + rng*70` px), and steers around a tangent waypoint at that
margin until it's past. One decision, held — like a person. Two garnishes:

- **The flinch**: when a zone is first *noticed* already close (placed
  mid-approach — the tier's snapshot staleness makes this happen naturally),
  the first ~0.3 s of the detour is an overcorrected jerk away, then it
  settles into the arc. The human "oh crap" swerve.
- **Emergency shell**: the old radial push survives only INSIDE the radius
  itself as a hard get-out — commitment must never mean standing in a quake.

### M3 — Greed (the deliberate mistake)

While **diving** a weak target or **pressing** (impatience), hazard
avoidance is damped to ~0.3× — the bot tanks a Sandtrap to secure a kill,
exactly the trade a human makes. Never while idling in band.

### M4 — Sloppy bands

Band edges get a per-episode fuzz (±12%, re-rolled every 4–8 s via memory
rng) plus **hysteresis**: the advance/hold/back state only flips once the
boundary is exceeded by a real overshoot (~25 px), so the bot drifts in and
out of range like a human instead of vibrating at the exact band edge.

### M5 — Micro-texture (small, optional garnish)

Rare, short repositioning pauses at ALL tiers (0.15–0.3 s — distinct from
low-tier dither, which is longer and gates buttons too), and strafe legs
that overshoot the orbit-flip by a beat (extending the existing debounce
with rng leg lengths, like the weave already does).

## Trade-offs (decide before building)

- **A small effectiveness dip, mostly at top tiers.** Smoothing and sloppy
  bands make the bot *very slightly* easier to hit. Reactive snaps exempt
  the dodges, so the dip should be minor — and arguably healthy (inhuman/
  godlike have been smartened three times; texture pulls them back toward
  "great human"). Gate: re-run the mirror-match ladder (bot-brains step 4's
  godlike-beats-novice 9–1 check) and require it still monotonic.
- **Tuning time.** This is feel work; the dials land in one `HUMANIZE`
  table and the real verification is your eyes in practice mode, not tests.
- **Interaction with nav.** Order matters: blend → smooth → wall-resolve
  (`openDirection`) — smoothing must feed INTO the wall probes, never fight
  them, or the wall-grinding nav killed comes back. Unstick stays above it.
- **Test churn.** A handful of bot tests assert exact-tick movement
  outcomes; some will need loosening to direction-cone asserts.

## Build plan (when green-lit)

1. `HUMANIZE` dial table + new `BotMemory` fields + **M1**, with tests
   (turn-rate cap honored, reactive snap exempt).
2. **M2 + M3** — the Sandtrap headline. Tests: detour side committed for the
   episode, margin varies per episode, flinch fires on late notice, dive
   walks the trap.
3. **M4 + M5**.
4. Verification: mirror-ladder run stays monotonic; wedgeCount stays ~0
   (nav regression canary); Tom's practice-mode feel pass — drop a Sandtrap
   in the bot's path and watch the walk-around.

## Notes

- Biggest payoff is the **ranked bot disguise** (bits-ranked-bots.md): the
  motor layer is the one channel every player watches for the whole match.
- The casual/practice bots inherit it automatically (same `botThink`).
