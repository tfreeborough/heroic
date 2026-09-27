# Blood in the Sand — launch marketing playbook

Status: **drafted 2026-08-29** · Owner: Tom · Budget: ~£0 + a few hours a week.
Goal: **players in matches**, not revenue — a 1v1 game is fun in proportion to
how fast it finds you an opponent, so every channel below funnels to installs
and to the Discord (where match nights keep the queue warm).

## The engine: the video factory

`apps/bits-promos` (see its README) renders vertical 9:16 videos from
templates + real game data. Three formats, one render each for TikTok /
Reels / Shorts:

- **Spotlights** — weapon/ability reveals over hands-free in-game footage
  of the item (a weapon slams in and its sim numbers count up on a spec
  plate; an ability rises into a bloom with its cooldown ring and charges) (the capture rig: a dev-only
  showcase deep link autopilots a 1v1 on the simulator while
  `bun run capture` records it). ~23 exist on day one
  (`bun run capture:roster && bun run render:roster`) — that's a month of
  near-zero-effort posts before counting human gameplay, re-shootable after
  every balance patch.
- **GameplayClip** — a raw phone screen recording given the trailer
  treatment: framed footage over a breathing blurred fill, a gold cold-open title, a
  broadcast lower third for the hook, and the developer's sign-off as the
  end card (one person, it's free, come and fight me). Record → drop it in the Drive footage folder →
  it's in the Desk (`bun run desk`, apps/desk): trim it, pick the template, render
  vertical/square/landscape. Recording → rendered post is under 10 minutes.
- **HookClip** — the GameplayClip built for the scroll: no title beat, the
  hook sentence is on screen from the first frame and lifts at three
  seconds. Type several hooks in the Desk's field separated by `|` and one
  press renders each as its own video. This is the template for the hook
  tests below.
- **Stills** — `remotion still` for thumbnails, Reddit images, Discord
  announcements.

### Cadence that survives contact with a day job

- **1 gameplay clip + 2 spotlights a week** was the launch-week floor;
  since 2026-09-26 the target is 1–2 posts a day (see Hook testing).
  Batch-render spotlights once; schedule ahead with each platform's native
  scheduler.
- Post the same video natively to TikTok, Reels and Shorts — never a
  cross-post with another platform's watermark (the algorithms punish it).
- **Hooks are the whole game.** The first second decides the scroll. Lead
  with the outcome ("He had 1 HP. Then the Harpoon."), a question ("Would
  you dodge or Ironhide this?"), or a rule that sounds unfair ("Healing
  once per round. Once."). Loadout-mind-games content ("what beats 3× dash?")
  invites comments, and comments are the ranking signal.
- Reply to every early comment; ask a pick question in the caption
  ("Sinkhole or Sandstorm?").

### Hook testing (from 2026-09-26)

The numbers so far: of the viewers who stay, about two thirds of each
Short gets watched, which is healthy; but roughly four in five thumb past
inside three seconds. So the hook is the lever, and hooks get tested, not
guessed.

- **Same footage, same ending, three or four hooks.** The Desk renders
  them from one trim. Post them days apart, mixed in with other clips,
  never together; change the caption, the cover and the music start too,
  so TikTok's duplicate-content check has nothing to match on (Shorts
  doesn't care).
- **Test the first frame, not just the words.** Round one: three hook
  lines on the same start point. Round two: the winning line on three
  start points (on the swing, one second before the kill, on the
  reversal). The start point usually moves swipe-away more than any
  sentence does.
- **Hook types to rotate:** the outcome tease ("He had 1 HP. Then the
  Harpoon."), the unfair rule ("One life. No respawn. No healing."), the
  question ("Would you dodge this or Ironhide it?"), the dev line ("I made
  a game where nothing is aimed").
- **Judge by retention, not views.** YouTube Studio gives "viewed vs
  swiped away" per Short; TikTok gives the retention graph and the
  full-watch rate. Views at 48 hours are the algorithm's test batch and
  swing wildly on small numbers. One video per hook proves nothing; the
  same hook type across several clips does. Keep a sheet: clip, hook type,
  hook text, platform, post date, swipe-away %, average watch %, views at
  48h.
- **The Desk's Queue tab is the plan.** Queue a batch from Renders and it
  takes the next free slot; hook variants of one clip are held three days
  apart automatically. Each post has the title (Shorts) and the one
  description used on every platform, drafted in my voice and editable.
  Upload through the native schedulers, tick the platform, done. Overdue
  goes red; Re-flow lays the backlog out again from today.
- **Cadence: one or two posts a day**, not three a week. This is the same
  plan as the testing: one clip trimmed once and rendered with three hooks
  is three posts, so a weekend of recording is a week of daily posts, and
  daily posts are the only way to get enough samples for the hook data to
  mean anything. Schedule with each platform's native scheduler.

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
