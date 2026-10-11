# Save Point: the ASCII build channel

*Drafted 2026-10-09 (Tom + Claude). Channel: **Autosave**, @autosave.ascii.
Status: **stages 1–3 BUILT 2026-10-09; MEMORY, Reroll and stage 4 (the
Saves tab) BUILT 2026-10-10**, all uncommitted: `packages/ascii-build`
(engine, loop exit, progress; 9 tests), `apps/autosave-promos` (Desk
entry `autosave`, the `Save` template, forged sfx, `bun run sync`
library, `desk.saves.tsx` + `desk.server.ts`), first test render
`apps/autosave-promos/out/test-save-07.mp4`. A lighthouse draft is
waiting on the Saves tab. Owed: Tom's run of the Saves tab, his
watch/listen of a render, Suno tracks into public/music, taglines for the
first four saves, slot suggestion from the queue, more rare eggs.
Earlier working name "Save Point". Grew out of the beat-builds experiment
(`apps/bits-promos/lab/beat-builds`). Companions: [desk-scripts.md](desk-scripts.md) (where the BITS use of the
same effect lands later), [apps/desk/README.md](../../apps/desk/README.md).*

## Why (Tom, 2026-10-09)

> "after playing around with it for a bit and all of the settings, all I
> can say is... wow, absolutely stunning to look at."
>
> "in desk I think i'd like to build a standalone tool that allows me to
> just make 9:16 videos of this art being generated. I want to run a
> separate tiktok channel just for these visuals to see how they perform
> by themselves … (so not bits related at all for the second channel)"
>
> "it kind-of feels like reaching a save point, maybe that's what we can
> style it as, maybe make it feel like you've reached a save screen in a
> video game"

A test of whether the visual alone holds people. No voice, no game, no
face: a picture building itself out of glyphs, framed as a game saving
your progress, with music and soft ticks.

## The video

9:16, 1080×1920, about 15 seconds, made to loop.

| Time | What happens |
|---|---|
| 0–0.5s | "Please wait while we save your progress." and a small "Do not turn off your phone." with a spinning save icon. The first glyphs are already moving (the hook is motion on frame 0). |
| 0.5–11s | The picture builds (shuffled arrival + fill order, Tom's locked look). The save bar fills in step with the glyphs that have landed: `[██████░░░░] 62%`. Loading-screen tips cycle underneath (2–3 per video, see below). |
| ~10.5s | The bar sticks at 99% for a beat. Everyone knows that feeling. |
| 11–13s | "Save complete. You may now continue scrolling." and a save chime. Tint end glow fades up. Slot panel fully typed out. |
| 13–15s | The picture dissolves back into rain and the screen empties, so the last frame meets the first: a seamless loop. |

**The save screen frame** (all in the mono font, same palette as the
glyphs, so it reads as one terminal):

- Top: `SAVE SLOT 07`, and `SAVING…` → `GAME SAVED`.
- Middle: the picture, portrait, filling most of the frame.
- Bottom: the slot panel typed out as the build runs:
  `LOCATION  THE CASTLE ON THE HILL`, `PLAYTIME  412:07:33` (ticking),
  `DATE  09.10.2026`.
- Light CRT dressing: scanlines and a soft vignette. Subtle; the glyphs
  stay the star.

**Series hook:** the slot number goes up by one for each video across the
whole channel (Save #1, #2, …), so the channel is a run of saves, and the
location line names what the picture turned out to be.

## Loading-screen easter eggs (Tom, 10-09)

> "It would be nice if we could add some other quintessential loading
> screen easter eggs, sometimes they have hints and other stuff, it would
> be nice to cycle through."

- **Hints, built 2026-10-10 (replaces the seeded bank below):** 250 drafted
  in `apps/autosave-promos/hints.json` (committed; Tip / Hint / Did you know? /
  Lore). The Desk's **Hints** tab is a queue Tom orders (drag, To the top,
  click to reword, delete, add next/last) plus a **Used** list, most recent
  first, with the render's name and time and a Use again button. A fresh Make
  form takes the top two as `hint1`/`hint2` (editable there), and a Render
  press marks them used, so no two videos share one. A hint typed in Make that
  isn't in the bank joins it as used. Past 90 characters one takes a third line.
- (Original plan) **Tips** cycle under the bar: a bank in the channel package, picked by
  the seed so no two neighbouring videos repeat. Plain, dry, British, in
  Tom's voice (no slogans, no em dashes). Starter bank:
  - Tip: Your progress is only saved if you watch until the end.
  - Tip: Rest when you can. The feed will still be there.
  - Tip: Drink some water.
  - Tip: Talk to everyone in town twice.
  - Tip: Check behind the waterfall.
  - Tip: Saving often never hurt anyone.
  - Tip: Some saves hide something. Keep your eyes open.
  - Hint: The bar always sticks at 99%. Nobody knows why.
  - Did you know? Every picture here is made of a few thousand typed characters.
  - Did you know? Nothing in this video was filmed.
  - Tip: If you're reading this, it's working.
- **The classics as set dressing:** the spinning save icon, "Do not turn
  off your phone", "Checking save data…" for the first half second, the
  bar sticking at 99%.
- **Rare eggs** (about 1 in 10 videos, picked by the seed): an
  achievement toast ("Achievement unlocked: watched one to the end"), a
  "Save data corrupted… just kidding" flicker, a palette swap. Something
  for the comments to spot.

## Locked look (from the experiment)

ASCII rain effect, bold tonal source image with white background cut
away, light = glyphs, gain 1.1, gamma 1, 6 grey levels, **120 columns**,
Matrix green, **dither** on straight edges (12% zone), arrival + fill
order **shuffled** per video (fixed by a seed so a render is repeatable),
palette-tinted end glow. Images: one bold subject, a few big shapes.
Busy scenes (the fantasy world map) don't read.

## Sound

- A music bed per video, from the channel's own music folder: Suno
  tracks Tom generates and drops in (instrumental; the Desk's music
  picker chooses the 15s window). Wide spread of styles, led by ambient
  drum and bass and downtempo retro game music. The prompts are in
  "Suno prompts" below.
- Soft ticks as glyphs land, thinned so it's a texture under the music,
  not a hailstorm (at most a few per frame, quieter as the build gets
  dense).
- One save chime on `GAME SAVED`.
- Ticks + chime are made with the forge's ElevenLabs tool and kept in the
  channel package.

## How it's built

1. **`packages/ascii-build`** (shared, unprefixed: both channels use it).
   The engine pulled out of the lab: image → ink map (background knockout,
   tone), grid sampling with grey levels and edge dither, the cell
   schedule (order + arrival + seed), and `draw(ctx, t)`. A pure function
   of time, which is what Remotion needs: any frame renders on its own,
   in any order. The lab page switches to the package and stays the
   tuning bench.
2. **A new promos package for the channel** (name follows the channel
   name, e.g. `apps/save-point-promos`), with its own `desk.config.ts`,
   registered in `apps/desk/games.ts`. Its own Drive folders, renders,
   library and queue, with no BITS assets anywhere.
3. **The `Save` template** (Remotion, 9:16, no clip needed): props =
   image, location line, slot number, seed, arrival/order (or shuffle),
   music + start, length. Ticks are placed from the cell schedule (the
   engine knows when every glyph lands).
4. **Making the picture in the Desk:** a prompt field with **Generate**
   (the forge, portrait 1024×1536, the bold tonal style added for you),
   a few candidates, pick one. The location line defaults from the
   prompt.

Rendering at 1080×1920 redraws every landed glyph each frame (about 10k
`fillText` calls at 120 columns on a portrait image). Fine for a render.
Worth measuring before trusting the live preview at full rate.

## Decided 2026-10-09 (late), built 2026-10-10

- **LOCATION becomes MEMORY.** Not every save is a place ("The quiet
  hours"). Tom: "I love memory as a name, I can also get very descriptive
  with it too." So the MEMORY line can run long: it needs to wrap over a
  few lines, and the scramble → reveal has to work across all of them.
  The prop becomes `memory`, sidecars too. *Built:* wraps to 36
  characters under a `MEMORY` label (PLAYTIME moved above it), about
  three lines before the Desk warns; each character settles in a ragged
  left-to-right wave over ~1.2s; a long memory ends the build earlier so
  there's reading time (about 18 characters a second, 2–5s) before the
  loop comes round.
- **Seeds:** a new video starts on a random seed, and a **Reroll** button
  beside the field picks a new one (shuffle is from the seed, so the
  default seed of 1 always showed the same look). *Built* as a generic
  Desk feature (`reroll` on a template); picking a picture also fills
  its memory (`linked`).
- **Stage 4 makes the whole save, not just the picture:** image prompt
  (bold, one subject) → candidate images → MEMORY line, tagline, post
  title and description, all written to match. **Everything generated is
  a draft Tom can override**: he puts his own flavour on the words, and
  his edits are what's kept (the sidecar holds the final text).

## Stage 4: the Saves tab (designed + built 2026-10-10)

Autosave gets its own Desk tab, **Saves**, where a whole save is made
before it becomes a video. One draft at a time, top to bottom:

1. **Idea.** A box for Tom's own idea in plain words ("grandad teaching
   me chess"). Or **Suggest**: Claude offers six picture ideas in the
   channel's mood (one bold subject, a quiet, nostalgic, game-save
   feeling), steering clear of what's already in the library. Clicking
   one fills the prompt. The prompt stays a text box Tom can edit.
2. **Pictures.** **Generate** makes three candidates in the bold tonal
   style (GPT Image through `packages/forge`, 1024×1024, the style added
   for you, as `gen-tonal.ts` did). They take 30–90s, so they run in the
   background and land one by one. Each card shows the picture **as
   glyphs** (the real engine, Tom's locked look), because a picture that
   looks fine can still read badly as ASCII; hover shows the original.
   **Three more** adds another round. Pick one.
3. **Words.** **Write** sends the chosen picture (Claude looks at it) and
   the prompt to Claude, which drafts three options each for the
   **memory**, the **tagline** (the one line under the video) and the
   post **title**. The first option fills each box; the others sit under
   it as chips to swap in. Every box is free text, so Tom rewrites
   whatever he likes. What's in the boxes when he saves is what's kept.
4. **Save.** Tom names it (a slug is suggested). The picture goes to
   `public/saves/<name>.png` and the words to its sidecar
   `<name>.json` `{memory, tagline, title, prompt}`. The library
   re-syncs, and **Make a video** opens Make with that picture, its words
   and a fresh seed.

The words travel as props on the Save template (`memory`, `tagline`,
`title`). Picking a picture in Make fills all three from its sidecar, and
they stay editable there too, per video. The queue's draft reads them:
title `Save NN: <title>`, and a description that starts with the tagline,
then the fixed channel line and the tags.

Drafts live in `public/saves/drafts/<id>/` (gitignored) with a
`draft.json`, so a half-made save survives a Desk restart. A saved or
binned draft's folder goes.

**How it plugs into the Desk (generic):** a game can add its own tabs
(`tabs` in desk.config: a lazy browser component) and server routes
(a `desk.server.ts` beside the config, loaded by path at Desk start so
the browser bundle never sees it, mounted at `/api/<game>/x/<name>`).
It can also hide tabs it has no use for: Autosave hides Clips and
Scripts (no footage, no scripts). Make takes a one-shot preset (props
handed over from another tab).

Cost: about $0.05–0.10 a round of three pictures (medium quality), and
pennies for the words.

## More, 2026-10-10 (Tom)

- **Journal.** Taglines get cut at about 60 characters in TikTok's UI, but
  Tom wants room to be creative. So the tagline stays short (Claude asked
  for under 60; a counter on the box; a Desk warning past it), and a new
  **journal** field holds the long text. It goes in the description
  under the tagline, behind "more", above the channel line and tags. It's
  blank by default: "Draft a journal entry" offers one beside Tom's box,
  and never writes into it. Kept verbatim in the sidecar.
- **Picture picker.** Make's image select is gone. A generic `gallery`
  field shows preview squares on two tabs, **To make** and **Made** (any
  render that used it). A fresh form starts on something not made yet.
- **Glyph copies.** On Save the Saves tab draws the finished picture
  (locked look, matrix green, end glow) at 2048×2048 and stores it as
  `public/saves/ascii/<name>.png` (gitignored), for Tom to use elsewhere.
  Older saves get theirs from a "Make them" button on the tab.

## Playtime + the egg registry (Tom, 2026-10-10)

**Playtime is real.** It's the total length of every save before this
one, using actual video lengths. Save 01 starts at `0:00:00`, and each
save starts exactly where the last one's clock stopped (the last frame
shows `from + seconds`). The numbers stay small, and that's the joke.

- **Ledger:** `public/slots.json` (committed), one entry per slot
  `{slot, seconds, playtimeFrom, egg, batch, renderedAt}`. It sits in
  public/ so the video reads it live (no rebundle, no Desk page reload).
  It's written on the **Render press** through the template's `rendered`
  hook (`POST x/slot-rendered`, which works out the clock and egg exactly
  as the video does), and the latest render of a slot wins. *Built
  10-10*: `src/eggs.ts` (registry + ledger maths, 4 tests), Make's info
  line and Egg choice, the Eggs panel on the Saves tab.
- Make fills `playtimeFrom` from the ledger (slots before this one,
  overridable) and defaults `slot` to the next free one.
- **Drift:** if an earlier slot is re-rendered at a new length, Make
  warns on the later slot that its clock no longer joins up.

**Eggs:** at most one per save, and only some saves get one. Tom: "lets
not have every video have an egg though it should be a little bit rare".

- **Registry:** `src/eggs.ts`, every egg in one list, each with an id,
  a label, an effect, and how it fires. `status: "idea"` entries are
  reminders that never fire, listed on the Saves tab so nothing gets
  forgotten.
- **Firing order:**
  1. Make's override (None, or force one).
  2. A **pinned** slot (`slots: [13]`) always gets its egg.
  3. Otherwise one seeded roll at `EGG_RATE` (about 1 in 7) decides
     whether there's an egg at all, then a weighted pick among the live
     eggs that aren't on cooldown (cooldown counts slots, from the
     ledger).
- **First eggs:** backwards clock (about a second, mid-build), frozen
  at `99:59:59`, `--:--:--` until saved, `??` hours (pinned to slot
  13), and the old "Achievement unlocked" (it was seed % 10, so it now
  joins the roll).
- **Make** shows which egg (if any) and why. The **Saves tab** shows the
  eggs used by slot, the pinned ones coming up, and the ideas list.

## Later (not in this build)

- **BITS Desk:** a sketch card on the overlay track gets an "ASCII build"
  style, timed by the voice take's Whisper words instead of a fixed
  length (the original idea).
- Batch mode: a list of prompts → a week of saves for the queue.
- Words-build effect: parked. Lower resolution, only reads on simple
  silhouettes.

## Suno prompts

Paste into Suno's style box with **Instrumental** on. Named artists and
games get blocked, so describe the era instead. Make two of each and keep
the ones with a calm first minute (that's where the 15s windows come from).

1. ambient liquid drum and bass, 172 bpm, soft rolling breakbeats, warm reese bass, airy pads, rain textures, nostalgic, late night
2. atmospheric jungle, late 90s console racing game soundtrack, chopped breakbeats, deep sub bass, dreamy pads, glassy chime melody
3. ambient drum and bass, half-time feel, lush strings, wordless vocal chops, hopeful, sunrise
4. downtempo retro video game music, 16-bit soundfont, mellow electric piano, soft lo-fi drums, save room theme, cosy
5. calm save room theme, survival horror safe room, slow ambient, music box melody, warm tape hiss, reassuring
6. lo-fi chiptune, handheld console square waves, dusty hip hop drums 80 bpm, vinyl crackle, gentle
7. FM synthesis ambient, 90s console menu music, glassy bells, soft breakbeat, floating
8. slow synthwave title screen music, analog synth arpeggio, gated reverb drums, dreamy, 90 bpm
9. dark ambient electronica, computer terminal hum, slow pulsing bass, soft glitch clicks, minimal, cyberpunk

## Slot numbers

Recommendation: keep them, but small. A dim `SLOT 16` in the top corner,
the way real save screens show it, not a headline. It gives people a
handle ("16 is my favourite"), works as the post title, and costs nothing
on screen at that size. The number counts **posted** videos: the Desk
suggests the next one and Tom can change it, so the public run has no
gaps. Pending Tom's call.

**Moved 10-10:** the top corners sit under TikTok's top bar (LIVE on the
left, search on the right), so `SLOT 07` now shares the PLAYTIME row
(`PLAYTIME  0:00:12     SLOT 07`), short of the button rail. The DATE is
gone: the slot already says which save it is, a render date isn't the post
date anyway, and a dated video looks stale when TikTok resurfaces it months
later.

## Name

Leaning "Save Point". Alternatives on the table: Autosave, Now Saving,
Save Slot, Please Wait, Do Not Switch Off. Handle availability decides
between close calls.

## Open questions

- The channel's name (and so the package name).
- Slot numbers: small corner label as recommended above, or none?

## Generated music (2026-10-10, prototype)

Tom: could the seed make a different piece of loading music for every save,
the way it makes a different picture? Yes: written in code, no AI model
(`src/music/`, `bun scripts/music.ts --samples` → `out/music/`).

- **Mood from the words** (`mood.ts`): word lists over memory, title,
  tagline and journal pick one of cosy, wistful, wonder, night, playful,
  tender. Nothing telling → the seed picks cosy, wistful or wonder.
- **The seed composes** (`compose.ts`) inside that mood: mode, key,
  tempo, progression, instruments (FM electric piano, music box, celesta,
  ocarina, harp, pad, bass), the little tune, arpeggio or not, room tone
  (crackle, tape, rain, hiss). Tender is a 3/4 lullaby.
- **It follows the video:** whole beats up to `saved` so the home chord
  lands on it; bass and arpeggio join after the first bar; the pad opens
  up as the bar fills; tune and arpeggio stop at 99% on a hanging chord;
  the chime speaks and the tune answers a beat later; it closes down
  through the exit and a reversed chord swells into the loop point.
- **The chime is in C** (C, E, F, B measured), so keys are white-key modes
  moved by `chimeShift` (−2..+2); the template will play the chime at
  rate 2^(shift/12) to match.
- **Seamless:** notes ring round the end to the start; reverb, wobble and
  the lowpass run over the loop twice and keep the second pass. Same
  loudness for every save (−16 dB RMS).

**Styles (10-10, Tom: "a little more variety").** The mood sets harmony,
tempo, room and texture; the seed also picks a STYLE that suits the mood,
which sets the arrangement: felt piano, rhodes, lo-fi (boom-bap), chip
(pulse + triangle + NES-noise kit), ambient (choir/strings, no beat),
lullaby (3/4), guitar (Karplus-Strong fingerpicking), downtempo
(half-time), dnb (~170, chords every two bars, tune in quarters). Soft
synthesised drums; instrument balance set by measuring levels
(`--stems`), not by ear. Chord colour only where sweet (major 6/9, else
7th; minor IV plain). `--variants N` = N seeds for one memory to choose
from; `--style`/`--mood` force one. Samples: every style twice.

**Decided 10-10 (Tom):** the music seed is the SLOT number
(`musicSeed(slot, take)`), not the picture seed: slots never repeat, so no
two saves share a tune, and Reroll only changes the visuals; `take` 1, 2…
is the "different tune" escape hatch. (The Desk's 1–9999 picture seed
would collide by ~118 saves.) Progressions roughly doubled (≈100), chosen
for different OPENINGS since a 16s save only plays 2–3 chords before the
lead-in. Lo-fi CUT (Tom: the beat felt off) → replaced by a village
WALTZ (quick 3/4, pluck on one, chord on two and three, flute/ocarina,
no drums). Drums no longer pick up the mood's swing.

**Progressions are written, not listed (10-10, Tom: "hundreds of these",
`src/music/harmony.ts`).** A Markov walk over what-follows-what per mode
(diatonic + borrowed ♭III/♭VI/♭VII/iv/IV/V + secondary dominants, borrowed
weighted per mood), a per-track colour palette (2–3 of plain, 7th, add9,
9th, 6th/6-9, sus, 11th/maj7♯11; each chord draws its own, only sweet
intervals; sus only on major chords, never first or twice running), bass
as root / walking inversions / tonic pedal, close or open voicing, and
sometimes two chords in a bar. The tune moves off any note a semitone from
a chord note. Harmony has its own random stream and always walks 12
chords, so a slot keeps its chords across styles. Measured: 500 slots per
mood → 496–500 distinct progressions (with key).

**Wired into the Desk (10-10).** Music defaults to "Generated: this
slot's own tune" (`music: "@tune"`), with Tune style (auto or one of the
nine) and Tune take (0 = the slot's own, 1, 2… = another). Suno tracks
stay in the list. `src/music/tune.ts` is shared by video, Desk and
generator: the file name is slot + take + style + a hash of the words and
length (an edited memory moves "Save complete", so it's a new file). The
Desk's new generic `prepare` hook (apps/desk/game.ts) asks desk.server.ts
"tune" for the file a moment after the form settles and before
Render/Still; the route runs scripts/music.ts in its own process (never
blocking the server), dedupes, caches, keeps the newest 40. The video plays
the tune only while `musicFile` matches its props, from frame 0 with a
one-frame fade, and plays the chime pre-pitched into its key
(public/sfx/chime-up1.wav etc., `bun scripts/chimes.ts`; Remotion's
playbackRate keeps pitch in a render so it can't do this). The Make note
says which tune, its mood words and "Making it…". Verified with a real
Remotion render (tune at lag 0, chime a semitone up for slot 1).
