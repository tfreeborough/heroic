# Blood in the Sand — store listing copy

Status: **drafted 2026-09-07** for the Google Play closed-testing listing
(submitted for review 2026-09-08); the App Store fields below added
2026-09-08. Assets render from `apps/bits-promos` (`bun run render:store`
→ `out/store/`): the 1024×500 feature graphic + six 1080×1920 gameplay
screenshots defined in `src/data/store.ts`, plus a seventh "note from the
dev" card (`DEV_NOTE`). `bun run render:store -- --apple` renders the same
seven cards at 1284×2778 into `out/store/apple/` for App Store Connect's
6.5" iPhone slot (it only accepts 1242×2688 / 1284×2778, either way up).
Keep the pitch here and in that file in step.

## App name (30 max)

Blood in the Sand

## Short description (80 max)

A quick, bloody arena game. Duel alone or with a mate. One life per round.

## Full description (4000 max)

Blood in the Sand is a small gladiator duel game I've been making on my own. Two players (or teams of two) drop into a sandy arena, pick a weapon and a few abilities, and fight until one side is dead. Rounds are short, a match is over in a few minutes, and then you queue again.

There's no aiming. Your attacks go at whoever's nearest, and every attack has a windup you can see coming. So the whole game is spacing and timing: do you dash through it, block it, or step out of the way and hit them while they're recovering?

You die once and you're out for the round. First to three rounds wins. If two people spend too long circling each other, the arena starts shrinking and anyone left outside it starts bleeding, which sorts things out quickly.

What's in it right now:

- Ranked 1v1 and 2v2, with a solo queue for 2v2 if you haven't got a mate around
- Private rooms with a passcode for playing friends, up to 4v4, plus a six-player free-for-all
- Practice against bots. The easy ones are genuinely bad at the game. The hard ones will beat you.
- A big map of achievements (I call them deeds) for things like winning on your last sliver of health, or killing the person who just killed your teammate
- Blood that stays on the sand for the whole match, footprints through it, and a crowd that gets loud when something happens

It's free. There's a shop with some extra weapons, abilities and announcer voices. You can buy the currency for it with real money or earn it by playing. Nothing in there makes you hit harder, it just gives you more things to build with.

A game like this only works if there are people to fight, so if you like it, tell someone. There's a Discord where I run match nights and post patch notes: discord.gg/8FHgBmaSnT

Made in the evenings by one person. Bugs and strong opinions about balance are both welcome.

## App Store Connect fields

Same description as above (Apple's field is also 4000). The rest:

**Subtitle** (30 max, 25 used)

Short, bloody arena duels

**Promotional text** (170 max, 163 used — editable any time without a new build)

One life a round, no aiming, every attack telegraphed. A duel game about timing, made by one person in the evenings. Free, with a Discord where I run match nights.

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
- Screenshots: `out/store/apple/01`–`07`, same order as Play. Only the 6.5"
  slot is required; Apple scales it for the other iPhones. No iPad set
  (the app is iPhone-only).
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

## Notes for the Play Console form

- Voice: first person, plain, a bit British, honest about what's in it.
  No ALL-CAPS section headers, no slogan triplets ("Dodge it, tank it,
  return it") — Tom flagged the first draft as reading "very AI" (09-07).
- The solo-dev angle is deliberate and on the images: the feature graphic
  carries a MADE BY ONE PERSON chip and screenshot 07 is a first-person
  note from Tom with the studio wordmark + Discord. People back a person.
- Category: Games › Action. Tags: PvP, Arena, Multiplayer, Pixel art.
- Contains ads: no. In-app purchases: yes (Signet packs).
- The feature graphic is also cropped and rounded on some Play surfaces;
  the render keeps the name and the helmet inside the middle 80%.
- Image captions stay EVERGREEN: spectacle and the rules that never change
  (one life, no aim, the crowd, the blood). No counts, mode names or roster
  in any image — those go stale every patch and images cost a rerender;
  the description text carries the specifics because it is editable in
  the console in seconds.
- Screenshots 01–06 are cut from the hand-recorded promo footage. Swap in
  real phone captures of the War Table, Deed Map, Armory and the mode-select
  cards as they exist — add a PNG under `apps/bits-promos/public/` and a
  `StoreShotSpec` entry, then `bun run render:store -- --only <slug>`.
