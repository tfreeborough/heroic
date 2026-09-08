# Blood in the Sand — preview-video factoids

Companion copy for the weapon and ability spotlight videos (see
[marketing.md](./marketing.md) for the video pipeline). Every number below
was read straight out of the sim (`packages/blood-in-the-sand-sim/src/config.ts`
and the `abilities/` folder, plus `packages/core/src/combat`), so it's true as
of 2026-09-07. If a number gets retuned, the factoid goes stale: check config
before reusing an old post.

Written so a line can be lifted into a post more or less as-is. Plain, first
person where it helps, no slogans.

## The shared rules (worth one post of their own, or a footnote)

- Everyone has 100 hp and the same body: an 18px circle. Sprint is 280 px/s.
  The whole sim runs at 30 ticks a second on the server.
- Nothing is aimed. Weapons auto-fire at your auto-target and no aim is ever
  sent over the network. The game is about reading telegraphs and being in the
  right place, not twitch aim.
- A weapon hit is `(attack − 2 defence) × ±15% variance`, with a 15% chance to
  crit for double. Ability damage is different: it's a fixed number, no crit,
  no defence, no dice.
- Dash i-frames dodge everything that's *incoming*: swings, arrows, bolts,
  shells, mines, quake ticks, the sinkhole's pull, tar, the shout, the harpoon.
  They do not dodge what's already *in* you: bleed, poison, and the Closing
  Sands keep ticking.
- Ironhide is the other universal answer: 70% less damage from hits, immune to
  every shove, slow and pull. It doesn't touch bleed, poison or the Sands
  either.

---

## Abilities

### Dash (first post)

Sim: `abilities/dash.ts`, `DASH*` in config. 75px hop over 0.1s, 0.2s of
i-frames, 3s cooldown, 4 charges a round.

1. **It's a hop, not a sprint.** The dash moves you 75px in a tenth of a
   second: about two body-widths, at roughly 2.7× sprint speed. It started life
   at 180px and got cut twice (to 100, then 75) because a long dash turned
   every fight into tag. The whole point is to slip a swing, not cross the
   arena.
2. **You're untouchable for twice as long as you're moving.** The roll itself
   lasts 3 ticks. The i-frames last 6. That extra tenth of a second after you
   land is the grace tail that makes "dash through the hammer" feel fair
   instead of frame-perfect.
3. **Let go of the stick and it lunges at your target.** The roll direction
   is whatever you're pushing. With the stick neutral it uses your facing, and
   your facing always points at your auto-target. So a bare dash press is an
   attack step, and a stick-plus-dash is an escape.
4. **The roll ignores slows.** Dash writes your velocity directly rather than
   pushing through the movement model, so a hammer slow, tar, a quake or even
   Ironhide's own self-slow don't shrink the hop. Slowed is exactly when you
   need the escape to still be a real escape.
5. **You're a bowling ball while rolling.** Anyone you plough through inside a
   64px contact circle gets shoved outward up to 840 px/s, three times sprint
   speed. It's a cap not a stack, so sitting on someone doesn't launch them
   into orbit. Ironhide shrugs it off entirely.
6. **A dash cuts a harpoon chain from either end.** If you're being reeled,
   rolling snaps it. If you're the one pulling and you dash, you let go. The
   same i-frames also dodge the chain at the instant it lands.
7. **Four hops a round, three seconds apart.** Dash has the fattest budget of
   any ability (most get 2 or 3) because it's the metronome pick: small value,
   often. Charges refill every round so nobody snowballs a bank of dodges.
   Practice mode never spends them at all.
8. **The bots are watching your cooldown.** Ability timers are in the match
   snapshot, and the top bot tiers read yours: the moment your dash is spent
   they surge in to punish. They also hold their own dash against a shooter
   until the arrow is within 0.15s of release, then hop sideways rather than
   forwards, and keep a spare charge in reserve while a ranged enemy is alive.
9. **Dashing doesn't cancel your own swing.** Your attack cycle keeps
   running through the roll, so you can dash out of a telegraph and still land
   the hit you'd already started winding up.
10. **It's tuned against the trident on purpose.** A dash from the trident's
    maximum reach (180px) lands you 105px from the wielder, inside its 115px
    dead zone where the prongs can't touch you. That relationship was kept
    deliberately when the trident got its range bump.

### Sandtrap

Sim: `abilities/deployables.ts`, `SANDTRAP`. Buried charge, 30 damage, 240px
blast, 2s arm, 2 charges a round, 10s cooldown.

1. **Thirty damage is the biggest fixed number in the game.** Bigger than a
   bombard shell (22), bigger than a bow crit's low end. It's a flat 30 with no
   dice, no defence, only Ironhide can shave it.
2. **The blast is twice the size of the trigger.** An enemy's rim within 120px
   sets it off, but everyone on the enemy team within 240px eats it and gets
   thrown at 700 px/s. It's a group punish disguised as a mine.
3. **One live mine per player.** Planting a second silently fizzles the first,
   so you're relocating a trap, never carpeting the sand. And it lasts until
   the round ends (600s lifetime is "forever" in a game with 90s rounds).
4. **You can roll through your own mistake.** The trigger foot and the blast
   are enemy-only, but if an enemy trips it while you're mid-dash, your
   i-frames skip the blast too.

### Tremor

Sim: `deployables.ts` (the `quake` kind), `TREMOR`. 240px quake at your feet,
4s, 3 damage a second, 25% slow. 2 charges, 9s cooldown.

1. **The ground bites the moment it opens.** The first tick fires on the very
   next step, then every second for four ticks. Twelve total, which is exactly
   what the old instant slam did before it became a zone.
2. **It's tuned to lose to a Blood Font.** 3 a second versus the font's 8 a
   second healing: a quake pressures a healing circle, it doesn't cancel one.
   That was the design line.
3. **The slow refreshes every tick you're inside, and lingers 0.3s after you
   step out.** If a hammer slow (50%) overlaps it, the stronger one wins; they
   don't stack.
4. **Ironhide takes the ticks but not the slow.** A 3-damage tick through 70%
   reduction rounds to 1. Dash i-frames skip both the tick and the slow.

### Harpoon

Sim: `abilities/harpoon.ts`, `HARPOON`. Instant chain, 550px reach, 8 damage,
then a reel at 360 px/s. 2 charges, 12s cooldown.

1. **It out-reaches every weapon in the game.** The chain lands at 550px. The
   bow stops acquiring targets at 380. The harpoon does its own target search
   at press time so your weapon's lock-on distance never caps it.
2. **The reel is faster than you can run.** Victims are dragged at 360 px/s
   against a 280 sprint. From max range that's about 1.4 seconds of being
   hauled, and the caster stands rooted the whole time. Only a dash outruns it.
3. **A press with no valid mark costs nothing.** No cooldown, no charge burnt.
   The button just does nothing, so you can mash it at the edge of range
   without wasting it.
4. **Mirror Guard reverses it.** Chain a guarded player and you take the 8
   damage and get reeled to *their* feet instead, and they stay free to move
   while you're dragged. The chain also snaps if either end dashes, if the
   victim goes Ironhide, or if a pillar breaks line of sight.
5. **You can harpoon a Straw Man.** The barb sticks and does its 8 damage but
   there's nothing to drag. The chain still draws on screen even when the
   target dodges it.

### Mirror Guard

Sim: `step.ts` projectile loop, `MIRROR_GUARD`. 2s window, 3 charges, 12s
cooldown.

1. **A reflected shot homes twice as hard as a staff orb.** Staff orbs steer at
   2.2 rad/s. Anything you bounce back steers at 4 rad/s with a fresh full
   range budget, aimed at the shooter. Reflect a bow arrow and they now face a
   homing arrow.
2. **It turns each Scorpion bolt individually.** Three bolts in, three bolts
   back.
3. **It does not stop melee, shells or beams.** Only travelling projectiles
   (and the harpoon chain, which it reverses). A bombard shell is above the
   fight, so it lands regardless.
4. **The bounce is a field swap, not a new projectile.** The arrow literally
   changes owner mid-flight, which is why the kill credits you.

### Ironhide

Sim: `abilities/statuses.ts`, `IRONHIDE`. 2.5s, 70% damage reduction, half
speed. 3 charges, 12s cooldown.

1. **Walk through the telegraph instead of dodging it.** Hits do 30% while
   it's up, and a fixed 30-damage sandtrap becomes 9. Every hit still lands
   for at least 1.
2. **You are immune to every shove, slow and pull in the game.** Hammer slow,
   quake, tar, sinkhole, warding shout, dash barge, harpoon reel: none of them
   take. The barb still does its damage; the pull just doesn't happen.
3. **It costs you half your speed.** The self-slow overrides any other slow
   (immune while iron), and a War Drums aura multiplies on top, so a drummed
   Ironhide walks at 0.5 × 1.35 of sprint.
4. **It does nothing for bleed, poison or the Sands.** The blade's already in
   you. Smart bots cast Ironhide when a hit is coming and their dash is down.

### Straw Man

Sim: `deployables.ts`, `STRAW_MAN`. 30hp decoy, 4s life, taunts inside 310px
for 1.5s. 2 charges, 14s cooldown.

1. **It's a combatant that can't act.** The dummy runs the full hit roll like a
   player (variance and crits included), just with 0 attack. So a hammer crit
   one-shots it and it soaks arrows exactly like the body it imitates.
2. **The taunt hijacks a swing already in flight.** Everyone within 310px is
   force-locked onto it for 1.5s, and a windup mid-telegraph is retargeted, so
   a blow already coming down lands on straw.
3. **310px was chosen to flip divers, not shooters.** Melee engagement is 250
   (blade) to 285 (hammer); the staff and bow acquire at 340 and 380. The
   radius sits between them on purpose.
4. **The counterplay is walking it out of your own reach.** The hold releases
   early if the dummy leaves your weapon's engagement radius, dies, or gets
   smoked. You can also harpoon it.

### Warding Shout

Sim: `abilities/wardingShout.ts`, `WARDING_SHOUT`. Instant, no damage, 170px
cone, 90° wide, 2400 px/s hurl. 3 charges, 7s cooldown.

1. **The hardest shove in the game by a mile.** 2400 px/s outward against a
   sandtrap's 700 and a bow arrow's 260. It's the old tremor slam promoted to
   a peel with the damage stripped.
2. **It comes out of your mouth, not your boots.** It's a 90° cone off your
   facing, so it's aimable and therefore whiffable. Flanks are safe.
3. **Someone standing dead-centre on you gets hurled along your facing.** No
   angle to gate on, so the cone rule is skipped for them.
4. **Dash i-frames ride straight through it.** Ironhide plants and doesn't
   move.

### War Drums

Sim: `statuses.ts` speedFactorOf, `WAR_DRUMS`. 260px moving aura, 3s, +35%
speed. 3 charges, 12s cooldown.

1. **It's the hammer slow run backwards.** Same plumbing, a factor above 1
   instead of below. Sprint goes 280 → 378 px/s for everyone on your team
   inside the circle, you included.
2. **The circle moves with you.** It's re-checked every tick, so step out and
   you lose it instantly.
3. **Auras don't stack.** Two drummers overlapping is still one beat.
4. **The radius was doubled from 130 to 260** because it needed to feel like a
   war-band's worth of ground, not a personal bubble.

### Blood Font

Sim: `deployables.ts`, `BLOOD_FONT`. 100px circle, 4 hp every 0.5s for 4s.
One pour per round, 16s cooldown.

1. **Bleed in reverse.** 8 hp a second, 32 total if you stand in it start to
   finish. Fixed ticks, no dice.
2. **Once per round.** Healing is enormous in a one-life mode, so the font is
   one of only three abilities capped at a single charge (with Sinkhole and
   Tar Pit).
3. **It's the number everything else is tuned against.** The quake sits under
   it (3/s), the fang's full poison out-drips it (12/s), the Closing Sands at
   full strength out-damage it (16/s). The font is the balance yardstick.
4. **It heals the whole team inside, and never overheals.** Ticks are capped
   at missing hp, so a topped-off ally gets nothing.

### Sandstorm

Sim: `abilities/targets.ts`, `SANDSTORM`. 120px cloud, 3s. 2 charges, 14s
cooldown.

1. **Nothing inside can be targeted, friend or foe.** Existing locks treat the
   mark as lost, which means a windup already running on someone breaks the
   moment they step in.
2. **It blinds both ways.** Stand in the cloud and you can't take aim either.
   No hiding inside while shooting out.
3. **It kills volleys and beams.** A Scorpion volley ends the moment its mark
   smokes, and a Lifeline link breaks if either end is in the cloud.
4. **The harpoon can't chain into or out of it.**

### Sinkhole (Signet)

Sim: `deployables.ts`, `SINKHOLE`. Thrown 200px ahead, 0.6s in the air, 260px
pull ramping 60 → 240 px/s over 4s, 6s total. One throw per round, 16s
cooldown.

1. **It pulls everyone. Your team, their team, you.** It's the only group
   displacer on the roster and it spares no one, the same rule as the bombard.
2. **The pull drags your feet, not your momentum.** A velocity nudge would get
   crushed by the mover's braking before you moved an inch, so the sand moves
   your position directly. Your stick input still integrates on top.
3. **At full strength, sprinting straight out gains you 40 px/s.** The pull
   peaks at 240 against a 280 sprint. The hole is 260px wide. From the centre
   that's six and a half seconds of running for a hole that lasts two more.
   Dash always escapes; Ironhide plants its feet.
4. **It's thrown, so it can miss.** It goes 200px along your facing and clamps
   inside the arena wall, so throwing it at a wall plants it at the rim.
5. **No damage.** It's a setup piece. The sales pitch is a sinkhole feeding a
   teammate's bombard.

### Tar Pit (Signet)

Sim: `abilities/index.ts` laying window + `deployables.ts` (the `tar` kind),
`TAR_PIT`. 2.5s laying window, a blob every 80px travelled, 30% slow. One
trail per round, 14s cooldown.

1. **You paint it by moving.** One blob at your feet on cast, then one every
   80px you travel for 2.5s. A full sprint lays about 700px of trail, nine
   blobs. Stand still and you get exactly one.
2. **Blobs are "wet" for 1.5s.** Each one grows from 20px to 60px, so the
   trail behind you thickens as the chaser reaches it.
3. **It slows you too.** Double back through your own trail and it grabs you.
   Both teams, no exceptions.
4. **It never dries mid-fight.** Blobs last until the round ends. Live tar
   across rounds was considered and cut because rounds would snowball into a
   maze.

### Titan's Draught (Signet)

Sim: `statuses.ts`, `TITANS_DRAUGHT`. 5s, 1.6× body, 1.35× weapon damage. 2
charges, 14s cooldown.

1. **You grow, and so does your hurtbox.** Your radius goes 18 → 29px for
   every check that can touch you: arcs, arrows, blasts, zone edges, crowd
   shoving. Bigger stick, bigger target. That's the balance.
2. **Melee arms grow with the body.** Arc weapons get 1.6× reach, so a
   hammer's 125 becomes 200 and a fang's 60 becomes 96. Bows and staves are
   unchanged: a giant's bow is the same bow.
3. **Only weapon hits get the 35%.** Bleed, poison, tremor ticks and sandtrap
   damage stay fixed. The venom is the venom.
4. **A bombard shell is stamped at launch.** Fire while drunk and the shell
   lands at 30 damage even if the draught runs out mid-flight.

---

## Weapons

Damage ranges below are non-crit hits against the standard 2 defence, ±15%
variance, rounded. Crits double before rounding.

### Blade

Reach 90, 40° cone, 0.25s windup, 0.55s recovery, attack 16, bleed 35%.

1. **The quickest swing in the base roster.** A full cycle is 0.8s. The hit is
   12 to 16, crit 24 to 32.
2. **It's out-reached by the hammer on purpose.** A fast cycle plus bleed
   already carried it; extra reach was making it own the melee bracket.
3. **Bleed stacks.** Every non-lethal hit has a 35% chance to add a separate
   3-damage-a-second bleed for 3 seconds, and those stack. Three lucky hits is
   9 a second ticking through Ironhide and i-frames alike.
4. **Its knockback is near-zero (100) on purpose.** The blade wants you to
   stay in reach; shoving its own target away was self-defeating.

### Bow

Reach 360, arrow 650 px/s, 0.5s windup, 0.9s recovery, attack 20.

1. **The biggest raw hit in the base roster.** 15 to 21 a shot, 31 to 41 on a
   crit. Three crits is a kill; five plain hits usually isn't.
2. **The arrow crosses full range in 0.55 seconds.** At sprint you move 154px
   in that time, so sidestepping a long shot is real but dashing through it is
   the clean answer.
3. **Arrows fly 60px past acquisition range.** A shot loosed at the edge still
   connects on someone stepping back. Walls stop them dead.
4. **The tester pass made it slower to fire and faster in flight.** The shot
   is harder to earn and harder to sidestep once loosed.

### Staff

Reach 320, orb 300 px/s, homing 2.2 rad/s, 0.6s windup, 0.9s recovery,
attack 17.

1. **The orb is barely faster than you.** 300 px/s against a 280 sprint.
   Outrunnable never, out-dashable always.
2. **It steers, but not enough to track a close strafer.** 2.2 rad/s is
   "slightly homing" by design: real at range, beatable up close.
3. **Longest telegraph and rarest shot of the base ranged weapons.** It was
   near-unapproachable at a 0.9s cycle in v1; it's 1.5s now so melee can close
   between orbs.
4. **The biggest shove of the base four.** 300 px/s knockback on hit, and
   13 to 17 damage.

### Hammer

Reach 125, 90° cone, 0.65s windup, 0.75s recovery, attack 19, slow 50% for
1.5s.

1. **The hardest single hit in melee behind the slowest, most readable sweep.**
   14 to 20, crit 29 to 39.
2. **It used to launch people. Now it slows them.** Huge knockback kept
   resetting fights; the 50% slow sets up the *next* hit instead. Knockback
   is exactly 0.
3. **The slow refreshes, never stacks.** Repeated hits extend the 1.5s window.
   Ironhide is immune to it.
4. **Longest reach in base melee.** 125px against the blade's 90, and a
   90-degree cone that's hard to orbit out of.

### Trident (deed-gated)

Reach 180 with a 115 dead zone, 26° arc, 0.35s windup, 0.7s recovery, attack
15, guaranteed bleed, 40% slow, thrust 0.15s.

1. **Only the head is dangerous.** The hit region is a 65px band at the end of
   the reach. Anyone whose body is inside 115px is standing between the prongs
   and the hands, and the sim won't even start a swing at them.
2. **The strike travels.** The front runs from your hand to full reach over
   0.15s, hitting each body once as it crosses them, so a dash can slip
   through the moving point.
3. **The biggest knockback of any weapon.** 480 px/s: a landed poke launches
   them back out to your preferred range while a 1s 40% slow pins them there.
4. **The bleed is guaranteed but gentle.** 1 damage every half second for six
   seconds, and a re-poke resets the clock rather than queueing a second
   drip. 11 to 15 on the hit itself.

### Fang (Signet)

Reach 60, 35° cone, 0.15s windup, 0.3s recovery, attack 5, poison 4 stacks ×
3/s for 5s.

1. **The raw hit is always 3.** Attack 5 minus 2 defence, and ±15% of 3
   rounds back to 3 every time. Crits are 5 to 7. The venom is the weapon.
2. **The fastest cycle in the game: 0.45 seconds.** Four stabs to max stacks
   takes about 1.35s of contact.
3. **Full stacks out-drip a Blood Font.** 12 a second against the font's 8.
   Get in, stab three times, leave: 9 a second for 5 seconds is 45 damage
   after you've gone.
4. **Every stab refreshes one shared clock and all stacks fall off together.**
   Poison ignores Ironhide and i-frames. Kill credit follows the last hand
   that applied it.
5. **Everything out-reaches it.** 60px against the blade's 90 and hammer's
   125; its whole game is closing through telegraphs and leaving before the
   answer lands. Zero knockback because it wants the next stab.

### Scorpion (Signet)

Reach 240, bolts 850 px/s flying to 480, 3 bolts 0.12s apart, 0.45s windup,
1.3s recovery, attack 8.

1. **The fastest projectile in the game.** 850 px/s, against the bow's 650.
   Bolts fly 480px, further than a bow arrow (420), even though the volley can
   only *begin* inside 240.
2. **Each bolt re-aims at release.** The three go out over 0.24s, each at the
   mark's position at that instant. A strafer sheds some bolts, rarely all
   three.
3. **A full volley just out-pays a bow hit.** 5 to 7 a bolt, 15 to 21 for
   all three. It runs on the slowest ranged cycle after the bombard (1.75s).
4. **The volley dies when its mark does.** Kill or smoke the target between
   bolts and the rest never fire. Mirror Guard sends each one back
   individually.

### Bombard (Signet)

Reach 360 with a 120 dead zone, 0.55s windup, 1.4s recovery, shell 22 fixed
damage, 120px blast, 400 knockback, flight 0.55 to 0.9s.

1. **The slowest cycle in the game and the first friendly fire.** 1.95s
   between shots, and the blast hits everyone: enemies, allies, the gunner.
   Shelling a diver on your feet means shelling your own feet.
2. **The shell lands where you *stood*.** The mark is frozen at launch and the
   landing ring is drawn for both teams from that moment. Walking off it is
   the whole counterplay.
3. **The floor on flight time is a balance line.** A dead-centred target needs
   138px to walk clear, 0.49s at sprint. Close shells fly 0.55s so the
   walk-out stays barely alive at any range; under that they'd be
   dash-or-eat.
4. **Inside 120px it cannot even start a swing.** Diving the gunner is total
   safety from the gun. The shell is above the fight too: Mirror Guard can't
   touch it.
5. **22 is a fixed number.** No crit, no defence, no variance. Artillery is
   reliable, not lucky.

### Lifeline (Signet)

Range 300, tick every 0.5s, heal 3/s ramping +1/s to a 12/s cap, 1.5s grace.

1. **It has no attack cycle.** No windup, no recovery, no strike. It's a
   maintained link that re-nominates its patient every tick.
2. **Nine held seconds to full power.** 3 a second at link start, +1 every
   unbroken second, capped at 12. It passes Blood Font parity (8/s) at 5s and
   ends half again beyond it. A protected healer out-heals the font on
   purpose.
3. **It deals no damage, ever, and never links an enemy.** An enemy-snap
   hijack was built and cut after play; the counterplay is the healer's body.
   In 1v1 it links nothing, and the codex says so.
4. **A broken link remembers for 1.5 seconds.** Clip a pillar, cross a
   sandstorm edge, and the ramp is frozen, not lost, if the same patient
   re-qualifies in time. A different ally needing it wipes the memory.
5. **It's sticky and it's fair.** It picks the most-wounded ally but won't
   drop the current patient for a newer, sorer one. A dashing ally keeps their
   heal: i-frames dodge harm, and this is the opposite.
