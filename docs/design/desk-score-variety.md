# Score variety: the same style, a different piece every time

*Drafted 2026-10-24 (Tom + Claude). Status: **BUILT the same day** (§ As
built, below), uncommitted. Follows [desk-ascii-scripts.md](desk-ascii-scripts.md)
§ The score. Owed: Tom's listen to the audition set (before and after
folders under `apps/bits-promos/out/desk/audition/20df15c8*`), then
trimming any draw that sounds wrong rather than different.*

## The problem, in Tom's words

> They're good but I wish they had a lot more variety, quite a few of my
> videos essentially sound much of a muchness and I'd like it to still
> work thematically but make more interesting choices of sounds and
> progressions.

> I basically still want the music to follow the theme of the video, the
> problem is that most of my videos are about problems indie game devs
> face so they'll always get locked down to a few styles. I think what I'm
> looking for is more variety within those styles.

So: the mood planning stays as it is (a beat's mood still picks the mode
and the intensity, the video's main mood still picks the style). What
changes is how much a **style** pins down, and how much the **seed** gets
to decide inside it.

## Why two felt-piano scores sound like one piece

Reading `packages/music/src/journey.ts` as it stands, the seed chooses the
key, the tempo (inside a narrow band), one chord instrument, one tune
instrument and a five-note theme. Everything else is the same for every
video:

| Fixed today | What it does to the ear |
|---|---|
| **The pad plays under every chord, always** | one sustained synth bed under every video, whatever the style: most of the house sound |
| **One build order, fixed thresholds** | pad → chords → bass → theme → arpeggio → drums. Every video climbs the same staircase |
| **Chords struck once a bar** (felt, rhodes), held (ambient, downtempo), picked (guitar) | one way of playing per style, so felt piano is always "one soft chord a bar" |
| **One chord a bar, four-bar phrases, 4/4** | the harmonic rhythm (how often the chords change) never breathes |
| **One arpeggio figure**, up-and-down over the chord | every busy stretch ticks the same way |
| **Drums default to the same half-time groove** for styles with none of their own | felt, rhodes and guitar all get the one beat |
| **The theme**: 2 bars, 4–6 notes, a small contour vocabulary, restated every other phrase, same instrument and register throughout | one melodic idea for ten minutes, always worn the same way |
| **Voicing**: close, around middle C, minimum movement | the same lush mid-register seventh-chord cloud whatever the chords |
| **Room**: the mood's reverb and nothing else, no texture | every score in the same hall |
| **Harmony moves only one way**: the lift (up a tone, twice at most) | a chapter never changes key, only colour |

Five of the ten rows are the arrangement, not the notes. That's where the
sameness lives, and none of it is the style's business.

## What stays the same

- A beat's mood → its mode and intensity; big moment → the lift. The
  planner's job and prompt are untouched.
- The style comes from the main mood as now (`JOURNEY_STYLES`, the mood's
  list). A problem-video still gets felt, rhodes, guitar or downtempo.
- One piece, never crossfades. Changes still land on phrase lines, curves
  still glide.
- Same seed + same plan = the same file. Existing WAVs on disk stay; only
  a re-make (new plan hash, or **Another soundtrack**) hears the new
  composer. There's no versioning of the old composer: a re-made score
  for an old seed is a new piece, which is what the button says anyway.
- Quiet under the voice, at the same bed level.

## What the seed chooses inside a style

Each is a draw the seed makes once (a few per phrase, marked *per
phrase*), from a short list the style can trim. Anything the style
doesn't trim is open to it.

### 1. The foundation: what's under everything

Today: the pad. Instead one of

- **pad** (as now)
- **strings**, slower bow
- **a drone**: the home note held low (sub or low strings) under the whole
  piece, chords moving over it. The pedal-point feel. Suits focus, tense,
  eerie
- **nothing**: the chord instrument alone, dry. Suits felt, guitar, vibes
- **the chord instrument's own sustain** (held notes under its own strikes)

The pad becomes one choice in five instead of the floor of every video.

### 2. Figuration: how the chord instrument plays

Today: one play per style. Instead the style lists what suits it and the
seed picks, then may **change it at a chapter** (the one place a change of
hands is welcome):

- **strike**: once a bar, soft second strike when busy (as now)
- **pulse**: repeated eighths or quarters on the chord, the engine under a
  talking head. Felt piano pulsing quietly is a different piece from felt
  piano striking
- **broken**: the chord as a rolling figure, bass note then the rest
  (Alberti-ish), 8ths or triplets
- **rolled**: strummed/rolled chords, slower
- **held**: sustained (as now for ambient, downtempo)
- **pick**: fingerpicked (guitar, as now; harp)

### 3. Harmonic rhythm and phrase length

- **Chords change every bar, or every two** (*per phrase*): two when the
  phrase's intensity is low, one when it's up, with a seed-chosen bias so
  one piece breathes more than another. Two chords in a bar at a peak
  (the Save composer's `splits`, brought over).
- **Phrases of four or eight bars**, one choice per piece. Eight-bar
  phrases make the theme rarer and the build slower.

### 4. The build: which layers, in what order

Today one staircase. Instead a **recipe** per piece, each a different
order the layers join in by intensity:

- **classic**: pad/foundation → chords → bass → theme → figure → drums
- **groove first**: foundation → bass + figure → chords → theme → drums
  (the ostinato is the point; the chords are colour over it)
- **tune first**: foundation → theme → chords → bass → figure → drums
  (sparse and melodic, the theme carries the quiet beats)
- **chords first, no drums**: foundation → chords → bass → theme → figure
  (drums never; a piece that never gets busy)

Thresholds jittered a little per piece so two classic pieces don't switch
layers at the same intensities.

### 5. Figures: the arpeggio and the ostinato

Today one pattern. A list, seed-picked, may change at a chapter:

- up; up-and-down (as now); broken thirds; pedal alternation (a held top
  note against the chord notes); **three against four** (a 3-note figure
  over 4/4 so the accent walks); syncopated (off-beat).
- Rate: 8ths, 16ths or triplets, from the style's list; the driving mood
  still pushes it quicker.

### 6. The theme, worn differently

- Longer contour vocabulary and a **2- or 4-bar** theme.
- **Register**: stated in the middle, then up an octave at a peak, down
  one in melancholy (as now) or under a drone.
- **Augmentation**: the theme at half speed under a quiet beat.
- **A second voice**: an answer a bar behind on another instrument
  (celesta, vibes or strings for felt; the style lists the guests), or a
  held counter-note. Seed decides whether the piece has one.
- **Rests**: the theme can sit out a whole chapter, so its return lands.
- **A guest instrument for a chapter**: the theme moves to another voice
  for one chapter and comes back.

### 7. Harmony and voicing

- **Voicing register** per piece: close mid (as now), **open low** (a
  wide bottom fifth, chord tones spread: cinematic, tense), **high close**
  (toybox, curious), or spread (drop-2, already there as `open`).
- **Chapter modulation**: besides the lift, a chapter may move to the
  relative minor/major, down a fourth, or up a minor third, pivoting on a
  shared chord and coming back home for the end card. At most one key
  change of this kind, never in a short.
- **Pedal-point phrases**: with the drone foundation, phrases where the
  bass holds while the chords walk (`bassMode: pedal` already exists in
  `harmony.ts`; today it's per harmony and rarely heard).
- **Colour reach**: the palette size and the borrowed-chord weight get a
  per-piece bias (a plainer piece, a richer one) on top of the mood's.
- Chromatic mediant (a chord a major third away) allowed for eerie and
  wonder, one per phrase at most.

### 8. Rhythm and tempo

- Styles with no drums get a **choice of light grooves** (halftime, brush,
  hand, pulse-only = kick and shaker) instead of halftime every time.
- **Swing** per piece inside a band around the style's.
- **Tempo bands widened** a little per mood, and a **half-time feel**
  option (the same bpm, the beat felt at half) so two 72 bpm pieces move
  differently.

### 9. Sound and room

- **Room per piece**: small/dry, medium, hall, on top of the mood's
  reverb. Today every score sits in the mood's one room.
- **Texture per piece**: none, hiss, crackle, tape (the Save composer's
  textures; journey sets `none`). Faint, under the bed level.
- **Instrument tone per piece**: the piano's hardness, the pad's cutoff,
  the epiano's bell/tine balance, nudged by seed. Small, but the felt
  piano in one video is then not the felt piano in the next.

### Later: new voices

The stage 6 instruments in desk-ascii-scripts.md (cello, glockenspiel,
bells, handpan, clarinet, synth arp, analogue pad, taiko, swells) were
never built. They'd widen the guest and foundation lists above. Each is a
dozen lines in `render.ts` and needs Tom's ear, so they come after the
arrangement work, not before: the arrangement is where the sameness is.

## Hearing it: the audition set

A script, `bun run score:audition --script <id> --seeds 6 --from 60 --for 45`,
renders the same real plan for six seeds, 45 seconds each from the
minute mark, into one folder with a text file of the six labels. Tom
listens through the six in a row; if they sound like six pieces the work
is done, if two sound alike the labels say which draws they shared. The
label grows to name every draw above (foundation, figuration, recipe,
figure, voicing, room).

## Build order (proposed)

1. **The audition script** first, run on the composer as it is, so there's
   a before.
2. **Foundation + figuration + build recipe** (§1, §2, §4). The three that
   change the most for the least.
3. **Harmonic rhythm, phrase length, figures** (§3, §5).
4. **Theme treatment** (§6).
5. **Harmony, voicing, chapter modulation** (§7).
6. **Rhythm, tempo, sound, room** (§8, §9).
7. Audition again; Tom's listen; trim anything that sounds wrong rather
   than different.

Each stage keeps Save tunes byte-identical (hash the 18 Autosave tunes
before and after, as stage 4 of the score work did): `compose.ts` is not
touched, journey gets the new draws from its own stream so adding a draw
later never reshuffles the ones before it.

## Trade-offs

- **More draws, more ways to sound wrong.** Every list above is short on
  purpose and every item has to pass Tom's ear in the audition. A draw
  that produces one bad piece in six gets cut, not tuned.
- **Re-made scores change.** An edit whose score was made before this
  work keeps its file; pressing Make again or re-organising with a timing
  change makes a different piece from the same seed. Acceptable: the
  button already means "a new piece".
- **The label gets long.** It already is; the audition file is where it's
  read.
- **Not touched**: mood planning, the style picker, the Save composer,
  the Autosave ledger.

## As built (2026-10-24)

All of §1–§9 bar three items, in `packages/music/src/journey.ts`, with
the Save composer untouched (the 18 Autosave tunes hashed identical
before and after; `compose.ts` only gained the `pulse` kit, `harmony.ts`
the `III` chord and an optional per-piece bias with unchanged defaults).

- The arrangement draws come from their own stream (`seed * 211 + 29`)
  in a fixed order; per-chapter draws come after the fixed ones so the
  number of chapters never moves them. Per-phrase chances (a bar split in
  two at a peak, a chord from nowhere) have a third stream.
- `ARRANGE` in journey.ts is the per-style trim: foundations,
  figurations, recipes, figures, registers, guests, textures, rates.
- Foundation **none** makes the chord instrument the floor (its layer
  opens at intensity 0, softer under 0.2). A **drone** is a sub plus low
  strings on the home note; the bass layer waits a further 0.25 of
  intensity over it.
- Figuration and figure may each change hands at a chapter, **twice at
  most** per piece (the first cut changed five or six times over thirteen
  chapters and was restless).
- Chapter modulation: one middle chapter, pieces over 150 s only, never a
  short, by −5, +3, −3 or +5 semitones; the end card is always home.
- The theme: 2 bars, or 4 when the phrases are 8; a guest answers on busy
  even phrases; one middle chapter may rest it, another hand it to the
  guest; half speed under quiet beats when the piece does that.
- Drum-less styles draw from halftime, brush, hand, pulse; brush and hand
  kits now play their rim clicks (journey skipped them before).
- The label names every draw, and where something changes hands.
- The audition: `bun run score:audition <game> <script id> [--seeds 6 |
  --seeds 5,77,901] [--from 60] [--for 45]` (apps/desk/lib/audition.ts,
  cli.ts). Only the window is rendered, so six seeds of an 18-minute score
  take about 30 s.

**Not built** (and not missed yet): the per-piece instrument tone nudges
(§9, needs render.ts to take tone parameters), the half-time feel (§8),
and the stage 6 instruments. Also found and fixed on the way: the second
strike in a bar could land past the end of a short last span and get a
negative duration (an old bug, now guarded).

### 10. Gregorian chant (Tom's take, 2026-10-24)

Not a style: a **chapter** inside the styles we already get, where it
earns its place under the darker beats. One middle chapter whose beats
are mostly tense, melancholy, eerie, wonder or night may be sung:

- The foundation, chords, figure, bass and drums all stop. Under it, an
  **organum fifth**: the home note and the fifth above, held by the
  voices for each phrase (the earliest two-part chant), with a quiet sub
  so a phone hears the bottom.
- The **theme is sung** in unison by a small schola of men, low (around
  A3), at half speed and straight (no swing), legato, its leaps smoothed
  to steps. When the beat is up, a second voice sings it a **fourth
  below** (strict organum), the tritone avoided.
- Each note is a **syllable**: a vowel from a Latin text the piece draws
  (Kyrie, Dies irae, Alleluia, Sanctus, Requiem, Gloria), with a
  closed-lips hum opening into the vowel. Long held notes swell instead.
- A piece with a chant chapter sits in the **hall** whatever room it
  drew: one room per piece, and a schola in a dry room is a pad.
- Never in a short (a loop), never in chip.

The voice is new in `render.ts` (`chant`): five singers a hair apart in
pitch, each scooping up into the note and finding a slow vibrato late,
four male formants per vowel interpolated from the hum, the harmonics
normalised so the vowels sit at one loudness. The existing `choir` is one
fixed "oh" and would read as a pad playing a tune, so it isn't reused;
`Note` gains an optional `vowel`, which the Save composer never sets.

The draw is appended to the end of the arrangement stream (after the
modulation), so every seed's other draws stay where they were. Chance
0.45 when a chapter is eligible. Auditioned with
`bun run score:audition … --from <chant chapter start>`; the label says
"monks sing it in chapter N (Kyrie)".

### As built: the chant (2026-10-24, later the same day)

§10 as designed. `chant` is a new instrument in `render.ts` (`Note` gained
optional `vowel` and `sung`; the Save composer sets neither, and the 18
Autosave tunes render byte-identical). In `journey.ts` the chant draw is
the last on the arrangement stream: a middle chapter at least 60 % under
tense, melancholy, eerie, wonder or night beats, not the rest or guest
chapter, chance 0.45, never in a loop or chip. In that chapter every other
layer stops; each phrase holds the organum fifth (the home note from A2
up, and its fifth) with a sub, and from the second beat the theme is sung
at half speed, straight, its contour clamped to steps, a syllable of the
drawn text per note; the organal voice a scale-fourth below joins above
intensity 0.45 and on every second phrase. The room is the hall whenever
there is a chant chapter. Label: "monks sing it in chapter 13 (Requiem)".

Found on the way: **the theme was cut after its first bar** since the
first journey (the phrase end was the first chord's end, not the last's),
so every score only ever hinted its theme. Fixed; `JOURNEY_VERSION` is 3.

Examples: `apps/bits-promos/out/desk/audition/20df15c8-chant/` (six
seeds of the AI-slop script, 80 s round each chant chapter, four styles,
five texts).

Later the same day the voice went to Autosave too as the Save style
`chant` (save-point-channel.md § Chant): parallel organum under the chord
roots and the tune sung in syllables, with `CHANT_TEXTS` now shared from
compose.ts.
