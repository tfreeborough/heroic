# The Desk: list clips ("3 mistakes I made making my game")

*Drafted 2026-10-04 (Tom + Claude). Status: **BUILT 2026-10-04, all three
steps**, uncommitted. Owed: Tom's own run (markers on a real voiced edit,
a full render). See § Build notes. Companions:
[desk-timeline.md](desk-timeline.md) (the edits this builds on),
[desk-voiceover.md](desk-voiceover.md) (voice + captions),
[marketing.md](../marketing.md) (hook testing).*

## Why

Tom wants a video format for talking through a list: "3 mistakes I made
making my game", "4 things I learned about game development". It's his voice
over a mixed edit (phone gameplay, Realmsmith, code), with the list on
screen. The data behind it: the voiced TikTok got about 15x the like rate of
the hook clip (10-02). A list gives the voice a shape, and the blank slots
give the viewer a reason to stay.

## Tom's calls (2026-10-04)

1. **Items are timed by markers in the editor.** In Edit you drop a marker
   at the playhead and drag it like a split line. You don't type times in
   Make.
2. **The list fills in.** After the title, every slot shows, numbered and
   blank. Each item slams in big when its marker comes, then settles into
   its slot. The empty slots are the open loop.
3. **It counts down, N→1.** The first item you talk about is #N and the
   last is #1, the payoff.

## The shape of it

```
 frame 0            marker ▼1        marker ▼2        marker ▼3
 ┌──────────────┐   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
 │3 MISTAKES I  │   │3 MISTAKES I  │ │3 MISTAKES I  │ │3 MISTAKES I  │
 │MADE MAKING MY│   │1 ▓▓▓▓▓▓▓▓    │ │1 ▓▓▓▓▓▓▓▓    │ │1 IGNORED THE │
 │GAME          │   │2 ▓▓▓▓▓▓▓▓    │ │2 NO BOTS…    │ │  3s RULE     │
 │              │   │3 MAP EDITOR… │ │3 MAP EDITOR… │ │2 NO BOTS…    │
 │  [footage]   │   │  [footage]   │ │  [footage]   │ │3 MAP EDITOR… │
 │  captions    │   │  captions    │ │  captions    │ │  captions    │
 └──────────────┘   └──────────────┘ └──────────────┘ └──────────────┘
   title = hook       #3 lands          #2 lands         #1 lands
```

- **The title is the hook.** On screen from frame 0, big, exactly like the
  hook clip's card, so it's also the cover. It uses the hook clip's
  `variants` too, so several titles can be A/B tested from one edit.
- **When the title lifts, it shrinks to a header** and the blank slots
  appear under it. They're numbered #1 at the top and #N at the bottom, so
  the list fills from the bottom up and #1 stays blank, in plain sight,
  until the end.
- **At each marker** the item's line lands big in the middle, holds for
  about 1.5s, then flies into its slot. If the next marker comes sooner,
  the hold gets shorter.
- **Captions** sit where they do today (vertical: above the platforms'
  caption block). The list lives in the top band, and the footage sits
  between the two.
- **Ending**: same choices as the hook clip (loop by default, or sign-off).
  On a loop, the full list fades out before the replay so the title lands
  on a clean frame 0.

## Markers (the editor half)

- A **marker** is a moment on the edit: `markers?: { id, at }[]` on the
  `Sequence`, in sequence time. They're generic, so any later template can
  read them too.
- In `Edit.tsx`, **M** drops one at the playhead (right-click → "Add
  marker" too). They're drawn as numbered flags above V1, drag to move,
  click + Delete to remove, ⌘Z undoes. They're numbered by position on the
  timeline, so dragging one past another renumbers them.
- **Markers are pinned to the footage, like the voice.** Re-cut the edit
  and each marker travels with the moment it was on (`mapTime`, the same
  as `remapVoice` / `remapOver`). Dropping a marker on the line you say
  ("number two…") keeps it on that line.
- The editor keeps its plain preview, and Make is where you see the list.
  That's cheaper, and every template shares the editor's preview.

## The template (the Make half)

`ListClip` in `apps/bits-promos/src/ListClip.tsx`, a sibling of `HookClip`
built from the same parts (Stage, VoiceLayer, MusicBed, the hook card).
Props on top of the hook clip's:

| Prop | What |
|---|---|
| `hook` | The title, and the hook (variants). Named `hook`, not `title`: Make fills an empty `title` with the edit's name. "3 mistakes I made making my game" |
| `items` | The lines, **in the order you say them**. Make shows them as a row-per-item list (the `VariantList` editor), each row labelled with the number it gets: with 3 items the rows read #3, #2, #1 |
| `order` | `down` (default) / `up`. Hidden for now, there in case a video wants it |
| `hold` | Seconds an item stays big before it settles (default 1.5) |

The template reads the markers from the edit itself (`useSequence`, the
same load the Stage does), so a CLI render gets them too. Make only reads
them for the warning.

**Warnings** (the existing `warn` hook):
- Fewer markers than items: "3 items, 2 markers. #1 will land at the
  end." (Spare items land evenly in whatever's left.)
- More markers than items: the spare markers are ignored, and the warning
  says so.
- A plain clip (not an edit) has no markers: items are spaced evenly, with
  a warning pointing at the editor.

## Build plan

1. **Markers on the sequence**: type, pure edits (add / move / remove /
   remap) + tests in `packages/voiceover/src/sequence.ts`; saving remaps
   them alongside voice-overs.
2. **Markers in the editor**: flags row, M key, drag, delete, undo.
3. **ListClip template**: composition + schema + Root entry + the
   `desk.templates.ts` row; Make passes `markers` from the chosen edit.
   Checked with stills at each beat in all three shapes.

## Still to judge by eye (Tom)

- Slot order: #1 at the top, filling bottom-up, is the recommendation. A
  top-down fill (#3 first slot) is a one-line change if it reads wrong.
- Long items: Tom wanted more room than 28 characters. A slot wraps to two
  lines (about 70 characters at full size in vertical) before it steps
  down. An optional `short` per item for the slot is phase 2 if needed.

## Build notes (2026-10-04)

| What | Where |
|---|---|
| `Marker`, add/move/remove, `remapMarkers`, `ride` (top row + markers together), 5 tests | `packages/voiceover/src/sequence.ts` |
| Saving keeps them (sorted, clamped) | `apps/desk/lib/sequences.ts` |
| Editor: flags on the ruler, dashed line through the rows, M / + Marker / right-click, drag, Delete, undo; every footage change rides them | `apps/desk/ui/Edit.tsx` |
| Template + its timing (pure, 7 tests) | `apps/bits-promos/src/ListClip.tsx`, `src/listTiming.ts` |
| Desk row: title variants, items list (`lists` on DeskTemplate, rows numbered #3 #2 #1), marker warning (`warn` gets the clip's marker times) | `apps/bits-promos/desk.templates.ts`, `apps/desk/game.ts`, `ui/form.tsx`, `ui/Make.tsx` |

Look, after stills in all three shapes: the list sits on a dark card (a
gradient let busy menus show through); numbers are heavy sans `#1`
(Cinzel's 1 reads as an I); blank rows stay one line high and open as the
words wipe in (otherwise the blanks give away which items are long);
square gives the card at least 62% of the frame; landscape puts it in
the column beside the footage. Brand mark stays top-left, no REC chip.

Not tried in a browser: the editor's marker UI (typecheck only). Tom
must restart `bun run desk` for the server to keep markers on save.

## The list comes and goes (2026-10-06)

Tom's look at a real voiced edit: the list was unreadable over busy footage
(code, menus), the rows looked poor, and it didn't need to be up the whole
time. Changed in `ListClip.tsx`, timing helpers in `listTiming.ts`
(`mergeWindows`, `windowLevel`, 2 tests):

- **A dim behind the words.** The footage darkens (`dim`, default 0.6)
  under the title and whenever the list or an arriving item is up, and
  clears in between. On a loop it's back on for the title's return, so the
  last frame still matches frame 0.
- **The list is up in windows, not always.** Blank for 3s after the title
  (so the open loop is still seen), then from each marker for `showFor`
  seconds (default 9). Windows that touch or sit within 1s of each other
  join, so it never blinks off and straight back.
- **One thing at a time.** At a marker the item shows big on its own for
  the hold, then gives way to the list with that row filled and lit. The
  list is hidden while an item is up big.
- **The look.** No outer card (the dim does that job), so the list is
  bigger and sits in the middle band, under the brand mark and clear of
  the captions, in all three shapes. Each row is a plate: a dashed outline
  with a hollow number while blank; filled, with a gold number tile, once
  landed; gold-edged while it's the one being talked about.

Checked with stills on `edit-2026-10-05-2` at every beat in vertical, and
the item + full list in square and landscape. Not watched in motion yet.
