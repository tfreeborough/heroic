# Blood in the Sand — Deed Bounties (Glory for deeds)

Status: **designed + BUILT 2026-09-18** · numbers are a first pass, Tom's to tune ·
Applies to: **Blood in the Sand**

> The economy pass the deed docs kept deferring ("rewards deliberately unset —
> economy pass is Tom's"). Companion to [achievements.md](./achievements.md) (the
> engine and the `rewards` array this rides), [glory-economy.md](./glory-economy.md)
> (the ledger it pays into) and [bits-store.md](./bits-store.md) (what Glory buys).

## The problem

186 deeds, none paying Glory. Pay too much and nobody needs the Armory; pay too
little and an unlock feels hollow. Higher tiers and hard one-offs should pay more.

## What the numbers are anchored to

| | |
|---|---|
| A ranked win pays | 15–30 Glory (≈22 against an equal) |
| A ranked loss pays | 5 |
| A 50% player earns | ≈14 a match, ≈165 an hour at ~12 matches an hour |
| A Signet costs | 800 Glory (`SIGNET_GLORY_PRICE`) — ≈4.8 hours, the agreed 4–5h target |
| The shelf | 7 Signets today = 5,600 Glory ≈ 34 hours of match pay alone |

**The thing to hold on to: deed Glory is a finite faucet, match pay is the
endless one.** Every bounty is paid once per player, ever. So bounties can't
remove the need to buy — they can only bring the first purchases forward. Whether
a free player "never needs to buy" is set by the Signet price and match pay, far
more than by anything in this doc. Bounties are there for *feel*, front-loaded on
purpose: the early hours are when a player decides whether the game is generous.

## The bands

Every paying deed sits in one of eight bands (`bounties.ts`), picked by how long or
how hard the deed is:

| Band | Roughly |
|---:|---|
| 5 | a match or two — the first rung of a fast ladder |
| 10 | your first session |
| 25 | a few hours, or a nice moment most players will have |
| 50 | ~10 hours, or a real skill feat |
| 100 | ~25 hours, or a hard feat |
| 200 | ~50–100 hours, a capstone, or a very hard feat |
| 400 | hundreds of hours |
| 800 | the summit — one Signet at the default rate |

Authoring stays with the tier, next to its threshold: `rewards: [bounty(50)]`. The
type only accepts a band, so nobody invents a 37.

## The rules

1. **Ladders always climb.** A higher tier pays strictly more than the one below.
2. **The same hours mustn't pay twice over.** Wins is the spine and climbs one band
   a tier (10 → 800). Ladders that tick alongside it from the same play — kills,
   damage, Glory earned, 2v2 wins — sit a band lower.
3. **Fast ladders sit low.** Three spells tick at once and charges refill every
   round, so cast ladders pay 5 / 10 / 25. Weapon ladders pay 10 / 25 / 100 (the top
   rung is ~25 hours with one weapon).
4. **Skill beats hours.** Feats are priced by how hard they are: Flawless 25, By a
   Thread 50, Not a Scratch 100. Streaks likewise: 3 / 5 / 10 / 25 in a row pay
   25 / 50 / 200 / 800.
5. **Who is never paid** (all test-enforced):
   - the **skirmish board** — sealed, zero-pay (bits-skirmish-deeds.md);
   - **loss streaks and the joke deeds** — titles or nothing; never pay for losing;
   - **secret deeds** — they're consolations, and a bounty nobody can read is no carrot;
   - **deeds on Signet items** (Fang, Scorpion, Bombard, Lifeline, Sinkhole, Tar Pit,
     Titan's Draught ladders) — a deed on a bought item paying currency is a soft
     pay-for-Glory loop. This extends Tom's 2026-08-14 call on the writ feats to the
     generic ladders; it's structural in `defs.ts` (`withBounties` skips
     `SIGNET_*`), so a new Armory item is unpaid by construction and a new free or
     deed-gated one is paid by construction. Trident and Call the Tide are *earned*,
     so their ladders pay.
6. **A budget.** `BOUNTY_BUDGET` (9,000) caps everything the boards can ever pay,
   summed. New content that pushes past it fails the suite — raise it on purpose.
7. **Bounties never feed the Glory ladder.** `glory_earned` reads `ranked:` ledger
   rows only (2026-09-10), so a bounty can't push the chain that paid it.

## The payouts (first pass)

Total **8,155 Glory** across 133 paying deeds (of 186) — about ten Signets, of which
2,800 sits in five deeds that take hundreds of hours.

**The Pit — 2,970**
- Christened with blood: 10
- Ranked wins (5 / 25 / 50 / 100 / 250 / 500 / 1000): 10 / 25 / 50 / 100 / 200 / 400 / 800
- Win streak (3 / 5 / 10 / 25): 25 / 50 / 200 / 800
- Not a Scratch 100 · Still Standing 100 · By a Thread 50 · Flawless 25 · Never Doubted 25
- Loss streaks: nothing

**Brothers in Arms (2v2) — 1,400**
- Two Blades, One Sand: 10
- 2v2 wins (5 / 25 / 100 / 250): 10 / 25 / 100 / 200
- Assists (10 / 50 / 250): 5 / 25 / 100 · Revenge kills (5 / 25 / 100): 5 / 25 / 100
- Clutch rounds (1 / 10 / 50): 25 / 50 / 200 · Double kills (1 / 25 / 100): 10 / 25 / 100
- The Last Word 100 · Shieldwall 100 · Selfless 50 · In Concert 25 · The Ambush 25 ·
  Swift Vengeance 25 · Even Split 25 · The Meat Shield 25 · Matching Set 10
- The two jokes: nothing

**The Kill — 855**
- Killing blows (5 / 25 / 100 / 500 / 1250 / 9001): 5 / 10 / 25 / 50 / 100 / 400
- Damage dealt (500 / 2.5k / 10k / 25k / 100k): 5 / 10 / 25 / 50 / 100
- Carnage 50 · Killer Instinct 25

**The Arsenal — 725**
- Blade, Bow, Staff, Hammer, Trident (15 / 150 / 600 rounds): 10 / 25 / 100 each
- Fang, Scorpion, Bombard, Lifeline: nothing (rule 5)
- The Old Ways 50

**The three Arts — 530**
- Every free spell + Call the Tide: 5 / 10 / 25
- Sinkhole, Titan's Draught, Tar Pit: nothing (rule 5)
- Return to Sender 50

**Glory — 790** · Glory earned (100 / 500 / 2.5k / 5k / 8.5k / 15k / 25k): 5 / 10 / 25 / 50 / 100 / 200 / 400

**Blood & Mercy — 215** · Healing (500 / 2.5k / 10k / 25k / 100k): 5 / 10 / 25 / 50 / 100 · Lifeblood 25

**The Blood Tide — 670**
- The Horn Sounds 10 · Tide kills (10 / 60 / 250): 10 / 25 / 100
- Quicksand 100 · Baptism 50 · Waist Deep 50 · The Last Grain 50 · Undertow 50 · Let the Tide Decide 25
- Tidecaller (capstone): 200, with the title and the spell
- The three jokes: nothing

## What it does to a player

Modelled for a diligent 1v1 player at a 50% win rate (every spell cast every round,
one weapon at a time — so it reads high):

| Hours | Match Glory | Deed Glory | On top | Signets afforded |
|---:|---:|---:|---:|---|
| 2 | 330 | 195 | +59% | 0.4 → 0.7 |
| 5 | 825 | 320 | +39% | 1.0 → 1.4 |
| 10 | 1,650 | 685 | +42% | 2.1 → 2.9 |
| 20 | 3,300 | 1,125 | +34% | 4.1 → 5.5 |
| 50 | 8,250 | 2,235 | +27% | 10.3 → 13.1 |
| 100 | 16,500 | 3,730 | +23% | 20.6 → 25.3 |
| 300 | 49,500 | 5,415 | +11% | 61.9 → 68.6 |

So the first Signet lands at about 3.7 hours instead of 4.8, and a free player
clears today's shelf at about 26 hours instead of 34. Generous early, tapering to
a rounding error — which is the shape we want. If it reads too rich, the levers in
order of bluntness: drop the cast ladders a band (they're 40% of the early
payout), then the feats, then the spine.

## Farming

- **Fresh identities + account merge** was a real hole: bounties are front-loaded,
  a merge sums both wallets, so a reinstall could re-earn the early bounties and
  merge them in, repeatedly. **Closed**: `mergePlayers` holds back the source's
  payment for any deed the target already holds (compared against unlock rows, not
  ledger rows — an earlier merge lands as one aggregate row). Spent bounties stay
  spent (clamped at zero).
- **Throwing**: nothing here pays for losing. The two "first match" deeds pay 10
  whatever the result, once.
- **Win-trading for the 25 streak** (800): two people, ~25 staged matches, for one
  Signet's worth. Not worth it, and Elo drift breaks the pairing. Accepted.
- **Feats against disguised ranked bots** are easier than against people. Accepted —
  they have to count or deeds leak bot-ness (achievements.md).
- **Lifeline speeds the healing ladder.** It's the generic counter, the amounts are
  small, and the Lifeline's own ladder pays nothing. Accepted.

## Where it shows

- **Ceremony card**: `+50 GLORY` line (already built — it just had nothing to show).
- **Chronicle, unlocked row**: "Earned 50 Glory" (already built).
- **Chronicle, locked row**: "Pays 50 Glory" in a banked-down gold — new. The reveal
  rule keeps titles and secret steel hidden until earned; a Glory bounty is a
  carrot, not a spoiler. Secret deeds never pay, so nothing leaks.
- **Purse**: refreshes on the next menu screen as it always has; the bounty is in
  the ledger before the `deedUnlocks` message goes out.
- **HQ → Deeds**: a Bounty column and a "worth N Glory" total.

## Rollout

1. Deploy the game server (bounties pay from the first settle after).
2. Ship the client by OTA for the display. **No protocol bump** — the wire carries
   deed ids, amounts come from each side's own defs. An old client simply doesn't
   show the locked-row line.
3. **Back pay** for deeds players already hold: `bun run bounties:backfill` in
   `apps/blood-in-the-sand-server` — a dry run by default, `--apply` to pay. It
   writes the same ledger rows under the same idempotency keys as the live award,
   so it can't double-pay and is safe to run twice. Run it after step 1. Players
   just see a bigger purse; there's no ceremony for back pay.

## Open

- Tom's tuning pass on every number above.
- Whether rule 5's extension to the generic Signet ladders is what Tom wants (the
  08-14 call was about the writ feats specifically).
- A "Glory from deeds: earned / still to earn" line on the Chronicle shelf — cheap,
  not built.
- The flat 5-Glory loss still makes throwing faintly profitable (store-security
  audit, 08-15) — untouched here.
