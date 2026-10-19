# The Desk: scripts

> **2026-10-11:** the visual plan (text cards, sketches, b-roll slots,
> shot list) and shorts are being replaced by one ASCII picture per beat
> and a generated score: see [desk-ascii-scripts.md](desk-ascii-scripts.md).

*Drafted 2026-10-09 (Tom + Claude). Status: **all five stages BUILT
2026-10-09** (the Scripts tab with rewrite, review and adjust; the
overlay track, its editor and the Talk template; the visual plan, the
sketches and the shot list; the prompter, the takes bin and take
cleaning; organise), uncommitted. Owed: Tom's run of the whole loop on
a real script (the first recording through the prompter is the first
test of the matcher on his speech). Replaces the Ideas tab. Companions:
[desk-sequence-editor.md](desk-sequence-editor.md) (the editor the
organised cuts open in), [desk-voiceover.md](desk-voiceover.md) (takes,
Whisper, captions), [apps/desk/README.md](../../apps/desk/README.md).*

## Why (Tom, 2026-10-09)

> "Slowly its started taking more and more of my time up to the point
> where scripting / recording / editing is taking 3+ hours for a single
> video, they're also often over 3 minutes long. One of the issues is that
> I'm writing scripts that in reality, should probably be full youtube
> videos, and then I can't scale them down for tiktok/shorts/reels.
>
> I would write a single script, and it would make a few edits to get it
> on style for how I write, and then produce a condensed version for
> short-form content … two titles, one for long form and one for short
> form, potentially a longer script could also be re-worked into multiple
> smaller shorts.
>
> For each video script, I also want it to plan out the visuals and create
> all of the image/text assets needed to bring it to life, I should be
> able to record, transcript my voice and attach it to these projects, and
> after pressing an organise button, it should take my audio, arrange it
> and also add images / text automatically at the correct timestamps. I
> can go in and then add music / game footage if needed later on.
>
> I can't be spending 3 hours every night trying to make a video … I have
> lots of ideas for what I can talk about, and I'm reasonably good at
> writing video scripts, so I want to spend the time I do have doing that
> and have you take care of the rest.
>
> All of the scripts and assets and stuff it's making should be able to
> be dropped directly into a timeline and then I can just make a few
> final tweaks and adjustments before sending to render."

## Decided already (Tom, 2026-10-09)

1. **Long form is in.** Not the original goal, but Tom used to do YouTube
   and wants the brand built for future games. Long form means anything
   from about five minutes up, landscape.
2. **The look is a simple, clean sketch.** The videos should feel
   cobbled together by one person. Generated pictures are line sketches,
   not polished art. Between them, b-roll Tom films himself: code on
   screen, in-game footage, the tools.
3. **Recording happens in the Desk, against a teleprompter.**
4. **Tom's own voice only.** No synthetic scratch voice; he reads the
   script aloud to himself to judge it.
5. **As many shorts as feel natural.** One or four, decided per script by
   what the script holds.
6. **Tom cuts his own audio.** A script is recorded over dozens of takes.
   He trims the edges and cuts bits out of each take himself. If a take
   is a mess he deletes it and records again. Nothing picks takes for him.
7. **A re-pasted script is a change, not a restart.** The Desk works out
   what changed between the old paste and the new one and adjusts the
   rewrite to match, keeping everything that didn't change.

## Words

- **Script**: a project on the Scripts tab. What Ideas was, grown up.
  Holds the source, the cuts, the visual plan, the takes, and the edits
  made from it.
- **Source**: the words Tom pasted from the Google Doc, kept as pasted,
  every version.
- **Cut**: one video's worth of script: the **long cut** and each
  **short cut**. Each has a title and a list of beats.
- **Beat**: one thought, as a few sentences, with a stable id. What a card
  is hung on, what a take is matched to, what a short borrows. About ten
  to twenty seconds spoken.
- **Card**: something on screen for a stretch of time that isn't footage:
  a **text card**, a **sketch** (a generated picture), or a **b-roll
  slot** (a note of what to film, invisible in the render).
- **Overlay track**: the row in the sequence that cards sit on. New.
- **Take**: one recording off the mic, with its Whisper words. As now.
- **Kept regions**: the parts of a take that survive Tom's cleaning.
  Everything downstream only sees these.
- **Organise**: the button that turns the takes into sequences: one per
  cut, audio in script order, cards at the moment each beat starts.

## The shape of it

```
 paste ─▶ rewrite ─▶ review ─▶ plan visuals ─▶ make assets
                                  │
          record (teleprompter) ◀─┘   clean takes
                  │                       │
                  └──────── organise ◀────┘
                                │
                   sequences/<script>-long.json
                   sequences/<script>-short-1.json …
                                │
                      the editor (footage, music, tweaks) ─▶ Make ─▶ render
```

Each step is a button on the script's page. Nothing runs on its own, and
every step can be run again. Tom's time goes into the paste and the
recording; the Desk's into the rest.

## The script page

Replaces the Ideas tab. The list on the left is the scripts (a script with
only a title is an idea, exactly as before: the quick jot survives). The
page on the right is the script, in steps down the page, each folding
away when done.

**Source.** A box to paste into. Every paste is kept as a version with its
time. The box saves itself on every change, like the ideas did.

**Rewrite.** One press. Claude returns, as structured output:

- the **long cut**: the source rewritten in Tom's voice, as beats, with
  a title;
- **short cuts**: as many as the script naturally holds, each a title, a
  hook line, and beats. A short's beat either carries the id of the long
  beat it is (the same words, so a take serves both) or is new text (a
  condensed opening, a wrap) which needs its own recording;
- a one-line note per cut saying why it works as a video.

The voice is Tom's own scripts: every other script on the tab, in full,
goes into the call (Tom, 2026-10-09: "I'd want scripts to be rewritten
in MY style not generic AI model style"), with the instruction that his
sentences come back word for word unless one would trip him reading it
aloud. The game's `script.ai` in `desk.config.ts` adds the about
paragraph and the rules; it carries no invented example lines. The rules are the house voice: first person, plain, British, no slogan
triplets, no caps headers, no em dashes.

**Review.** The long cut sits beside the source, beat by beat, with what
changed lit up. Under each beat: **keep mine** (the beat goes back to the
source words) and a box to say what to change (the beat is re-done on its
own, the rest untouched). A box at the bottom does the same for the whole
cut. Shorts sit under in tabs, same tools, plus **drop this short** and
**another short about…**. Titles are editable in place. Nothing is final
until Tom moves on; everything is editable after, too.

**A second paste.** The new source is diffed against the last. Claude gets
the old source, the current long cut with its beat ids, and the new
source, and is asked for the long cut adjusted to the change, keeping
every unchanged beat's id and words. Beats whose words changed are marked
**changed**: their take match is dropped (they show as not yet recorded)
and their card is marked **check**. Shorts get the same pass. Beats that
only Tom edited by hand, not the source, are left alone.

## Beats and the visual plan

**Plan visuals** runs over the long cut's beats (shorts reuse the long
beat's card where the beat is shared; short-only beats are planned too)
and gives each beat one of:

- **text card**: two to six words, the point of the beat, for when the
  words carry it;
- **sketch**: a prompt for a picture, in the house style, for when a
  picture says it faster;
- **b-roll slot**: a note of what to film ("the Harpoon's hit band code",
  "a 2v2 on Obelisk, mid fight"), for when real footage should carry it;
- **nothing**: the previous card stays up.

Tom goes down the list and changes any of them: the kind, the words, the
prompt. **Make the assets** generates every sketch not yet made (GPT
Image, through the forge module lifted out of Realmsmith) and shows them
on the beats; **again** on a sketch makes another. **Shot list** is the
b-roll slots as one list to film from, with a copy button.

The sketch style is one fixed prompt prefix for every picture (clean black
ink line sketch, one accent colour, transparent background, no words, no
frame), set per game in `script.ai.sketch`. Pictures land in
`public/cards/<script>/<beat>-<n>.png`, gitignored like footage and takes,
backed up to Drive with the takes.

A card is content, not style. The template draws it: a text card in the
brand type on the brand backdrop, a sketch centred on the backdrop or
small over footage. The same card looks right in every shape without the
plan knowing the shape.

## The overlay track (new in the sequence model)

```ts
type Card = {
  id: string;
  kind: "text" | "image" | "broll";
  /** text: the lines. image: the file under the public dir. broll: the note. */
  text?: string;
  src?: string;
  note?: string;
  /** Sequence seconds. */
  at: number;
  seconds: number;
  /** full: the frame, on the backdrop (nothing behind). over: small, over whatever is playing. */
  place: "full" | "over";
  /** Which beat put it there, so organise can find its own cards again. */
  beat?: string;
};
type OverlayTrack = { id: string; cards: Card[] };   // sorted by at, never overlapping
// Sequence gains:  overlay?: OverlayTrack
```

A card at `place: "full"` is picture when no video track has any: the
Stage shows the backdrop with the card on it. With footage under it, a
full card gives way to the footage (the b-roll wins) and shows nothing;
an `over` card sits in the top third (tall) or the right third (wide)
regardless. A b-roll card is never drawn in the render; in the editor it
is a dimmed block with its note, so Tom sees where footage is wanted and
drops a clip onto it.

In the editor the overlay is one more track above the video tracks:
cards move, trim, snap and delete like clips. The library gains a
**Cards** shelf (the script's sketches and text cards, and **+ text
card**) so a card can be dropped in by hand too. The inspector for a
card: its text or picture, full or over.

Every template that plays a sequence gets the overlay for free, because
the Stage draws it. The long cut needs one new template, **Talk**:
landscape, the sequence straight through, regular captions, the title as
a cold open, chapter marks from the long cut's beats for the YouTube
description.

## Recording against the teleprompter

**Record** on the script page opens the prompter: the beats of every cut
that still need a take, long cut first, then the short-only beats, each
marked with the cut it is for. The current beat is large; the next is
under it, smaller. The mic, the meter and **Record** (`R`) are the
editor's own. Press, 3-2-1, read as many beats as you like, press again.
The take is saved to `public/voice/takes/` and transcribed as now, then
matched (below), and every beat it covers gets a tick. Space moves the
prompter to the next beat; it also follows the ticks on its own. Record
in any order, as many times as you like.

**The takes bin** is under the prompter: one row per take, newest first:
the waveform, the words, the beats it covers, **delete**. Click a take
and it opens full width: the waveform with the words along it. Drag
either end to trim; drag across a stretch (or shift-click from one word
to another) and press delete to cut it out; `⌘Z` undoes. The file is
never touched. The take gains `keep: Span[]`, and everything after this
sees only the kept parts: the words in them, the audio in them. Clean a
take after organising and press organise again.

## Organise

Matching a take to the script is a text alignment: the take's kept words
and the cut's beats are both normalised (lower case, no punctuation,
numbers as words), and a longest-common-subsequence alignment finds, for
each take, which beats it reads and where in the take each beat begins.
A beat counts as covered by a take when most of its words are found in
order (threshold to tune; start at 70 percent). The time of the first
matched word is where the beat starts in that take.

Organise, for each cut:

1. walks the beats in order; for each, takes the one take that covers it
   (two takes covering the same beat is a **conflict**: the row shows
   both and asks; nothing is picked for Tom, per decision 6; an uncovered
   beat is listed as **not recorded** and skipped);
2. slices that take from the beat's start to the next beat's start (or
   the take's kept end), so a take read straight through several beats is
   split at the beat boundaries, and a beat read across two takes is
   stitched;
3. lays the slices on the audio track in order with a fixed gap between
   beats (`gap`, default 0.3s, a setting on the script);
4. puts the beat's card on the overlay track at the beat's start, lasting
   until the next card (text and sketch) or the beat's end (b-roll);
5. drops a marker at every beat start, so the list template and anything
   else that reads markers still works;
6. writes a new sequence: `<script>-long`, `<script>-short-1`… The video
   tracks are empty. Music is unset.

Organise never edits a sequence Tom has opened in the editor. Each run
writes fresh sequences, named with the run number; the old ones stay
listed on the script until he deletes them. His timeline work is never
overwritten.

Then the normal loop: the editor (drop footage on the b-roll slots, pick
a song, trim), **Done** to Make with the sequence chosen, the Talk
template for the long cut, any vertical template for the shorts, render,
queue. The queue drafter is handed the cut's title and hook, so the post
copy starts from the script, not the clip note.

## What gets stored

```
<rendersDir>/scripts/<id>.json        the script (gitignored, like ideas.json)
  { id, title, createdAt, updatedAt,
    sources: [{ at, text }],
    long: { title, beats: [{ id, text, changed?, card? }] },
    shorts: [{ id, title, hook, beats: [{ id, text, from?, changed?, card? }], why }],
    takes: [{ file, seconds, recordedAt, words, transcribed, keep?, covers: [{ cut, beat, at }] }],
    gap, sequences: [{ id, cut, run, at }], done? }
public/cards/<script>/*.png           sketches (gitignored, backed up with the takes)
public/voice/takes/*.wav              takes (as now)
public/sequences/*.json               the organised cuts (committed, as now)
```

The Ideas file migrates the first time the tab opens: each idea becomes
a script whose single source is its description. Edits that point at an
idea by id keep working: the ids carry over.

## Where the code goes

- `packages/forge` (new, unprefixed: shared): Realmsmith's
  `forge/openai.ts` and `forge/elevenlabs.ts` move here as they are;
  Realmsmith imports them. The Desk reads the keys from its own `.env`.
- `packages/voiceover`: `Take.keep`, the kept-words and kept-audio
  helpers, the `Card` and `OverlayTrack` types and their pure edits
  (move, trim, split, place), the beat matcher (`match.ts`: pure, tested
  on fixtures of real transcripts), and the overlay drawing in
  `remotion.tsx`.
- `apps/desk/lib`: `scripts.ts` (the store, the migration from ideas),
  `rewrite.ts` (the Claude calls: rewrite, adjust to a change, redo a
  beat, plan visuals; same client and shape as `draft.ts`), `cards.ts`
  (sketch generation and files), `organise.ts` (takes → sequences).
- `apps/desk/ui`: `Scripts.tsx` (the tab), `script/` (Source, Review,
  Plan, Prompter, Takes panels), the overlay track and the Cards shelf in
  `edit/`.
- `apps/bits-promos`: `Talk.tsx` (the long-form template), the overlay
  layer in `stage.tsx`, `script.ai` in `desk.config.ts`.

## Decisions

### 1. Beats are the unit of everything

The rewrite returns beats, not prose, and every beat has an id that lives
through the review, the visual plan, the takes and the shorts. A short's
beat that is the same words as a long beat carries that id, so one
recording serves both cuts. Without a stable unit, "adjust the rewrite to
my edit" and "put the card where I start saying it" both become guesswork.

### 2. Cards go in the sequence model, not in template props

The alternative was a per-template `cards` prop. Then the editor can't
show them, they can't be moved against the voice, and each template
draws them its own way. In the model, every template that plays a
sequence gets them, the editor treats them like clips, and organise writes
one file. The cost is a model change and an editor track, which is the
one piece of real new UI in this.

### 3. Organise writes new sequences, never merges into edited ones

Merging a re-run into a sequence Tom has already cut footage into is a
hard problem with no good answer when beats have moved. Fresh sequences
per run, old ones kept, is boring and safe. If this turns out to be a
pain (organise, tweak, clean one take, organise again, redo the tweaks),
the answer is to clean the takes before touching the timeline, which the
page's order of steps already suggests.

### 4. No automatic take picking

Tom decided it: he cuts his own audio and re-records what's wrong. So
organise never chooses between takes; a conflict is shown and left. This
keeps the matcher simple and its mistakes visible.

### 5. A card is content; the template is the style

The plan never says a font, a colour or a position. It says "text, these
words" or "a sketch of this". The brand is drawn in one place per game
and the same script page serves every game.

### 6. Scripts are gitignored, like ideas

They are personal drafts in Tom's own words, with API output in them.
The committed artefacts are the sequences, as now. Takes and sketches are
backed up to Drive with the existing takes backup.

## Build stages

Each stage is usable on its own and the first already saves time.

1. **Scripts.** The tab, the store, the migration from ideas, source
   versions, rewrite + shorts + titles through Claude, the review panel,
   the adjust-to-a-change pass. The Script panel in the editor reads a
   cut instead of an idea.
2. **The overlay track.** Model, pure edits, Stage drawing, the editor
   track, the Cards shelf and inspector, the Talk template. Checked by
   hand-placing cards on an existing edit and rendering it.
3. **The visual plan.** `packages/forge` lift, plan visuals, sketch
   generation, the shot list, the style prefix.
4. **Recording.** The prompter, the takes bin, take cleaning, kept
   regions through the voice pipeline.
5. **Organise.** The matcher with its fixture tests, the sequence writer,
   conflicts and not-recorded rows, the queue drafter fed from the cut.

## Things to check while building

- The matcher on Tom's real speech: he ad-libs, drops words and restarts
  mid-sentence. Keep the fixture transcripts from his first takes.
- Whisper's word times are rough by up to 0.9s around pauses
  (`align.ts`); beat starts should come from the aligned words, and a
  card landing a touch early reads better than a touch late.
- A long cut of five minutes is 300 seconds on the editor's px-per-second
  scale: the zoom range needs to reach it.
- Structured-output size: a long script is forty beats; the rewrite call
  needs enough output room.
- Image cost and time: forty sketches at once is slow; generate in
  parallel in batches and show each as it lands.

## Not in this

- Uploading to the platforms (still by hand through their schedulers).
- Reading the Google Doc directly (paste is fine; a Drive read can come
  later if the paste turns out to be the annoying bit).
- Synthetic voice of any kind (decision 4).
- Automatic retake and false-start detection (decision 6).
- Face-on-camera footage handling beyond what the editor does for any
  phone recording.

## Build notes (2026-10-09, stage 1)

- `apps/desk/lib/scripts.ts` (types, word diff, paragraph matching),
  `scriptsStore.ts` (files + the ideas migration), `rewrite.ts` (the
  Claude calls: rewrite, adjust, redo a beat, redo a cut, another short;
  `claude-opus-5-5`, structured output, effort high), `scriptSteps.ts`
  (the server-side glue), `ui/Scripts.tsx` (the tab). The editor's
  Script panel, Make and the routes now read scripts; `#ideas` still
  opens the tab. BITS has a `script.ai` voice in its desk.config.
- Tried on a real 667-word script of Tom's (a throwaway copy): the
  rewrite took 49s and gave 20 beats and three shorts, each short
  reusing four to six long beats word for word. Adjust after appending a
  paragraph took 38s and kept 20 of 21 beats untouched. Redoing one
  beat took 6s.
- The review shows each long beat against the source paragraph it
  shares most words with, not a true alignment: a beat merged from two
  paragraphs lights up more than it should. Fine for reading; revisit if
  it misleads.
- Not yet: the visual plan (stage 3) and the `sketch` prompt in the
  voice is unused until then.

## Build notes (2026-10-09, stages 2 and 3)

- **The overlay track.** `Card`, `OverlayTrack`, `Sequence.overlay` and
  the pure edits (`placeCard`, `moveCard`, `trimCard*`, `splitCardAt`,
  `removeCards`, `updateCard`, `cardAt`, `fitCard`) live in
  `packages/voiceover/src/sequence.ts` with tests in `cards.test.ts`;
  cards count in `sequenceSeconds`, `snapPoints` and `shiftClips`. A card
  dropped into a gap shorter than it is cut to the gap; dropped onto a
  card it goes to the nearest free spot. The Desk's `sequences.ts`
  sanitises them on save.
- **Drawing.** `apps/bits-promos/src/cards.tsx` (`CardsLayer`) is
  rendered by the Stage before a template's own overlays, so every
  template that plays an edit gets the cards, the editor's preview
  included. Checked with four stills through Talk: text on the backdrop,
  an `over` card in the right third beside footage, a sketch on the
  backdrop, a b-roll slot drawing nothing.
- **The editor.** A `cards` row above the video tracks (`Kind` gained
  `overlay`), the library's Cards shelf (+ Text, + B-roll slot, the
  script's sketches, the edit's cards), a card inspector, Split and
  Delete and ⌘A and the context menu all know cards.
- **Talk.** `apps/bits-promos/src/Talk.tsx`: landscape, straight through
  the edit, optional cold-open title (empty by default: the first card is
  the title), regular captions, sign-off or none. Chapter marks for the
  description are stage 5's (organise knows the beats).
- **The visual plan.** `Beat.card` (`BeatCard`: text / sketch / broll /
  none, with `src` once a sketch is made and `check` when its prompt
  changed after). `planVisuals` in `rewrite.ts` plans every beat in one
  call (the long cut's and the shorts' own beats). `lib/cards.ts` makes a
  sketch with `@heroic/forge` (lifted from Realmsmith's `forge/openai.ts`
  and `elevenlabs.ts`; Realmsmith imports the package now) in the game's
  `script.ai.sketch` style, into `public/cards/<script>/<beat>-<n>.png`
  (gitignored; `backupTakes` copies the folder to Drive). `makeSketches`
  runs three at a time in the background, saving each onto its beat as
  it lands; the page polls while any are pending and folds the pictures
  in, and the store keeps a server-made `src` the page's autosave doesn't
  know about yet. The shot list is `shotList()` in `lib/scripts.ts`.
- The keys: `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` were copied from
  Realmsmith's `.env.local` into `apps/desk/.env` (both gitignored).
- **Sketches, tried for real** on a throwaway copy of Tom's latency
  script: the plan (8s) gave 4 text, 3 sketch, 2 b-roll, 1 none across
  10 beats, with sensible prompts and filmable b-roll notes. The first
  pictures were wrong: asked for light ink on a transparent ground the
  model paints neon glows on black. The fix is to let it draw its natural
  sketch, black ink on white paper (opaque), and lift the ink in code:
  ffmpeg `geq` turns each pixel's darkness into alpha and every pixel the
  brand's bone, so the lines come out cream on nothing and the dark
  backdrop shows through. Checked composited on the backdrop colour: a
  clean notebook doodle. A picture takes about 15s; three run at once.
- The editor's cards row is typechecked and renders, not yet dragged by
  hand.

## Build notes (2026-10-09, stages 4 and 5)

- **The matcher** (`apps/desk/lib/match.ts`, tests in `match.test.ts`
  and, on Tom's real takes, `match.real.test.ts` with
  `fixtures/authority-takes.json`): each beat is aligned on its own to
  the best-matching stretch of the take's kept, unhidden words (a local
  alignment: a word in place +1, wrong −1, skipped −0.6, traced back for
  the words that paired up); a beat is covered at 70 percent of its words
  heard in order; a cover is the take time of the first and last paired
  word. Two beats claiming overlapping stretches keep the one with more
  words. A beat of five words or fewer (a heading) only counts read on
  its own, a 0.4s pause either side, never as a phrase inside a sentence.
  `matchScript` runs it per cut and merges by beat, best score wins.
- **Found on the way, on the real takes** (17 takes of the 8 Oct
  authority-model video, 839 words, with two passages read twice, two
  abandoned starts, a silent take and a mic test): the first matcher was
  one global LCS against every beat in order, and it (a) scattered one
  take's words across earlier beats that shared phrases, so that take's
  own beat went missing, and (b) found the four-word heading "the server
  authority model" inside a later sentence, a false conflict. The local
  alignment fixed (a); the short-beat rule fixed (b). After both: every
  clean take covers exactly its beats at 93–100 percent, the abandoned
  starts and the mic test cover nothing, the two double readings are the
  only conflicts, and organise lays 15 clips over 161s with the cards and
  markers where the beats start.
- **Kept regions**: `ScriptTake.keep` (spans of the take). `cutRegion`,
  `trimRegion`, `keptWords`, `keptSeconds` are pure. The store accepts
  `takes` in a patch but only ever takes `keep` and `words` from the page:
  files come from the server's own take route, and a take the page
  didn't send is not deleted (that's the DELETE route).
- **The prompter** (`ui/Prompter.tsx`): the mic code is the editor's
  (`mic.ts`), the waveform widget too. Record saves the take through
  `POST scripts/:id/takes` (saveTake, then Whisper, then onto the
  script) and answers with the take; the ticks come from `matchScript`
  on the page. The take view: drag to select, cut / keep only / trim to
  the words / reset, click to play from there.
- **Organise** (`lib/organise.ts`, tests in `organise.test.ts`): pure,
  `organiseCut(script, cut, covers)` → a Sequence. Slices run from 0.12s
  before a beat's first word to 0.12s before the next beat's first word
  in the same take, else 0.18s after its last word, clipped to the kept
  region. Conflicts and missing beats are skipped and reported. The
  server step writes `<slug>-long-r<n>` and `<slug>-short-<k>-r<n>` with
  `writeSequence`, records them on the script (`runs`, `sequences`), and
  the page links each to the editor.
- Not yet tried: the prompter end to end with the mic (the mic and
  Whisper paths are the editor's own), and the organised edit opened in
  the editor and rendered. LEAD 0.12 and TAIL 0.18 are first guesses.
