# Challenges — fights against the odds (offline, bots, brag-worthy)

*Drafted 2026-09-26 (Tom + Claude); roster revised the same day on Tom's
first pass. Status: **BUILT 2026-09-26** (all twelve incl. the horde; sim
dials + tests, API report route, client screens, HUD strip, deeds board) —
uncommitted; on-device pass, card art + 7 deed icons (Forge briefs in the
style bible), share card, and the replay verifier owed. See § Build notes.* Companions: [bits-mode-select.md](./bits-mode-select.md)
(the fourth card), [bot-brains.md](./bot-brains.md) + [bot-brains-v4.md](./bot-brains-v4.md)
(the opponents), [bits-deed-glory.md](./bits-deed-glory.md) (the bands),
[achievements.md](./achievements.md) (trust model), [bits-showcase-scripts.md](./bits-showcase-scripts.md)
(forced seating + scripted placement precedent).

## Why (Tom, 2026-09-26)

The game no longer needs massive strides every other day. The problem now is
players: enough of them that ranked has a queue, and enough noise on the
socials to bring the next ones in. Challenges are the content that serves
both without needing anyone else online:

1. **No matchmaking.** Every challenge is a practice match with a fixed recipe.
   The sim runs on the phone; the queue can be empty and the game still has
   something to do tonight.
2. **Marketing material.** Each one is a one-line premise and a clip:
   "1v4, bow only, tide at ten seconds". That is the spectacle-not-roster
   material the marketing rules want, and a "can you beat this?" deep link is
   a door from a social post back into the app.
3. **A rewards spine.** First clears pay Glory and deeds; attempt counts are
   the brag number ("cleared on attempt 31").

Guardrail: challenges are a **funnel into ranked, not a substitute**. Solo
content keeps players opening the app on the nights the queue is empty (the
nights we lose them today). The best rewards stay ranked-facing and the queue
is one tap from the challenge screen.

## What the sim already gives us (audit 2026-09-26)

- **Uneven teams.** `addPlayer(sim, name, forcedTeam)` skips the balanced
  draw; the dummy range already seats you alone against three. Round-over
  counts *alive teams*, so 1v4 ends correctly the moment one side is wiped.
  Gap: seat count is `teamSize × teamCount`, so 1v4 builds as a 4v4 shape with
  three empty seats on your side (fine) or gets a `seats` override (nicer).
- **Bot tiers.** Eight presets, Novice → Godlike (`botDifficulty.ts`).
  Practice default is Skilled (4th of 8). Godlike is near-impossible by
  decision (bot-brains-v4.md) — that IS the crown challenge.
- **Forced kits, both sides.** Showcase scripts set every seat's weapon and
  abilities; bots then play whatever they hold (archetype derives from the
  kit). So "three bows against your blade" is a recipe, not code.
- **Handicaps.** The Primer's placement contract carries `hp` and
  `moveFactor` per seat. Start at a third of health = one number.
- **Early tide.** Practice already reads a sands-delay dial (dev env today).
  Challenges need it as a per-sim config field instead of env. Small.
- **Brawl shape.** Six teams of one exists (protocol v32): "you vs five, each
  for themselves" is a recipe.
- **Respawning enemies.** The dummy range's respawn pass is the wave
  mechanism in embryo (2s, back on the spawn slot, full reset). Generalising
  it from `dummy` to a per-seat `respawns` flag with a bot brain attached is
  the ONE new mechanic in the roster below (challenge 12).

## Recipe format

```ts
interface Challenge {
  id: string;                 // "two-on-one"
  tier: "easy" | "medium" | "hard" | "deathwish";
  name: string;               // Tom's voice, plain (indie-voice rule)
  premise: string;            // one line, the share-card line
  arena: string;              // registry id — challenge-only arenas need NO protocol bump
  you: { weapon?: WeaponId; abilities?: AbilityId[]; hp?: number; moveFactor?: number };
                              // undefined = player's own pick via the wizard
  seats: Array<{             // every bot, allies included (team 1 = yours)
    team: Team; difficulty: DifficultyId; weapon?: WeaponId; abilities?: AbilityId[]; hp?: number;
    archetype?: ArchetypeId;  // override the kit-derived brain (the rookie's `ward`)
    protect?: boolean;        // the round is LOST the tick this seat dies
  }>;
  sandsDelay?: number;        // seconds; undefined = the shipped 45
  win: { type: "lastStanding" } | { type: "kills"; count: number } | { type: "survive"; seconds: number };
  reward: { glory: Band; deed?: DeedId };   // FIRST clear only
}
```

Seeded by wall clock like practice (a challenge should feel different each
attempt); the seed + input log are kept for verification (below).

## The twelve (proposal)

Tiers map to bot presets roughly: easy Novice/Average · medium Experienced/
Skilled · hard Skilled/Adept/Masterful · deathwish Masterful/Inhuman/Godlike.
"Own kit" = the arming wizard runs as normal. All are last-one-standing unless
stated. Arena is a suggestion; First Blood's pillar suits kiting fights,
Obelisk's open floor suits being outnumbered.

| # | Tier | Name | Premise | You | Foes | Twist | Glory |
|--:|---|---|---|---|---|---|--:|
| 1 | easy | Two on one | beat two at once | own kit | 2 × Novice | — | 10 |
| 2 | easy | Bow only | win with the bow and nothing else | bow, no abilities | 1 × Skilled, blade + dash | the closer punishes lazy kiting | 10 |
| 3 | easy | Half a heart | start on half health | own kit, hp 50% | 1 × Adept | — | 10 |
| 4 | medium | Three on one | beat three at once | own kit | 3 × Average | — | 25 |
| 5 | medium | Hammer, nothing else | the slow weapon against a quick one | hammer, no abilities | 1 × Skilled, blade + dash | — | 25 |
| 6 | medium | Carry the rookie | keep the rookie alive, win the fight | own kit | ally: 1 × Novice, bow, `ward` brain · foes: 2 × Skilled | 2v2 shape · lose the instant the rookie dies | 25 |
| 7 | hard | Four on one | beat four at once | own kit | 4 × Skilled at 50 max hp | — | 50 |
| 8 | hard | Through the arrows | close the gap under fire | blade, no abilities | 3 × Experienced, all bows | Obelisk (open floor) | 50 |
| 9 | hard | The tide waits for no one | the blood tide rolls at ten seconds | own kit | 3 × Skilled, all blade + dash | sandsDelay 10 | 50 |
| 10 | deathwish | Yahtzee | five in a row | own kit | 5 × Skilled at 50 max hp, one every 5s | sandsDelay 20 · the stream | 200 |
| 11 | deathwish | Godlike | no room, no time, no mistakes | own kit | 1 × Godlike, **counter-picks your weapon at START** (`COUNTER_KITS`) | sandsDelay 10 | 400 |
| 12 | deathwish | The horde | thirty-five kills before they get one | own kit | 4 × Novice at 20 max hp, respawn 5s, arriving every 4s | win: kills 35 · objective HUD | 200 |

Why this shape:

- **Easy teaches.** Two-on-one teaches target switching, bow-only teaches
  kiting against a bot that dashes in when you kite badly, half-a-heart
  teaches not trading against a Skilled bot. Two-on-one is the first-session
  gimme; the other two are "easy" in premise, not in execution (Tom
  2026-09-26: both needed making harder).
- **Medium is the 1v3 rung plus two lessons** (the hammer's timing, and
  carrying a bad teammate). Replaced "Six enter", which was just a brawl
  (Tom). **Carry the rookie is an escort**: a 2v2 where your ally is a Novice
  bot with a bow and the enemies are two Skilled bots, and the round is lost
  the instant the rookie dies (Tom 2026-09-26: "require it that the bot has
  to stay alive"). The rookie plays a new `ward` archetype — the coward the
  brain was explicitly stopped from being (bot.ts: the 3.5s flee budget,
  Tom 2026-07-22) — because here cowardice is the point:
  - bow, so it keeps shooting from range and isn't pure dead weight;
  - band held wide (sniper-ish `near`/`far`), `disengageBelow` high (~0.9)
    so it runs at the first scratch, and the flee budget lifted for this
    preset only (a `fleeBudget: null` field; every other archetype keeps 3.5s);
  - `anchorLeash` to YOU, so it runs toward you rather than into a corner,
    and the enemy bots' `focus: "weakest"` archetypes will naturally hunt it.
  The fight becomes: peel two Skilled bots off a bow that keeps running
  behind you. The rookie also NEVER counts as "last stand" — it flees even
  when you're down, but that's moot since you're the one who must win.
- **Hard is the marketing tier.** 1v4 is the headline clip. The arrow wall
  and the early tide make two more clips that read at a glance.
- **Hard's tide fight is three closers.** Three Skilled blade-and-dash
  bots with the tide at ten seconds: nowhere to kite, and every one of them
  can close the gap. May deserve the 100 band; Tom's call.
- **Deathwish is the summit.** Godlike is the crown by prior decision, but a
  single Godlike bot can still be tricked (Tom 2026-09-26). The recipe closes
  the tricks rather than adding bots: it holds blade + dash (the closer, so
  kiting loops don't work) and the tide rolls at ten seconds (so there's no
  room to run a geometry trick for long). If that's still trickable the next
  step is 2 × Godlike, not more twists. Any trick found while tuning goes
  into the exploit gauntlet (`botGauntlet.ts`) — the real fix is a bot that
  can't be tricked anywhere, not just here. The horde is the only one needing
  new sim work; if it slips, the fallback is "Three on one, Masterful" at the
  same band.

## Rewards and attempts

- **Glory pays on first clear only**, at the band in the table (bits-deed-glory.md
  bands; totals 1 125 across all twelve — inside the 9 000 budget but Tom's
  tuning owed). Re-clears pay nothing; they're for the attempt counter.
- **Deeds:** one per tier for clearing every challenge in it, and a
  chapter capstone for clearing them all. No copy names a count (Tom
  2026-09-27: the catalogue grows); tier thresholds derive from the list. Titles for the tier clears; the
  capstone reward is Tom's call (a wardrobe piece keeps it ranked-facing —
  worn cosmetics only show online).
- **Attempts:** an attempt = a round that reached "active" and ended without
  the win (death, or leaving mid-round). Counted per challenge, stored locally
  (AsyncStorage) and mirrored to the deeds counters as `challenge:<id>:attempts`.
  Shown on the card ("attempt 31") and on the share card at clear.
- **Ranked funnel:** the challenge screen shows the queue's ping pill and a
  "Ranked" door; tier-clear titles say so on the ranked board.

## Trust

Practice pays nothing today because BITS deeds are server-awarded and Glory
buys real things. Two stages:

1. **Ship:** client reports `challengeClear { id, seed, attempts }`, server
   pays the band once per account per challenge (the skirmish precedent —
   "verify ranked, trust skirmish", Tom 2026-08-08). Exposure is capped at
   1 125 Glory per account, one-off, so a spoofed clear is a nuisance, not an
   economy.
2. **Verify (later):** the sim is deterministic, so the client uploads seed +
   per-tick input log and the server replays the match headlessly (the bot
   script's sim) and pays only if the replay clears. Same cost as one bot
   match; input logs are ~3 600 ticks × a few bytes.

## Objective HUD (the horde, and any non-last-standing win)

Last-one-standing needs no HUD — the arena already tells you when it's over.
Kills and survive wins do (Tom 2026-09-26: the horde needs a counter that
shows how close you are). One strip on GameScreen, challenge matches only,
under the round clock:

- `kills`: "7 / 20" with a thin fill bar; the number ticks on each of YOUR
  lethal hits (the `hit` event with `lethal: true` and `attackerId` = you —
  respawned seats count again, that's the point).
- `survive`: a countdown "0:42" that runs while the round is active.
- `protect`: the ward's health as a thin bar with its name ("Rookie 62%"),
  turning red under a quarter. The loss card on its death says so plainly
  ("the rookie's dead") — it's a different failure from your own.
- Both flash on the last 10% and hand off to the clear/loss card.

The counter lives in the challenge runner (client), not the sim: it reads
the same events the deeds accumulator reads, so the replay verifier (below)
can recount it identically server-side.

## Ratified decisions (Tom, 2026-09-26)

1. **Own mode-select card.** Not a Practice tab — it's a destination.
2. **Own kit for the outnumbered fights.** Players should play around with
   their loadout and work out what beats numbers; that IS the replay value.
   Only the kit-lesson fights (Bow only, Hammer nothing else, Through the
   arrows) lock the kit.
3. **Glory bands as tabled** (1 125 total, first clears only). Worst case a
   spoofed run hands someone a Signet's worth for free — acceptable until
   the replay verifier lands.

## Screen (sketch, art owed)

**Mode select placement:** the stack today is Ranked full-width, then
Skirmish + Practice as a half row, then Deeds + Spectacle as a half row, then
locked Story. CHALLENGES goes **full-width directly under Ranked** — it's the
second flagship (the offline hook and the marketing feed) and a half card
crops the art too hard for a "1v4" silhouette. The column grows one
card-height; whether that scrolls or the units tighten is judged on device,
and the four-beat reveal roll gains a beat (mode-select's shared-slot trick
covers the half rows only). Card art: a Forge brief owed — one fighter, many
shadows, the reveal-roll style of the other cards.

The screen itself is four tier rows of three cards; a card
shows name, premise, attempt count, cleared tick, Glory band. Tap → the
arming wizard (skipped for locked kits) → the match on GameScreen. On clear:
the matchEnd kit reveal, then a share card (premise + attempts) with a deep
link `bloodinthesand://challenge?id=…`. On loss: attempt +1, "again" is one tap.

## Sim work, in order

1. `seats` override on `createSim` (or accept empty seats) + forced seating.
2. `sandsDelay` as a sim config field (replaces the dev env dial in practice).
3. Placement `hp` per seat outside the Primer (the Primer's contract, lifted).
4. Bot allies at a different tier from the foes (per-seat difficulty —
   practice today uses one tier for every bot), plus per-seat archetype
   override and the `ward` preset with its lifted flee budget.
   Challenge runner: `protect` seats end the round as a loss on their death
   (client-side today, from the lethal `hit` event; the sim's own round-over
   rule is untouched).
5. Challenge 12 only: generalise `respawnDummies` to `respawns` seats with a
   brain, plus a kills win condition and the objective HUD.

## Open questions for Tom

- The all-twelve capstone reward (lean: a title + a wardrobe piece, so it's
  worn where other players see it — ranked-facing by construction).
- ~~Godlike still trickable after the blade+dash+tide recipe → 2 × Godlike?~~ Answered 2026-09-27: counter-pick + Ironhide-aware brain instead (see the Godlike rework below).
- Names — these are placeholders in your voice, fix them freely.
- Card art brief for the Forge.

## Build notes (2026-09-26)

**Sim** (`packages/blood-in-the-sand-sim`, 14 new tests in `challenges.test.ts`):
- `state.sandsDelay` / `state.winsToTake` (null = shipped config; `Infinity`
  delay = the tide never comes, Call the Tide gated off); `sandsDelayOf`.
- `ArenaPlayer.startHpFrac` (YOUR handicap, applied at every round reset and
  respawn), `maxHpScale` + `setPlayerMaxHpScale` (a foe's smaller pool,
  baked into its stats so it still spawns on a full bar — Tom 2026-09-27:
  a half-empty bot reads as us nerfing it for you), `respawns` (the dummy range's respawn pass, generalised; a
  respawning team is never "wiped"), `kitLocked` (the arming gate treats
  the seat as armed even with an empty hand).
- `concludeRound(sim, winner, events)` — the tail of `checkRoundOver`,
  exported for the host's own verdicts (kills, the ward's death).
- Spawn lines centre on the SEATED count per side, so a lone fighter stands
  on its anchor (a full room is unchanged).
- `ward` archetype (`fleeBudgetTicks: null` — the one preset that may run
  all round); every other preset keeps the 3.5s budget.
- `ArenaPlayer.cooldownScale`: multiplies that seat's cooldowns at cast
  time, never below the active window (`you.cooldownScale`). Built for the
  horde on a misread of "allow unlimited ability uses" — Tom meant
  unlimited CASTS, which every challenge already has (the practice flag
  never spends the charge budget). Reverted to 1 the same evening after the
  sims showed a zero scale turns Ironhide into a permanent shield (1v5:
  0% → 100% for the Oracle, still 0% for Godlike). Kept as a dial; no
  recipe uses it. The gauntlet's `COOLDOWN=` env is the what-if knob.
- `challenges.ts`: the twelve recipes, `challengeById`, `challengeTeamSize`.
- `achievements/defsChallenges.ts`: the `challenges` board — one deed per
  challenge whose bounty IS the challenge's Glory (paid once by
  `applyMatchAchievements`' idempotency), the first-clear root, four tier
  titles, the all-twelve capstone (title; Tom's call on more), Stubborn
  (100 attempts, secret). `challengeCountersAfter` folds a report into the
  `challenge:` namespace (attempts only climb; aggregates recomputed).
  `BOUNTY_BUDGET` 9,000 → 10,200 to admit the 1,125.

**API** (`apps/blood-in-the-sand-api`): `POST /challenges/report
{ id, cleared, attempts }` → counters folded, board evaluated, unlocks
applied through the settle writer; returns `{ unlocks, counters }`. The one
client-trusted award path (30/min/player).

**Client** (`apps/blood-in-the-sand`):
- `PracticeClient(..., challenge)`: seats the recipe (forced teams, fixed
  kits filled from the FREE roster, per-seat tier + pinned archetype, hp,
  respawns), sets the dials, force-starts the partial room, and JUDGES the
  round off the host's events (`judge()`): your lethal hits count kills,
  a protected seat's death concludes as a loss, kills/survive conclude as
  a win. `objective` feeds GameScreen's strip; `challengeResult` +
  `challengeUnlocks` feed the result card. Reports every round.
- `challenges/progress.ts` (device tally, server counters adopted on open),
  `challenges/link.ts` (`bloodinthesand://challenge?id=`, ships in every
  build).
- Screens: `ChallengesScreen` (4 tiers × 3 cards, attempts, cleared tick,
  Glory); the pre-match lobby is **RoomScreen in challenge dress** (Tom's
  first look, same day: the locked-kit grey brief and the own-kit room
  lobby looked like two different products) — the same wizard for an own
  kit (skipped when locked), then `ChallengeLobbyView`: tier eyebrow, name,
  premise, attempt number, the opposition WITH their kits and tiers, your
  arsenal sockets, and an explicit **START THE CHALLENGE** button. Nothing
  counts down until it's pressed (`PracticeClient.begin()`; the lobby clock
  waits — Robin Hood used to count itself in after a beat); after START the
  count is a 2s veil. `ChallengeCards` is the result card with the deeds
  ceremony; the mode-select CHALLENGES card (full width under
  Ranked, painted ramp until the art lands; the reveal roll is five beats,
  stagger 0.18 → 0.15), GameScreen's objective strip (kills / survive /
  ward hp).

**Fixed on Tom's first device pass (2026-09-26):** the post-match lobby
clock restarting a full-room locked-kit challenge underneath the deeds
ceremony (the clock now stays stopped once a round has a result; AGAIN
seats a fresh client). Tom renamed the twelve in `challenges.ts` (Robin
Hood, Yahtzee, Blot out the sun…); deed titles follow the names.

**Autopilot + gauntlet (Tom, same day: "a rod for my own back" — some of
these can't be beaten by thumb, and the clips need beating them).**
- Seating and judging moved INTO the sim (`seatChallenge`,
  `createChallengeJudge` in `challenges.ts`): the phone's PracticeClient and
  the headless gauntlet run the same seat, the same dials, the same verdict.
- **Dev autopilot** (`devFlags.autopilot`, the home dev menu's CHALLENGE
  AUTOPILOT row: OFF → GODLIKE → MASTERFUL → SKILLED): the shared bot brain
  drives your seat in the next challenge, stick ignored, the real
  GameScreen rendering — record it. Dev/internal builds only
  (DEV_MENU_ENABLED); read once per challenge client.
- **`bun run challenges:sim`** (`src/challengeGauntlet.ts`): every recipe ×
  seeds × (own-kit recipes: four candidate kits) × the recipe's arena or
  the rotation, autopilot at `TIER` (default godlike). Prints clear rates,
  mean clear time, loss reasons, the horde's mean kills. The first read is
  below; it is the ceiling a perfect-execution bot reaches, NOT a human
  forecast — the brain was built to duel, not to fight outnumbered.

  First gauntlet, 2026-09-26 (godlike autopilot, 8 seeds × kit × arena):

  | Challenge | Best clear rate | With | Notes |
  |---|--:|---|---|
  | Folie à deux (2v1) | 79% | staff dash+sandstorm | hammer 0% — the brain can't hold two off |
  | Robin Hood | 75% | locked | ~13s clears |
  | Half a heart | 50% | blade dash+ironhide | |
  | Three's a crowd | 33% | staff | blade 4%, hammer 0% |
  | Bring down the hammer | 63% | locked | ~10s clears |
  | Rookie's first day | 83% | blade | the ward dies in 1–9 of 24 depending on kit |
  | Four little heart-breakers | 4% | bow | effectively unbeatable for the brain |
  | Blot out the sun | 0% | locked | a blade with NO dash vs three bows never closes |
  | A rising tide | 21% | bow | |
  | Yahtzee (1v5) | 0% | any | never |
  | Godlike | 75% | blade dash+ironhide | 8s clears — godlike-vs-godlike favours the closer |
  | The horde | 4% | bow | mean 6–7 kills of 20 before dying |

  Read: the duel-shaped fights are recordable today (autopilot on, a few
  takes). The OUTNUMBERED ones (1v4, 1v5, the arrow wall, the horde) sit at
  or near zero — the shared brain fights one body at a time and dies to
  the rest. That is a fact about the brain, not proof a kiting human can't;
  but it does mean no clip comes out of the autopilot for those four until
  either the recipes ease (a tier down, a dash for the arrow wall's blade,
  fewer/weaker horde seats) or the brain learns outnumbered play (a real
  project). Tom's call.

**The Oracle — a skill above Godlike (Tom, same day: "build a level of
skill above Godlike using this simulation logic").** `src/oracle.ts`.
Godlike is perfect execution of a duelist's heuristics; the Oracle is
FORESIGHT. The sim is pure and deterministic and an offline host owns
every opponent's brain, so every few ticks it clones the match
(`cloneSim`: plain-data state copy + RNG restored at its draw count),
plays each candidate move forward ~1s against the real opponents thinking
their real thoughts (cloned memories, their own tiers), scores where that
lands (won/lost soonest; else my health, kills, foes' health, the gap for a
ranged kit, not flanked, not cornered), and holds the best move until the
next replan. Candidates: the Godlike prior ±casting, standing still, 8
compass directions ±casting (19 rollouts). Two budgets: `ORACLE_FULL`
(horizon 30, replan every 5 — the gauntlet, ~6s per simulated match) and
`ORACLE_LITE` (horizon 24, replan every 10, foes re-think every 2nd tick —
the phone; device cost is the open question, Tom's pass owed). NEVER a
difficulty tier: no player faces it; the dev menu's autopilot row (OFF →
ORACLE → GODLIKE → …) and `TIER=oracle bun run challenges:sim` are its only
callers. First read: 1v4 4% → 67% (bow), the arrow wall 0% → 50%; the
rest in the table below as the runs land.

**The outnumbered fights, retuned by simulation (2026-09-26, late).** Tom
asked for a winnable tier. There isn't one: five bots at once is 0% for
the Godlike proxy from Adept down to NOVICE, and 0% for the Oracle down to
Average (17% vs Novices). Attacks land automatically in reach, so five
bodies in reach is five auto-attacks whatever their tier; a 1.25× speed
handicap didn't help (they dash to close); nerfing their hands to Blood
Font + Straw Man didn't help (their damage is the auto-attack); a stream
of one every 8s, 12s, even 40s didn't help — a Godlike duelist doesn't
reliably beat ONE full-health Adept, so five in a row compounds to zero.
The horde told the same story: three Skilled respawners kill the proxy
before its first kill, so respawn 10s/15s changed nothing. What moved
both was WEAKER BODIES — the classic horde ingredient — plus timing:
- **Yahtzee** → five Skilled at 35% hp, one arriving every 6s (`spawnDelay`
  i×6). Proxy 44% (bow); 5v1 at once stays in the premise. 09-27: now
  35 max hp on a full bar (was 35% of 100) — re-run 42% (staff). Then
  Tom's tune: 40 max hp, one every 5s — proxy 22% (staff), 0% hammer.
  Then 50 max hp (matching the 1v4) — proxy 14% (staff), bow 6%, blade 3%.
- **The horde** → three Novices at 20% hp, arriving every 4s, 8s down
  between lives (`respawnSeconds`). Proxy 33% on ranged kits, 0% melee;
  two-seat variants reached 56% (staff) if it needs easing. 09-27: now
  20 max hp on a full bar — re-run 36% (bow). Later 09-27, Tom: too
  soft — four seats, 5s down, 35 kills. Proxy 0% on every kit (best
  mean 10 kills, bow).
New sim dials for this: `ArenaPlayer.spawnDelay` (pending seats wait off
the sand and count as alive), `state.respawnSeconds`. Gauntlet what-ifs:
`FOE_TIER`, `FOE_HP`, `FOE_HAND`, `FOE_WEAPON`, `FOE_MAX`, `STAGGER`,
`RESPAWN`, `MOVE`, `COOLDOWN`. The Oracle's `killWeight` (1500 on
kill-count recipes) stops it kiting the horde forever.

**Owed:** on-device pass of the new lobby + the horde's pacing, the ward's
cowardice, the Yahtzee stream (pending bodies park at −10 000,−10 000 —
check nothing draws them), and the Oracle's per-tick cost on a phone; card
art + the seven deed icons; the share card; the replay verifier.

## Tall order (`the-titan`, hard) — 2026-09-27

Tom's 13th: a hammer on a PERMANENT Titan's Draught (`ArenaPlayer.permanentAbilities`
— the slot fires at the bell and its clock is held 1s into the window, so
clients drawing the grow-in from "time since cast" draw a giant) plus three
Lifeline healers, dash only (`exactHand`, which also locks the kit so the
arming gate passes a one-ability hand). Healers: 30 max hp, `healScale`
0.35 on the beam. New `medic` archetype — any beam weapon derives it: guard
spot ~170px behind the patient from the threat, fanned per seat, 250px
leash, pulled in when line of sight breaks, escape hop under 130px.
Proxy clears: as first specced 0%; titan alone 41%; 30hp healers 2%;
+heal ×0.35 7% (the 4v1 is 6%). Titan tier made no difference — the body
is the wall. Owed: Tom's device look, name/premise copy, a botGauntlet
medic row.

**Four little heart-breakers (1v4), 2026-09-27:** four Skilled at 50 max hp
(full bars). Proxy: blade 17%, bow 11%, staff 11%, hammer 0% (was 6% best
at 100; 60 gave 11% best, 70 barely moved it).

## Godlike rework (2026-09-27)

Tom: "as soon as you realise the enemy always has a blade you can just go
Blade + Ironhide and win a war of attrition". The proxy agreed: blade +
dash + Ironhide cleared the old recipe 77% (hammer + Ironhide 69%). Giving
the bot Ironhide too only moved it to 69%, so the kit wasn't the problem:
the brain never read an ENEMY's active buffs and only ever used its own
Ironhide as a last resort. Two fixes, both built:

1. **Ironhide-aware brain** (`bot.ts`, `botCasts.ts`; every bot, not just
   this challenge; ranked backfill benefits too). Sharp tiers (footwork ≥ 0.7):
   - *Wait it out*: a melee target's Ironhide is running → hold a band just
     past their reach (`IRONHIDE_WAIT`: +25..+60px) and circle, no gap-close
     hops, until it drops; then the ordinary band walks back in while the
     cooldown runs. Not against a shooter, not when the mark is under 15% hp.
   - *Trade with it*: a melee blow that actually lands is coming, mine
     answers it, theirs isn't running → Ironhide on purpose. A timed dodge
     dash still wins when it's available (i-frames take none of the blow).
   - Exploit gauntlet row `TOM blade vs IRONHIDE TRADER blade`: bot lost
     0–12 before, wins 12–0 after. Rest of the gauntlet unchanged.
   - Old recipe with the new brain: blade + Ironhide 77% → 46%. A godlike
     mirror (same kit both sides) sits at ~50%, which is honest.
2. **Counter-pick** (`challenges.ts`): the seat carries `counter: true` and
   `armCounterPicks` re-arms it at START against YOUR weapon (the phone's
   `begin()`; the gauntlet after the kit lands). The lobby hides its kit
   ("waiting on you" / "it picks its kit after you pick yours") and it's
   revealed on the press. `COUNTER_KITS` is a compile-enforced
   Record<WeaponId>, picked by brute force (`src/_counterSearch.ts`: godlike
   autopilot, every weapon × 8 hands vs blade/bow/staff/hammer/trident × 8
   hands, 12–24 seeds × 3 arenas). The weapon decides it; the hand barely
   moves the answer:

   | Your weapon | It brings | Proxy clear (mean over hands) |
   |---|---|--:|
   | blade | trident + dash + Ironhide | 5% |
   | fang | trident + dash + Ironhide | 9% |
   | hammer | trident + dash + sandtrap | 8% |
   | trident | bow + dash + harpoon | 4% |
   | bow | blade + dash + straw man | 7% |
   | staff | blade + dash + harpoon | 8% |
   | scorpion / bombard / lifeline | blade + dash + harpoon | 0–1% |

   Without the trident no free kit held blade + dash under ~40%; the
   trident's dead-zone game is what finally beats the closer. A recipe
   isn't a draft, so a paid weapon here is fine (the Titan precedent).

`challenges:sim` now: blade 4%, bow 4%, hammer 10%, staff 2% (godlike
proxy, 48 runs each). That's a perfect-execution ceiling, not a human
forecast, but it means no autopilot clip for this one any more.


## Retune — 2026-09-28

Tom's play-through notes: some mediums were far too easy, and one hard was
hard for the wrong reason. `challenges:sim`, godlike proxy, 8 seeds (24 runs
per own kit), before → after:

| Challenge | Change | Proxy best clear |
|---|---|--:|
| Robin Hood | 6 × Skilled blade + dash on **10 max hp** (one arrow each), one every 3s | 63% → 63% (5.3 kills per run, was 0.6) |
| Three's a crowd | foes Average → **Experienced** | 38% → 17% |
| Rookie's first day | the hunters **mark the rookie** (`hunt: "ward"` → `markId`) whoever's hitting them; the `ward` also runs from any foe inside 300px (`fleeWithin`), hurt or not. The fight is the peel | 79% → 46% (losses are now all "ward") |
| Tall order | heal ×0.35 → **×0.5**, so out-damaging the healing stops working; the giant is **relentless** and hunts you (`relentless` drops flee, band, reach-edge footwork and idle pauses; the hammer's reach-edge footwork read as it being scared off) | 13% → 17% (blade; the rest 0%) |
| Blot out the sun | bows are **never dealt a harpoon** (`bannedAbilities`: a drag into three bows was instant death) | 0% → 0% (the no-dash proxy never closes; Tom came close by hand) |
| A rising tide | foes Skilled → **Adept**, tide at **3s** (was 10s) | 21% → 4% |

New seat dials: `hunt` ("ward" | "you"), `relentless`, and
`bannedAbilities` (on `ChallengeSeat`). `seatChallenge` turns them into
`SeatedChallengeBot.pins` (`BotPins`: archetype, markId, relentless), which the
phone host, the gauntlet and the Oracle's foes spread into every `botThink`
call.
