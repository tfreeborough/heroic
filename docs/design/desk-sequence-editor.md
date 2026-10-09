# The Desk: the sequence editor

*Drafted 2026-10-05 (Tom + Claude). Status: **BUILT 2026-10-05, all
three stages**, uncommitted. Owed: Tom's own run (a real edit from Make,
voice in bites, a render) and a look at the layout on his screen. Companions:
[desk-timeline.md](desk-timeline.md) (the one-row timeline this replaces),
[desk-voiceover.md](desk-voiceover.md) (recording and captions),
[apps/desk/README.md](../../apps/desk/README.md).*

## Why (Tom, 2026-10-05)

> "What I want to be able to do is go to the make a video page, click to
> start a timeline editor and then add footage in and edit there, and once
> I've saved it takes me back to the video to finalise details. … I need
> to be able to add video tracks so I can move clips around and align
> them, I also need to be able to record audio clips separately and place
> them into the editor. I still need to be able to edit shorts
> individually, but the arrangement and audio management should happen in
> the sequence editor."

And on the open questions: delete leaves a gap ("I'll be recording audio
clips in bites so happy to just rearrange"); shift-select several things
and drag them together; a separate music bed he picks a song for; many
separate voice clips.

## What changes

Today's editor (built 2026-10-02) already cuts shots from many recordings,
frames them per output shape and stacks a second row over the first. Three
things are the wrong shape for what Tom now wants:

1. **The front door.** You start from Clips with one recording already on
   the track. Make is a button at the end. It should be the other way
   round: Make starts an empty timeline and gets the edit back.
2. **The bottom track is packed.** No gaps, deleting closes up, every join
   is a slide, and only the top row is placed freely. Aligning clips to
   each other and to the voice needs every clip at a time of its own.
3. **The voice is one voice-over**, pinned to the footage under it, with
   named variants to A/B a script. Tom wants many small recordings he can
   move about like clips.

## Words

- **Recording**: a file in the library (phone clip, screen recording).
- **Clip**: a slice of a recording placed on a video track at a time.
- **Take**: one recording off the mic (or an imported audio file), with
  the words Whisper heard in it.
- **Audio clip**: a slice of a take placed on an audio track at a time.
- **Track**: a row. Video tracks hold clips, audio tracks hold audio clips.
- **Sequence** (an **edit** on screen): the whole thing: tracks, takes,
  the music bed, markers. One JSON file, committed, as now.
- **Framing**: which part of a recording a clip shows, per output shape.

## The shape of it

```
 0s        5s        10s       15s       20s       25s
 |---------|---------|---------|---------|---------|----
 V2              [code.mov        ]
 V1  [harpoon.mp4   ][realmsmith.mov ]        [harpoon.mp4]
 A1  [take 1  ]  [take 2    ]   [take 3 ]      [take 5]
 A2                         [take 4]
     words words words  words words      words
 ♪   [Desert Wind ───────────────────────────────────────
```

- **Make → Start a timeline** opens an empty editor. **+ Add footage**
  puts a recording at the playhead on the chosen video track. **Done ›**
  goes back to Make with the edit chosen.
- **Every clip sits at its own time.** Drag it anywhere along its track or
  onto another track. Its edges trim. `S` splits at the playhead, `Delete`
  takes it out and leaves the gap. `⌘Z` undoes.
- **Shift-click** adds to the selection, on any track. Drag one and they
  all move together; `Delete` removes them all.
- **Snapping** while dragging: a clip's edges snap to other clips' edges,
  the playhead and the markers. Towards the clip before it on the same
  track there are two snap points: touching (a hard cut) and overlapping
  by the slide length (a slide).
- **Audio tracks** work the same way. `R` records from the playhead onto
  the selected audio track; if something's already there the take goes on
  the next track with room, a new one if need be. Nothing is ever trimmed
  by a recording. Audio files can be added the same way.
- **The music bed** is one song for the whole edit, picked in the editor
  (song, where in the song it starts, level). It ducks under the voice as
  today.

## Joins are geometry

Nothing is stored about how two clips meet; it falls out of where they are:

| On one video track | What plays |
|---|---|
| Two clips overlap | a slide, lasting the overlap (the next clip comes in from the right as the first leaves left) |
| They touch | a hard cut |
| They touch, same recording, nothing taken out between | no join at all (a split); framed differently either side, the camera glides |
| A gap | the track below shows through; nothing on any track = the template's backdrop |

The sequence keeps a `slide` length (0.4s) only as the default: how far
**+ Add footage** overlaps the clip before it, and the second snap point.

## Tracks on top of each other

Any number of video tracks for arranging. At one moment at most two show:
the lowest track with picture fills the frame; the next one up with
picture stacks over it (top half in a tall frame, right half in a wide
one), easing in and out as today. A third track with picture at the same
moment isn't shown, and the editor says so. Framing per shape stays
(`frames[shape]`, `frames["<shape>:stacked"]`).

## The voice

- Takes belong to the sequence. Each audio clip names its take and a
  slice of it. Words belong to the take; captions are every word of every
  audio clip on every track, in order. Nudge, tidy, noise and level are
  per sequence, as they were per voice-over.
- An audio clip plays with the music and the footage ducked under it.
- Audio clips on one track never overlap (the later one stops where the
  next starts). Across tracks they can: two people, or a mistake you'll
  hear.
- The named voice-over variants go. An alternative take is an audio clip
  on a muted track.

## Make

- **Start a timeline** (new, empty) or **Pick a clip** as before. An edit
  picked in Make gets **Open the timeline** instead of "Edit this clip
  first".
- Coming back from the editor with **Done ›** lands here with the edit
  chosen and the template's details to fill in.
- The music fields are hidden when the edit has a music bed; the edit's
  wins. A raw recording or an edit without music still takes a song in
  Make.
- The `voice` field goes for edits: their voice is in the sequence. It
  stays only for legacy voice-overs over raw recordings.

## Clips

**Edit** on a recording still opens the same editor with just that
recording on V1: that's "edit a short individually". **+ New edit** moves
to Make as Start a timeline.

## Migration

Existing edits convert on first read (the file says `shots`, not
`video`):

- V1 shots → clips on V1 at the times they played at, so a slide stays an
  overlap and a cut stays touching. The top row → V2.
- The edit's own voice-over (the one named after it) → its takes and A1.
  Named variants → further audio tracks, muted. Nudge, tidy, noise, level
  from the edit's own voice-over. The old voice JSON goes to `.trash`
  (takes kept).
- Markers keep their times.
- The old editor's cuts of one recording (`clean/<file>?from=<cut>`) still
  open as before, now straight into the new shape.

## Where the code goes

| What | Where |
|---|---|
| Sequence v2 types, timing, snapping, moves, captions across tracks, migration from v1, tests | `packages/voiceover/src/sequence.ts` (+ `legacy.ts`, tests) |
| Edits on disk, takes in the sequence, music | `apps/desk/lib/sequences.ts`, routes `/api/<game>/sequences…` |
| The editor, split up: state + load/save, the timeline, the panels | `apps/desk/ui/edit/` |
| Playing it: tracks, overlaps as slides, gaps, the stack, audio clips, music from the sequence | `apps/bits-promos/src/stage.tsx`, `voice.tsx`, `components.tsx` |
| Make: start a timeline, come back to it | `apps/desk/ui/Make.tsx` |

## Build stages

1. **The model and the player.** Sequence v2 in the package with tests;
   conversion of v1 edits and voice-overs; the Stage plays tracks, gaps
   and overlaps; audio clips and the music bed play from the sequence.
2. **The editor.** Tracks, free placement, snapping, shift-select and
   group drag, audio tracks and recording onto them, the music lane.
3. **The flow.** Make starts a timeline and gets it back; Clips loses New
   edit; README and docs.

## Not in this

- Keyframed pans within one clip (split + glide covers it).
- Audio clips of the footage's own sound separated from the picture (a
  clip's sound stays a switch and a level on the clip).
- Fades on audio clips beyond the de-click at each end.
- Text and titles on the timeline (the templates own text).

## Build notes (2026-10-05)

What's where:

| What | Where |
|---|---|
| Sequence v2 types, timing (`timeTrack`, `layersAt`, `stackIntervals`, `splitAt`), video/audio edits, `shiftClips`, snapping, framing, markers, music; 97 tests | `packages/voiceover/src/sequence.ts` (+ `.test.ts`) |
| The old shape and `upgradeSequence` (old edit + its voice-overs → a sequence) | `packages/voiceover/src/legacy.ts` |
| `Spoken` (takes + settings) for the Remotion voice/captions components, so a sequence or an old voice-over file both play | `packages/voiceover/src/remotion.tsx` |
| Edits on disk, the on-read migration, `createSequence`, `sequenceFrom` (builds the old shape then upgrades it: one tested path) | `apps/desk/lib/sequences.ts` |
| Takes for an edit: `POST /sequences/:id/takes`, `/transcribe`, `/sound` (`resoundTakes`, `trashTakes` in `lib/voice.ts`) | `apps/desk/server.ts`, `apps/desk/lib/voice.ts` |
| The editor: state, load/save, mic, keys, the room's layout (`Editor.tsx`); the tracks and every drag and drop (`Timeline.tsx`); the library down the left (`Library.tsx`); the inspector's panels (`panels.tsx`); Framer, Wave, the drag payload (`widgets.tsx`) | `apps/desk/ui/edit/` (the old `ui/Edit.tsx` is gone) |
| Playing it: `TrackLayer` per video track, overlap = slide, gap = nothing, role per frame (alone / main / over / hidden), the morph when a track comes in under a playing clip | `apps/bits-promos/src/stage.tsx` |
| `useVoice(props, seq, …)` reads the edit's audio tracks (legacy `voice` file otherwise); `useBed` picks the edit's music over the template's | `apps/bits-promos/src/voice.tsx`, the three templates |
| Make: Start a timeline, Open the timeline, the edit's voice/music fields hidden | `apps/desk/ui/Make.tsx` |

How it hangs together:

- **Roles, not rows.** The player doesn't know "main" and "over" tracks;
  at each frame the lowest track with picture is the main layer and the
  next up the over layer (`layersAt`). A clip's card is laid out for its
  role that frame, and `stackIntervals` + `splitAt` ease the frame
  between one and two cards. A clip that was already playing alone when a
  lower track came in morphs from full frame to its half instead of
  sliding in (it's the one that stays; the other arrives).
- **A group move goes as far as it fits.** `shiftClips` tries the whole
  move, then shorter ones (2% steps, then bisection), so dragging two
  clips into a longer one stops where the second would be swallowed
  rather than refusing to move at all. A single clip uses `fitVideo` /
  `fitAudio` (nearest spot that fits) and can change track; above the top
  video track or below the last audio track means a new one.
- **Snapping** is in the package (`snapPoints`, `snapTo`), 8px of reach
  at the current zoom, guide line drawn on the edge that landed.
- **The old voice-over's `against`/`remapVoice` machinery is gone**: with
  free placement there's nothing to pin to. `types.ts` keeps the
  `VoiceOver` shape for plain-recording voice-overs and for migration.
- **Migration on read**: `readSequence` sees `shots` and writes the file
  back in the new shape, then `deleteVoice(…, keepTakes)` moves the old
  voice-over JSON to `public/voice/.trash`. The Stage does the same
  upgrade in memory if a render fetches an unmigrated file (without the
  voice, which only the Desk can find).
- **The room (2026-10-06).** Tom found the first layout "a bunch of random
  panels" and clip moves "weird: the timeline stretches rather than the
  clip". Now: the editor fills the window (`html[data-screen=edit]`), a
  three-column room (library 250px · stage · inspector 340px) over the
  tracks, whose height is dragged from their toolbar (remembered). The
  library replaces the Add-footage modal: recordings and the edit's takes,
  click = at the playhead on the focused track, HTML5 drag onto a row =
  exactly there (snapped; above V-top / below A-last makes a track; the
  payload sits in `dragPayload` because drag data is unreadable until the
  drop). The inspector is tabbed (Clip · Voice · Captions · Music · Script
  · Edit) and turns to Clip only on a click in the timeline, never on a
  pick the editor makes itself (a take landing while you read the script).
  Messages are a toast.
- **The scale is pixels per second**, state in the Editor, set once to fit
  on load and changed only by zooming (wheel, slider, Fit). Positions are
  px, not percentages of the lane, so a clip dragged past the end makes
  the lane longer and nothing else moves. (Before, the lane was `total +
  25%` and every clip a percentage of it: moving the last clip rescaled
  the whole timeline under the pointer.)
- **Mutes**: every clip has its own 🔊 (hover; stays when silent), every
  track too, video tracks now included (`VideoTrack.muted`, honoured by
  the Stage and kept by `writeSequence`). **Snap** is a toolbar toggle
  (`N`, remembered); ⌥ while dragging skips it once; reach 10px.

Tested: 97 package tests; all three packages typecheck. Migration dry
run on the real edits (the Challenge Update Clip: 130.542s either way,
21 takes, 505 words). Headless Chrome on a second Desk (port 3411): Make
→ Start a timeline → an empty editor; + Add footage twice (second lands
on the end overlapping by a slide); a song picked → the music lane; the
migrated edit opened (4 clips, 21 voice clips, 505 words); split; two
clips shift-selected and dragged together; Delete; ⌘Z; a voice clip
dragged below A1 → A2 made; a video clip dragged above V1 → V2 made;
play; Make with the edit chosen shows Open the timeline and hides the
music fields. Test edits were removed afterwards. Not tested: the mic
(no fake audio this time) and a full render. The room (10-06), headless
Chrome at 1600×1000 and 1728×1117 on a copy of the Challenge Update Clip:
a clip dragged 150px right moved alone (the first clip's x and width
unchanged, the lane 1486→1667px); clip 🔊 and V1 🔊; Snap toggle; a
library click and a library drag onto V1 past the end each added a clip;
every inspector tab; the tracks bar dragged taller; a voice clip's click
turned the inspector to it; the page doesn't scroll.
