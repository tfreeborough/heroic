# Blood in the Sand — launch marketing playbook

Status: **drafted 2026-08-29** · Owner: Tom · Budget: ~£0 + a few hours a week.
Goal: **players in matches**, not revenue — a 1v1 game is fun in proportion to
how fast it finds you an opponent, so every channel below funnels to installs
and to the Discord (where match nights keep the queue warm).

## The engine: the video factory

`apps/bits-promos` (see its README) renders vertical 9:16 videos from
templates + real game data. Three formats, one render each for TikTok /
Reels / Shorts:

- **Spotlights** — weapon/ability cards from the live sim numbers, cutting
  to hands-free in-game footage of the item (the capture rig: a dev-only
  showcase deep link autopilots a 1v1 on the simulator while
  `bun run capture` records it). ~23 exist on day one
  (`bun run capture:roster && bun run render:roster`) — that's a month of
  near-zero-effort posts before counting human gameplay, re-shootable after
  every balance patch.
- **GameplayClip** — a raw phone screen recording wrapped in a hook banner,
  watermark, and end card. Recording → rendered post is under 10 minutes.
- **Stills** — `remotion still` for thumbnails, Reddit images, Discord
  announcements.

### Cadence that survives contact with a day job

- **1 gameplay clip + 2 spotlights a week.** Batch-render spotlights once;
  schedule ahead with each platform's native scheduler.
- Post the same video natively to TikTok, Reels and Shorts — never a
  cross-post with another platform's watermark (the algorithms punish it).
- **Hooks are the whole game.** The first second decides the scroll. Lead
  with the outcome ("He had 1 HP. Then the Harpoon."), a question ("Would
  you dodge or Ironhide this?"), or a rule that sounds unfair ("Healing
  once per round. Once."). Loadout-mind-games content ("what beats 3× dash?")
  invites comments, and comments are the ranking signal.
- Reply to every early comment; ask a pick question in the caption
  ("Sinkhole or Sandstorm?").

### Clip-worthy moments to farm

One-life rounds are a highlight generator: match point at 2–2, dash i-frame
dodges on the telegraph, Mirror Guard returns, Sinkhole reversals, Straw Man
bamboozles. Spectator mode + bots mean staged clips need no second human.

## Channels you already have

- **Discord = the retention engine.** A 1v1 game dies without opponents:
  run a fixed weekly **match night** (same day, same hour — an event, not a
  vibe), post a weekly ranked leaderboard screenshot, and give playtesters a
  role + credits mention. Every video's end card and bio link should land
  here or on the store page.
- **Subreddit = the archive.** Small subs look dead and dead looks bad —
  treat it as the searchable home for patch notes, roadmap posts, and clip
  archives rather than a growth channel. Growth comes from *other* subs.

## Manual promotion that actually moves installs (ranked by effort/return)

1. **Build-in-public devlogs.** Post honest, specific dev content to
   r/iosgaming, r/IndieDev, r/gamedev (check each sub's self-promo rules
   first, participate before promoting) and to TikTok as "day X of launching
   my gladiator game" videos. The deterministic sim, the AI-asset Forge
   pipeline, "my bot queue pretends to be human" — these are genuinely
   unusual stories, and dev-story videos routinely outperform ads for solo
   devs. The same post works on Hacker News (Show HN) for the tech angle.
2. **TestFlight → launch funnel.** Before the store release, a public
   TestFlight link is the CTA; collect testers in Discord, then convert them
   into day-one reviews (reviews are the #1 App Store conversion lever —
   ask in-app after a won match, never after a loss).
3. **ASO basics, once.** Title + subtitle carry the keywords ("1v1 arena
   duel", "PvP gladiator"); screenshots are portrait, first two do the
   selling, and a 30s app preview video is just three GameplayClip renders
   re-cut. Localise the store listing later, not now.
4. **Micro-creators, not influencers.** DM 10–20 small mobile-gaming
   TikTokers/YouTubers (1k–50k) with a promo code and a one-line pitch +
   presskit link. One yes beats a hundred cold emails to IGN. Track who
   posts; invite them to match night to fight *you* on camera.
5. **Press kit + one pitch wave.** A single page (presskit() format is the
   indie standard): trailer, GIFs, icon, fact sheet, contact. Email
   TouchArcade, PocketGamer, and the mobile-curation newsletters the week
   before launch — low odds per email, near-zero cost, and Apple editorial
   (App Store featuring via the "promote your app" form) is the real
   lottery ticket worth entering.
6. **Launch-day posts.** r/iosgaming allows dev launch posts (read the
   current rules); "I spent N months building a 1v1 gladiator duel where
   nothing is aimed and everything is a telegraph — AMA" with a good clip
   is the format that works. Cross-post to r/AndroidGaming when that build
   exists.
7. **In-game share loop (build later).** A post-match "share replay clip"
   button is the compounding channel — every good match markets the game.
   The spectator system is most of the plumbing already.

## What to skip (for now)

Paid UA (unknowable ROI pre-monetisation), a custom website beyond the
existing site + presskit, Twitter/X grinding, cross-platform Discord
partnerships, and any channel that needs daily attention. Revisit paid ads
only if organic proves people retain.

## Measure just enough

One trackable link per channel (App Store campaign links or a link
shortener), weekly note of installs / Discord joins / D1 match count. If a
channel does nothing for 4 weeks, drop it — the cadence above should cost
≤4 focused hours a week total.
