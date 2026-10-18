# The Desk: thumbnails

*Drafted 2026-10-17 (Tom + Claude). Status: **BUILT 2026-10-17**, uncommitted
(step 6 of the Scripts tab). Owed: Tom's own run in his Desk (restart needed
for the new routes) and the first Test & compare results. Builds on [desk-ascii-scripts.md](desk-ascii-scripts.md)
(the pictures, the glyph build, the Beats template). Mocks:
`apps/bits-promos/src/experiments/thumbnail/` (ThumbMock composition +
`render.ts`), pictures and renders in the gitignored
`apps/bits-promos/public/experiments/thumb-mock/`.*

## Why (Tom, 2026-10-17)

> "For our long form videos in desk, one thing I've neglected to do is come
> up with a thumbnail for each one. I like the idea of using the same ascii
> style as in the videos... The thumbnail + title are 95% of getting people
> through the door to watch the video."

## Decided (Tom, 2026-10-17)

1. **Glyph-built letters.** The words are built out of glyphs like the
   title cold open, not set in clean type.
2. **The picture stays matrix green; the words take an accent colour.**
3. **A fresh picture for the thumbnail**, written for a thumbnail, not a
   beat's picture reused.
4. **Red or white, Tom's choice per thumbnail**, previewed right there.
5. **No channel mark.**
6. The eye worked for the cheating video, but every script gets its own
   ideas. The eye is a pattern for the brief, not a template.

## Thumbnail conventions we're building around

- Thumbnail and title are a pair. Words on the thumbnail add to the title
  and never repeat it. Two to four words, or none.
- It has to read at phone size (about 360px wide in the home feed, 168px
  in up next). One subject, close and big, strong contrast.
- YouTube puts the video length bottom right, so nothing goes there.
- YouTube Studio's **Test & compare** takes up to three thumbnails and
  picks the winner on watch time. So we make three, not one.
- Text and faces aren't rules. Text that adds a twist helps, and so does a
  human with a readable feeling. But the published numbers are mostly
  other niches. Our own Test & compare results decide.

## What the mocks showed (10-17)

Three fresh pictures for "How does cheating work in multiplayer games?":
a shocked face, a hooded figure crowning himself, an eye through a crack.

- **Faces keep their feeling in glyphs**, even at 168px.
- **Glyph letters read as solid bold type at feed size.** You only see
  they're characters at full size. That's the effect we want.
- **Chunky fonts.** Anton read best. Cinzel's serifs go soft when small.
- **Brighter than the videos.** At the Beats settings (gain 1.1, glow
  0.22) the thumbnail was too dim for a feed. Gain 1.6 and glow 0.45 read
  well. Thumbnails need their own look settings.
- **160 columns.** 120 shows the glyphs more but loses the face. 280
  stops looking like ASCII at feed size.
- **Words go where the picture is dark.** A fixed left-hand box ran "WIN"
  into the hood. The real version measures the picture's ink and puts the
  words on its empty side.
- Red and bone both stand out against the green. Amber is close to green
  in brightness.
- The picture prompt asking for "the left third solid black" worked every
  time, which leaves room for the words.
- **Tom's pick: the eye through the crack** ("terrifying to look at, that
  would get me to click right away"). Why it works: one huge eye staring
  straight out at the viewer, half hidden, almost nothing else in frame.
  It's the face lesson pushed to the limit. The idea brief should always
  include one picture like it: an extreme close-up looking straight down
  the lens, with something hidden or watching.

## As built (10-17)

**Step 6, The thumbnail**, on the script page (after Organise, open once
there are ideas):

- **Three ideas** / **Three more ideas** (`rewrite.ts planThumbnails`):
  one Claude call over the title, the long cut and each beat's picture
  prompt, plus the ideas already there (so it doesn't repeat them) and an
  optional steer typed beside the button ("more like the eye"). Returns a
  prompt, 0 to 4 words, an accent and a one-line why per idea. Rules: one
  subject, close, readable at 168px; at least one face or eye with a
  feeling looking at you; at least one with no words; words add to the
  title and never repeat it, shorter is better; an idea with words keeps a
  third of the frame black. New ideas are added, old ones stay.
- **Make N pictures** / per idea **make**, **again**, **my own** (or drop an
  image on the card), **my own picture** at the top for an idea of your
  own: same GPT Image path as the beat pictures, the game's picture style
  plus `THUMB_STYLE`, saved as `cards/<script>/thumb-<idea>-<n>.png`, made
  in the background and polled (pending keys `thumb:<idea>`).
- Each card: the thumbnail drawn live at 1280×720, the words box (blank =
  none, a new line forces a break), **red / white**, **auto / left /
  right** for the words' side, the prompt, **download** (the PNG, about
  0.5 to 0.7 MB, under YouTube's 2 MB), × to drop the idea.
- **Borrow** (10-18, Tom: "swapping images generated from one thumbnail
  and putting them on another"): **borrow** on a card opens a row of the
  other ideas' pictures; pick one and it goes under this idea's words.
  Or drag a card's thumbnail (or one of its tries) onto another card. The
  borrowed picture joins that idea's tries, so you can flip back, and the
  idea it came from keeps it. The server only takes a picture that already
  belongs to one of the script's ideas.
- **In the feed**: every idea with a picture as a 360px phone home-feed
  card and a 168px up-next row beside the real title, dark or light.

**The engine** is `packages/ascii-build/src/thumbnail.ts` (`planThumbnail`,
`drawThumbnail`, `darkSide`, `freeWidth`): the picture covers the frame
at 160 columns, gain 1.6, glow 0.45; the words are Anton set as glyphs.
They go on the darker side (`darkSide`), in a box only as wide as that
side is empty (`freeWidth`, 22% to 45% of the frame), clear of the
bottom-right corner. Unless Tom types a line break, they take whichever
split into one to three lines sets them biggest. The Desk draws it on a
canvas and the download is that canvas, so the preview is the file.
`inkFromText` moved out of the Remotion entry into `src/text.ts` (still
re-exported there) so the page can use it.

Stored on the script as `thumbnails[]: { id, prompt, words, accent:
"red" | "white", side?, why?, candidates, chosen?, error? }`. The page
can change the words, accent, side, prompt and choice, and drop an idea;
pictures only come from the server (`scriptsStore.updateScript`).

Checked 10-17 on a test Desk: 3 own pictures in, a real Claude plan (7s),
one real GPT picture, words saved through PUT, the step screenshotted
headless. First layout let "I WIN" run into the hood and set "NOT LAG" on
one line; fixed with `freeWidth` and the line-split search.

## Titles to test (10-18)

Tom: "We also have the ability to A/B test video titles along with
thumbnails... adding a title generator too that will hook people in."
Step 6 is now **The title and thumbnail**, with a Titles block first:

- **Three titles** / **Three more titles** (+ steer): one Claude call
  (`rewrite.ts planTitles`) over the working title, the chapters, the long
  cut, the thumbnails' words (a title never repeats them) and the titles
  already there. The rules: Test & compare rewards watch time, so the hook
  has to be delivered; use stakes, a specific number, something learnt the
  hard way, or a claim against what people assume; under 60 characters;
  sentence case; Tom's voice; no clickbait phrases. Each title comes with
  a one-line why, written to Tom as "you".
- **my own title** adds an empty one. Each title has a length count (it
  goes red past 60, where a phone cuts it off), copy and ×.
- **In the feed** has title chips (the working title plus each one to
  test), so every thumbnail can be seen beside every title.
- `Script.titles[] = { id, text, why? }`, which the page can edit. The
  working title stays the long cut's, the one the video builds on screen.
  Downloads are still named after it.

First run, on "Why most mobile games fail": "Why most indie mobile games
fail, from a solo dev", "What 10,000 views actually did for my mobile
game", "87% of mobile downloads are casual. I made a ranked game". Both
numbers come from the script.

## Step 7, Description and tags (10-18)

Tom: "generate a couple of lines to put at the top of my description +
tags... I can add all of the extra guff underneath the timestamps."

- **Write them** / **Write them again** (+ a steer box): one Claude call
  (`rewrite.ts writeYouTube`, effort medium, about 5s) over the title, the
  chapter names and the long cut. It answers with two or three sentences,
  about 250 characters at most, and 10 to 15 tags.
- The lines describe this video only, never subscribe/links/channel stuff.
  The first sentence says what the video is about in words people search
  for, because YouTube shows only about 120 characters before "more". The
  lines never repeat the title and are in Tom's voice from the desk.config
  rules: first person, British, no em dashes or exclamation marks.
- Tags are lower case, most specific first, and the game's name always
  goes in (code adds it: the model kept leaving it out). They're kept
  under YouTube's 500 characters, where a tag with a space counts its
  quotes.
- Both boxes are Tom's to edit (`Script.youtube = { description, tags }`,
  tags as one comma string, which YouTube Studio's box splits). There's a
  **copy** button on each, and **copy with the chapters** adds the last
  organise's chapter list under the lines.

Tried on three real scripts (cheating, pivots, mobile games fail) before
Tom saw it.

## Later, maybe

- Claude suggesting a title to pair with each thumbnail (YouTube may let
  titles be tested too). Not asked for yet.
- Logging which idea won Test & compare, so the brief learns what works
  on this channel.
