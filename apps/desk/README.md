# The Desk

One local page for the whole promo loop, for every game in the monorepo:
phone recordings in from Google Drive → edit them (cut the footage, talk
over it, caption it) → pick a template,
fill the props, watch the live preview → render vertical / square /
landscape → the library of finished videos, pushed to Drive.

```sh
bun run desk          # from the repo root → http://localhost:3400
```

Remotion Studio is not part of the daily loop — it's for building templates.

## Screens

**Clips** — the game's library, edits up front. Record on the phone,
drop the file in the game's Drive footage folder, press **Sync from Drive**:
rclone pulls new files (additively — nothing local is ever deleted) and each
gets a sidecar `.json` with its facts and your notes. Anything Drive calls a
video counts, extension or not: a phone export saved as "scorpion raw" comes
down as `scorpion raw.mp4`. Files that aren't videos are listed as ignored,
so the log always says what it saw. Media is gitignored, sidecars are
committed. **Screen recordings and anything else on the Mac**: drop them
anywhere on the page (or **Import from this Mac…**). Each is converted to a
copy at most 1440 tall at the game's frame rate (Retina captures are huge
and often variable frame rate, which stutters the preview and drifts a
render); the original is kept in `footage/originals/`. Imports aren't on
Drive until **Back up imports to Drive** (into `footage-imports/<shelf>/`
under the renders folder; the footage remote is read-only).

**Shelves.** A folder inside the Drive footage folder is a shelf on the
Clips screen: make `B-ROLL`, `GAMEPLAY`, `TALKING HEAD`… on Drive, drop
recordings in, and the next Sync files each on its folder's shelf. The top
of the Drive folder (where the phone's recordings land) is **Unsorted**,
shown first. The library stays flat on disk; the sidecar remembers the
folder (`shelf`) and where the file was on Drive (`drivePath`), so moving
a file between Drive folders re-shelves it next sync, while a shelf picked
in the Desk (each card has a select, with **New shelf…**) stays until the
file moves on Drive. Imports from the Mac land on the shelf the
**Imports go on** select names. Two Drive folders holding the same file
name clash (the library is flat): the sync log says so and the first wins.

Each card is a raw recording: click its name to give it one (the phone's
`Record_2026-…` is nobody's idea of a title), the note shows under it,
and a badge says **phone** or **screen** (tall or wide) or **from the Mac**.
**Edits** sit at the top; **Edit** on a recording opens the editor with just
that recording on the first track: the way to cut up one short. Cuts the
old one-recording Clean up saved as new files are not footage any more:
they fold away under **Cuts from the old editor**, each with **Turn into
an edit** (the recording it came from opens in the editor with the cut's
pieces loaded, and the edit takes its place up top) or **Open the edit**
once it has. A clip with a voice-over is badged **voiced**. **Bin** moves
a clip to `.trash/` AND writes its name to `.binned.json` (committed), so
Sync leaves it on Drive for good; the **Bin** fold restores one.

**Edit** — the sequence editor: video tracks of clips from any of the
game's recordings, audio tracks of your voice, a music bed, markers, and
the preview of it as it renders (design:
`docs/design/desk-sequence-editor.md`; recording and captions:
`docs/design/desk-voiceover.md`). An edit is
`public/sequences/<id>.json` (committed) and saves itself; the templates
play it directly, so there is nothing to export. Start one from **Make a
video → Start a timeline** (empty) or from a recording on Clips; **Done ›**
goes back to Make with it chosen.

- *The room.* The library (the game's recordings, the edit's takes) down
  the left: click one and it lands at the playhead on the track you last
  clicked in, or drag it onto any track to put it exactly there. The
  preview in the middle, the inspector (the clip you picked, Voice,
  Captions, Music, Script, Edit) down the right, the tracks across the
  bottom; drag the tracks' toolbar up or down for more or less room.
- *Everything sits at its own time.* Click or drag the ruler to run the
  playhead. Click a clip to pick it, **shift-click** to pick several, drag
  to move: the whole selection moves together, and a clip on its own can
  change track (above the top video track, or below the last audio track,
  makes a new one). Edges snap to other clips' edges, to a slide's length
  before a clip's end, to markers and to the playhead (**Snap** in the
  toolbar or `N` turns that off; hold `⌥` while dragging to skip it once).
  Drag an edge to take more or less of the recording. The scale only
  changes when you zoom, so moving a clip past the end makes the lane
  longer, never everything smaller. `S` splits the clip under the
  playhead on the track you last clicked in; `Delete` takes the selection
  out and **leaves the gap**; `M` drops a marker; `⌘Z` undoes.
- *Joins are geometry.* On one track, clips that overlap slide (the next
  comes in from the right as the last leaves, for as long as they
  overlap); clips that touch cut; two halves of one recording (split,
  nothing taken out) carry straight on; a gap shows the track below, or
  the backdrop. **+ Add footage** puts a recording at the playhead, or on
  the end of the track overlapping the last clip by **Slide (s)**.
- *Tracks stack.* Where two video tracks have picture, the lower one
  fills its half of the frame and the upper one slides into the other
  (top in a tall frame, right in a wide one): code over gameplay. A third
  with picture at the same moment isn't shown. **+** by the track names
  adds a track. A clip in a stack has a second framing, *when stacked*.
- *A clip* (click one): shave the status and nav bars, silence it or set
  its level, and **frame** it: a window the shape of the video on a frame
  of the recording; drag to move, scroll to zoom. Each shape (vertical,
  square, landscape: the buttons above the preview) has its own framing.
  A widescreen recording in a tall video starts framed on its middle. To
  pan, split the clip and frame the second half elsewhere: the camera
  glides between them.
- *Voice*: pick the mic, watch the meter, press **Record** (`R`). After a
  3-2-1 the edit plays from the playhead and the take lands as a clip on
  the audio track you last clicked in (the next with room, or a new one,
  if something's already there: nothing is ever trimmed by a recording).
  Record in bites and arrange them. **Add a recording from a file** does
  the same with any audio file. Audio clips move, trim and split like the
  video (`⌥S` splits between words); 🔊 on a clip (hover it) silences that
  clip, 🔊 by a track name the whole track, video tracks included (an
  alternative take you want to keep; footage whose sound you never want). **Tidy the sound** takes
  out the rumble and levels every take; **Background noise** turns the
  room down where you're not speaking; **Voice level** is how loud you are
  against the footage and the music. The untouched recording is always
  kept. **Play the footage's own sound** is for this screen only (off =
  nothing plays while you record).
- *Words*: Whisper writes them a couple of seconds after each take, timed
  to where the speech actually is; the captions are every word of every
  audio clip that's heard. Double-click a word to fix it; select one and
  `Delete` to keep it off the captions.
- *Music*: one song under the whole edit, from the game's songs; where in
  the song it starts and its level. It ducks while you talk. Every video
  made from the edit plays it (Make's own music fields are hidden then).

Takes live in `public/voice/takes/` (ignored) and only on this Mac until
you press **Back the takes up to Drive**; the edit keeps them (the takes
and the audio clips are in its JSON). Whisper runs locally: the first
time, **Set it up** builds whisper.cpp under `.cache/whisper` and
downloads its model (1.6 GB; needs `brew install cmake`), or run
`bun lib/whisper.ts install` here. Edits saved before 2026-10-05 (one
packed row of shots, voice-overs in `public/voice/<id>.json`) are brought
up to date the first time they're read: the old voice-over files go to
`public/voice/.trash`, their takes staying put.

**Make a video** — **Start a timeline** opens an empty edit in the editor
(Done there brings you back here with it chosen), or pick a clip (an edit
or a recording) and a template, fill the form (generated from the
template's zod schema, so a new prop is a new field), tick the formats,
watch the preview — it runs the exact template code the render does.
**Render** queues one Remotion render per format (progress in the page);
**Still of this frame** renders a PNG for Reddit / Discord / thumbnails.
An edit brings its voice, captions and music bed with it (the `voice` and
music fields are hidden); a plain recording voiced before edits carried
their own voice still picks its voice-over under `voice`. `captions` is
tiktok / regular / off, `duck` is how far the music and the game's sound
drop while you talk. Leave the hook and the other lines empty on a voiced
video.

**Renders** — everything finished, one card per *batch* (the formats you
rendered together). Format chips pick which to play or download, with a tick
for each that's on Drive; **Upload to Drive** pushes every format not yet
there in one rclone run; **Re-open** restores the whole batch in Make;
**Delete** takes the batch (or just the shown format). **Queue** puts the
batch on the posting queue (**Queue all unqueued** does the lot); **ignore**
marks an experiment the queue must leave alone — never auto-queued, and off
the queue if it was on it — until you undo it.

**Queue** — what to upload, when. Two slots a day (morning, evening); a
queued batch lands in the next free slot, and two videos from the same
recording (the hook variants of one clip) are never within three days of
each other, so the empty slots between them are for other content. Each
post carries a **title** (Shorts has one; TikTok and Reels don't) and one
**description** used on every platform, drafted from the render's props in
the game's voice (`post.draft` in its desk.config) and editable in place,
with copy buttons. With `ANTHROPIC_API_KEY` in `apps/desk/.env` (gitignored;
Bun loads it) and a `post.ai` voice in the game's config, Claude writes the
variable part instead — the lead line, a sentence of context from the
clip's note, a question for the comments, and three or four title options
to pick from — while the game line, the ask and the hashtags stay fixed
text appended by code, so every post pitches the same thing. The edit
panel says which it was and has a **redraft** button; a failed call falls
back to the template, never blocks the queue. The Desk doesn't upload to the platforms (their posting
APIs need app audits): download, upload through each platform's own
scheduler, and tick TikTok / Shorts / Reels here. Overdue posts show in
red; **Re-flow from today** lifts everything not yet posted and lays it
out again in order under the spacing rule. Stored in
`<rendersDir>/schedule.json`; deleting a render drops it from the queue.

**Ideas** — a list of videos worth making: a title and, if you want one, a
description in basic markdown (**bold**, *italics*, `-` bullets, `1.`
numbered lists). Click an idea to edit it (⌘↩ saves, Esc cancels), tick it
when it's made (done ones fold away under the list), × to delete. Stored in
`<rendersDir>/ideas.json`.

The description is the script. In the editor, the **Script** panel beside
Record picks the idea an edit is making (ideas not yet ticked); its title
and description sit there, large, to read from while recording. The edit
remembers the idea (`idea` in its JSON), Make names it under the chosen
clip, and the idea's row on Ideas links back to the edit. Tick it off from
any of the three once the video's made.

## Adding a game

1. Give the game a promos package (a Remotion project — see
   `apps/bits-promos`) whose compositions take a `format` prop.
2. Add `desk.config.ts` there (copy BITS's): name, icon, folders, Drive ids,
   fps, formats, `prepare` commands, and `templates: () => import("./desk.templates")`.
3. Add `desk.templates.ts`: the compositions the Make screen offers —
   component, zod schema, duration function, defaults. For voice-overs,
   mark the templates that take the voice props `voice: true` and export a
   `VOICE_PREVIEW` whose footage player takes `segments` + `slide` (see
   BITS's `src/voice.tsx` and `Stage`). Optionally give the
   config a `post.draft(template, props)` that writes the queue's title and
   description in the game's voice, and a `post.ai` voice (about, rules,
   example lines, fixed boilerplate) for Claude to draft from.
4. Export both from the package's `exports`, add the package to this app's
   dependencies, and add one line to `games.ts`.

Drive, one-time per game: a read-only rclone remote rooted at the drop
folder (`rclone config create <remote> drive scope=drive.readonly
root_folder_id=<id>` — the Clips screen prints the exact command until it
exists), and the upload target the game's `uploadTarget` names.

## Layout

- `server.ts` — Bun serves the page (`index.html`, bundled with HMR) and the
  JSON API under `/api/<game>/…`; a game's public dir is served at
  `/g/<game>/…`, and at the root for the page's current game (cookie) so the
  templates' `staticFile()` paths resolve in the preview.
- `lib/` — footage sync + sidecars + the bin ledger, ffmpeg (probe via Remotion's ffprobe; thumbnails + cleanup via the full `ffmpeg-static` build — Remotion's ffmpeg lacks xfade/setpts),
  render jobs (one shared Remotion bundle per game, the public dir linked in rather than copied; the formats of one press share a `batch` id), the renders library (batches, multi-file upload),
  voice-overs (`voice.ts`: takes in, ffmpeg tidy, Drive backup) and Whisper (`whisper.ts`: install, transcribe).
- `../../packages/voiceover` — what a voice-over IS (takes, pieces, words), the edits as pure functions, what a CUT is and how a voice-over follows one (`cut.ts`), caption paging, word timing, and the Remotion pieces a game's templates use (`@heroic/voiceover/remotion`).
- `ui/` — the React screens. `Edit.tsx` is the editor; `form.tsx` turns a zod schema into fields; `mic.ts` is the recorder (raw samples to a WAV, the browser's call processing off).
- `game.ts` — the contract a game's `desk.config.ts` fulfils; `games.ts` — the registry.
- `cli.ts` — `bun cli.ts sync <game> [--offline] [--add <file>…]` for the page-less sync.
