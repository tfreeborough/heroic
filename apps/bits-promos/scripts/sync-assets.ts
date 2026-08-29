/**
 * Sync everything the promo videos need from the real game into public/:
 *
 *  - the pixel-art icon PNGs (weapons + abilities)
 *  - the app icon + Cinzel font
 *  - src/data/roster.json, generated from the LIVE sim config — names,
 *    cooldowns, charges, reach etc. can never drift from the shipped game.
 *
 * Run via `bun run sync` (every studio/render script runs it first).
 */
import { cpSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  WEAPONS,
  WEAPON_IDS,
  ABILITIES,
  ABILITY_IDS,
} from "@heroic/blood-in-the-sand-sim";

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
  return { id, name: w.name, icon: `assets/icons/${id}.png`, stats };
});

const abilities = ABILITY_IDS.map((id) => {
  const a = ABILITIES[id];
  return {
    id,
    name: a.name,
    category: a.category,
    icon: `assets/icons/${id}.png`,
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

const roster = { weapons: withIcon(weapons), abilities: withIcon(abilities) };
mkdirSync(join(appRoot, "src/data"), { recursive: true });
writeFileSync(
  join(appRoot, "src/data/roster.json"),
  JSON.stringify(roster, null, 2) + "\n",
);
console.log(
  `synced ${roster.weapons.length} weapons + ${roster.abilities.length} abilities, icons + font + app icon`,
);
