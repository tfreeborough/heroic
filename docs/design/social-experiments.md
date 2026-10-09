# Social experiments

Status: **designed + first experiment built 2026-10-07** · Owner: Tom.

Big swings on TikTok to learn what the algorithm rewards, run while the
account is small (8 followers at the time of writing) so a flop costs
nothing. Each experiment is a ONE-OFF video, not a format: nothing in it is
meant to be reused. If one works, it gets promoted to a proper Desk template
(see [marketing.md](../marketing.md)).

## Where they live

`apps/bits-promos/src/experiments/<name>/` — one folder per experiment, each a
plain Remotion composition registered in `Root.tsx` and, so it can be voiced,
scored and queued like any other clip, listed in `desk.templates.ts` under an
"Experiment ·" label. Build it in Studio (`bun run studio`), render it from
the Desk. Generated media (scores, data) goes under `public/experiments/`,
which is gitignored: the code regenerates it.

Why Remotion and not an animated website screen-recorded: a composition is
just React, so anything a page can draw it can draw, but every frame is a
function of the frame number, so the voice-over lands on the exact frame
every render and there are no dropped frames. The one rule: nothing on screen
may run off the wall clock (no CSS transitions, timers, self-ticking
libraries).

## Experiment 1 · the attention test

**Hypothesis.** Telling the viewer they are being tested on how long they can
watch without swiping, and showing them how far they've got, makes them stay
to beat everyone else. TikTok sees completion rate and total watch time,
both top-ranked signals, and pushes the video.

**Risk and the mitigation.** A new account's first videos shape who TikTok
shows it to. A pure psychology gimmick pulls a general audience and the next
BITS clip flops with them. So the video is BITS-coded by construction: a bot
match plays underneath, the facts land as deed cards with real emblems, the
beats are the game's own weapon hits, the crowd is the arena's ambience.

**Screen.** `src/experiments/attention/AttentionTest.tsx` (second pass,
10-07: Tom's verdict on the first was that only the bar landed, the "most
people left here" line was easy to miss and the deed cards meant nothing
if you don't know the game. Principles now: readable at a glance, big
type; nothing needs game knowledge, the game is the footage; persistent
beats transient.)

- Progress bar up the LEFT edge, bottom to top. The right edge is under
  TikTok's button rail (roughly the right 15% from 45% to 80% of the
  height); the bottom quarter is caption territory; the top tenth is the
  header. The percent rides the bar's head.
- The bar is eased: displayed % = 1 − (1 − t)^curve (default 1.6). The
  first third feels quick, the last ten percent takes its time. Everything
  on screen keys off the DISPLAYED percent.
- "N% of viewers still here" big at the top. The count is modelled (floor +
  (100 − floor) × (1 − d)^2.2, floor 1: in Tom's analytics under 1% watch
  to 100%), not measured; the caption says so and the
  follow-up video reports the real retention curve from analytics.
- CHECKPOINTS keyed to the COUNT, not the bar (the bar-keyed first cut
  said "half the viewers" while the count read 24, Tom 10-07): as the count
  falls through 50 / 25 / 10 / 3 a compact crimson PILL slides in under the
  count with a positive line about the viewer ("You've outlasted half the
  viewers", "You're in the top 25%", "You're in the top 10%", "Top 3%.
  Nearly there"), a whoosh (the Hammerfall fall), the count flushes red
  and jumps. Replaced the deed cards and the stands. The first cut was a
  full-width 190px band with loss-framed copy ("Half the viewers have
  gone"): too big, and counting who left rather than the viewer's progress
  (Tom, 10-08). Flex-centred so it sits right in every player.
- ONE fact at a time in the middle band, "6 / 10" small above it, revealed
  in two parts: the first sentence, then the rest a beat later beneath
  (`reveal`, default 2.4s) so the payoff lands while the setup is still up;
  the next fact crossfades in. (A ledger that kept older facts compressed
  in grey underneath was tried first: confusing to the eye, and the next
  arrived before you'd finished the last.) On a Desk edit the facts land on
  its markers (press M where you say each one), the same mechanism as the
  list clip; on a plain recording they spread evenly in REAL time from the
  end of the `intro` (default 18s: the hook plus Tom's 15-second read of
  the opening, measured 10-07) to seven seconds before the cut, so fewer
  facts means longer on each (spreading over displayed % bunched them
  early; Tom 10-07).
- The match underneath is graded from near-black and drained to full colour
  as the bar climbs; the vignette opens then closes again near the end; the
  footage trembles more as the quake grows (overlays stay still).
- Hook on frame zero, three seconds, then the count and fact fade in.
  "You are being tested." was the first; Tom: a statement, he'd swipe it.
  Dares and claims ("Only 4% finish this", "You won't last 90 seconds")
  were the second pass; Tom: cliché, people swipe those too. The hook is a
  plain first-person ASK, in the voice everything else is written in: it
  gives the viewer a role instead of a challenge to decline. Default "I'm
  running an experiment on attention. You're in it." (Tom's pick, 10-07).
  In the Desk the hook is a VARIANT field like the
  hook clip's: add several lines and one press renders each as its own
  video, so the opener is A/B-tested on TikTok rather than argued about.
  Candidates in the same register: "Help me run an experiment.", "I need
  you for an experiment.", "Can you help me test something?", "Quick
  experiment. I need 90 seconds of you.", "Help me find out how long you
  can watch this." Final card on the cut, over the hall's ring-out,
  near-solid: "100%", "you made it", "Comment the % where you nearly
  swiped." (Gotcha: inside an AbsoluteFill, an absolutely-positioned dim
  paints OVER non-positioned text siblings whatever the DOM order; the text
  block needs position: relative.)

**Facts** (ten, in speaking order, `ATTENTION_FACTS`; each two sentences,
the second is the reveal. Tom's verdict on the first list, 10-07: usage
statistics aren't facts and aren't interesting. These are all findings
from named studies, checked against the originals on 2026-10-07):

1. Simons & Chabris 1999, "Gorillas in our midst": about half of viewers
   counting basketball passes miss the person in the gorilla suit.
2. Killingsworth & Gilbert 2010 (Science): minds wander 46.9% of waking
   time, and people are less happy when they do.
3. Wilson et al. 2014 (Science): left alone to think for 6–15 minutes, 12
   of 18 men (67%) and 6 of 24 women (25%) self-administered a shock they
   had earlier said they'd pay to avoid.
4. Ward et al. 2017, "Brain Drain": the mere presence of one's own phone on
   the desk reduces available working memory; another room beat the desk,
   and slightly beat pocket/bag; worst for the most phone-dependent.
5. Stothart, Mitchum & Yehnert 2015 (JEP: HPP): a notification you don't
   respond to is as distracting as answering; three times the probability
   of an error.
6. Altmann et al. 2013 (JEP: General, Michigan State): ~2.8s interruptions
   doubled sequence errors, ~4.4s tripled them.
7. Blink rate: 15–20/min normally, 4–6/min at a computer (several
   computer-vision-syndrome studies; the exact drop varies, 50–60%).
8. Nielsen Norman Group (Weinreich et al.): users read ~20% of the words on
   an average page, 28% at most.
9. Gloria Mark (UC Irvine): 2.5 minutes on one screen in 2004, 47 seconds
   by 2016.
10. The "8 seconds, less than a goldfish" figure: a 2015 Microsoft Canada
    marketing report citing Statistic Brain, which cited no research.

Dropped: phone-check counts, hours per day, TikTok completion rates and
session counts (usage statistics, not findings), task-switching 40%
(an upper bound, and dull), 23 minutes to resume (true but worn).

**Score.** `src/experiments/attention/score.ts` → `bun run attention:score -- --seconds N`

The rhythm is ONE real clock and the illusions live in pitch and density
(the Dunkirk recipe). Three drafts got here on 2026-10-07:

- *Draft 1, a true Risset rhythm* (layers at doubling tempos, loudness a
  bell over the stack, the fastest fading out as a new slowest fades in):
  Tom heard the hammers "reset" every cycle. Any distinct sound in the
  stack is a stream the ear follows, and every Risset stream doubles then
  hands off to one at half the rate. Only near-identical ticks blur across
  the handover.
- *Draft 2, hammer outside the stack* as a free accelerando, then snapped
  to the nearest tick: out of time, then irregular. Two clocks can't share
  a groove.
- *Draft 3, what shipped:* the HAMMER is the metronome, an honest
  accelerando from 24 to 80 BPM over the piece (`--hammer`, `--hammerRise`
  octaves; 36 → 109 ended "way too fast", 40 → 80 still started too fast,
  Tom 10-07), beat one of each bar heavier, tremor booms
  under it from a quarter in. Every other drum is a strict subdivision:
  ticks at 1, 2, 4, 8 per beat, triplet fills past the midpoint, war-drum
  rolls ending on a bar line every eight bars and into the cut, and the cut
  itself lands on a bar line. Regular by construction. The ticks carry a
  Shepard trick on DENSITY: the loudness bell drifts from the coarse ticks
  toward the fine ones one step per cycle and wraps, density-normalised so
  only the drift moves, so the texture always seems to be getting busier
  while every tick stays on the grid. A real 24 → 80 BPM accelerando over 90s plus
  a 5 dB swell is a big effect on its own, and it can't fall apart the way
  a Risset stack can.
- A real build on top (drum filter opening, pad brightening, the arena
  crowd thickening) so it feels inevitable rather than mechanical.
- More of the game joins the longer it runs (Tom's ask after the first
  listen, 10-07): the loudness bell widens so more subdivisions are
  audible; tremor booms under beat one from a quarter in and under beat
  three past the midpoint, bright enough to keep their rock-crack; blade
  and staff hits on the triplets of the beat past the midpoint; the
  war-drum roll into a bar line every eight bars and into the cut; a gong
  to open; cheers from the start, sparse and distant, then closer together
  and louder as it climbs (jeers for the first third, and the Tide's horn
  at 80%, were tried and dropped: the stands are with you, and the horn got
  lost in the mix); and the arena's earthquake rumble under everything,
  from nothing to a floor-shaking roar (`quake.wav`, its own stem). The
  quake is kept bright enough to read on a phone speaker (a rumble
  low-passed to 140 Hz is inaudible on one; Tom couldn't hear it) and built
  as a seamless bed: the bank's rumble is a four-second event with its own
  swell and tail, so its steady middle is found by RMS and the bed is
  rebuilt from half-overlapped Hann grains of it at random offsets in two
  voices, one at pitch and one lower (looping it whole repeated the tails).
  The video answers it with a tremble on the footage that grows with it
  (`shake` prop; overlays stay still). `--countdown` adds three clapper
  ticks before the cut (off: it telegraphs). The `events` list in
  score.json drives the video: the stands hop on a cheer.
- The ending: six seconds before the end everything stops ON one blow
  (the bombard's blast wave with a powder charge under it, the ground
  cracking, a quiet anvil ring, the body hitting the sand) and the whole
  thing rings out in an empty stone hall — a Freeverb-style reverb (RT60
  `--hall`, default 3.2s) with a slow echo in front, fed by the blow and
  the last second of the score so the drums recede into the room rather
  than vanish. Like a vast door slammed shut. The silence-then-hit version
  felt disconnected (Tom, 10-07). The hall is its own stem (`hall.wav`),
  played in the video un-ducked; the final card plays over the ring-out.

Defaults: hammer 24 → 80 BPM, 4 subdivision layers, a 5 dB master swell
over the length (`--swell`, every stem alike so the Desk balance holds; the
blow and hall sit outside it), the pitch and
density illusions drifting over a 25s cycle (`--bpm`/`--beats` only set
that cycle now). `--bellWidth` is the knob for "one clear tempo" (narrow) vs
"thick and ambiguous" (wide). Writes `drums / pad / crowd / reactions / mix.wav` as
stems (the Desk ducks pad, crowd and reactions under the voice, never the drums) and
`score.json` with every audible hit, which the composition reads to pulse
the bar on the real beats.

**Open.** Tom's listen to the 30s test (`public/experiments/attention/mix.mp3`),
then tune bpm / bellWidth / levels; pick the match footage (a 6-way Brawl
with the Tide closing, trimmed so the last kill lands on the cut); the
voice-over; length 60–90s for the first post, two minutes as a follow-up
experiment if the curve holds. The "stuck bar" and "false ending" tricks are
not built; they are the next knobs.

**Desk gotcha (10-07).** The Remotion Player caps simultaneous `<Audio>`
tags at five (`numberOfSharedAudioTags`); this composition plays six stems,
so the Desk preview showed the Player's ⚠️ fallback and the five tags that
had mounted kept playing with nothing to stop them. The CLI render has no
cap, which is why `remotion render` was fine. The Desk's Players now pass
`numberOfSharedAudioTags={12}`. To debug a Desk preview without the Chrome
extension: a headless probe with `@remotion/renderer`'s `openBrowser` →
`newPage` → `goto` the Make page, pick the template through the select,
and read the page's console errors (scratchpad script `desk-probe.ts`).

**The game/dev link (Tom, 10-07).** The honest motive IS the link: a solo
dev whose clips get swiped in three seconds built a test. And the length
is the game's: a BITS match lasts about 90 seconds, so the video is
exactly one match long and the ask is "watch one match" — the footage is
not wallpaper, it is the unit of time being tested. The voice-over
opens "Before you swipe... this is an experiment. I make a game on my
own, and eight in ten people swipe my clips in under three seconds…", and
points at the footage ("the fight underneath is my game"). The game is
NAMED only on the end card (`credit` line, default "That was one match of
Blood in the Sand, my mobile game. It's free on the App Store and Google
Play, just search the name." — Tom: say it's a mobile game and that they
can search the store), seen by the people who finished. The results video the following week is where the
dev angle pays off.

**Defaults as of 10-08 (Tom's mix after watching the Brawl render):** no
facts; pad 0.15 and padDuck 0.15 (the khoomei sits well under the voice);
captions regular; shake 10; floor 1; intro 18; endHold 2.5.

**Voice-over.** Tom's worry (10-07): a voice means fewer facts, and the
ducking would kill the Shepard effect. Resolution: the voice does NOT read
the facts (they're on screen, people read faster than he talks); it sets
the premise, says what the bar is, reacts to the count, one or two
asides, a quiet last line before the cut — ~30s of speech across 90s.
With a voice, eight facts (drop blink rate and the 3-second interruption),
or NONE: watching the Brawl render, Tom found it works with no facts at
all, just the bar, the count, the checkpoints and the voice. Zero facts is
a supported setting (blank rows in the Desk list are ignored).
The pad takes a SHALLOW duck (`padDuck`, default 0.65) while crowd and
quake take the deep one: the illusion is pitch motion and survives a
shallow duck. Drums are never ducked. Render a voiced AND a silent cut and
let TikTok decide.

**Measuring.** Post, wait 48h, read TikTok's retention curve. Compare average
watch time and completion against the hook clips. The follow-up video
("here's how many of you actually made it") is the second post.
