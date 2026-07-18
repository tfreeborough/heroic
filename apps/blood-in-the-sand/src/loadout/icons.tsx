/**
 * Weapon + ability icons — Asset Forge woodcut art (256px palette-quantized
 * die-cut PNGs on transparent, apps/blood-in-the-sand/assets/icons/; ~20KB
 * each, biggest in-app render is the 52pt codex hero). The art carries its
 * own palette (bone/ochre/accent on black), so icons are no longer tinted by
 * the caller; category colour lives in the surrounding chrome instead.
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
};

export interface LoadoutIconProps {
  id: IconId;
  size: number;
}

export const LoadoutIcon = ({ id, size }: LoadoutIconProps) => (
  <Image source={ICON_SOURCES[id]} style={{ width: size, height: size }} resizeMode="contain" />
);
