# The Desk

One local page for the whole promo loop, for every game in the monorepo:
phone recordings in from Google Drive → clean them up → pick a template,
fill the props, watch the live preview → render vertical / square /
landscape → the library of finished videos, pushed to Drive.

```sh
bun run desk          # from the repo root → http://localhost:3400
```

Remotion Studio is not part of the daily loop — it's for building templates.

## Screens

**Clips** — the game's clip library, cuts up front. Record on the phone,
drop the file in the game's Drive footage folder, press **Sync from Drive**:
rclone pulls new files (additively — nothing local is ever deleted) and each
gets a sidecar `.json` with its facts and your notes. Media is gitignored,
sidecars are committed. The grid shows what you'd make a video from: your
cleaned-up cuts plus any recording you haven't touched; once a raw has a cut
it folds away under **Originals already cut**, and the cut links back to it
(**re-cut** opens the original with that cut's edit loaded — save over it or
under a new name). **Bin** moves a clip to `.trash/` AND writes its name to
`.binned.json` (committed), so Sync leaves it on Drive for good; the **Bin**
fold restores one.

**Clean up** — edit a recording like a track in Audacity, without touching
the phone. One filmstrip of the whole clip: click to put the playhead down,
**Split** there (button, right-click, or `S`), click a piece to select it,
`Delete` to drop it. Dropped pieces are gaps — playback skips them, and
`⌘Z` undoes. Drag a split line to move it. Two or more kept pieces join
with a slide left, and the player previews the join with two video layers. Shave the status bar and nav bar with the
sliders, drop the audio if it's junk, name it, save: ffmpeg writes the new
clip next to the original in seconds.

**Make a video** — pick a clip and a template, fill the form (generated from
the template's zod schema, so a new prop is a new field), tick the formats,
watch the preview — it runs the exact template code the render does.
**Render** queues one Remotion render per format (progress in the page);
**Still of this frame** renders a PNG for Reddit / Discord / thumbnails.

**Renders** — everything finished, one card per *batch* (the formats you
rendered together). Format chips pick which to play or download, with a tick
for each that's on Drive; **Upload to Drive** pushes every format not yet
there in one rclone run; **Re-open** restores the whole batch in Make;
**Delete** takes the batch (or just the shown format).

## Adding a game

1. Give the game a promos package (a Remotion project — see
   `apps/bits-promos`) whose compositions take a `format` prop.
2. Add `desk.config.ts` there (copy BITS's): name, icon, folders, Drive ids,
   fps, formats, `prepare` commands, and `templates: () => import("./desk.templates")`.
3. Add `desk.templates.ts`: the compositions the Make screen offers —
   component, zod schema, duration function, defaults.
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
  render jobs (one shared Remotion bundle per game; the formats of one press share a `batch` id), the renders library (batches, multi-file upload).
- `ui/` — the React screens. `form.tsx` turns a zod schema into fields.
- `game.ts` — the contract a game's `desk.config.ts` fulfils; `games.ts` — the registry.
- `cli.ts` — `bun cli.ts sync <game> [--offline] [--add <file>…]` for the page-less sync.
