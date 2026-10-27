# Desk shorts: cutting the long video into shorts

Status: DESIGNED 2026-10-23, questions settled the same day. Stages 1 (the stage + Find shorts), 2 (hooks) and 3–4 (a short's own edit + loop score + Beats short mode + Render ticked through a server render queue) BUILT 2026-10-23; stage 5 copy BUILT 2026-10-26 (a short's post copy on the script, the Queue reads every script render's words live, tags everywhere); X tick added 2026-10-26 (posts queued before it don't need it to count as done); the related-video reminder not yet.

## Why (Tom, 2026-10-23)

> "Since I have long form videos, maybe we could figure out a way to
> automatically turn the long form scripts into bite-sized videos for X,
> YT Shorts and TikTok."

The goal is **followers, not views of the long video.** People should
come through to the profiles and follow, so that later there's an
audience to tell about the games. A short works if it makes someone
curious about the person who made it. Whether they click straight
through to the long video matters much less.

This reverses decision 1 of `desk-ascii-scripts.md` ("long form only, no
shorts"). That decision was about writing and recording **separate**
short scripts, which Tom couldn't make himself shrink his writing into.
This design doesn't do that. A short is cut out of the long video he
has already recorded, plus a hook line or two recorded on the same day.

## Decided (Tom, 2026-10-23)

1. **At least 3 shorts per long video**, and more when the script has
   them. A rich script might give 6–10.
2. **Goal = profile visits and follows.** Every choice below (the
   picking, the hook, the ending, the post copy) serves that.
3. **Recording a few extra hook lines is fine.** He's already been
   recording for about an hour by then, so another five minutes costs
   little.
4. **One short goes to every platform**: TikTok, YouTube Shorts, Reels
   and X. No A/B testing and no hook variants. The Queue's hook-variant
   tooling stays for BITS clips but isn't used here.
5. **Reels stays** in the Queue, even though it hasn't had much traction
   yet. These shorts might change that.
6. **Loop ending:** back into the hook, as HookClip does. No end card,
   no sign-off.
7. **Hook text on screen, briefly**, as well as spoken.
8. **Up to 90s when it holds up.** The aim is good mini videos found
   inside the main script, not everything kept as short as possible.
   Good content keeps people watching.
9. **Hooks in Tom's voice.** They have to grab attention without hype.
   Nothing in the "WOWEEE LOOK AT THIS VIDEO" vein, which isn't on brand.
   See § The hook's voice.

## The shape of it

A **Shorts** stage of its own on the script page, after Organise and
beside Publish (Tom, 10-23, after a false start on a top-level tab):

```
Write · Cut · Pictures · Record · Organise · Shorts · Publish
```

It needs the long cut organised, because picking works on what was
actually said and how long it actually runs, not on guesses. Before
that the stage just says so, with a link back to Organise.

The stage, top to bottom:

1. **Find shorts.** Claude reads the organised long cut and suggests
   runs of beats that work alone. Tom keeps or bins each one.
2. **Hooks.** Each kept short gets a hook line. Claude drafts it, Tom
   edits it, then records it against the prompter, which the stage
   embeds (the Record stage's component) with just the hooks to read.
3. **Render.** Tom ticks the shorts he wants and presses **Render
   ticked**: one press, every short. Organising the sequences is part of
   the render, not a step of its own.
4. **Queue.** Each rendered short goes to the Queue with one set of copy
   for every platform.

## 1. Finding the shorts

Tom's bar (10-23): "almost all of these are absolute bangers rather than
needing me to review a bunch of short scripts." So finding is two calls,
not one, and his own calls feed back.

**The finder** is generous. One call over the whole long cut, with the
beat texts and real durations from the kept takes (the same slicing
Organise uses, nothing written). It runs in the background like Plan the
story. What it may offer:

- **One run of consecutive beats, or two runs with a single jump**,
  20–90s spoken as recorded. A jump is for one thing only: a payoff
  separated from its setup by a digression; both runs must read as one
  piece of speech, and the finder says why the join reads (`Cut.join`).
  Tom hears the seam on the preview and bins it if it's bad.
- **Stands alone, first sentence included.** A sentence that gestures
  at something outside the run (a this, that, it, "whenever this comes
  up") sounds like the middle of a conversation even with a hook in
  front of it (Tom, 10-23, on hearing one), so it can't open a short and
  can't be in one. When a run's natural opener leans like that, the
  finder **starts one beat later and writes what the hook has to
  carry** (`Cut.check`: the thing the dropped beat said, as content),
  so a first beat that begins "But that's like saying…" or "So…" reads
  as the answer to the hook. Only when the next beat reads that way.
- **Has a payoff**, **has the person in it**, **is one thing**.
- Length is never the aim; a run that only reaches the window by taking
  in a beat that doesn't belong is out.

**The judge** is a second call that didn't pick them and owes them
nothing. It reads each candidate exactly as it will be heard, as a
stranger scrolling who will never see the long video, and scores it 1–10
on one question: would they watch to the end and tap the profile. It
judges a candidate's first beat as if its carry line had just been said,
and fails a candidate for any one of: a lean on anything the hook won't
have said, no payoff, nobody in it, two things, a join that doesn't
read, a beat there for length. Pass = 7 and up with no fault. A pass
that needs its hook keeps `check` (what the hook has to say); a fail
gets `problem`.

**What lands:** passes as suggested shorts ranked by score; fails as
near misses, folded away on the page ("show near misses (n)"), each
with its problem, so Tom can keep one anyway. If under three pass, the
bar stays where it is.

**Tom's calls are the standard.** Every find (and the judge) is shown
the shorts Tom kept and binned, across all his scripts (title, video,
first words), as "the author's own calls on earlier shorts". That's what
moves it toward his taste rather than Claude's.

**Titles for a stranger.** Tom (10-23): "Steam's discount goes to the
studios that need it least" reads as sale prices, not the cut Steam
takes. So the finder is told a title names the thing itself in everyday
words, and the judge reads every title as a stranger with no context
and gives a plain one when it could be taken two ways or doesn't say
what the short is about. The same literal-reader test goes on the hooks
(§ 2). That title came back as "Steam only lowers its cut once a game
makes $10 million".

Each card shows: title, score, beats (as "5–7 + 12" for two runs, with
a ⤵ jump mark between them), seconds as recorded, why, join, "the hook
has to say" or problem, the beat texts. Tom can **keep**, **bin**, **nudge** (add or
drop a beat at either end; ids stay), **hear it** (below), **Find more**
(runs not offered before) or **Find again** (undecided ones replaced).

### Hear it

Every card has ▶ hear it: the short's take slices played one after
another exactly as Organise would lay them (same matcher and slicer, a
route that writes nothing), with the long video's music quiet
underneath: the newest edit's song if it has one, else its generated
score. Web Audio for the slices (sample-accurate joins), an audio element
for the bed. It's how Tom judges the joins and the run before anything
is rendered.

Live runs (Steam video, 46 beats): finder 8 candidates → judge 3
passes (8, 7, 7) and 5 near misses with real reasons, ~50s for both
calls. The itch.io short first came back as beats 24–26 opening
"Whenever this comes up…"; after the carry rule it's 25–26 opening
"But that's like saying…" with the hook told to say that people tell you
to just sell somewhere else, like itch.io.

## 2. Hooks

The long video's beats are written to flow, so its first line rarely
stops a thumb. Tom's Shorts data says about 80% swipe in the first 3
seconds (bits-hook-testing).

Each short opens with a **hook beat**, a new beat with its own words
and no `from`. The draft:

- One sentence, under about 4 seconds spoken (around 10 words).
- Says what the short pays off, or the tension in it.
- **Never repeats** the short's own first line.
- Claude drafts 3. Tom picks one or writes his own.

### The hook's voice

Tom's words: it has to grab attention, but nothing in the "WOWEEE LOOK
AT THIS VIDEO" vein. The hook is the most hype-prone line in the whole
pipeline: models write hooks the way the internet writes hooks. So it
gets the strictest voice handling in the Desk:

1. **Same voice context as the rewrite.** The `system()` prompt from
   `rewrite.ts`, with Tom's own scripts in full and the game's voice
   rules, and its hard rules (no caps, no exclamation marks, no slogans,
   no coined aphorisms, no em dashes). It doesn't get a hook-writer
   persona of its own.
2. **His own words first.** Before writing anything, Claude looks for a
   line Tom already wrote that would open the short: in the run itself
   (often the payoff, said flat as a claim) or elsewhere in the script.
   It lifts that word for word, or trims it. New words only when nothing
   fits, and then built from phrases he uses. Each draft is labelled
   *your line, beat N* or *new words*, so Tom sees which is which.
3. **What grabs, in his register.** The brief describes the kinds of
   opener that work without hype, and gives **no example lines**
   (no-examples-in-creative-prompts: the model copies them). The kinds:
   - something specific: a real number, a real thing he did, a real
     mistake;
   - an honest admission;
   - an opinion stated plainly, one some people would disagree with;
   - the problem stated flatly, with dry understatement rather than
     exaggeration.

   It's told a viewer stops for a real person saying something real,
   not for volume.
4. **Banned outright**, as categories in the brief: telling the viewer
   to watch, wait or stay; superlatives and hype words Tom doesn't use;
   "you won't believe"-style promises; manufactured cliffhangers; trend
   formats (POV, "Did you know", "Nobody talks about"); questions aimed
   at the viewer that nobody would really ask; anything a stranger could
   have said about any game. The banned list names the *kinds*, plus the
   few stock phrases that are so common they need saying.
5. **A literal check.** A second pass on effort low reads each draft
   against two questions: "would this sound odd said out loud by the
   person in those scripts, to a mate?" and "does a stranger, taking
   every word in its everyday sense, get what this is about?" (Tom's
   "discount" catch on a title, § 1). It drops any that fail and writes
   a replacement. This is the same idea as the literal-reader check on
   picture prompts.
6. **It learns from his picks.** Every hook Tom keeps (picked or
   rewritten) is saved with the script. Later hook calls get those as
   "hooks the author chose before", real lines he approved, never
   invented ones (scripts-in-toms-voice). After a few videos the drafts
   start sounding like his choices, not like Claude's guess at them.

The voice rules come from the game's `script.ai` in desk.config, so the
same machinery works for Autosave or any other channel in its own voice.

### Recording and showing it

The **prompter** gets a *Hooks* list after the long script: every kept
short's hook, read one after another in one take. Matching and keep
regions work as they already do. A hook is just a beat.

The same words go **on screen from frame 0, briefly** (HookClip's
lesson): they're up while the hook is spoken, about 3s at most, then
gone. A muted scroller gets the hook too. Tom can make a short skip the
recorded hook and open straight on the excerpt with only on-screen text.

### Stage 2 as built (2026-10-23)

- `Cut.hookDrafts` (text + source: "your line, beat N" / "new words" /
  "new words (checked)"); `withHook(cut, text)` in `lib/scripts.ts` sets
  `hook` and the hook beat (own beat in front of the excerpt, id kept
  when the words change, `changed` set so its take wants checking;
  empty removes it); `hookBeats(s)` = the kept shorts' hook beats.
- `rewrite.ts draftHooks`: the rewrite's `system()` voice context (Tom's
  scripts in full) + HOOK_RULES (own words first with beat number,
  kinds not examples, carry line, banned kinds, stranger reads it
  literally), three drafts a short in one call, then HOOK_CHECK on
  effort low (sounds odd to a mate? stranger gets it? lifted lines
  checked the same, after one slipped through with "discount").
  Hooks Tom chose before (kept shorts' `hook`, all scripts) go in as the
  standard.
- `scriptSteps.ts draftHooks` (`POST scripts/:id/hooks[?all=1]`): kept
  shorts without drafts, or all again; a chosen hook is never touched.
- Shorts stage: **Draft the hooks** sits in the top bar beside Find; a
  kept short's hook lives ON ITS CARD, in front of the beats where it's
  said (Tom, 10-23: a separate Hooks section "feels weird"): a `hook`
  row with the text box (type or pick a draft chip, labelled with its
  source), read ✓ / to read, the carry line just above. The hook beat
  stays out of the beat rows (the box is it). Below all the cards, one
  **Read the hooks** panel = the Prompter with `only={hookBeats}`: the
  hooks read one after another like the script, matched by the same
  matcher (a hook beat is its own beat, so `coversOf` finds it with no
  change).
- `previewShort` already lays the hook take in front when it's
  recorded (organiseCut reads a short's own beats from the takes).
- Live on the Steam video: 4 kept shorts → 12 drafts in 18s, mostly
  lifted lines with beat numbers, none hypey.

## 3. Organising a short (inside the render)

The data model is already there (parked 10-11):

- A short is a `Cut` with `kind: "short"`, `hook`, `why` and `beats`.
  Its excerpt beats carry `from: <long beat id>`, and `organiseCut`
  already reads a `from` beat from the long beat's takes
  (`beatId = b.from ?? b.id`). Its hook beat is its own beat.
- **Pictures:** `from` beats show their long beat's pictures (as
  `cardOfBeat` already does for the old cards; pictures need the same
  look-through). The hook beat shows the first excerpt beat's picture,
  starting with the fast burst from Autosave's first-second hook, so
  the picture is already building at frame 0.
- **Score:** `makeScore` over the short's own sequence. It's a new score
  with the long video's seed, so it's recognisably the same piece. No
  chapters, no title cold open, no end card.
- **Pulled words + captions:** come through as they are; the Beats
  template already lays them out for vertical.

Organising happens when Tom presses Render ticked: one sequence per
ticked short, named after the long video's run, written fresh each
time (never merged into an edited one, as the long organise does).
A short whose beats are missing or in conflict is reported on its card
and left out of the render rather than rendered with a hole. A rendered
sequence is kept and listed in the editor, so Tom can still open one
and fix it by hand, then render that one again from the editor.

## 4. Render

The **Beats template, vertical**, plus a `short` mode:

- Hook text on frame 0, up while the hook is spoken (3s at most).
- No cold open, chapters or end card.
- **Loop ending** (HookClip's): the last moments crossfade back into
  the opening picture build, and the hook drops back in landing on frame
  0's exact state. The score's end has to land on a loop too, not a
  final cadence, so `packages/music` gets a loop ending (check while
  building: the journey currently lands home for the end card). A quiet
  channel name may sit in the last second if it doesn't spoil the seam;
  decide on a real render.
- **Render ticked, in one go.** The page ticks every kept short by
  default; Tom unticks what he doesn't want. One press organises and
  renders them all: a batch per short (so each is its own card under
  Renders and its own Queue post), vertical only. Progress shows on
  each short's card, and the button reads "rendering 3 of 6". A short
  already rendered shows its thumbnail and a Render again.
- **A render queue on the server.** Today `startRender` kicks every
  job off at once (`/api/:game/render` returns a job per format, and
  the hook-variant loop fires them all). Six Remotion renders at once on
  one machine thrash. Shorts use a small server-side queue, two jobs
  at a time, the rest waiting with `state: "queued"`. The queue goes
  in `lib/render.ts` so Make's variant batches get it too.
- Picture: the vertical layout already fits the landscape picture
  across the full width in the middle band (11% down, half the height),
  clear of TikTok's top bar and bottom quarter. **No cropping and no
  vertical pictures to generate.** Worth a look on a real frame: the
  picture is about 1080×720 on a 1080×1920 screen. If it feels small,
  try `cols` lower or a taller band.

X takes vertical video, so **one render serves all three**.

## 5. Queue and copy

Renders go to the existing **Queue**: same slots and spacing. Shorts
from one long video share a `clip`, so the same-clip gap spaces them out
over days rather than dumping them on one.

- Add **X** to `PLATFORMS` (no title; 280-character text), so the
  platforms are TikTok · Shorts · Reels · X.
- **Post copy:** `draft.ts` from the short's title, hook and why, plus
  the long video's title. One description for all three (Tom asked for
  consistency before). On X it has to fit 280 characters, so the draft
  is written to that limit. Shorts also gets its title.
- **YouTube Shorts' related video:** Shorts can link to one full
  video. The Desk can't set it (no uploads by decision), so the Queue
  row shows the long video's link (`sequences[].youtube`) with a
  reminder to set it in YouTube Studio. It's the one real bridge from a
  short to the long video.
- Posting stays by hand, as the Desk has always done. X's posting API
  is paid, and TikTok's is region-gated (autosave-story-comments).

**As built (2026-10-26).** A kept short carries `post` (`ShortPost`:
title, description, tags), written by `writeShortPost` (rewrite.ts, the
script voice) when Render ticked starts it, or from "Write the post" on
its card (Shorts stage, "The post" box: edit by hand, copy each, an
instruction for the next write). The Queue never stores a script's
words: `presentSchedule` (scheduleStore.ts) resolves a post's `clip`
(`sequences/<id>.json`) to the script that owns that sequence on every
read and overlays `title`/`description`/`tags` plus `source` (script,
cut, short, written). A short = its post copy (title + hook until it's
written); the long video = the long cut's title, the YouTube description
with the chapters under it, and the tags from the Publish stage. In the
Queue those posts are read only, with copy title / description / tags
and the way to the stage that owns them. Redraft refuses them.

## What helps follows

Not features as such, but they shape the defaults:

- **Same look every time.** The ASCII pictures, the terminal captions
  and the Cinzel channel name make the shorts recognisable as one
  person's. Someone who sees three of them knows whose they are. That's
  a reason to keep shorts in the Beats look and not a different short
  template.
- **The profile does the converting.** Profile bios, pinned posts and
  the YouTube channel trailer are out of the Desk's scope, but worth a
  look on each platform once shorts start landing.
- **Cadence:** 3+ shorts per long video, posted over a week or so, gives
  a steady stream between long videos. Longer, better shorts are fine (decision 8). That's what the Queue is for.

## Build stages

1. **The stage + Find shorts:** the Shorts stage on the script page,
   the background Claude call,
   suggestion cards (keep, bin, nudge, Find more), cuts saved as
   `kind: "short"`. The rewrite still never writes shorts.
2. **Hooks:** the hook drafts in Tom's voice, the embedded prompter with
   the Hooks list, matching takes to hook beats, kept hooks saved for
   later drafts.
3. **Organise + pictures + score:** a sequence per short, the `from`
   picture look-through, a per-short score with a loop ending.
4. **Beats short mode + Render ticked:** hook on frame 0, no title or
   end card, loop ending; the server render queue; one press renders
   every ticked short with per-card progress.
5. **Queue:** X platform, drafts per short, the related-video reminder.

Each stage is usable alone: after stage 1 Tom can already see which bits
of a video would make shorts.

### Stage 1 as built (2026-10-23)

- `Cut` gained `check`, `problem`, `join`, `score`, `state` (suggested ·
  kept · binned);
  `Beat` gained `seconds` (as recorded, measured at Find shorts).
  Helpers in `lib/scripts.ts`: `excerpt` (a list of beat numbers),
  `shortBeats`, `shortLabel`, `shortSeconds`, `nudgeShort`,
  `SHORT_MIN`/`SHORT_MAX` (20/90). Tests in
  `lib/shorts.test.ts`.
- `organiseCut` returns `laid` (beat, at, seconds) so Find shorts times
  beats by the same slicing organise uses, without writing anything.
- `rewrite.ts findShorts`: finder + judge (see § 1), the long cut's
  beats with their recorded seconds, the shorts already offered, Tom's
  keeps and bins (`ShortTaste`); answers `ShortVerdict[]` (beats, join,
  title, why, score, verdict, problem, check). No hook (stage 2). Voice =
  the game's about + rules, no sample scripts (it writes only titles and
  reasons).
- `previewShort` (scriptSteps) + `GET scripts/:id/shorts/:short/preview`
  + `ShortPlayer` on the page: hear it.
- `scriptSteps.ts findShorts` runs it in the background (`finding` on
  the script GET, route `POST scripts/:id/shorts/find[?more=1]`). A
  fresh find replaces undecided suggestions and keeps kept and binned
  ones; `more` keeps everything and asks for runs not offered.
- The Shorts stage (`ShortsStage` in `ui/Scripts.tsx`): gate on
  organised, Find / Find again / Find more, a card per short with its
  beats, length as recorded, why, check or problem, Keep / Bin / nudge
  at either end (beats keep their ids), binned folded away.
- Old scripts' parked shorts from 10-09 (no `state`) are hidden and not
  counted; a fresh find drops them.

### Stages 3–4 as built (2026-10-23)

- `renderableShort(s, c)` in `lib/scripts.ts`: the short with each
  excerpt beat carrying its long beat's picture, mood, pulled words and
  story line (ids, `from` and words untouched so the takes still read
  it), chapters stripped, the hook beat borrowing the first excerpt
  beat's picture and mood (no pulled words). `organiseCut` then makes
  ONE build when the same picture follows itself straight after (the
  hook and the first beat), carrying the pulled words over.
- `planFor(seq, s, { loop })` / `makeScore(…, { loop })` in
  `lib/score.ts`: no cold open, no end card, `loop: true`.
  `@heroic/music` journey: `JourneyPlan.loop` = no fade in or out, the
  last chord swapped for the lead-in (the end card's) so the replay
  resolves onto the first, and the Score's `loop: true` so the render
  wraps the ringing notes round the seam.
- `Script.sequences[]` entries gain `short` (the short's id) and
  `render` (the library slug once it's made). `longEdits(s)` = the
  long video's; every "newest edit" lookup (score, music carry-over,
  chapters, the Organise list) uses it, so a short's edit never passes
  for the long one.
- `lib/render.ts`: a queue, two renders at a time, `state: "queued"`
  until a slot frees; Make's batches go through it too. `onDone` hands
  the manifest back.
- `lib/scriptSteps.ts renderShorts(g, id, shortIds)` (`POST
  scripts/:id/shorts/render`): per short, organise afresh into
  `<title>-short-<n>-r<run>` (overwritten each time; "open the edit" is
  for fixing by hand), score it as a loop with the script's one
  `scoreSeed` (made if there's none, so every short's score is the same
  piece), then a Beats render: vertical, `opening: none`, `ending:
  loop`, `hook`, `hookFor` = the hook's spoken seconds + 0.3 (3 at
  most), one batch a short. Answers at once; GET script carries
  `rendering` (scoring → queued → bundling → rendering → done | failed
  by short id) and the page polls. Left out and said so: no hook, hook
  not recorded, a beat missing or read twice, already on its way.
- Beats template `ending: "loop"` + `hook` + `hookFor`: `HookLine` on
  frame 0 (glyph face, mid-screen UNDER the picture on a tall frame at
  49–65%, the short's picture lifted to 16–48% to make room and the
  terminal line from 67%; the first render had the hook at 10–30%,
  under TikTok's top bar, the second clipped the terminal line; settles
  rather than enters, lifts at `hookFor`, drops back in over the last 8
  frames landing on frame 0's state); the first build gets `burst`
  (ascii-build `BURST` 45% of the glyphs in 0.6s, start at 0.05s); the
  terminal line is off for the last 0.3s of speech; `MusicBed loop`
  de-clicks the ends. Duration = the body + `LOOP_TAIL` (1s, ascii-build
  video.ts): the first render ended on the last word with the picture
  still up (a hard cut at the seam), so the tail lets it rain away
  while the hook drops back in, and the loop score is written to the
  same length so its loop point is the video's.
- Shorts stage: a tick on every kept card (ticked by default, off while
  it's on its way), **Render ticked (N)** in the top bar ("rendering 2 ·
  render 1 more"), a row on each kept card for the score / queue /
  progress bar, then the thumbnail, watch, and open the edit. The
  stage hint says "rendering" and counts rendered.
- Not yet: picture size on a real vertical frame (§ 4's "worth a look"),
  the quiet channel name in the last second, and stage 5.

## Settled (Tom, 2026-10-23)

The first round's open questions: loop ending, hook text on screen
briefly, Reels kept, up to 90s. Now decisions 5–8 above. Nothing open;
ready to build from stage 1.
