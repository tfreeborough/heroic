# The Desk: many clips on one timeline, and widescreen footage

*Drafted 2026-10-02 (Tom + Claude). Status: **BUILT 2026-10-02, all three
stages**, the same day Tom took all four recommendations (templates play
the sequence, stacked second track, drop-to-import, V1 closes the gap).
Uncommitted. Owed: Tom's own run with real footage (a real screen
recording, his voice over a mixed edit) and a full render. See § Build
notes.* Companions:
[desk-voiceover.md](desk-voiceover.md) (the editor this grows out of),
[apps/desk/README.md](../../apps/desk/README.md).

## Why (Tom, 2026-10-02)

> "I think it would be good for me to be able to import 16:9 video and crop
> for sure. At the moment it's not really possible to import multiple clips
> and arrange them together on a single timeline, maybe we should also add
> support for this (like in Audacity, being able to split a clip, drag it
> onto a different track and re-arrange multiple clips together)."

The content behind it: voiced devlogs. Tom talking over a mix of phone
gameplay and desktop recordings (code, Realmsmith, the Forge), cut
together. Today the editor can only cut ONE phone recording, and only
phone-shaped footage looks right in a vertical video.

## What exists today

- **The editor** (`apps/desk/ui/Edit.tsx`) edits one recording: split,
  drop, restore, with the voice pinned to the footage under it
  (`packages/voiceover/src/cut.ts`). The footage clock is packed: what's
  dropped closes up.
- **Save encodes a file.** ffmpeg writes the cut as a new clip; Make and
  the renders play that file.
- **The preview already plays an unencoded edit.** The templates' footage
  player (`apps/bits-promos/src/stage.tsx`, `Pieces`) plays a list of
  kept stretches of one file, with the slide at each join.
- **Crop is top/bottom only** (`cropTop` / `cropBottom`, fractions of
  height), made for shaving a phone's status bar. The Stage fits whatever
  is left inside the frame, so a 16:9 recording in a vertical video comes
  out as a thin strip across the middle.

## Words used in this doc

- **Source**: a recording on disk (phone clip, screen recording).
- **Shot**: a slice of a source placed on the timeline. Splitting a shot
  gives two shots. The video version of a voice *piece*.
- **Track**: a row on the timeline. Video tracks hold shots, voice tracks
  hold voice pieces.
- **Sequence**: the whole edit: tracks, shots, voice. Replaces "a cut of
  one recording". A JSON file, committed, like a voice-over is today.
- **Framing**: which part of a source a shot shows, per output shape.

## The shape of it

```
 0s        5s        10s       15s       20s
 |---------|---------|---------|---------|----
 V2              [code.mov 0:12-0:18]
 V1  [harpoon.mp4 ][harpoon.mp4][realmsmith.mov ]
 VO  [take 1   ]   [take 2         ][take 3]
     words words words words words words
```

- **+ Add footage** opens the clip library and puts the chosen source at
  the playhead (or the end). Phone clips and widescreen recordings alike.
- **Drag a shot** along its track to reorder, or up/down onto another
  track. Its edges drag to trim. `S` splits, `Delete` drops, `⌘Z` undoes,
  as today.
- **Every shot has its own framing and its own sound** (on/off and level),
  so the game's audio can play under one shot and be silent under the
  next.
- **Joins**: where one shot follows another on a track, the join is the
  slide we have now, or a hard cut. Picked per join; slide stays the
  default.
- **Voice works as today**, on its own track, pinned to the footage under
  it (see decision 4).

## Framing widescreen footage

Select a shot and the panel beside the preview shows its whole source with
a box on it: the part that will be shown. The box is the shape of the
output being previewed (9:16 for vertical), dragged to move and
scroll-wheeled to zoom. Each output shape keeps its own box, so one edit
renders well as vertical AND landscape:

| Source | Vertical default | Landscape default |
|---|---|---|
| Phone portrait | as today (whole, status bar shaved) | as today (centred, blurred fill either side) |
| Widescreen | a 9:16 box over the middle, to be moved | the whole frame |

**Moving the camera within a shot** (following the cursor down some code)
is split + a new box: split the shot where the view should change and
move the second half's box. Joins between two halves of the SAME source
default to a quick glide from one box to the other rather than a slide,
so it reads as a pan, not a cut. Proper keyframed pans can come later if
that isn't enough.

Pixel art note: a box that zooms a phone capture of the game crawls
(already seen with `push`). That's fine for code and the editors; for game
footage the box should zoom in whole steps (2x, 3x), so the zoom panel
snaps to those when the source is a game clip.

## Making screen recordings that crop well

For the docs page and the README, not code:

- Bump the editor font to 20–24pt. Code that's readable at 1080 wide
  vertical is huge on the Mac screen; that's correct.
- Keep what matters in a column about a third of the screen wide, so one
  9:16 box catches it.
- macOS `⌘⇧5` records the whole screen or a region. A region roughly
  9:16 needs no cropping at all.

## Decisions

Each had a recommendation; Tom took all four (2026-10-02).

### 1. How a sequence becomes a video

| | Templates play the sequence (recommended) | Save flattens it into one file |
|---|---|---|
| How | Make passes the sequence; the Stage plays every shot from its own source, framed for the shape being rendered | ffmpeg renders the sequence into one clip, as Save does today |
| Framing per output shape | works: vertical and landscape each use their own box | has to pick one shape at Save, or save one file per shape |
| Waiting | none; the preview and the render are the edit | an encode on every Save |
| Cost | the Stage learns many sources and framing boxes; the templates take a sequence as well as a clip | ffmpeg learns crop boxes and multiple inputs; the Stage is unchanged |

Today's single-recording cuts keep working either way: a cut is a sequence
with one source on one track, converted when it's opened.

### 2. What a second video track means

When shots on V1 and V2 play at the same moment:

| | Stacked (recommended) | Picture in picture | Top one covers |
|---|---|---|---|
| Vertical | V2 above, V1 below, each half the frame (code on top, game underneath) | V2 in a rounded corner box over V1 | only V2 shows |
| Landscape | side by side | corner box | only V2 shows |
| Good for | "here's the code, here's what it does" | a facecam | cutaways (but one track can do that already) |

Stacked is the layout the devlogs want. Picture in picture could come later
as a per-shot switch.

### 3. Getting widescreen recordings in

Screen recordings start on the Mac, and today footage only arrives from
Drive.

| | Drop on the Desk (recommended) | Through Drive |
|---|---|---|
| How | drag the file onto the Clips page; it's copied in, then backed up to Drive with the existing rclone button | put it in the Drive footage folder, press Sync |
| Speed | instant | upload then download, slow for big screen recordings |

Either way the Desk **converts on the way in**: macOS screen recordings are
huge (Retina resolution, often a variable frame rate), which makes the
preview stutter and the render drift. The import makes a 1080-tall copy
at the game's frame rate and keeps the original beside it.

### 4. What happens to the rest when a shot is removed

| | Close the gap (recommended) | Leave a gap |
|---|---|---|
| Delete a shot on V1 | everything after it, on every track, moves up, the voice with its footage, as today | a hole is left; nothing else moves |
| Drag a shot | only that shot moves (never ripples) | same |
| Feels like | today's editor | Audacity |

V1 is the spine of the video; deletes on it close up. On V2 and the voice
track nothing ripples: a delete leaves a gap, because those tracks are
placed against V1.

## Where the code goes

| What | Where |
|---|---|
| Sequence types, ripple/move/split maths, framing maths, tests | `packages/voiceover` (grows a `sequence.ts`; it is the Desk's shared timeline package already) |
| Timeline UI with tracks, framing panel | `apps/desk/ui/Edit.tsx`, split into files as it grows (it's 1500 lines now) |
| Import + convert | `apps/desk/lib/footage.ts`, `lib/ffmpeg.ts` |
| Stage plays shots with boxes, stacked layout | `apps/bits-promos/src/stage.tsx` |
| Sequences on disk | `<game>/public/sequences/<id>.json`, committed |

## Build stages

Each ends with something Tom can use.

1. **Many clips, one track.** Sequences, + Add footage, drag to reorder,
   per-shot sound, per-join slide/cut, templates play the sequence.
   Today's cuts open as one-source sequences.
2. **Widescreen.** Drop-to-import with the convert, framing boxes per
   output shape, the same-source glide.
3. **Second video track.** Drag between tracks, the stacked layout.

## Not in this

- Keyframed pans and zooms within one shot (split + glide covers it first).
- Text, stickers and titles placed on the timeline (the templates own
  text).
- Recording the screen from inside the Desk.
- Music on the timeline (stays a Make field).

## Build notes (2026-10-02)

What's where:

| What | Where |
|---|---|
| Sequence types, timing, voice/top-row remapping, edits, framing maths (88 tests in the package) | `packages/voiceover/src/sequence.ts` (+ `.test.ts`) |
| Edits on disk, starting one from a clip, carrying voice-overs along on save | `apps/desk/lib/sequences.ts`, routes `/api/<game>/sequences` |
| Import + convert (background job, progress), Drive backup of imports | `apps/desk/lib/imports.ts`, routes `/api/<game>/imports` |
| The editor (main row, top row, framing, shape switch) | `apps/desk/ui/Edit.tsx` |
| Playing it: shots as cards, slides/cuts, the glide, the stack | `apps/bits-promos/src/stage.tsx` |

How it hangs together:

- **An edit is a clip.** Make lists edits as `seq:<id>` and hands the
  template `clip: "sequences/<id>.json"`; the Stage sees `.json`, loads it
  and plays the shots. `startFrom`, durations and the hook clip's loop
  crossfade work on the edit's own clock. The editor passes the unsaved
  edit inline (`sequenceData`, replacing the old `segments`/`slide`).
- **The old editor's cuts** become edits on first open (`sequenceFrom`):
  the cut's pieces as shots, its join as the slide, its crop and mute on
  each shot. The timing is identical (tested against `outStarts`), so the
  cut's voice-overs MOVE to the edit untouched apart from `clip` and
  `against`. The cut's file stays in the library (folded under Originals)
  and still works in Make, minus its voice-over. Checked on the real
  "Challenge Update Clip": 130.542s either way, all 21 pieces unmoved.
- **Voice pinned to footage**, now across recordings: `mapTime` finds the
  same moment of the same recording in the new sequence (same shot id
  first, then any shot showing it, nearest position), else waits at the
  next join. Each voice-over saves `against` (the timing it was made
  over); saving the edit remaps every voice-over of it whose `against`
  differs, so a closed one never drifts.
- **Joins**: slide (default) or cut per shot; two halves of one recording
  with nothing taken out between are no join. Per-join slide length =
  the edit's slide, capped at half of either shot (the old global rule
  gave the same numbers for migrated cuts because the migrated slide is
  the cut's already-capped value).
- **Framing**: `frames[<shape>]` per shot, a box in fractions of the
  recording; default = the crop, or a frame-shaped middle for widescreen
  in a tall frame. Each card is laid out for its own box, so mixed
  recordings sit right. Same recording, split, framed differently = a
  0.6s eased glide (the join's `cut` = a jump).
- **The top row** (`over`): shots with an `at`. While one plays,
  `splitAmount` eases 0→1 over 0.4s (back-to-back top shots stay split);
  the main card lerps from its own layout into its half and its framing
  morphs to `frames["<shape>:stacked"]` (default: the middle, filling its
  half) without stretching (`mixBox` keeps the box the card's shape); the
  top card slides in from its edge. Vertical and square stack top/bottom,
  landscape goes side by side. Top-row shots go in silent and ride along
  with main-row changes like the voice.
- **Import** streams the body to `footage/originals/` in chunks (Bun's
  `Bun.write(path, new Response(req.body))` never finishes; the writer
  loop does), converts with `-progress` for a live %, writes the sidecar
  (crop 0, `imported`) before the rename so a concurrent Sync can't give
  it a phone's crop. Body cap raised to 32 GB (Bun's default is 128 MB).
  Height cap is 1440, not the 1080 this doc first said: a 9:16 window cut
  from a 1080-tall frame is only 607 px wide, which smears code.
- The old **Save** (ffmpeg cut) is gone from the editor; the `cleanup`
  route and `cleanupClip` remain for now but nothing calls them.

Tested: 88 package tests; all three packages typecheck. In headless Chrome
on a second Desk (port 3411) against real footage: migrated a voiced cut,
split, added a second recording, dragged to reorder (voice followed),
flipped a join, trimmed an edge, dropped a file on the Clips page (import
+ convert), uploaded a 180 MB 2880×1800 60 fps "screen recording"
(→ 2304×1440 30 fps), framed it, split + reframed (glide), switched the
preview to landscape, dragged a shot up to the top row. Remotion stills
of the edit in all three shapes: per-shot crops, the glide, the stack
ramp. Every file the tests touched was put back (the voice-over's
checksum matches).
