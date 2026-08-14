/**
 * Weapon + ability icons — Asset Forge pre-rendered pixel art (256px
 * palette-quantized cut-out PNGs on transparent, snapped to a 64px grid,
 * apps/blood-in-the-sand/assets/icons/; biggest in-app render is the 52pt
 * codex hero). The art carries its own full-colour palette
 * (docs/design/bits-art-style.md), so icons are never tinted by the caller;
 * category colour lives in the surrounding chrome instead.
 */
import { Image } from "react-native";
import type { AbilityId, WeaponId } from "@heroic/blood-in-the-sand-sim";

export type IconId = WeaponId | AbilityId;

/** Metro asset refs — usable by RN <Image> and Skia's useImage alike. */
export const ICON_SOURCES: Record<IconId, number> = {
  // weapons
  "blade": require("../../assets/icons/blade.png"),
  "bow": require("../../assets/icons/bow.png"),
  "staff": require("../../assets/icons/staff.png"),
  "hammer": require("../../assets/icons/hammer.png"),
  // Forge art owed — harpoon's spear-head stands in until the trident lands.
  "trident": require("../../assets/icons/trident.png"),
  // Forge art owed — the blade stands in until the fang lands (a copy of
  // blade.png; replace the file, the key stays).
  "fang": require("../../assets/icons/fang.png"),
  // Forge art owed — the bow stands in until the scorpion lands (same rule).
  "scorpion": require("../../assets/icons/scorpion.png"),
  // Forge art owed — the sandtrap's charge stands in until the bombard lands.
  "bombard": require("../../assets/icons/bombard.png"),
  // abilities
  "sandtrap": require("../../assets/icons/sandtrap.png"),
  "tremor": require("../../assets/icons/tremor.png"),
  "harpoon": require("../../assets/icons/harpoon.png"),
  "dash": require("../../assets/icons/dash.png"),
  "mirror-guard": require("../../assets/icons/mirror-guard.png"),
  "ironhide": require("../../assets/icons/ironhide.png"),
  "straw-man": require("../../assets/icons/straw-man.png"),
  // Forge art owed — a copy of tremor's boot stands in until the shout lands.
  "warding-shout": require("../../assets/icons/warding-shout.png"),
  "war-drums": require("../../assets/icons/war-drums.png"),
  "blood-font": require("../../assets/icons/blood-font.png"),
  "sandstorm": require("../../assets/icons/sandstorm.png"),
  // Forge art owed — the sandstorm swirl stands in until the sinkhole lands.
  "sinkhole": require("../../assets/icons/sinkhole.png"),
  // Forge art owed — the blood font's pool stands in until the tar lands.
  "tar-pit": require("../../assets/icons/tar-pit.png"),
  // Forge art owed — ironhide's stand stands in until the draught lands.
  "titans-draught": require("../../assets/icons/titans-draught.png"),
};

export interface LoadoutIconProps {
  id: IconId;
  size: number;
}

export const LoadoutIcon = ({ id, size }: LoadoutIconProps) => (
  <Image source={ICON_SOURCES[id]} style={{ width: size, height: size }} resizeMode="contain" />
);
