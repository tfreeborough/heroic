# Blood in the Sand — store listing copy

Status: **drafted 2026-09-07** for the Google Play closed-testing listing;
the same text serves the App Store (its subtitle = the short description,
trimmed to 30 chars: "Quick, bloody 1v1 duels"). Assets render from
`apps/bits-promos` (`bun run render:store` → `out/store/`): the 1024×500
feature graphic + six 1080×1920 gameplay screenshots defined in
`src/data/store.ts`, plus a seventh "note from the dev" card (`DEV_NOTE`). Keep the pitch here and in that file in step.

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
