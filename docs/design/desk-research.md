# The Desk: research

*Drafted 2026-10-17 (Tom + Claude); Tom's three open questions answered
the same day. Status: **BUILT 2026-10-17**, uncommitted. Tested once live
on a copy of the cheating script; Tom's own run in the Desk is owed. Adds
a research step to the Scripts tab ([desk-scripts.md](desk-scripts.md),
[desk-ascii-scripts.md](desk-ascii-scripts.md)). Everything else on the
tab (rewrite, review, pictures, prompter, organise) stays as it is.*

## Why (Tom, 2026-10-17)

> "Something I've been mulling over is research and data to support my
> points. I have 2 jobs and don't have time to do all of the research
> manually."

> "I want it to actually modify my script to inject these little bits of
> information."

Long-form videos land better when the claims are backed up: a real number,
a named study, a developer's own postmortem. Finding those by hand takes
hours Tom doesn't have. The Desk already holds the script and already talks
to Claude, so research belongs there. A Claude Project on claude.ai could
find the facts, but it would hand back a whole rewritten script that Tom
would have to compare line by line. Here the facts arrive as separate
additions he can accept one at a time, and his own words are never touched.

## Decided (Tom, 2026-10-17)

1. **The Google Doc stays the master.** Tom writes there and pastes into
   the Desk, as now. Research must survive a re-paste (see "A second
   paste").
2. **It runs on a finished draft.** One press, after the paste. It isn't a
   writing companion, and it doesn't run while he types.
3. **A few strong ones, scaled to length.** One addition offered per two
   minutes spoken (at least one, at most eight), and none when nothing
   good turns up. Nothing is padded with weak sources.
4. **Evidence against is mentioned when it's weaker than the point.** It
   can go in as a fair "to be fair…" line (stance `concedes`). Evidence
   that knocks the point down altogether (stance `refutes`) never goes in
   the script. It shows as a warning for Tom to deal with.
5. **Sources are Claude's judgement.** Tom: "use your best judgement on
   what to trust". The rules are in `lib/researcher.ts` (`SOURCE_RULES`)
   and summarised below.

## Settled in this doc (Claude's calls, open to change)

6. **Additions only.** Research never edits, reorders or removes a word of
   Tom's. Each finding is one or two new sentences pinned after one of his
   sentences.
7. **Every addition carries proof.** That means the source link, the
   source's own words (the quote), who published it and when. Each quote
   is checked against the page itself, and a quote that isn't on the page
   is never offered.
8. **Said, not footnoted.** An addition names its source the way a person
   would out loud ("Riot say this themselves…"), so it works in the video
   without a citation on screen. The links go into the YouTube
   description.

## Words

- **Finding**: what the research brought back for one spot in the draft:
  the addition, its anchor, its source, the quote, a strength and a stance
  (`supports`, `concedes`, `refutes`).
- **Anchor**: the exact sentence of Tom's that an addition goes after.
- **Addition**: the one or two sentences, in Tom's voice, that would be
  read aloud.
- **Woven script**: Tom's paste with his accepted additions put in after
  their anchors. It's what the rewrite reads.

## The shape of it

```
 paste ─▶ RESEARCH ─▶ rewrite ─▶ review ─▶ pictures ─▶ record ─▶ organise
             │
   search the web ─▶ write additions in Tom's voice ─▶ check each quote on its page
             │
   Tom: accept / edit / reject each  ─▶  woven script  ─▶  rewrite reads it
                                              │
                                      sources list ─▶ YouTube description
```

Research sits in step 1, between the paste and the rewrite. It can also
run after a rewrite. An accepted addition then changes the woven script,
the cuts go stale, and the existing **Adjust the cuts** takes care of it.

## How a run works

One press of **Research the draft** under the paste box. It runs in the
background with a progress line, and the page polls for it. The test run
on a 975-word script took four and a half minutes.

**1. Search.** One call with Anthropic's web search and web fetch server
tools (`web_search_20260209`, `web_fetch_20260209`). Searches are capped
at four per addition wanted plus six, up to 30. The draft goes in as
numbered sentences. Claude:

- picks the spots where a real fact would help most: claims stated as
  true, or general lines a specific fact would sharpen. It skips Tom's own
  story, which is his and not something to source;
- searches, then **opens each page** and copies the quote from the page
  itself, never from a search snippet or memory;
- looks for evidence against each point as well as for it;
- writes a plain-text report of findings, best first, plus the spots
  where nothing solid turned up.

If the server's tool loop pauses (`pause_turn`), the Desk hands the turn
back and the loop carries on. Prompt caching is on for this loop.

**What counts as a source** (`SOURCE_RULES`), best first:
1. Primary sources: the original survey, study or dataset; a platform's
   own figures (Valve, Apple, Google, Epic…); company filings; a
   developer's own postmortem, blog, talk or interview about their own
   game; peer-reviewed research.
2. Established journalism and trade press that did the reporting or names
   its primary source (Game Developer, GamesIndustry.biz, PC Gamer,
   Eurogamer, The Verge, Ars Technica, BBC, Reuters…). When the article
   cites a survey, Claude goes and finds the original.
3. Data trackers (VG Insights, Gamalytic, SteamDB, Sensor Tower…) only for
   figures nobody publishes directly, and said as estimates.

Never used: SEO listicles, statistics roundup sites without a primary
link, content farms, AI-written summaries, Wikipedia itself, Reddit or
forum posts (unless it's the developer talking), or press releases. For
anything about markets, sales or money, recent sources win.

**2. Write.** A second call with structured output turns the report into
findings. It uses the rewrite's own system prompt (Tom's scripts in full
as the voice, the house rules) plus the addition rules:

- name the source out loud;
- never change a number;
- `concedes` gets a fair "to be fair…" line, without arguing back beyond
  what Tom's script already says;
- `refutes` gets no words to say, only a note for Tom.

**3. Check.** Each quote is looked for on its page. The Desk checks the
text the fetch tool brought back in step 1 first, then fetches the URL
itself (an async fetch with a 15 second timeout, never `spawnSync` inside
a `Bun.serve` handler, which has crashed the Desk before). Case,
punctuation, curly quotes and HTML are ignored; numbers must match
exactly; a quote split by "…" counts if every piece is there. Each finding
ends up in one of three states:

- **checked**: the quote is on the page.
- **check this one yourself**: the page couldn't be read here (paywall,
  PDF, script-drawn page, bot wall). It's still offered, with a warning.
- **not on the page**: dropped, never shown, and counted in the run
  summary.

A number in the addition that isn't in the quote gets a warning ("check
the number before you say it"), not a drop, because an addition may
fairly say "just under half" for 48%.

The best `findingsWanted` (by length) of the supports and concedes are
**offered**; the rest wait under **more**. Every refutes is shown.
Accepted and rejected findings from an earlier run carry over, and the
search is told not to find them again.

## Review

The **Research** panel sits under the paste in step 1. It shows the paste
as reading text, but only the paragraphs with something in them (the rest
fold to ⋯). Each finding appears as a card right after its anchor
sentence, and the anchor sentence is lit up. Each card shows:

- what it is (backs this up / a fair point against), whether the source
  is only fair, and the check state;
- the words to say;
- the publisher, date and link, with **the quote** one click away;
- **Accept**, **Edit** (then save and accept), **reject**. Once accepted:
  **edit**, **take it out**, and whether it's **in the script** or **in
  your doc**.

A refutes card shows the note on what the source says against the point,
the source and quote, and **Noted**, which hides it.

Under the cards:

- **show N more findings**: the extras, each with its anchor.
- **Couldn't find solid backing for these**: the lines worth softening
  before recording.
- **copy for the doc** and **copy sources for the description**.
- **Research again**: a fresh run. Accepted findings stay, and rejected
  ones aren't offered again.

## A second paste

Additions live in `Script.research`, not in the pasted text, so a re-paste
can't wipe them. `weave()` places each accepted addition every time the
woven script is built (rewrite, adjust, the stale check, the review
diff):

- **in your doc**: its words are already in the paste (Tom copied it into
  the Google Doc), so it isn't added twice.
- **placed**: its anchor is still there, so it goes in after it. Two
  additions on one anchor go in list order.
- **lost**: its anchor is gone. The panel shows "Lost its place" with
  **Put it after…** (a list of the current sentences) or **drop it**.

**copy for the doc** gives every accepted addition that isn't in the doc
yet, each as "After '…' add: …". The Desk never writes to Google.

## Sources out

**copy sources for the description** gives one line per source used, in
script order: publisher, title, year, link. Citations on screen (a small
source tag while the addition is said) are a later idea for the Beats
template.

## Code

- `apps/desk/lib/research.ts`: the pure half, imported by the page too.
  It holds the types, `findingsWanted`, `sentences`, `weave`,
  `wovenSource`, `pageText`, `quoteOnPage`, `strayNumber`, `forTheDoc`
  and `sourcesBlock`. Tests are in `research.test.ts` (18).
- `apps/desk/lib/researcher.ts`: the run. Search loop, write call, quote
  check, background state (`researchState`), and `decide` for Tom's calls.
- `Script.research` (`lib/scripts.ts`). `isStale` compares against the
  woven script. `scriptSteps.ts` hands the woven script to rewrite,
  adjust, redo-cut and short, and snapshots the woven text.
- Routes: `POST /api/:game/scripts/:id/research` starts a run.
  `POST …/research/decide` takes `{ finding, status?, text?, anchor? }`.
  `GET` on the script now carries `researching`.
- `apps/desk/ui/Research.tsx`: the panel. Styles are under `/* research */`
  in `styles.css`.

## Cost

The one live run (975 words, 18 searches, 6 findings, 0 dropped) cost
**$4.10**, before prompt caching was switched on for the search loop. Most
of that is the loop re-reading every page it has opened. The run summary
shows each run's cost from the API's usage, so Tom's first real run will
show what caching saves. If it's still high, the next things to try are
`effort: "medium"` on the search loop and a lower search cap.

## Not built (later, if wanted)

- **More like this** on a single spot (another try at one sentence).
- Per-game source settings in `desk.config.ts`. Claude's judgement covers
  it for now (decision 5).
- Citations on screen in the Beats template.

## Owed

Tom's first real run in the Desk: the panel's look, whether the voice of
the additions is right, the "check this one yourself" rate, and the cost
with caching on. The visual check of the panel wasn't done, because the
Chrome extension wasn't connected. It's typechecked, the page bundle
builds, and the routes were tested against a live server.
