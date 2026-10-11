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

**Edit** — the sequence editor: a cards row (text, sketches, b-roll
slots, drawn over the footage), video tracks of clips from any of the
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
- *Cards.* The row above the video tracks holds what's on screen when
  it isn't footage: a **text card** (a few words in the brand type), a
  **picture** (one of the script's sketches), or a **b-roll slot** (a
  note of what to film: dimmed on the timeline, never drawn). Cards
  never overlap; they move, trim, split and snap like clips. A card *on
  the backdrop* fills the frame and gives way to any footage playing; one
  *over the footage* sits in the top third (tall) or the right third
  (wide) regardless. The library's **Cards** shelf has **+ Text**, **+
  B-roll slot**, the script's sketches and the cards already in the edit;
  right-click the row for a text card at that spot. Every template that
  plays an edit draws them (the Stage does), under its own overlays.
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

**Make a video** — the **Talk (long form)** template is the long video:
you talking for five minutes and up straight through an edit, 16:9, its
cards and b-roll, regular captions, the sign-off to close. **Start a
timeline** opens an empty edit in the editor
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

**Scripts** — where a video starts (design: `docs/design/desk-scripts.md`).
The list down the left; a script with only a title is an idea, as before.
Open one and the page is steps: **1. The script**: paste what you wrote
(it saves as you go); **Rewrite into cuts** has Claude turn it into **2.
The long cut** (the whole script, lightly edited, as *beats*: one thought each, five to fifteen seconds spoken, each
with a stable id everything later hangs on) and **3. The shorts** (as
many self-contained 45–75s cuts as the script holds, each with a title, a
hook line and a note on why it stands alone; a short's beat that is a
long beat word for word is marked *same as long beat n*, so one
recording serves both). Each beat shows what changed from the paragraph
it came from (added words lit, dropped words struck); click to edit it,
**keep mine** puts your paragraph back, **change…** has Claude redo that
one beat to an instruction, and a box under each cut does the same for
the whole cut. **+ short** asks for one more. Change the script after a
rewrite and the page offers **Adjust the cuts to the change**: every beat
whose point still stands keeps its id and words, changed and new ones are
marked. Stored in `<rendersDir>/scripts/<id>.json` (gitignored); an old
`ideas.json` is migrated the first time the tab opens and renamed. The voice is
yours: every other script on the tab goes into the call in full, with
the instruction that your sentences come back word for word unless one
would trip you reading it aloud; the game's `script.ai` in `desk.config`
only adds the rules (no invented example lines). Needs
`ANTHROPIC_API_KEY` in `apps/desk/.env`. **4. The visuals**: **Plan the
visuals** gives every beat what's on screen while it's said: *a few
words* (a text card), *a sketch* (a prompt), *footage to film* (a b-roll
note) or *nothing new*. Change any row; **Make N sketches** draws the
sketches three at a time in the background (GPT Image through the shared
`@heroic/forge`, the game's `script.ai.sketch` style in front of every
prompt, needs `OPENAI_API_KEY` in `apps/desk/.env`) and each lands on its
row as it finishes (`public/cards/<script>/`, gitignored; **Back the takes
up to Drive** copies them too); **again** on a row makes another try.
**Show the shot list** is the b-roll notes as one list to film from.
**5. Record**: the prompter. Every beat that needs a take, large, the
next one to read lit; the mic and its meter; **Record** (`R`), a 3-2-1,
read as many beats as you like, `R` again. The take is saved to
`public/voice/takes/` (like an edit's), Whisper writes its words, and
every beat it reads gets a tick (✓✓ = read in two takes: delete one, or
organise will skip that beat). Read in any order, as many times as you
like; **Add a recording from a file** takes one made elsewhere. The takes
sit under the prompter: waveform, words, the beats each covers, **×** to
delete (to the voice folder's `.trash`). Click a take to open it: drag
across the sound to select a stretch, **Cut it out** or **Keep only
this**, **Trim to the words** takes the silence off both ends, **Reset**
undoes every cut; the file is never touched, the take keeps a list of
kept regions and the matching and organise only see those. **6.
Organise**: every cut becomes a fresh edit (`<script>-long-r1`,
`<script>-short-1-r1`…): the takes sliced per beat in script order with
the **gap** between, each beat's card on the cards row at its start (a
text card or sketch until the next card, a b-roll slot for its beat), a
marker per beat, the video tracks empty. A beat nobody read is skipped
and said so; a beat read in two takes is skipped and said so (nothing
picks between takes for you). Earlier runs' edits are never touched.
Open an edit, drop footage on the b-roll slots, pick a song, Done › to
Make: **Talk** for the long cut, any vertical template for a short.

In the editor, the **Script** panel beside Record picks the script an
edit is making; its long cut (or the pasted script, before a rewrite)
sits there, large, to read from while recording. The edit remembers it
(`idea` in its JSON), Make names it under the chosen clip, and the
script's row links back to the edit. Tick it off from any of the three
once the video's made.

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
