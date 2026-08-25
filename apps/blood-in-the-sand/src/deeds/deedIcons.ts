/**
 * Deed icon sources (achievements.md § icon art), keyed by the defs' `icon`
 * field. Two families:
 * - Deed-specific emblems forged in Realmsmith (deed-bits type) — null until
 *   the PNG lands in assets/deeds; the forge's save step hands back the
 *   exact replacement line (paste it — a forged PNG that stays null here
 *   is invisible in-game while Realmsmith still ticks it done).
 * - Cast/weapon chains REUSE the loadout icons (recognition beats novelty,
 *   and it saves ~45 generations) — derived from the roster, so new sim
 *   content wires its own map icon automatically.
 *
 * A null (or unknown) key renders as the bare medallion — the map never
 * breaks on missing art.
 */
import { useMemo } from "react";
import { useImage, type SkImage } from "@shopify/react-native-skia";
import { ABILITY_IDS, WEAPON_IDS } from "@heroic/blood-in-the-sand-sim";
import { ICON_SOURCES } from "../loadout/icons";

export const DEED_ICONS: Record<string, number | null> = {
  // Forged deed emblems (Realmsmith → Asset Forge → deed-bits) — the save
  // step pastes require() lines here, replacing null.
  "deed-first-match": require("../../assets/deeds/deed-first-match.png"),
  "deed-wins": require("../../assets/deeds/deed-wins.png"),
  "deed-kills": require("../../assets/deeds/deed-kills.png"),
  "deed-win-streak": require("../../assets/deeds/deed-win-streak.png"),
  "deed-loss-streak": require("../../assets/deeds/deed-loss-streak.png"),
  "deed-glory": require("../../assets/deeds/deed-glory.png"),
  "deed-damage": require("../../assets/deeds/deed-damage.png"),
  "deed-healing": require("../../assets/deeds/deed-healing.png"),
  "deed-untouched": require("../../assets/deeds/deed-untouched.png"),
  "deed-lifeblood": require("../../assets/deeds/deed-lifeblood.png"),
  // Wave-2 feats (forged 2026-08-08, wired 2026-08-24 — the require lines
  // were never pasted after the forge, so these rendered iconless).
  "deed-thread": require("../../assets/deeds/deed-thread.png"),
  "deed-reflect": require("../../assets/deeds/deed-reflect.png"),
  "deed-standing": require("../../assets/deeds/deed-standing.png"),
  "deed-flawless": require("../../assets/deeds/deed-flawless.png"),
  "deed-old-ways": require("../../assets/deeds/deed-old-ways.png"),
  "deed-carnage": require("../../assets/deeds/deed-carnage.png"),
  "deed-crits": require("../../assets/deeds/deed-crits.png"),
  "deed-comeback": require("../../assets/deeds/deed-comeback.png"),
  // Wave-3: the 2v2 board (achievements.md § Wave-3) — forged 2026-08-24,
  // the same day as the defs (deedSet derives the rows; briefs in the style
  // bible).
  "deed-two-blades": require("../../assets/deeds/deed-two-blades.png"),
  "deed-duo-wins": require("../../assets/deeds/deed-duo-wins.png"),
  "deed-assists": require("../../assets/deeds/deed-assists.png"),
  "deed-revenge": require("../../assets/deeds/deed-revenge.png"),
  "deed-clutch": require("../../assets/deeds/deed-clutch.png"),
  "deed-double-kill": require("../../assets/deeds/deed-double-kill.png"),
  "deed-concert": require("../../assets/deeds/deed-concert.png"),
  "deed-ambush": require("../../assets/deeds/deed-ambush.png"),
  "deed-swift-vengeance": require("../../assets/deeds/deed-swift-vengeance.png"),
  "deed-last-word": require("../../assets/deeds/deed-last-word.png"),
  "deed-shieldwall": require("../../assets/deeds/deed-shieldwall.png"),
  "deed-matching-set": require("../../assets/deeds/deed-matching-set.png"),
  "deed-selfless": require("../../assets/deeds/deed-selfless.png"),
  "deed-even-split": require("../../assets/deeds/deed-even-split.png"),
  "deed-meat-shield": require("../../assets/deeds/deed-meat-shield.png"),
  "deed-along-for-the-ride": require("../../assets/deeds/deed-along-for-the-ride.png"),
  "deed-nobodys-hero": require("../../assets/deeds/deed-nobodys-hero.png"),
  // Loadout-icon reuse — derived, never forged as deeds.
  ...Object.fromEntries(WEAPON_IDS.map((w) => [`deed-rounds-${w}`, ICON_SOURCES[w]])),
  ...Object.fromEntries(ABILITY_IDS.map((a) => [`deed-casts-${a}`, ICON_SOURCES[a]])),
};

/** Static, module-frozen entry list — what makes the hook below legal. */
const DEED_ICON_ENTRIES = Object.entries(DEED_ICONS);

/**
 * Decode every available deed icon into Skia images for the map's picture.
 * The entry list is module-static, so the useImage calls are a fixed-order,
 * fixed-length hook sequence — safe despite the loop. The returned Map is
 * memoized on the loaded images, so the map picture only re-records as
 * decodes actually land.
 */
export const useDeedIconImages = (): Map<string, SkImage> => {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-order over a module-static list
  const images = DEED_ICON_ENTRIES.map(([, source]) => useImage(source));
  return useMemo(() => {
    const map = new Map<string, SkImage>();
    DEED_ICON_ENTRIES.forEach(([key], i) => {
      const img = images[i];
      if (img) map.set(key, img);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the images ARE the deps, fixed length
  }, images);
};
