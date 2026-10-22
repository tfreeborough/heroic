# Blood in the Sand — store listing copy

Status: **v2 drafted 2026-10-22** after the first look at the live store
stats (v1 was drafted 2026-09-07 for Google Play closed testing, App Store
fields added 2026-09-08). Assets render from `apps/bits-promos`:

- `bun run render:store` → `out/store/`: the 1024×500 feature graphic,
  eight 1080×1920 screenshots and the "note from the dev" card, all defined
  in `src/data/store.ts`.
- `bun run render:store -- --apple` renders the same cards at 1284×2778
  into `out/store/apple/` for App Store Connect's 6.5" iPhone slot (it only
  accepts 1242×2688 / 1284×2778, either way up).
- `bun run render:store -- --video` → `out/store/video/`: the store preview,
  `app-preview-886x1920.mp4` for App Store Connect and
  `play-promo-1920x1080.mp4` for YouTube → Play Console.
- `bun run render:store -- --assets` → `out/store/apple-assets/`: Apple's
  Asset Library placements (see below), a still and a looping video each.

Keep the pitch here and in that file in step.

## What was wrong with v1 (and what v2 changes)

- **"You don't aim" led the whole page** (first screenshot, feature graphic
  line, promotional text). It's the design reason the game works, but on a
  store page it reads as something the game is missing, not a reason to
  install. v2 leads with what you get: quick, bloody fights, one life a
  round, mates, arenas, bots that fight back. The windup rule is still
  there (card 2, "See it coming") but framed as a thing you do.
- **The fight was invisible at store size.** Every v1 card put a phone
  frame under a 400px caption band, so the actual fight was two dots in a
  beige field a thumb wide. v2 fills the card with footage and zooms onto
  the action (`zoom` + `focus` per card), so blood and the fighters read in
  the first-three-screenshots strip. The one menu card keeps a phone frame.
- **Every v1 card was the same desert arena.** There are three now and the
  footage exists for all of them, so each card is a different one.
- **No video.** Google only shows the feature graphic when there's a promo
  video, and both stores autoplay previews muted in search results, so the
  video is the first thing most people see. v2 ships one cut for both.

## App name (30 max)

Blood in the Sand

## Short description (80 max, 75 used)

Quick, bloody arena fights. One life a round. Bring a mate or go it alone.

## Full description (4000 max)

Blood in the Sand is a small gladiator arena game I've been making on my own. You drop into the sand with a weapon and a few abilities and fight until one side is dead. A round is about a minute, a match is a few minutes, and then you queue again.

You get one life a round. No respawns. Die and you watch the rest of it from the sand. First to three rounds wins, and if two people spend too long circling each other the arena starts shrinking and anyone left outside the line starts bleeding, which sorts things out quickly.

It's a game about timing and nerve rather than fast thumbs. Every attack has a windup you can see coming, and your attacks go at whoever's nearest, so there's nothing fiddly to aim on a touchscreen. The whole fight is in the spacing: do you dash through the swing, block it, or step out of the way and hit them while they're recovering?

What's in it right now:

- Ranked 1v1 and 2v2, with a solo queue for 2v2 if you haven't got a mate around
- Private rooms with a passcode for playing friends, up to 4v4, plus a six-player free-for-all
- Three arenas, dealt at random: the open sand of First Blood, the obelisks and scrub of Obelisk, and the old temple garden of Ancient Rites. Rocks and walls to hide behind, gaps you'll get caught in.
- Practice against bots, and a set of offline challenges against them. The easy bots are genuinely bad at the game. The hard ones will beat you.
- A big map of achievements (I call them deeds) for things like winning on your last sliver of health, or killing the person who just killed your teammate
- Blood that stays on the sand for the whole match, footprints through it, and a crowd that gets loud when something happens

It's free. There's a shop with some extra weapons, abilities and announcer voices. You can buy the currency for it with real money or earn it by playing. Nothing in there makes you hit harder, it just gives you more things to build with.

A game like this only works if there are people to fight, so if you like it, tell someone. There's a Discord where I run match nights and post patch notes: discord.gg/8FHgBmaSnT

Made in the evenings by one person. Bugs and strong opinions about balance are both welcome.

## App Store Connect fields

Same description as above (Apple's field is also 4000). The rest:

**Subtitle** (30 max, 26 used)

Quick, bloody arena fights

**Promotional text** (170 max, 156 used — editable any time without a new build)

One life a round. Every attack telegraphed, so it's timing and nerve, not fast thumbs. Made by one person. Free, with a Discord where I run match nights.

**Keywords** (100 max, 98 used; comma-separated, no spaces, never repeat the app name)

arena,duel,pvp,multiplayer,gladiator,fighting,1v1,2v2,online,ranked,pixel,brawl,sword,melee,battle

**URLs**

- Support: https://free-the-borough.com/support/
- Marketing: https://free-the-borough.com/
- Privacy policy (App Privacy section): https://free-the-borough.com/privacy/

**Other**

- Copyright: 2026 Free the Borough Games
- Primary category Games, secondary Action; subcategory Action.
- Age rating: answer the questionnaire with cartoon/fantasy violence
  (frequent, the blood is the point) — expect 12+.
- Screenshots: `out/store/apple/01`–`09`, same order as Play. Only the 6.5"
  slot is required; Apple scales it for the other iPhones. No iPad set
  (the app is iPhone-only).
- App preview: `out/store/video/app-preview-886x1920.mp4` into the same
  6.5" slot (it goes first, before the screenshots). Pick the poster frame
  on a kill, not the first frame. Up to three previews per slot; one is
  enough.
- App Review notes: paste the block below into "Notes" under App Review
  Information. No sign-in required, so leave the demo-account fields blank.

**Notes for App Review**

```
Blood in the Sand is a small online duel game made by one developer. Nothing needs an account or a login: the game creates an anonymous player on first launch.

To see it working quickly:

1. First launch shows a short five-page rules walkthrough. Skip or read it, then tap PLAY.
2. PRACTICE runs fully offline against bots. Pick a weapon and abilities, tap ARM YOURSELF, and a match starts. This works with no network at all.
3. RANKED needs the server. Tap RANKED, choose 1v1, and queue. If nobody else is queued a match still starts within about 20 seconds. Accept the match when the sheet appears (15 second timer).
4. SKIRMISH is private rooms with a passcode. Create a room and tap START NOW to fill the empty seats with bots, so it can be tested by one person.
5. STORY is intentionally locked until 31 October 2026. Tapping the card shakes it. That is by design, not a bug.

In-app purchases: the shop is the purse at the top of any menu screen. It sells packs of "Signets" (consumable), spent on cosmetic and loadout items. Nothing purchased affects damage or health. Sandbox purchases work with a normal sandbox Apple ID.

Sign in with Apple is optional (Settings > SIGN IN, or the ring beside the purse). It only links purchases to an account so they can be restored on another phone. Everything works without it. Account deletion is in Settings > DELETE ACCOUNT and at https://free-the-borough.com/delete-account/.

The game is portrait only, iPhone only. Blood and fantasy violence throughout, matching the age rating.

Contact for anything: freetheborough.games@gmail.com
```

## The screenshots (v2)

In order. Google shows the first two or three before the fold, Apple the
first three (after the video), so the strip has to sell on its own.

| # | Card | Footage |
|---|------|---------|
| 01 | Someone dies every round | Obelisk, six-way, a kill mid-spray |
| 02 | Blood stays on the sand | Horde challenge, the floor painted after a streak |
| 03 | Dodge it or wear it | First Blood, two windup arcs on screen |
| 04 | Bring a mate | Ancient Rites 2v2, first blood |
| 05 | Last one standing | Ancient Rites six-way, blood everywhere |
| 06 | Different arenas, different cover | Obelisk, the obelisks and the cliff |
| 07 | Choose your arms | War Table weapon grid, in a phone frame |
| 08 | The bots don't go easy | Tom losing to the Godlike bot: ROUND LOST, slain by Oenomaus |
| 09 | A note from the dev | no gameplay |

Headline direction settled 2026-10-22 ("Stakes"): every card is a dare
about dying rather than a rule of the game. The windup mechanic is one
card, framed as a dare, not the lead. Tom's note on the first v2 pass:
"I don't know if the point behind an attack windup is really UMPH enough
to get people to install."

Rules that still hold: captions are evergreen (no counts, mode names or
roster items in any image; those live in the description, which is
editable in seconds). The one exception by design is card 07, which is a
real screen and shows the weapon grid as it is; re-pull its frame when the
roster changes (`bun run render:store -- --only 07-arms`).

To swap a card's moment: change `at` (seconds into the clip), `zoom` and
`focus` (where the fight is, as fractions of the picture) in
`src/data/store.ts`, then re-render that slug. New footage goes through
the Desk's Drive folder as usual; the cleaned-up cuts there have the nav
bar already shaved.

## The store preview video

One cut, two renders, defined as `PREVIEW_BEATS` in `src/data/store.ts`:
five stretches of real matches (5s each, one line per beat, the whole
screen in view with barely any zoom), then a 3.5s card. 28.5s total. The
first pass had seven 3s beats zoomed in; Tom (10-22): "too many cuts, and
the video is quite zoomed in" — if it needs tightening again, cut beats
rather than shortening them.

- **App Store Connect:** `app-preview-886x1920.mp4`. Apple's rules: 15–30s,
  H.264 ≤30fps, ≤500MB, 886×1920 for every current iPhone class, and
  previews may only use footage captured in the app (overlaid text is
  fine; ours is footage from the first frame to the end card). Upload it
  into the 6.5" slot next to the screenshots. It autoplays muted in
  search, so the first beat is the kill, not a title.
- **Google Play:** `play-promo-1920x1080.mp4` goes on YouTube first
  (unlisted is fine; it must be embeddable, not age-restricted, and with
  ads and monetisation off), then the link goes into Play Console →
  Store listing → Video. Landscape because Play's player is 16:9; the
  portrait footage sits in the middle over a blurred fill with the line
  beside it. Once a video is set, the feature graphic becomes its cover.
- The footage keeps its own sound, with a song from the game underneath
  (`PREVIEW_MUSIC`). Swap the song or set the file to empty to drop it.

## Apple's Asset Library (product page header + search results)

App Store Connect grew an Asset Library on 2026-10-05 with two new
placements, and neither takes a preview or a screenshot size (Tom got
"invalid dimensions" trying both, 10-22). `--assets` renders all four:

| Placement | Spec | Files |
|---|---|---|
| Product page header | 21:9, exactly 3840×1646; image (jpg/png, no alpha) or video 5–30s, 30/60fps, loops, muted by default (people can unmute) | `header-3840x1646.png`, `header-3840x1646.mp4` |
| Search results | 3:2, 1920×1280 up to 3840×2560; same rules, video always muted | `search-3840x2560.png`, `search-3840x2560.mp4` |

Both videos are the preview beats (25s) cover-cropped to the wide frame
around each beat's `focus`, with no end card because they loop. On a
phone the header is a strip the width of the page, so the fight fills it
rather than sitting as a small phone screen in the middle. The search
card carries one line per beat up top (Apple keeps roughly the middle
64% × 70% of the frame safe on every device; the lines sit inside
that); the header carries none, it sits under the app's own name. The
stills are one frame of the same crop (`BANNER_STILL` in
`src/data/store.ts`), the search still with "One life a round".

Upload: App Store Connect → the app → Asset Library → add the file and
pick the placement; submit the assets for review on their own (they
don't need a build). Apple's preview tool there shows the crop on each
device and in Dark Mode, so check the fight is inside the safe area
before submitting. Processing can take a while; a header can sit at
"processing" in one localisation and hold up the release.

Also new in Apple's screenshot spec: the required slot is now "iPhone
with Dynamic Island (medium)" (1179×2556 or 1206×2622); the 1284×2778 set
is still accepted (Face ID large) and Apple scales from it, so nothing
to re-upload unless Connect asks.

## Reading the numbers (what "woeful" actually measures)

- Play Console → Store performance: **store listing conversion rate**
  (visitors → installers), split by traffic source. Search traffic
  converts on the first screenshot strip and the video; Explore traffic
  on the icon and title. A rough bar for a small action game is a quarter
  to a third of visitors installing; well under a tenth means the page is
  the problem, not the traffic.
- App Store Connect → Analytics: **product page views → conversion rate**,
  and impressions → page views for the icon + subtitle.
- Don't guess which page is better, test it: Play Console → Store listing
  experiments can A/B the screenshots, feature graphic and short
  description against the live ones with real traffic (needs a few
  hundred visitors per arm to say anything). Apple's equivalent is
  Product Page Optimization under the app's App Store tab. Run v2 as the
  variant against v1 rather than replacing it blind, if the traffic is
  there; if it isn't, ship v2 and watch the rate for two weeks.

## Notes for the Play Console form

- Voice: first person, plain, a bit British, honest about what's in it.
  No ALL-CAPS section headers, no slogan triplets ("Dodge it, tank it,
  return it") — Tom flagged the first draft as reading "very AI" (09-07).
- The solo-dev angle is deliberate and on the images: the feature graphic
  carries a MADE BY ONE PERSON chip and screenshot 09 is a first-person
  note from Tom with the studio wordmark + Discord. People back a person.
- Category: Games › Action. Tags: PvP, Arena, Multiplayer, Pixel art.
- Contains ads: no. In-app purchases: yes (Signet packs).
- The feature graphic is also cropped and rounded on some Play surfaces
  and is the promo video's cover; the render keeps the name and the
  helmet inside the middle 80%.
