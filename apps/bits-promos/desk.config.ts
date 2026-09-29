/**
 * Blood in the Sand's entry in the Desk (apps/desk). Paths are this
 * package's; templates come from desk.templates.ts, loaded only in the
 * browser.
 */
import type { GameConfig } from "../desk/game";
import roster from "./src/data/roster.json";
import { FORMATS, FPS } from "./src/formats";

/**
 * The posting queue's words, in Tom's voice: first person, plain, no
 * slogans. One description for every platform (TikTok and Reels have no
 * title field), a title for Shorts kept under YouTube's 100 characters.
 * Android isn't mentioned until Play approves the listing.
 */
const GAME = "Blood in the Sand";
const ABOUT = "Blood in the Sand is a small gladiator arena game I've been making on my own. Nothing is aimed, everything is a telegraph, and you get one life a round. Free on iOS.";
const ASK = "Come and fight me: discord.gg/8FHgBmaSnT";
const TAGS = "#indiegame #mobilegame #pixelart #pvp #gamedev";
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
const title = (lead: string) => {
  const t = `${lead} | ${GAME}`;
  return t.length <= 100 ? t : clip(lead, 100);
};
const draft = (template: string, props: Record<string, unknown>) => {
  const str = (k: string) => (typeof props[k] === "string" ? (props[k] as string).trim() : "");
  if (template === "WeaponSpotlight" || template === "AbilitySpotlight") {
    const list = template === "WeaponSpotlight" ? roster.weapons : roster.abilities;
    const item = list.find((x) => x.id === str("id"));
    const name = item?.name ?? str("id");
    const line = item?.tagline ? `${item.tagline}\n\n` : "";
    return { title: title(`The ${name}`), description: `${line}The ${name}, as it plays in ${GAME}.\n\n${ABOUT}\n\n${ASK}\n\n${TAGS}` };
  }
  // The match and hook clips: the hook is the lead; the title (a label) is a fallback.
  const lead = str("hook") || str("line") || str("title") || GAME;
  return { title: title(lead), description: `${lead}\n\nReal gameplay, recorded in a match.\n\n${ABOUT}\n\n${ASK}\n\n${TAGS}` };
};

/** The same voice, for Claude to write the variable part of a post (needs
 * ANTHROPIC_API_KEY in apps/desk/.env; the template above is the fallback). */
const ai: NonNullable<GameConfig["post"]>["ai"] = {
  about:
    "A small gladiator duel game made by one person in the evenings. 1v1 or 2v2 in a sandy arena; pick a weapon and a few abilities. There's no aiming: attacks go at whoever's nearest and every attack has a windup you can see coming, so the game is spacing and timing (dash through it, block it, or step out and hit them while they recover). One life a round, first to three rounds. If people circle too long the arena shrinks and anyone outside bleeds. Ranked, private rooms, a six-player free-for-all, bots, achievements called deeds, blood that stays on the sand. Free on iOS.",
  rules:
    "It reads like the maker talking plainly, the way you'd write a Discord post about your own game. Honest about what's in it, a little dry humour, everyday words, no marketing-speak. Not a hype account: no ALL CAPS, no exclamation marks, no three-beat slogans, no coined aphorisms, no symmetrical clauses, no em dashes. Short sentences. The hook on the video is the starting point, not something to improve on with adjectives.",
  examples: [
    "A quick, bloody arena game. Duel alone or with a mate. One life per round.",
    "There's no aiming. Your attacks go at whoever's nearest, and every attack has a windup you can see coming.",
    "Practice against bots. The easy ones are genuinely bad at the game. The hard ones will beat you.",
    "You die once and you're out for the round.",
    "Made in the evenings by one person. Bugs and strong opinions about balance are both welcome.",
    "Come and fight me.",
    "Better with a mate.",
  ],
  boilerplate: `${ABOUT}\n\n${ASK}\n\n${TAGS}`,
  titleSuffix: GAME,
};

const config: GameConfig = {
  id: "bits",
  name: "Blood in the Sand",
  icon: "assets/app-icon.png",
  root: import.meta.dir,
  remotionEntry: "src/index.ts",
  publicDir: "public",
  footageDir: "public/footage",
  rendersDir: "out/desk",
  prepare: [["bun", "scripts/sync-assets.ts"]],
  fps: FPS,
  formats: FORMATS,
  drive: {
    footageFolderId: "1xslGjrceWPdqsBq11wU2wL7OLVi9-h-7",
    footageRemote: "gdrive-footage",
    // Heroic/BITS by id (drive.file scope can't see UI-made folders by path — see README).
    uploadTarget: "gdrive,root_folder_id=1BKUER-5XJJa2kRZZ1NwaTlPl080niB5Q:Promos/Desk",
  },
  templates: () => import("./desk.templates"),
  post: { draft, ai },
};
export default config;
