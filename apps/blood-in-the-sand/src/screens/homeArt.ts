/**
 * The forged home backdrop (Asset Forge `home-bits`, bits-art-style.md):
 * a full-bleed 1024×1536 portrait scene that phones cover-crop at runtime.
 * Null until forged — HomeScreen falls back to the hand-painted Skia High
 * Sun scene (homeScene.ts) so the front door never goes dark. Paste the
 * forge's require line over the null (the titleSprites.ts pattern).
 */
import type { ImageSourcePropType } from "react-native";

export const HOME_ART: Record<string, ImageSourcePropType | null> = {
  home: require("../../assets/home/home.png"),
};
