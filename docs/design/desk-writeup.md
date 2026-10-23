# The Desk: the write-up

*Drafted and BUILT 2026-10-23 (Tom + Claude). Owed: Tom's first run on a
real script, and a look at the page it makes on the site.*

## Why (Tom, 2026-10-23)

> "At the moment, I'm making long form youtube videos, what would be nice is
> if we could somehow take the content of that video, create a page and
> re-write the script slightly to make it slightly more like an article
> (remove the extra guff at the end, references to watching the video etc).
> With a link to the youtube video on that page too. This should provide
> consistent human content for google, but also links my indie dev youtube
> channel across to my website, increasing SEO."

## What it is

Its own stage, **Site**, after Publish (moved out of the Publish panel the
same day on Tom's ask). The long cut is already Tom's words in his voice, so
the article is a small step from it.

1. **Write the article.** Claude reads the long cut (beat by beat, with the
   chapters) and the author's own scripts for the voice, and writes the
   article: every point kept in order, spoken rhythm taken to written,
   nothing about watching, the screen, subscribing or the channel, `##`
   headings from the chapters, a search-minded title, a description under
   160 characters and a slug. An instruction box steers it; Write it again
   sees what was there.
2. **Tom edits.** Title, URL, description and the markdown body are his to
   change on the page (with a preview). He pastes the YouTube link once the
   video is up; the page keeps only the id, and reads the video's publish
   date off its watch page (`publishDate`, no API key; UK date) into the
   **Dated** field, which is the post's `date` and what the dev log orders
   by (newest first). Blank = the day it's first saved; a re-save on a later
   day adds `updated`.
3. **Save to the site.** Writes ONE FOLDER per post (Tom, same day: "put it
   all in a single folder, so if I need to delete it I can"):
   `apps/free-the-borough-site/src/content/log/<slug>/` holding `index.md`
   with its frontmatter, the cover as `cover.jpg` (1280×720: the player's
   poster and the social card; without one the page shows a plain plate, so
   nothing is fetched from YouTube before play) and the pictures as
   `1.jpg`, `2.jpg`… Astro processes images beside the markdown (`cover:
   ./cover.jpg`, `![alt](./1.jpg)`), sizing and optimising them. The folder
   is rewritten on every save; the first save fixes the page's date; a later
   save on another day adds `updated`; a save under a new slug removes the
   old folder. Delete the folder, the post is gone. Tom commits and pushes;
   Render builds the site.
4. **Pictures, one per heading** (added the same day). Each `##` heading
   gets the chosen picture of its chapter's first beat that has one; a
   heading that is no chapter takes the unused picture nearest its place
   in the piece. They're saved as JPEGs at most 1280 wide beside the
   markdown and go in as `![alt](./n.jpg)` straight under the heading, alt
   text = the beat's scene line (Astro adds width, height and lazy loading). No headings, no pictures. The pairing is `articlePictures` in
   `lib/scripts.ts`, shared with the panel's count.
   **As glyphs, not the stills** (Tom, same day: "it needs to be on theme").
   The engine draws on a canvas, so the Site stage draws each picture with
   `glyphStill` (the Pictures stage's still: 1920×1080, the video's columns,
   glow) and the cover with `thumbStill` with NO words, full bleed (Tom:
   "just the art in ASCII form") and sends them up (`POST …/writeup/still?key=<beat>|cover`,
   kept as `cards/<script>/site-<key>.png`) just before the save; the save
   converts those. A missing still fails the save with a message.
   **The cover is any thumbnail try.** A row of every thumbnail picture made
   for the script, each drawn as glyphs without words; Tom clicks one
   (`writeup.cover`, must be one of the tries), else the chosen thumbnail's
   picture is used.
5. **Sources.** The author's own notes (a Sources / References / Links /
   Notes section, quoted lines) and the sources of accepted research
   findings become a `## Sources` list on the end of the article, as plain
   links: a markdown link keeps its words, a bare URL is titled by its site
   and page, a note without a URL goes in as text, one entry per URL,
   nothing invented (`sourcesList` in `lib/scripts.ts`). Claude is told not
   to write one. **No nofollow**: that's for links you don't vouch for
   (paid, user-submitted); citing where the facts came from is an editorial
   link and reads as care. No picture goes under the Sources heading.

Where things live: `Script.writeup` (`lib/scripts.ts`), the Claude call
`writeArticle` in `lib/rewrite.ts`, the steps in `lib/scriptSteps.ts`,
routes `POST …/writeup` and `POST …/writeup/save`, the panel `ui/Writeup.tsx`.
The site paths come from the game's `desk.config.ts` (`site`), so a game
without a site has no Save button that works.

## Decided

- The Desk writes files, not commits. Tom reads the page in `bun run site`
  before it goes anywhere.
- The video id is pasted by hand. The Desk doesn't upload to YouTube.
- Thin pages hurt: the article is the whole script written down, not a
  transcript with the sign-off cut.
