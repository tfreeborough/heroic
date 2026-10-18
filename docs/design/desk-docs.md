# The Desk: scripts from Google Docs

*2026-10-17 (Tom + Claude). Status: **BUILT**, uncommitted. Tom approved
the Drive remote the same day, and all three Docs in the folder were
pulled through the real code and routes. Owed: Tom's look at the picker
and the Doc view in his own Desk (restart it first). A small change to the Scripts
tab ([desk-scripts.md](desk-scripts.md)), working alongside research
([desk-research.md](desk-research.md)).*

## Why (Tom, 2026-10-17)

> "The issue I have with pasting is its a simple text box and my google
> doc has formatting."

Tom writes every script as a Google Doc in one Drive folder (**Video
Scripts**, under Heroic/BITS). Pasting loses the formatting and has to be
done again after every edit.

## Decided (Tom, 2026-10-17)

1. **Pick the Doc in the Desk, don't paste.** The script remembers its
   Doc. **Pull the latest** replaces re-pasting, and the Doc stays the
   master.
2. **Headings usually become chapters, but not always.** A heading is a
   suggestion to the picture plan, never a forced chapter.
3. Pasting still works for anything not in a Doc.

## How it works

- **Access.** A third rclone remote, `gdrive-scripts`: read only, and
  limited to the Video Scripts folder, the same pattern as
  `gdrive-footage`. It's set in the game's `desk.config.ts` as
  `drive.scriptsFolderId` and `drive.scriptsRemote`. The Desk never
  writes to Drive, and it can't see anything outside that folder.
- **Format.** rclone exports each Doc as markdown
  (`--drive-export-formats md`), so headings, bold, italics and lists come
  with it. `cleanDocMarkdown` tidies Google's export: it undoes the
  backslash escapes, drops images and their base64 data, and collapses
  blank lines.
- **Picking.** **From a Google Doc…** in the scripts list makes a new
  script from a Doc. **or pull it from a Google Doc…** under an empty
  paste box links an existing script. Either opens a picker listing every
  Doc in the folder (subfolders too), newest first.
- **A linked script.** Step 1 shows the Doc formatted (read only) with its
  name (a link to open it in Docs), when it was last pulled, and **edited
  in Drive since** when the Doc is newer than the pull. **Pull the
  latest** brings the words in again. If the cuts exist, the usual
  **Adjust the cuts** follows the change. Research findings stay and
  re-anchor as they would after a re-paste. **unlink** keeps the words
  and makes the box editable again. The store ignores edits to the words
  of a linked script from the page, so the Doc stays the master.
- **Headings.** A line starting with `#` is a section title:
  - it's never said, and never part of a beat (rule added to the rewrite);
  - it's never a research anchor (`sentences` skips it);
  - it's left out of the spoken length and the review diff (`spokenText`).
  
  The picture plan gets each heading with the first words said after it.
  It's told a heading usually starts a chapter named after it, unless the
  chapter rules say no (video under six minutes, too close to the last
  chapter, not a real turn).
- **Emphasis.** Bold and italics show in the Doc view. The marks come off
  beats (the rewrite's `clean`), and they don't affect matching.
- **Bold lines as headings.** Tom's older Docs mark sections with a line
  that's all bold rather than a heading style. `cleanDocMarkdown` turns a
  bold-only line into a `##` heading when it's twelve words or fewer and
  doesn't end in . ! or …. A question counts, because titles often are
  questions. A bold sentence said for emphasis ends in a stop, so it stays
  speech.
- **Tom's notes.** His newer Docs end with a "Sources (for the video
  description)" section of quoted links. `unsaidLines` marks these lines
  as never said:
  - headings;
  - lines starting with `>`;
  - everything under a heading that starts Sources, References, Links or
    Notes, up to the next heading.
  
  Notes are left out of the spoken text, the research sentences and the
  chapter suggestions. `forRewrite` (and so `scriptText`) also drops them
  from what the rewrite reads and from the voice samples.

## What the first real pull taught us

- Drive labels exports `text/markdown; charset=utf-8`, so the listing
  checks the start of the type.
- Google escapes `! + . -` with backslashes, and ends lines inside a
  paragraph with two spaces (a hard break). The tidy-up handles both.
- The stale check now ignores spacing. `forRewrite` collapses blank lines,
  and without that change an old pasted script read as changed when it
  wasn't.
- rclone warns that its shared Google Drive client id "will stop working
  during 2026". That affects all three remotes (footage too). The fix is
  your own client id: <https://rclone.org/drive/#making-your-own-client-id>.

## Code

- `apps/desk/lib/doc.ts`: the pure half. `ScriptDoc` and `DocEntry`,
  `cleanDocMarkdown`, `stripMarks`, `spokenText`, `docHeadings`,
  `docTitle`. Tests are in `doc.test.ts`.
- `apps/desk/lib/scriptDocs.ts`: the rclone side, always async through
  `exec`, never `spawnSync`. `listDocs` caches for 30 seconds, plus
  `pullDoc`, `unlinkDoc` and `docModified`. A missing remote is reported
  with the setup command.
- `Script.doc`, set in `lib/scripts.ts`.
- Routes: `GET /api/:game/docs` lists the folder. `GET`, `POST` and
  `DELETE` on `/api/:game/scripts/:id/doc` give the modified time, pull
  (or link and pull), and unlink.
- `apps/desk/ui/DocPicker.tsx` is the picker. The Doc view uses
  `Markdown`, which now draws headings.

## Setup (once)

```
rclone config create gdrive-scripts drive scope=drive.readonly root_folder_id=1LyiDdAyVGfmpgVdKhKEamCihYkz44UYa
```

It opens a browser to approve read-only access. The picker shows this
line, with a copy button, whenever the remote is missing.
