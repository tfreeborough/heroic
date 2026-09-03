# Blood in the Sand — title moments: wearing your deeds loudly

2026-09-01, designed with Tom. Titles shipped as data (achievements.md §
wearable titles) but the wearing UX stalled at two quiet render sites: the
lobby roster row and a 10px italic line under the in-match name tag. Tom's
verdict: the in-match line is the *worst* place for them — long titles
("Christened with blood") sit right in the fight and block sight — and
nowhere does a title ever feel like a flex. This doc replaces the ambient
in-match line with four **moments**: short, loud, earned windows where the
title is the star and never in the way.

The through-line: **a title should appear when its wearer just did
something, not hover over them all match.** The announcer-pack flex
(monetisation.md) is the template — a cosmetic that fires at kill moments,
seen/heard by everyone, resolved client-side from public `RoomStatePlayer`
fields. Titles already ride that exact plumbing (`RoomStatePlayer.title`,
a deed id, `""` = bare), so everything below is presentation + one small
sim-side reveal rule. No protocol bump.

## The treatment: one recognisable style everywhere

Titles get a single shared look so they read as *the title* on every
surface, not ad-hoc gold text:

- Small caps (uppercase + smaller size), letter-spaced, the established
  title gold `#cfa964` (render.ts `C_TITLE`).
- Flanked by lucida marks: `✦ THE SAND SNAKE ✦` — the same glyph the
  Chronicle's WORN badge uses, so the picker and the flex rhyme.
- Long titles **auto-shrink, never wrap** (`numberOfLines={1}` +
  `adjustsFontSizeToFit`). A title is a name; two-line names read as
  sentences.
- Bare (`""`) or unresolvable ids (newer server content) render nothing —
  every moment degrades to exactly what ships today.

One tiny shared component (`src/game/TitleFlex.tsx`, size prop) so the
tuning happens once — the DeedCards "feel is tuned ONCE" rule.

## Moment 1 — the entrance (round-1 countdown)

The pre-round countdown already teaches names + faction colours via the
centre "X vs Y" team hint. On **round 1 only**, the hint grows into a
tale-of-the-tape under the digit: each player's name with their title
beneath in the treatment, your side blue / theirs red (the standing
allegiance cue). The whole point: titles as pre-fight intimidation —
"oh, *The Fourth Horseman* is on their side."

*(Reworked same day from Tom's on-device pass — bare text on sand was
invisible and 3s unreadable.)* The entrance is now the **EntranceCard**
(`game/EntranceCard.tsx`): the honour roll's treatment applied pre-fight
— a dark gilded plate (RoundBanner's scrim tones + hairline border) with
the two columns landing as staggered facing pairs (~300ms apart). And
round 1's countdown runs **5s, not 3** — sim-side
`ENTRANCE_COUNTDOWN_SECONDS` in `resetForRound` (roundNumber 1 only;
rounds 2+ keep the snappy `COUNTDOWN_SECONDS` pace). Timer rides the
existing `RoundSnapshot`, no wire change.

- Rounds 2+ keep the plain team hint — the roster is known, thumbs are
  set, don't re-read it.
- **No loadout icons here.** Kit secrecy is a design pillar
  (pvp-pick-ceremony.md; cast flash = the in-match intel channel). The
  entrance shows *who* they are, never *what they're carrying*.
- Data is already on the client: `client.roomState.players` + local
  `resolveTitleText`. Bots included — they wear titles (`BOT_TITLES`).

## Moment 2 — the kill-call flex

The announce banner ("Ragnar gets a / DOUBLE KILL") grows a third line:
the killer's title in the treatment, under the big label.

    Ragnar gets a
    DOUBLE KILL
    ✦ THE CRIMSON BLUR ✦

Same lookup as the announcer pack (the killer's `roomState` row, resolved
off the same `hit` event on every client — the room stays in unison).
Fires for FIRST BLOOD and every multi-kill tier. Top-of-screen, existing
TTL, `pointerEvents="none"` — zero new sight-blocking. Bare title = the
banner ships exactly as today. *(On-device pass: 13px went unnoticed —
the title line runs 16px now, sized to read as the banner's third voice.)*

## Moment 3 — the slain-by credit

When *you* die, you have dead time and an unanswered question. A single
line, lower-centre (clear of the death camera's subject and the spectate
chip):

    Slain by Wife
    ✦ THE ADDER'S KISS ✦

The most personal flex in the game — delivered directly to the person the
title was just used on, and it costs the living zero pixels. Client-only:
the lethal `hit` where `targetId` is you names the killer; title from
their roomState row. TTL ~3.5s (it should not outstay the sting). Killed
by a bare-title player → just the "Slain by" line. Environmental/unknown
attribution → no credit at all.

*(Reworked same day from Tom's on-device pass — the bare two-liner was
barely noticed.)* Now the **SlainCredit** plate (`game/SlainCredit.tsx`):
a dark pill with a foe-red hairline that springs in (overshoot ease,
remounted per death so the spring replays) — small SLAIN BY eyebrow, the
killer's name 22px foe-red, title beneath at 14.

## Moment 4 — the roll of honour + the kit reveal (match end)

The match-end plate (RoundBanner `big` variant) holds for 8 sim seconds
(`MATCH_END_SECONDS`) showing title + score over dead air. It becomes the
victors' stage, **shown to both sides** — the defeat plate listing who
beat you and what they're called is the actual flex:

    VICTORY / DEFEAT (unchanged, + flavour line + score)
    ─────────────────────────
    Ragnar          ✦ THE SAND SNAKE ✦      [blade] [dash] [tremor] [ironhide]
    Wife            ✦ DEADEYE ✦             [bow]   [straw-man] [war-drums] [sandstorm]

One row per **winning-team** player: name, title, weapon + three ability
icons (`LoadoutIcon`, the Forge pixel-art set — never tinted). Rows land
staggered (~500ms apart) so it reads as a ceremony, not a table. Bots
appear like anyone else. *(Layout rule from Tom's on-device pass,
2026-09-01: a title NEVER shares a line with the name — the row is an
identity block (name over title, left-aligned, flexed with minWidth 0)
beside the icons, so long name + long title shrink instead of shoving
the icons off screen. TitleFlex itself carries `maxWidth: "100%"` for the
same reason — unbounded, `adjustsFontSizeToFit` never engages — and the
kill-call banner bounds its lines with horizontal padding. Also from that
pass, 2026-09-03: while the match-end plate is up the CONTROLS and the
spectate chip hide — they render above the plate in the tree and sat on
the roll of honour, and there is nothing left to input; the stick/cast
latches zero on hide, the existing death-gesture rule.)*

Why the kit: Tom, 2026-09-01 — the loser's question is "how on earth did
they dominate that?", and the answer is the winner's loadout. It closes
the match's story AND it's the shop window: a Fang or a Titan's Draught
on the honour roll is an ad targeted at exactly the player it just beat
(bits-store.md — the announcer-pack flex logic, applied to arms).

### The reveal rule (the one sim change)

Enemy picks are team secrets: `toRoomStatePlayers` nulls enemy
`weapon`/`abilities` per viewer. The honour roll needs them, so the veil
drops **when the match is decided and not before**:

- `toRoomStatePlayers` (snapshot.ts): reveal all seats' picks when
  `state.round.phase === "matchEnd"`. Not at `roundEnd` — between rounds
  there is still a match to play and cast-flash intel to earn.
- **Gotcha — the roomState diff key** (room.ts `syncRoomState`): the key
  hashes the *omniscient* roster, which does NOT change when the phase
  flips, so the reveal would never broadcast. The key must include the
  reveal state (phase-at-matchEnd bit).
- Practice mirrors it for free if it rebuilds roomState on phase change
  (practice.ts builds via the same `toRoomStatePlayers`) — verify.
- Protocol: amendment comment only, **no bump** — `RoomStatePlayer`
  already allows non-null picks (own team), old clients just keep
  ignoring enemy rows' values.
- The reveal is data-wide (everyone's kit becomes public at matchEnd);
  the UI only *shows* the winners. Future surfaces (a scoreboard, the
  spectator view) inherit the reveal for free.

Ranked settlement stays deliberately ABSENT from this plate
(bits-ranked.md § ceremony) — the honour roll is names, titles, and arms;
Glory/rating remains RankedCeremony's beat. The ranked ceremony hold
(`ceremonyOver`) already guarantees the full 8s window.

## What the ambient line loses

The in-match under-body title line (render.ts `TITLE_FONT`/`C_TITLE` draw
in `drawPlayer`, the `ArenaRenderInput.titles` map, GameScreen's
`titlesRef` plumbing) is **removed** — that's the sight-blocker Tom
vetoed, and the four moments replace its job. The lobby roster row keeps
its title line (out-of-combat, no cost). achievements.md § wearing titles
render rule amended accordingly.

## Sound

Nothing new fires for moments 2–3 (the announcer VO *is* the sound; the
slain-by credit rides the existing death sting). The entrance rides the
countdown ticks. The honour roll's staggered rows want a soft per-row
land — reuse an existing UI tick from the catalogue if one fits; if it
needs its own event, wire per bits-audio.md (catalogue entry + Forge
done-tick) rather than shipping silent-forever. Decide in build.

## Build map

- sim: `snapshot.ts` reveal gate; `protocol.ts` amendment comment.
- server: `room.ts` diff-key reveal bit.
- app: `game/TitleFlex.tsx` (new); `GameScreen.tsx` (announce third
  line, slain-by state, round-1 entrance roster, honour data to the
  plate, titles plumbing removed); `game/RoundBanner.tsx` (honour rows);
  `game/render.ts` (title draw + input removed); `net/practice.ts`
  (roomState phase-change rebuild, if missing).
- docs: achievements.md § wearing titles pointer + render-rule edit.
