/**
 * Sync everything the promo videos need from the real game into public/:
 *
 *  - the pixel-art icon PNGs (weapons + abilities)
 *  - the app icon + Cinzel font
 *  - src/data/roster.json, generated from the LIVE sim config — names,
 *    cooldowns, charges, reach etc. can never drift from the shipped game —
 *    plus each item's one-liner, the same quote the War Table codex shows.
 *
 * Run via `bun run sync` (every studio/render script runs it first).
 */
import { cpSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  WEAPONS,
  WEAPON_IDS,
  ABILITIES,
  ABILITY_IDS,
} from "@heroic/blood-in-the-sand-sim";
import { ABILITY_CODEX, WEAPON_CODEX } from "../../blood-in-the-sand/src/loadout/catalogue";

const here = import.meta.dir;
const appRoot = join(here, "..");
const gameAssets = join(appRoot, "../blood-in-the-sand/assets");
const pub = join(appRoot, "public");

mkdirSync(join(pub, "assets/fonts"), { recursive: true });
mkdirSync(join(pub, "clips"), { recursive: true });
cpSync(join(gameAssets, "icons"), join(pub, "assets/icons"), { recursive: true });
cpSync(
  join(gameAssets, "fonts/Cinzel-Bold.ttf"),
  join(pub, "assets/fonts/Cinzel-Bold.ttf"),
);
cpSync(
  join(gameAssets, "blood-in-the-sand-icon.png"),
  join(pub, "assets/app-icon.png"),
);
// The title-screen arena painting — the store feature graphic's backdrop.
cpSync(join(gameAssets, "home/home.png"), join(pub, "assets/home.png"));
// The deed emblems + rank badges: the sign-off's "look how much is in here" field.
cpSync(join(gameAssets, "deeds"), join(pub, "assets/deeds"), { recursive: true });
cpSync(join(gameAssets, "ranks"), join(pub, "assets/ranks"), { recursive: true });

const num = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

const weapons = WEAPON_IDS.map((id) => {
  const w = WEAPONS[id];
  const stats: [string, string][] = [
    ["STYLE", w.attack.shape === "arc" ? "MELEE ARC" : "PROJECTILE"],
    ["REACH", num(w.attack.reach)],
    ["WINDUP", `${num(w.attack.windup)}s`],
  ];
  if (w.bleed) stats.push(["BLEED", `${num(w.bleed.chance * 100)}%`]);
  return { id, name: w.name, icon: `assets/icons/${id}.png`, tagline: WEAPON_CODEX[id].quote, stats };
});

const abilities = ABILITY_IDS.map((id) => {
  const a = ABILITIES[id];
  return {
    id,
    name: a.name,
    category: a.category,
    icon: `assets/icons/${id}.png`,
    tagline: ABILITY_CODEX[id].quote,
    stats: [
      ["CHARGES", num(a.charges)],
      ["COOLDOWN", `${num(a.cooldown)}s`],
    ] as [string, string][],
  };
});

// Only ship entries whose icon actually exists (future items won't break renders).
const withIcon = <T extends { icon: string; id: string }>(list: T[]) =>
  list.filter((e) => {
    const ok = existsSync(join(pub, e.icon));
    if (!ok) console.warn(`skipping ${e.id} — no icon at public/${e.icon}`);
    return ok;
  });

const pngs = (dir: string) =>
  readdirSync(join(pub, "assets", dir))
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => `assets/${dir}/${f}`);
/** Every piece of item/deed/rank art, for the sign-off's icon field. */
const gallery = [...withIcon(weapons).map((w) => w.icon), ...withIcon(abilities).map((a) => a.icon), ...pngs("deeds"), ...pngs("ranks")];

const roster = { weapons: withIcon(weapons), abilities: withIcon(abilities), gallery };
mkdirSync(join(appRoot, "src/data"), { recursive: true });
writeFileSync(
  join(appRoot, "src/data/roster.json"),
  JSON.stringify(roster, null, 2) + "\n",
);
console.log(
  `synced ${roster.weapons.length} weapons + ${roster.abilities.length} abilities, icons + font + app icon`,
);
