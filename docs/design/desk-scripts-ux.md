# Desk Scripts: the stage rework

2026-10-19. Tom: "having to keep scrolling down section to section is kinda painful… recording my voice, if I want to play it back I have to scroll down and if I have recorded LOTS of beats it's very far away each time."

## What was wrong

The script page was one column of seven folding steps (script, long cut, pictures, record, organise, title and thumbnail, description and tags). Every step is big on its own, so stacked they're a very long page. Record was the worst: the whole prompter (every beat) sat above the takes bin, and the bin's player only showed on the opened take under that, so with 40 beats every playback meant scrolling past the whole script.

## Settled with Tom

- **Stage tabs.** A bar under the title: Write · Cut · Pictures · Record · Organise · Publish, each with its progress under the name. One stage on screen at a time, full width. The stage is in the address (`#<game>/scripts/<id>/<stage>`), so a reload lands back on it; with no stage in the address the script opens where you last were on it (this machine), or Write before the rewrite and Cut after.
- **The script list folds away** while a script is open: a narrow strip with the "Scripts" button opens it as a drawer over the page. With no script open it's the full list, as before.
- **Record: the takes beside the prompter.** The prompter on the left (follows the beat you're on and scrolls it into view); on the right, a column that stays put: the last take pinned with ▶ (Space plays it, Delete deletes it), then the takes that read the beat you're on, each ▶ playing just that beat's stretch of it, then every take as a fold. Opening a take to trim it opens a panel along the bottom of the screen, so it's in view wherever you are. After a take lands the prompter moves on to the next beat that still needs reading after it.
- **Cut**: a beat rail down the left with what each beat has got (changed from your words, picture approved / made / planned, recorded), chapters as headings; click one to go to it, and it follows the page as you scroll. The title, the whole-cut change box and a "just the changed beats" filter sit in a bar that stays at the top. (Pictures and Record don't need the rail: the grid and the prompter are already the overview.)
- **Pictures**: a grid, one tile per picture, and the picked one open in a panel on the right with everything (tries, prompt, approve, again, mood, pulled words, chapter). ← → move through them, A approves. Filter: all / not approved / not made. The plan/make/remake/approve-all buttons and the world stay in the bar at the top.
- **Publish** = the old steps 6 and 7 together: titles and the description/tags side by side, thumbnails under them.
- **Write**: the script on the left, research on the right (stacked on a narrow window).

Nothing in the data or the server changes: this is the page only.

## Built

2026-10-19, same day. `ui/Scripts.tsx` (stage bar, drawer, Write/Cut/Organise/Publish layouts, the Cut rail), `ui/Prompter.tsx` (the Record stage: sized to the window, the player that skips cut stretches, the side column, the trim sheet, Space / Delete keys, the move-on after a take), `ui/Pictures.tsx` (tiles + detail, ← → and A), `ui/Thumbnails.tsx` (Titles exported for Publish), `ui/App.tsx` (the stage in the address), `styles.css` (the site header is opaque now, so nothing shows through it when the page scrolls). Checked with headless Chrome on the mobile-games script (54 beats, 54 takes): every stage, the drawer, the rail jump, Space play/stop, the arrows, the trim sheet. Owed: Tom recording through it for real.
