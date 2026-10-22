# The Desk: ASCII scripts

*Drafted 2026-10-11 (Tom + Claude), text, long beats and moods settled the same day. Status: **stages 1–5 BUILT 2026-10-11** (pictures, on screen, set pieces, music to a package, the score), uncommitted; stage 6 (new instruments and styles) and Tom's listen to come. Owed: Tom's run of Plan + Make + record + organise + a Beats render on a real script, and his eye on the build timing and the captions.
Changes [desk-scripts.md](desk-scripts.md): the visual plan (text cards,
sketches, b-roll slots, the shot list) goes, and a picture per beat plus
a generated score take its place. The rest of that doc (source, rewrite,
review, prompter, takes, cleaning, organise) stays as it is. Borrows from
[save-point-channel.md](save-point-channel.md): the ASCII build
(`packages/ascii-build`), the chiaroscuro picture style and the generated
music (`apps/autosave-promos/src/music`).*

## Why (Tom, 2026-10-11)

> "Because the ASCII art turned out so well, I want our script editors to
> essentially ONLY generate and build images for each beat in the script.
> We'll generate images for each beat that I'll be able to
> approve/remake/override, we'll then randomly assign a seed to each one
> so it maintains all of its randomised sequencing and options (as it is
> with Autosave Save template). We also auto-generated our own music as
> well and I'd like to do the same. We should be generating a musical
> journey as the viewer goes through each beat in the script. We should
> find a way of blending the music seamlessly and each video will have a
> completely unique soundtrack."

## Decided already (Tom, 2026-10-11)

1. **Long form only for now.** One long script makes one YouTube video.
   No shorts: TikTok can split a long video into parts by itself. The
   rewrite stops asking for shorts. The shorts code stays in the store
   so old scripts still open, but the page doesn't show them.
2. **Generic.** It's a Desk feature for every game and channel, not a
   BITS one. Expect to use it a lot.
3. **A beat lasts as long as its recordings.** That means the kept parts
   of its takes after Tom has cut the pauses and gaps. Organise already
   works this way, so nothing changes there.
4. **The old visual plan goes completely.** No text cards, no line
   sketches, no b-roll slots, no shot list. Tom can still drop his own
   footage on the timeline by hand in the editor.
5. **The music is quiet** and ducks a little more while Tom talks.
6. **Text (10-11):** captions are a must, and they should be inventive,
   not the usual block of words. Chapters yes, but only when the video is
   long enough to earn them: one every couple of minutes feels kitsch. A
   title at the start. An end card that really lands.
7. **Long beats get a second picture.**
8. **More moods and more instruments**, as far as the synth can do
   them well.

## Words

- **Picture**: the one image a beat shows, built out of glyphs. Each
  beat has candidates (every generation is kept) and one **chosen**.
- **Look seed**: a number on each beat that fixes every random choice in
  its build: how the glyphs arrive, the order they fill in, each glyph's
  timing. It's the same idea as the Save template's `seed`. Same seed,
  same build. **Reroll look** changes only the seed and keeps the picture.
- **Score**: the video's generated music. One continuous piece, written
  for this video's beats and their lengths.
- **Score seed**: one number per script that picks the key, tempo, style,
  instruments and the tune. Rerolling it gives a whole new soundtrack.
  The pictures don't change.
- **Mood**: what a beat should feel like musically, plus how intense it
  is. The score moves towards each beat's mood as the beat plays.

## The shape of it

```
 paste ─▶ rewrite (long cut only) ─▶ review ─▶ PICTURES ─▶ record ─▶ clean takes ─▶ organise
                                                 │                                   │
                          prompt per beat, generate, approve / again / my own        │
                          look seed per beat, mood per beat                          ▼
                                                              sequence: voice + one picture per beat
                                                                        + the SCORE (made for these exact beat times)
                                                                                     │
                                                                  editor (tweaks) ─▶ Make (Beats template) ─▶ render
```

## Pictures (replaces "Beats and the visual plan")

Planning is two steps (2026-10-22, Tom: decide the story once, then
write the prompts from it; one call for a 78-beat script had overrun the
reply cap and outlived the browser, and batching the prompts alone would
have lost the thread between batches).

**Plan the story** is one Claude call over the whole long cut, whose
output is small enough to always fit: the world, its look, its cast, the
chapters, and for every beat one short **scene line** saying what we see
(a shot, never a summary; cast named by their cast names; callbacks by
beat number; a LONG beat names two moments). Mood, intensity, big moment
and pulled word are decided here too. The story shows on the Pictures
stage as a page of lines under the world, each yours to change before a
prompt is written from it.

**Write the prompts** turns each scene line into the full picture prompt,
a batch of about twenty beats a call in the background, each batch saved
and shown as it lands (the button counts beats done). Every call gets the
world, the cast with their looks, the whole story and the prompts already
written, so a batch is telling a scene, never choosing one; the literal
reader check runs after each batch. "New prompt…" on one picture works
from its scene line too. For each beat the plan holds:

- a **picture prompt**: one scene that carries the beat's point, written
  for the chiaroscuro film-still style (one strong light carving a subject
  out of darkness). The style text is added by the Desk. It lives per game
  in `desk.config.ts` as `script.ai.picture`, and Autosave's text from
  `desk.server.ts` is the starting point.
- a **mood** and an **intensity** (0 to 1) for the score (see below).

The whole script and the whole story go into every call, so the pictures
belong together: recurring subjects look the same (their looks are written
out word for word), and an idea from beat 3 comes back in beat 30 because
the story says so.

Each video has its own **world** (`Script.theme`, 2026-10-17): Claude
picks one from the script before planning (a lighthouse winter, a
submarine crew, a heist…) and every metaphor lives in it, so the
pictures aren't stuck in swords-and-sand fantasy just because the game
is a gladiator arena. It's saved and kept on Plan again and on a single
prompt's redo; Tom can write his own in the **world** box, or clear it
for a fresh pick.

**The image model sees none of that** (2026-10-19). It gets the style,
one **look** line and the prompt, and reads every word literally: "a
colossal black megatower" in a cyberpunk world came out as a plain dark
slab, and "the black tower's door" as a medieval castle. So the plan
also writes `Script.look` (what the world literally looks like: genre,
era, buildings, clothes, tech, light sources, no colours or weather),
sent with every picture as "The world: …", and `Script.cast` (each
recurring character, place or object with one fixed look, written out
word for word in every prompt it's in). Prompts stand alone (no "the
tower" without describing it), name brightness never colour, keep the
subject lit (dark builds as nothing), and show one frozen instant.
Then a **literal reader** pass (`checkPrompts`, one cheap Claude call)
reads each prompt as the image model would and fixes what it would get
wrong before any picture is paid for; it runs after a plan and after a
single prompt's redo. Look and cast sit under the world box, editable;
changing the world clears them so Plan again writes new ones.

**Generate** makes every picture that's missing: GPT Image through
`packages/forge`, landscape 1536×1024, a few at a time, each one landing
on its beat as it arrives. They go to `public/cards/<script>/<beat>-<n>.png`
(gitignored and backed up to Drive, as now). Unlike the sketches, the
paper-to-alpha step is skipped, because the ASCII ink reads brightness
straight from the picture.

**Long beats get two pictures.** At plan time the beat's length is only
a guess (`spokenSeconds`), so Claude writes a second prompt for any beat
guessed at over 30 seconds (`LONG_BEAT`): the same moment from another angle, or what
it leads to. At organise time a beat with two chosen pictures
splits at the sentence break nearest its middle (from the Whisper word
times), and a long beat with only one picture shows **wants a second
picture** on the page. The second picture follows straight on from the
first, the same as a beat change, without the music treating it as a
new beat.

Each beat on the page shows its picture **as glyphs, building**, using
the real engine with the real look seed. That's how it will look, and a
picture that's fine as a photo can turn to mush as glyphs. Under it:

- **Approve**: a tick. Organise warns about unapproved beats but still
  uses them.
- **Again**: one more candidate from the same prompt. The older ones stay
  as thumbnails and one click picks between them.
- **Edit prompt**: change the words, then Again.
- **My own**: drop in or pick an image file. It becomes a candidate like
  any other.
- **Reroll look**: a new look seed.
- **Mood**: two chips, the mood and the intensity, both editable.

**Approve all** and **Generate missing** sit at the top. When a beat's
words change after a second paste, its picture is marked **check**.
Nothing is thrown away.

Each beat gets a random look seed when it's created. The arrival and order
are drawn from the seed, the same way `lookFor` does it in Save.tsx.
Palette and tone are set once per video (on the template form), so the
whole video looks like one thing.

Cost: about $0.05 a picture, so a 40-beat script is around $2, plus
remakes.

## On screen: the Beats template

A new generic template, **Beats**: landscape 16:9, made for YouTube.

- Each beat's picture **builds** over the start of the beat: over 60% of
  the beat, capped at 8 seconds, so a long beat isn't just a slow build.
  Then it **holds** with the engine's ambient shimmer, so a held picture
  never looks frozen.
- At a beat boundary the old picture **leaves** (the build's exit) while
  the next one is already arriving. They overlap by about half a second,
  so the screen is never empty and never cut.
- The build ticks (`sfx/ticks`) follow the glyphs landing, as in Save, but
  quieter.
- Captions, chapters, the title and the end card: see **Text on
  screen** below.

The overlay track keeps its job, but a card gains a fourth kind:

```ts
type Card = {
  // as now, plus:
  kind: "text" | "image" | "broll" | "build";
  /** build: the look seed (arrival + order + every glyph's timing). */
  seed?: number;
};
```

Organise writes one `build` card per beat, lasting the beat. Text, image
and b-roll stay in the model so existing edits still play, but organise
never writes them again. In the editor a build card is a block with its
thumbnail; the inspector shows the seed with a reroll button.

The template lives with the shared code, not in one game's promos app.
`packages/ascii-build` gets a Remotion layer (`remotion.tsx`) that draws
an overlay of build cards, and each game registers a **Beats** template
in its `desk.config.ts` with its own palette and font. Autosave's Save
template is untouched.

## Text on screen

Everything on screen is made of the same glyphs as the pictures, in the
same monospace font and palette. Text never sits on top of the world as
a sticker. It belongs to it.

### Captions: the terminal line

A single line low in the frame, the width of a terminal, driven by
Whisper's word times (the same placed words the editor's captions use):

- **Words decode as they're spoken.** Each word appears as scrambled
  glyphs a moment early and settles into its letters on the frame it's
  said, like MEMORY settling in the Save template. The spoken word is in
  full ink, the words already said dim behind it, and a block cursor
  waits after the last one.
- **Lines scroll like a terminal.** When the line fills, it rolls up and
  the old line fades away. Two lines at most are on screen.
- **Pauses blink.** In a gap between beats the cursor blinks on an empty
  line, and the silence reads as the machine waiting.

### Pulled words: the picture spells it

The inventive part. Once or twice a beat at most, Claude marks a **key
word** in the beat's text: the word the point turns on ("forty", "never",
"bots"). As Tom says it, glyphs **lift out of the picture** and fly
together to spell the word large across the frame. It holds for a beat
and they drop back into their cells. The picture is never redrawn: those
glyphs were borrowed, so the effect costs nothing to plan, because
ascii-build already knows where every glyph sits and how to move it.

The words are tickable on the script page, under the picture. Fewer is
better: if every beat has one, none of them land. As a guide, one in
every three beats. The music gets a small accent on a pulled word (a bell
or a soft hit on the beat).

### Chapters

Claude proposes chapters during Plan pictures, from the script's shape,
under strict rules (its own suggestions only: Doc headings and chapters
Tom adds always show, short of two within 10 seconds, YouTube's floor;
changed 2026-10-17):

- **None** in a video under about 6 minutes (spoken, guessed).
- At most one every **3 minutes**. A 12-minute video gets three or four.
- Each one is a real turn in the story, with a name of two to four
  words.

Tom can move, rename or drop them on the page (a chapter starts at a
beat). On screen a chapter is its own moment, not a corner label: the
picture leaves, the screen goes empty for a breath, then the name **builds out of glyphs** large in the middle,
holds for about 2.5 seconds and rains away into the next beat's picture.
Organise leaves a silent gap for it (about 3.5 seconds). The score marks
it too: the phrase lands home, a layer drops out, and the new chapter
starts on a fresh phrase. The chapters also go into the YouTube
description as timestamps, which YouTube turns into its own chapter bar
(it needs 0:00 first, at least three chapters, each at least 10 seconds).

### Title

A cold open, the first 4 to 5 seconds before the first beat: the title
builds out of glyphs in the middle, the score's first notes with it, then
it breaks apart and those same glyphs fall into the first picture. Picture
and title are one material, and the opening shows it straight away.

### The end card

The last beat's picture holds, then:

1. **The whole video, again.** Every picture from the video flashes past
   as a reel getting faster, in the order they appeared, each one on
   long enough to read (1.1s down to 0.4s). It's the journey in about six
   seconds.
2. **The mosaic.** They land as a grid of tiny thumbnails filling the
   frame, every picture still shimmering as glyphs (a glyph every 2px or
   so, at least 90 across, with the picture glowing faintly under them
   as in the reel, so a small tile still shows what it is).
3. **The sign-off.** The grid's glyphs drain away and leave the channel
   name built out of them, with one line under it in Tom's voice (per
   game in `desk.config.ts`, e.g. "Thanks for watching. I'm making a
   game.").
4. **YouTube's end screen.** It holds on space left clear for YouTube's
   end-screen elements (a video and the subscribe button), for 12 to 20
   seconds, with the score's last chord ringing out and the glyphs
   breathing.

The score lands its home chord on the mosaic.


### What it has to do

- Follow the beats: when the script turns, the music turns with it.
- Stay **seamless**: never sound like two tracks crossfaded.
- Be **unique per video** and repeatable: the same seed and the same beat
  times give the same file.
- Stay quiet under the voice.

### How: one piece, its settings moving

Crossfading separate tunes per beat would be easy, and you'd hear every
join. So the video gets **one piece**, and the beats only steer it. These
stay fixed for the whole video (from the score seed):

- key centre, tempo, metre
- the style and its instruments (felt piano, rhodes, ambient, downtempo…)
- **the theme**: a short tune that comes back, varied, through the video

That's what makes it sound like one piece. These move with the beats:

| Moves with the mood | What you hear |
|---|---|
| **Layers** (density) | pad alone, then + bass, + arpeggio, + the theme, + drums. Intensity decides how many are playing. |
| **Brightness** | the filter opens and closes (the Save tune already does this as the bar fills) |
| **Mode** | the same home note in a different colour: major ↔ dorian ↔ minor ↔ lydian. A shared chord pivots between them, so it changes without a jolt. |
| **Room** | more or less reverb: close and dry for a plain point, wide for a big one |
| **Harmonic pace** | chords change every bar, or every two bars when it should breathe |

**Smoothing.** The beat times come from organise, so they're exact. Every
change is moved onto the nearest bar line. Layers come in and drop out
only at the start of a phrase (every 4 bars). The curves (brightness,
level, reverb) glide over a bar or two instead of switching. A beat
shorter than a bar doesn't steer the music at all: it rides along with
its neighbour.

**Shape of the whole thing.** It starts thin (pad and the first hint of
the theme under the cold open). It ends by landing on the home chord as
the last beat ends, then rings out for a couple of seconds. There's
optional **lift**: Claude can mark one or two beats as the turn of the
video, and there the music steps up a key, the one deliberate big moment.

**Long-form structure.** The Save composer walks 12 chords for 16 seconds.
Ten minutes needs phrases: 4- and 8-bar phrases, the theme stated, then
varied (other instrument, other register, rhythm stretched), then left
out for a while so it means something when it comes back. The chord walk
(the Markov walk in `harmony.ts`) carries on across phrases and is pulled
home at the end of a section.

**Moods.** The six Autosave moods (cosy, wistful, wonder, night, playful,
tender) are all soft. A mood is only a preset (mode, tempo range,
brightness, room, which layers it likes), so adding moods is cheap. Seven
new ones for telling a story, all still quiet:

| Mood | For | How it sounds |
|---|---|---|
| **focus** | explaining how something works (the most common beat in a dev video) | steady, minimal, an arpeggio ticking over, no tune, mid brightness |
| **curious** | a question, a "what if" | lydian, pizzicato and plucks, light |
| **tense** | a problem, a bug, a deadline | minor, a held low note under it, sparse, filter down |
| **eerie** | something wrong or strange | slow, cold bells, wide room, unresolved chords |
| **driving** | momentum, building, a montage of work | steady pulse, the arpeggio pushing forward, soft drums |
| **melancholy** | something lost or cut | minor, slow, piano and low strings, lots of space |
| **triumph** | the win, the payoff | major, every layer, the theme in full, lift allowed |

Thirteen in all. Claude tags each beat during Plan pictures. The word
lists in `mood.ts` stay for Autosave, and Autosave can use the new moods
too when its words call for them.

**Instruments.** Everything is synthesised in code (`render.ts`), with
no samples. These are new voices, each small, and each kept only if it
sounds good on its own (`--stems`) and passes Tom's ear:

| Instrument | How it's made | Moods it serves |
|---|---|---|
| **cello / low strings** | the bowed voice an octave down, slower bow | melancholy, tense, triumph |
| **glockenspiel** | bright struck metal partials | curious, playful, wonder |
| **bells** | inharmonic FM partials, long ring | eerie, wonder, chapter accents |
| **handpan** | soft struck with a pitched hum | focus, cosy, curious |
| **clarinet** | odd harmonics (hollow), breathy | curious, wistful |
| **synth arp** | a filtered saw, short, tempo-synced | driving, focus |
| **analogue pad** | a slow-sweeping detuned saw | tense, eerie, night |
| **taiko / low toms** | a pitched drop with noise | triumph, driving, tense |
| **swells** | reversed cymbal and noise risers | chapter changes, lift, pulled words |
| **heartbeat** | a soft low double thump | tense |
| **brass** (risky) | a slow ensemble saw with brightness rising | triumph |

Brass is the one synthesis usually gets wrong (it goes cheap and 1980s
fast), so it's tried last and only kept if it really works. The styles
grow to match: **cinematic** (low strings, taiko, swells: tense, triumph,
driving), **synthwave-lite** (synth arp, analogue pad, soft kit: driving,
night, focus), **chamber** (cello, clarinet, pizzicato, harp: curious,
melancholy, wistful).

**Level.** The bed sits low (level about 0.2). Ducking already exists
(`duckAt` in `packages/voiceover`). The score uses a gentle depth (about
0.6, so it drops by roughly 40%), because it's already quiet. It comes
back up in the gaps between beats, and that's where you'll notice it
breathe.

### Where it runs

- `apps/autosave-promos/src/music` moves to a shared **`packages/music`**
  (unprefixed, since two games use it). Save keeps its loop behaviour
  (reversed swell, chime) as Save-only options. Check after the move: an
  Autosave tune renders byte-for-byte the same as before.
- New `journey.ts` next to `compose.ts`:
  `(scoreSeed, beats: {start, end, mood, intensity, lift?}[]) → Score`.
  The renderer is the same one.
- **Organise** writes the sequence, then asks for its score (in its own
  process, never inside a `Bun.serve` handler: see the spawnSync gotcha).
  The file is `music/generated/<script>-<scoreSeed>-<hash of beat times
  and moods>.wav`. The sequence's `music` points at it. Clean a take or
  re-organise and the beat times change, which gives a new hash and a
  new score, still from the same seed, so it sounds like the same piece,
  refitted.
- **Memory:** the renderer builds the whole track in memory. At 48k
  stereo float, ten minutes is about 230 MB before reverb. Render in
  phrase-length chunks with the reverb tail carried over, or at least
  measure it before the first real script.

### On the script page

Under Pictures: **Score**, which shows the style, key, tempo and theme
instrument in one line (like the Make note does for Autosave), plus the
mood strip, one coloured chip per beat. Buttons: **Another soundtrack**
(new score seed) and **Style** (auto or pinned). You hear it properly
in the editor after organise, because before that the beat lengths are
only guesses (`spokenSeconds`). A rough preview from the guessed lengths
is cheap and worth having.

## What gets stored

```
scripts/<id>.json   the script, as now, plus
  scoreSeed, scoreStyle?,
  long.beats[]: { id, text, changed?,
                  pictures: { prompt, candidates: string[], chosen?: string, approved?: boolean, check?: boolean, look: number }[],  // 1, or 2 for a long beat
                  mood?: { mood, intensity, lift? },
                  pulled?: { word: string, index: number }[],  // key words the picture spells
                  chapter?: { name: string } }                 // a chapter starts at this beat
public/cards/<script>/*.png               pictures (gitignored, Drive backup)
public/music/generated/<script>-*.wav     scores (gitignored, regenerable from the seed)
public/sequences/*.json                   organised cuts with build cards + music (committed, as now)
```

`beat.card` (the old plan) is left on old scripts, but nothing reads it
any more.

## Build stages

**Stages 4 and 5 as built (10-11).** `apps/autosave-promos/src/music`
compose/harmony/mood/render moved to **`packages/music`** (`tune.ts`
stays in Autosave: it's Save-specific); 18 Autosave tunes across moods
and styles hashed before and after, identical, and again after every
change below. The seven story moods (focus, curious, tense, eerie,
driving, melancholy, triumph) are in `MOODS` (no words: a beat's mood
comes from its plan), with presets, harmony flavours, and appended to
styles' mood lists (so Autosave's picks don't move). `render` gained a
run-once mode (`Score.loop: false`: notes past the end cut, effects run
once, reverb pre-delay doesn't wrap). **`journey.ts`**: seed fixes key
(any of 12), tempo, style (felt, rhodes, ambient, guitar, downtempo,
chip: 4/4 and able to sit back), instruments and a 2-bar theme; the
body is cut into segments at chapter cards, each a grid of 4-bar
phrases; a phrase takes its mood (→ the mood's mode, fixed per mood for
the piece, same tonic) and its average intensity (layers in at: chords
0.12, bass 0.3, theme 0.35, arpeggio 0.5 or driving 0.3, drums 0.72);
a phrase before a change of mode, or a segment's end, comes home; tense
and eerie hold a tonic pedal; the theme is stated on even phrases,
varied on busy odd ones, resting otherwise; a big moment lifts the key
a tone from its phrase (two at most); a chapter card holds the home
chord on the pad with two bell notes and a muffled filter; a pulled
word gets a soft bell; the end card has the theme in full over a
lead-in, home landing with the mosaic (7.6s in), ringing out with a 6s
fade; brightness and level glide over the bar and a half before each
chord. `scripts/journey.ts` (plan JSON → WAV) runs in its own process:
about 10× real time (3 minutes in 18–26s). Desk: `lib/score.ts`
`planFor(edit, script)` (video seconds: cold open + edit + end card;
one section per beat from its build cards and the beat's mood; chapter
cards → breaks; pulled words → accents), `makeScore` (file
`music/generated/score-<edit>-s<seed>-<hash>.wav`, gitignored, newest
30 kept; set as the edit's bed at 0.25 unless Tom put his own song
there); the Organise step's **Score** panel shows the label, a
player, **Make the music** (no score on the newest edit yet),
**Fit to the edit** (same seed, the edit's timings now) and
**Another soundtrack** (new seed). 2026-10-19, decoupled on Tom's ask:
organise no longer makes the score (each re-organise refitted it, and a
shift in the main mood swapped the style, so it sounded like a new song);
a new edit takes the previous edit's music bed as it was, and only the
panel's buttons write music. Beats lifts the bed ×2 where nobody
talks (the title, the end card). Checked: a throwaway edit end to end
(plan from the edit, score in 17s, bed set, a 74s Beats render: the
score ~12–15 dB under the voice), spectrogram and loudness of two
3-minute journeys (quiet title swell, building to the triumph, a
breath at the chapter, home on the mosaic, fade); test files deleted.
Owed: Tom's ears on all of it.

**Stage 3 as built (10-11).** Timings shared in `@heroic/ascii-build`
`video.ts`: COLD_OPEN 4.5s, CHAPTER_CARD 3.5s, END_CARD 20s,
`youtubeChapters` (0:00 first, "Intro" when the first beat opens no
chapter, three or more each 10s+, else nothing; tested). Organise: the
first beat's chapter gets no card (the title opens the video) and is
chapter one; a later one leaves a CHAPTER_CARD gap with a `chapter` card
(name + number `n`); the edit gets the cut's `title`; build cards carry
the beat's `pulled` words; the YouTube list shows (with copy) after
organising and on the last run. Remotion: `inkFromText` (type as white on
black → ink), `TextBuild`, `ChapterCard` (the name
decoding in, rain out; captions held off while it's up), pulled words
inside `BuildCanvas` (the picture's brightest glyphs fly to spell the
word in a 220px mono, picture dimmed and holes left, 0.45s out, 1s hold,
0.45s back, starting 0.15s before it's said), `EndCard` (6s reel that
speeds up from 1.1s to 0.4s a picture and DISSOLVES each into the next
rather than cutting, so no strobe; mosaic tiles pop in and rain away;
the channel name converges in Cinzel glyphs with the sign-off typed
under; hold to 20s, lower half clear for YouTube's end-screen
elements). Beats gains `opening` (title/none), `ending` (card/none),
`channel`, `signoff`. Type legibility needed ~10 glyph rows a letter:
titles set at 1500px wide and 210 columns, names at 190. Checked on a
48s throwaway render (title, two pulled words, a chapter, the end card)
plus stills after the fixes; deleted after. Also fixed: Beats passed the
voice its start in frames, not seconds.

**Stage 2 as built (10-11).** `Card.kind "build"` + `seed` in
`@heroic/voiceover`; organise writes one per chosen picture (`splitPoint`:
after the sentence-ending word nearest the slice's middle, within its
middle 60%, else the middle; tested). `@heroic/ascii-build/remotion`:
`BuildLayer` (each card in its own Sequence, builds over
`min(60%, 8s)`, falls away from 0.25s before its end with a 1s tail
into the next) and `TerminalCaptions` (`terminalLines`: a new line when
the next word won't fit or after a 1.1s pause; words decode from
scrambled glyphs 0.14s early and settle over 0.16s; the line scrolls up;
a blinking cursor in pauses; a line fades 2.6s after its last word;
tested). The BITS **Beats** template (`apps/bits-promos/src/Beats.tsx`):
landscape, sand or matrix, 160 columns, the pictures in the frame above
a 14% caption band, CRT scanlines and vignette as on Autosave, footage
from the edit over the pictures where a track has any, music bed at 0.2
ducked to 60% (until the score). Editor: build cards show their
thumbnail, the inspector has the look and reroll look, the Cards shelf
drops pictures as builds. Checked with a 26s render of a throwaway edit
(an old take's real words, four builds covering rain, sides, converge
and fade): renders at about real time; frames looked at; deleted after.
Not yet: the build ticks sound (Autosave's, quieter) is owed.

**Stage 1 as built (10-11).** `lib/rewrite.ts` planPictures (one call
over the whole script, ~35s for 21 beats), `lib/scriptSteps.ts`
planPictures / makePictures / ownPicture, `lib/cards.ts` PICTURE_STYLE +
makePicture (1536×1024, ~14s each), `ui/Pictures.tsx` (GlyphPicture: the
real engine, LOCKED_LOOK, still until hover, then a build-hold-exit loop),
`lookFromSeed` in ascii-build (the same draw Save's "shuffle" makes,
tested). Pulled words thinned server side (never two beats running).
Organise uses each beat's chosen picture as a flat image card until
stage 2. Verified on a copy of "3 times I pivoted" in a second Desk:
plan, three made, one own upload, the page screenshotted with the
glyph previews; the copy and its pictures deleted after.

1. **Pictures.** Rewrite = long cut only. Plan pictures (prompts, mood,
   pulled words, chapters, a second prompt for long beats), generation in
   the chiaroscuro style, the glyph preview on each beat, approve / again
   / edit / my own / reroll look, check on changed beats. The old Plan
   panel and the shot list come out.
2. **On screen.** `build` cards in the model, the ascii-build Remotion
   layer, the Beats template (landscape), organise writing build cards
   (and splitting long beats), editor block + inspector. Terminal
   captions. Check: organise a real script, render 60 seconds of it.
3. **The set pieces.** Title cold open, chapter cards (and the silent
   gaps organise leaves for them, plus the description timestamps),
   pulled words, the end card. Each one rendered on its own and judged
   by eye before the next.
4. **Music to a package.** Lift `src/music` into `packages/music`,
   Autosave on the package, byte-for-byte check.
5. **The journey.** The seven new moods, long-form phrases and theme,
   glides on bar lines, lift, chapter breaths, pulled-word accents, the
   ending on the mosaic, chunked render, organise making the score,
   gentle ducking, the Score panel. Check: a script with obviously
   different beats (a calm one, a tense one, a win) and listen across
   each join.
6. **New instruments and styles.** One voice at a time, each with a
   `--stems` sample for Tom; brass last. Then cinematic, synthwave-lite
   and chamber.
7. **Tom's pass.** A real script end to end. Tune the build timing, the
   overlap, the caption pace, the bed level and the duck depth by eye and
   ear.

## Things to check while building

- Captions at YouTube size: a terminal line must read on a phone in
  landscape, so it's bigger than it looks right on a monitor.
- Pulled words over a busy picture: the borrowed glyphs leave holes.
  Check it reads as on purpose, not as a glitch.
- The end card's flash-cut: 40 pictures at one or two frames each.
  Check it isn't a strobe hazard (keep under three flashes a second in
  big brightness swings, or soften the cut).
- Chapter gaps change the beat times, so the score must be made after
  them (organise does both, in that order).
