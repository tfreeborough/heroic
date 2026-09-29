# The Desk — voice-over and captions

*Drafted 2026-09-29 (Tom + Claude). Status: **BUILT 2026-09-29, all three
stages**, on Tom's go-ahead the same day (the four recommendations under
"Decisions" stand). Uncommitted. Owed: Tom's first recording with the real
mic, a listen to the tidied sound, his eye on both caption looks, and one
press of the Drive backup (not run in testing: it writes to his Drive). See
§ Build notes.* Companions: [apps/desk/README.md](../../apps/desk/README.md)
(the Desk's screens), [marketing.md](../marketing.md) (what the videos are for).

## Why (Tom, 2026-09-29)

> "I want to start making some videos in desk that have a voice over with
> captions on them. I'll record the clip, then record an audio track
> separately. I want to be able to clip the audio track so I can move it to
> certain parts of the video like an editor, [and] auto create captions as I
> speak."

So far every Desk video speaks through text on screen (the hook, the lower
third). A voice is the next thing to try: the maker talking over his own
game. Three parts, each useful without the next:

1. **Record** a voice take while watching the clip.
2. **Edit** it like an editor: split it, drop the bad bits, slide pieces to
   where they belong on the video.
3. **Caption** it automatically from what was said.

## Decided already (Tom, 2026-09-29)

- **Two caption styles to choose from**, per video: TikTok style (a few big
  words at a time, the spoken word lit up) and regular (a subtitle line).
  Plus off.
- **Recorded in the Desk**, on the Mac, through the condenser mic.
- **Hook clips need nothing special.** A voiced video leaves the hook empty
  and Tom handles that himself. Checked: `HookClip` already draws no hook
  card when the hook is blank, so this works today.

## Words used in this doc

- **Take**: one recording, start to stop. A file on disk. Never altered
  after it is recorded.
- **Piece**: a slice of a take placed on the video. Splitting a piece gives
  two pieces of the same take. Moving a piece changes where it plays, not
  the take.
- **Ducking**: turning the music and the game's own sound down while the
  voice is speaking, and back up when it stops.
- **Whisper**: the speech-to-text model. It returns the words and the time
  each one was said.
- **Waveform**: the picture of a sound's loudness over time. It is how you
  see where the words are without listening.

## What already exists that this leans on

| Need | Already in the Desk |
|---|---|
| A track you split, select and delete on | Clean up's filmstrip track (`cuts[]` + `removed[]`, `S`, Delete, ⌘Z, drag a split line) |
| Laying a sound into a video at a level | `MusicBed` in the templates (a Remotion `<Audio>` with a volume curve) |
| A full ffmpeg | `ffmpeg-static` (converts the recording, draws nothing new) |
| Long jobs that don't freeze the server | `lib/exec.ts` |
| A preview that IS the render | Make's Remotion Player |
| Edit files committed, media ignored | footage sidecars (`public/footage/*.json` in, `.mp4` out) |

What is new: reading the microphone, dragging a piece along a timeline,
Whisper, and drawing captions.

## The Voice screen

A new tab between **Clean up** and **Make**. The order of work becomes
Clips → Clean up → **Voice** → Make → Renders → Queue.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Voice · harpoon-triple.mp4                             [ Save ]  [ Make → ] │
├─────────────────────────────┬──────────────────────────────────────────────┤
│                             │ Mic  [ your condenser ▾ ]   ▮▮▮▮▮▮▯▯▯  -12 dB │
│                             │                                              │
│     the clip, playing,      │ [ ● Record ]  starts at the playhead, 3-2-1  │
│     with the captions       │ ☐ Hear the clip while I record               │
│     drawn on it live        │     (headphones on, or the mic hears it)     │
│                             │                                              │
│                             │ Captions   ○ off   ● TikTok   ○ regular      │
│                             │ ☑ Tidy the sound                             │
├─────────────────────────────┴──────────────────────────────────────────────┤
│        0s        2s        4s        6s        8s        10s       12s      │
│ clip   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ filmstrip ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │
│ voice     ▕▁▃▆▇▅▂▁▃▆▅▂▏          ▕▂▅▇▆▃▁▂▆▇▅▏              ▕▃▆▇▂▏           │
│ words      So he's on one HP      and I think that's it      Nope.          │
│                 ▲ playhead                                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

Three rows share one ruler:

- **clip**: the filmstrip, read only. It is there so you can see what is
  happening under each word.
- **voice**: the pieces, drawn as waveforms.
- **words**: what Whisper heard, each word sitting under the moment it was
  said.

### Controls

Same grammar as Clean up, plus moving.

| Action | How |
|---|---|
| Put the playhead down, select a piece | click |
| Play / pause | space |
| Record from the playhead | `R` or the button |
| Split the piece at the playhead | `S` or right-click |
| Drop the selected piece | Delete |
| **Move a piece** | drag it left or right |
| **Trim a piece** | drag its left or right edge |
| Undo | ⌘Z |
| Fix a word | click it in the words row, type, Enter |
| Remove a word from the captions | select it, Delete (the sound stays) |

Rules that keep it simple:

- **One voice row.** Pieces never overlap. Dragging a piece stops at its
  neighbours.
- **Recording over a piece replaces what it covers.** The new take wins and
  the old piece is trimmed back. ⌘Z brings it back.
- **A split lands between words.** If the playhead is within a few
  hundredths of a second of a gap, the split snaps to the gap so a word is
  never cut in half. Hold Alt to split exactly where you clicked.
- **A piece hanging off the end of the clip** is drawn in red: that part
  will not be heard.

### Recording

- The browser asks for the microphone once. `localhost` counts as a secure
  page, so no certificate is needed.
- **A mic picker and a level meter**, so it is plainly the condenser and not
  the MacBook's own mic, and so you can see you are not too quiet or
  clipping before you start. The choice is remembered.
- **The browser's voice processing is switched off.** By default a browser
  applies echo cancellation, noise suppression and automatic gain, which is
  what makes a good mic sound like a phone call. All three are turned off.
- **The clip plays silently while you record**, so its sound does not bleed
  into the mic. Tick "Hear the clip" when wearing headphones.
- A three-second count-in, then the clip plays from the playhead and the
  take lands on the voice row where it started.
- The recording is sent to the server, which converts it to a WAV file (the
  plain uncompressed format, which is what both the renderer and Whisper
  want).

### Tidy the sound

One tick box, on by default, applied when a take is converted: a high-pass
filter (removes desk rumble below the voice), and loudness levelling so
every take and every video comes out at the same volume. The untouched
recording is kept next to it, so the tick can be flipped later.

## Captions

### How the words are made

After each take the server runs Whisper on it. A 30 second take should take
a few seconds on the M3 Pro. The words appear in the words row when it
finishes. **They are not live**: you speak, stop, and they arrive.

Whisper is given a vocabulary hint: the game's name and every weapon and
ability name from the roster, so "Harpoon" and "Ironhide" are spelled right
more often. It will still mishear now and then, which is why every word can
be clicked and fixed.

### Why captions never need re-timing

Each word's time is stored against its **take**, not against the video. A
piece knows which slice of the take it is and where on the video it sits, so
a word's place on the video is worked out from the piece every time. Move a
piece and its words move. Split a piece and each half keeps its own words.
Drop a piece and its words go with it.

### The two styles

| | TikTok | Regular |
|---|---|---|
| On screen at once | 1 to 3 words | a phrase, up to two lines |
| The spoken word | lit up and popped | not marked |
| Size | big, heavy | subtitle size |
| Ground | none, a hard outline | a dark band |
| Changes | every beat | at pauses and sentence ends |

Both sit in the lower middle of a vertical video: below the play, above the
strip the platforms cover with their own caption and buttons. Square and
landscape get their own positions.

The look (fonts, colours) comes from the game's brand. The grouping of
words into screens is our own (`packages/voiceover/src/captions.ts`), since
the two styles need different rules.

**A caption nudge** (a small number, in milliseconds) shifts every caption
earlier or later, for when Whisper's timing feels a touch late.

## In Make

Any clip template can take a voice-over, the same way any can take music.
Four new fields:

| Field | What | Default |
|---|---|---|
| `voice` | which voice-over, from the ones recorded against this clip | none |
| `captions` | off / tiktok / regular | tiktok |
| `voiceVolume` | the voice's level | 1 |
| `duck` | how far the music and game sound drop while you speak | 0.35 |

v1 covers **Match clip** and **Hook clip**, where the footage runs from the
first frame. The spotlights have their own beats before and around the
footage and can follow once this has been used in anger.

A clip can have several voice-overs (two scripts for the same footage, to
test against each other). Each is a named file.

## What gets stored

```
apps/bits-promos/public/voice/
  harpoon-triple.json            the edit: pieces + words.   COMMITTED
  takes/harpoon-triple-1.wav     the tidied take.            ignored
  takes/harpoon-triple-1.raw.webm  what the mic gave us.     ignored
```

```ts
type VoiceOver = {
  id: string;              // "harpoon-triple"
  clip: string;            // the clip it was recorded against
  takes: Take[];
  pieces: Piece[];
  captionNudgeMs: number;
  tidy: boolean;
};
type Take  = { file: string; seconds: number; recordedAt: string; words: Word[] };
type Word  = { text: string; start: number; end: number; hidden?: boolean }; // seconds into the TAKE
type Piece = { take: number; start: number; end: number; at: number };
//            which take    slice of the take          where it starts on the CLIP
```

The same split as footage: the small file that IS the edit goes in git, the
sound files do not.

## Where the code goes

| What | Where | Why |
|---|---|---|
| Voice screen, recorder, timeline | `apps/desk/ui/Voice.tsx` | Desk UI |
| Save a take, convert, transcribe | `apps/desk/lib/voice.ts`, `lib/whisper.ts` | server side, through `lib/exec.ts` |
| Types, word placement, ducking maths, the audio layer, a themable captions component | `packages/voiceover` | shared by the Desk and every game's templates. Unprefixed because it is not game-specific |
| The BITS caption look | `apps/bits-promos/src/brand.ts` hands a theme to the shared component | the game owns its look |
| Vocabulary hint | `voice.vocabulary` on the game's `desk.config.ts` | per game |

## Decisions

Each had a recommendation; Tom took all four (2026-09-29, "Let's do it").

### 1. Positions are measured against the clip, not the finished video

A piece is stored as "starts 4.2s into the clip".

| | Against the clip (recommended) | Against the finished video |
|---|---|---|
| Change `startFrom` in Make | the voice stays on the action it was recorded over | the voice slides off the action |
| Same voice-over in Match clip and Hook clip | works | works only if both start at the same point |
| Cost | the template does one subtraction | none |

The catch either way: **voice the cut, not the raw recording.** If a clip is
re-cut after it has been voiced, the footage under the words has moved. The
Desk will warn when you re-cut a clip that has a voice-over.

### 2. Whisper runs on the Mac, and needs one install

| | On the Mac (recommended) | A paid service |
|---|---|---|
| Cost | free | pennies per video |
| Needs | `brew install cmake` once, then the Desk downloads and builds Whisper itself on first use, plus a model of about 1.6 GB | an API key |
| Speed | a few seconds a take | a few seconds a take |
| Works offline | yes | no |
| Your voice leaves the machine | no | yes |

`cmake` is a build tool. It is not on the Mac today (checked), and current
Whisper needs it. Xcode is already there.

### 3. Its own screen, not a panel in Make

Make is a form on the left and a preview on the right. A timeline wants the
full width of the page, and Clean up already set the pattern of one screen
per kind of edit. Recommended: its own tab.

### 4. Takes are not backed up anywhere

Footage comes from Drive, so losing the Mac loses nothing. Takes would only
exist on the Mac. Recommended: a **Back up takes to Drive** button using the
rclone setup already there, in stage 3. Until then a lost take means
recording it again.

## Build stages

Each stage ends with something Tom can use.

1. **Record, place, hear it.** The Voice screen with the clip and one voice
   row. Mic picker, meter, record at the playhead, drag to move, drag edges
   to trim. The `voice`, `voiceVolume` and `duck` fields in Make. A rendered
   video with a voice on it.
2. **Edit like an editor.** Waveforms, split, delete, several takes,
   record-over, undo, snapping to gaps. Tidy the sound.
3. **Captions.** Whisper install and model, words row, fix and hide words,
   both styles, the nudge, the `captions` field in Make. Drive backup of
   takes.

## Things to check while building

- **Does a take recorded after the render bundle was made get found?**
  Remotion copies the game's `public/` folder when it bundles, and the Desk
  only re-bundles when template source changes. If new takes are missed, the
  bundle check must also look at `public/voice/`.
- **How late is the recording?** There is a small delay between pressing
  record and the first sound being captured. Measure it once (clap on a
  visible frame) and take it off every take's position.
- **Whisper's word times** can drift near silences. If the nudge is not
  enough, Whisper has a more exact timing mode to switch on.
- **American spelling.** Whisper leans American ("color"). The vocabulary
  hint is written in British English to pull it the other way. Fixable by
  hand regardless.
- **Looping hook clips.** A voice that runs to the last frame plays straight
  into the first on replay. Probably wanted; listen to it.

## Not in this

- Captions appearing live while speaking.
- More than one voice row, or editing the music on the timeline.
- Captions for the game's own sound.
- Translating captions.
- Recording on the phone (a file dropped in can come later if wanted).

## Build notes (2026-09-29)

What exists:

- `packages/voiceover` (`@heroic/voiceover`): types, the edits as pure
  functions (`timeline.ts`), caption paging (`captions.ts`), word timing
  (`align.ts`), and the Remotion side (`remotion.tsx`: `useVoiceOver`,
  `VoiceTrack`, `Captions`, `useDuck`). 33 tests.
- `apps/desk`: `ui/Voice.tsx` (the screen), `ui/mic.ts` (the recorder),
  `lib/voice.ts` (takes, tidy, backup), `lib/whisper.ts`, routes under
  `/api/<game>/voice/…`, a Voice tab, a Voice button on every clip card,
  the `voice` field in Make, the re-cut warning in Clean up.
- `apps/bits-promos`: `src/voice.tsx` (the BITS look and caption
  placement), the voice props on Match clip and Hook clip, `VOICE_PREVIEW`.

Where the build differs from the design above:

- **Whisper's word times weren't good enough on their own.** Around a pause
  it put a word up to 0.3s early (a word "starting" in the silence before
  it). Fixed two ways: words are timed from the tokens' aligned END times
  (`--dtw`) rather than Whisper's own spans, and then each edge is pulled
  out of any silence it landed in, the silences being measured off the
  recording itself. On the test line every word at a pause landed within
  0.02s of the sound.
- **Whisper is run directly**, not through Remotion's wrapper, which waited
  on the process long after the answer was written (17s against 2s for an
  8s take). Remotion's package still does the install and model download.
- **It saves itself**; there is no Save button.
- **A file can be added** as a take (the link under Record), since the
  server converts whatever it is given.
- **The mic's head start is measured per take**, not once: the take skips
  however long the mic was live before the clip's first frame moved
  (0.02s in testing), so there is no delay setting.

Answers to "Things to check while building":

- A take recorded after the bundle was made WAS going to be missed, and so
  was any clip cut after it: Remotion copied `public/` (2.3 GB) into every
  bundle. The Desk now links it in (`symlinkPublicDir`), which also makes
  the first render of a session start sooner.
- Whisper did write "1 HP" for "one HP". Fix by hand.

How it was tested: the pure maths by unit test; the server by curl; the
screen in headless Chrome with a fake microphone playing a spoken line
(record, split, move, trim, undo, fix a word, hide a word, both caption
styles); renders of both caption styles in all three shapes, and the voice
in a render confirmed at the right times by transcribing the render. Not
tested: a real microphone, the Drive backup.

Tom's running Desk needs restarting to pick up the new routes.

## First pass with the real mic (Tom, 2026-09-29)

"Looking good as a first pass", with five things. What was done about each:

1. **Clip audio played with the tick box off.** The box only covered
   recording. It is now **Play the clip's own sound** and covers the whole
   screen: off, the clip is silent in the preview, and while recording
   nothing plays at all. It is this screen's setting only; a video's own
   sound is still `videoVolume` / `muted` in Make.
2. **The voice stopped playing the second time** (after a caption style
   change). NOT reproduced: a dozen play / pause / seek / style-change /
   replay sequences in Chrome and in Safari's engine all played. Hardened
   what could cause it: play is handed the click that asked for it (Safari
   rations sound to gestures); the space bar no longer acts on whichever
   tick box or button has the focus; Tidy no longer rewrites a take's file
   in place (a take now has `x.wav` tidied and `x.plain.wav` as recorded,
   and the take points at one); and a file the browser can't play now
   raises a message instead of silence. If it happens again: which
   browser, and did the clip's own sound carry on?
3. **Words bunched up on the timeline.** Tom's call: the scroll wheel zooms,
   smoothly, about the point under the cursor (a sideways swipe scrolls).
   Zoomed out, only the words there's room for are labelled; the rest are
   marks that show their word on hover.
4. **Hold and drag to move the playhead.** Done.
5. **The highlight was early.** A real fault, and the biggest change.
   Measured against Tom's take (each stretch of speech transcribed on its
   own to find out what was really said when), BOTH of Whisper's clocks
   were wrong around pauses by up to 0.9s: "hopefully" lit at 3.76s and
   was said at 4.55s; "but" lit at 8.18s and was said at 9.05s. The first
   build's fix (pull edges out of silences) only caught a pause that began
   exactly where the word did. Now (`align.ts`): find the stretches of
   speech in the recording, put each word in the stretch Whisper heard it
   END in (the one thing it got right on both test recordings), and share
   each stretch out among its words by how long each probably took. On
   Tom's take every word after a pause now starts within 0.05s of the
   sound. New voice-overs also start with a nudge of −50ms, so a caption
   lands just ahead of its word rather than with it.

Takes recorded before this keep their old times until **Listen to this
take again** is pressed on them; that now keeps any words you had fixed or
hidden, as long as Whisper hears the same number of words.

## One editor (Tom, 2026-09-29, later the same day)

> "Would it be possible to add all of the editing on the voice page into
> our main Clip editor? It feels weird to edit the clip somewhere and the
> audio in another, as I'll want the ability to make changes on the fly."

Built the same day. Clean up and Voice are now ONE screen, `ui/Edit.tsx`
(route `#<game>/clean/…`, as before; the Voice tab is gone and its old
address opens the editor).

### The problem, and Tom's three decisions

The two screens ran on different clocks: Clean up on the RECORDING's
(dropped footage stayed on the timeline as gaps), Voice on the finished
CLIP's. One timeline needs one clock.

| Decision | Tom chose |
|---|---|
| How dropped footage looks | **Packed.** The timeline is the clip's time; dropped footage closes up and leaves a thin hatched marker you click to restore. |
| What the voice does when footage is cut from the middle | **Moves with the footage.** |
| The Voice tab | **Removed.** |

### How it works

- **The voice is pinned to the footage under it** (`packages/voiceover/src/cut.ts`).
  A cut maps between the recording's time and the clip's; on any change
  to the footage each piece of voice is carried from the old cut to the
  new one by the moment of footage it starts on (`remapPieces`). Voice
  over footage that's been cut away waits at the join. This retires the
  "voice the cut, not the raw" rule and the re-cut warning.
- **The preview plays a cut that hasn't been made.** The templates'
  footage player (`Stage`) takes `segments` + `slide` and plays the
  recording's kept pieces end to end with the same slide ffmpeg's cut
  makes. So the editor previews footage, voice and captions together
  with nothing encoded.
- **Two kinds of saving.** Voice and words save themselves. Footage
  (and crop, and audio) is made real by Save, which encodes the clip
  file as before, because Make and the renders play that file. While
  the footage is changed and unsaved, the voice written to disk is
  carried BACK to the saved clip's timing, so Make is never handed a
  voice timed against footage it can't see.
- **A recording that's never been cut can be voiced as it is**: the
  voice-over belongs to the recording until the first Save, then moves
  on to the clip.
- **Pieces that touch in the recording are one stretch of footage.** A
  split on its own no longer makes a slide where nothing was removed.

### Found on the way

- **Saved clips with sound ran 0.6s past their end** (extra footage,
  silent). The joins were where they should be; only the tail was long.
  The encoder is now told where to stop.
- The filmstrip is made without holding the server up, and with more
  frames for a long recording (up to 96).

### Tested

52 unit tests (13 of them the cut and the voice following it). In
headless Chrome with a fake mic, on real footage: open a voiced clip,
play across a join (the right footage, mid-slide), record, split and
drop footage (voice moved by exactly the footage removed less the
join), drag an edge, undo, save as a new clip, reload at the new
address, change footage after saving (voice on disk unmoved). Tom's own
voice-over was opened and left byte-for-byte as it was.

## Noise and level (Tom, 2026-09-29, later still)

> "There's a bit of ambient background noise on my audio I'd like to be
> able to remove, also reduce the overall volume of my voice would be
> good, it's a bit over the top at the moment."

Two controls in the editor's Record panel, both per voice-over, both
remembered for the next one you start.

**Background noise: Leave it / Light / Medium / Strong.**
What was found in Tom's takes: the recordings are quiet (voice about
−35 dB), so levelling them turns the room up 20 dB with the voice; and
most of that room was RUMBLE below 80 Hz, which the tidy's gentle cut
left largely in. So any strength first cuts the rumble properly (a
steeper cut at 90 Hz: 17 dB off the typical noise on its own), then
turns the rest of the room down by 8 / 15 / 24 dB wherever nobody is
speaking (`packages/voiceover/src/denoise.ts`, Audacity's method: learn
the room from the pauses, gate each frequency, smooth the gating).

ffmpeg's own filters were measured first and rejected: `afftdn` took
4–8 dB off whatever it was asked for, `anlmdn` took 20 off and 2–5 dB
of the consonants with it. Ours, on the same takes: the asked-for
amount off the typical noise, the voice unchanged in every band
(0.0 dB from 80 Hz to 12 kHz).

What it does NOT remove: anything that stands out from the room, such
as a breath, a click, a key press. Those are louder than the room, so
they pass as if they were voice. Split them out on the timeline.

**Voice level**: 10–100%, applied when the voice is played, so it
changes instantly and nothing is re-made. It multiplies a video's own
`voiceVolume` in Make.

A take is never rewritten: each way of making it is its own file
beside the raw recording (`x.wav`, `x.plain.wav`, `x.n2v1.wav`…), made
the first time it's asked for (under a second), and the take points
at one.

Not judged by ear: measured only. The strengths are Tom's to pick by
listening.
