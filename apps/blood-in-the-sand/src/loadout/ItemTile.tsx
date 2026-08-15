/**
 * The roster tile — one weapon/spell as a tappable grid card: category-glow
 * band (gold for steel), icon, name, an optional sub-line. Extracted from
 * the War Table's grid (RoomScreen) so the Armory sells from the SAME tile
 * players pick from in the lobby (bits-store.md: one codex, two doors —
 * this is the tile half of that rule; CodexBody is the sheet half).
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { Canvas, LinearGradient, RoundedRect, vec } from "@shopify/react-native-skia";
import { ABILITIES, WEAPONS, type AbilityId, type WeaponId } from "@heroic/blood-in-the-sand-sim";
import { CATEGORY_META, categoryOf, C_BONE, C_GOLD, C_MUTED } from "./catalogue";
import { LoadoutIcon, type IconId } from "./icons";

export const TILE_BAND_H = 22;
export const TILE_BAND_LINE = 2;

/** Band colour with an alpha suffix — category colour for spells, gold for
 * steel (all CATEGORY_META colours are plain #rrggbb). */
const bandColor = (id: IconId, alpha: string): string =>
  `${id in WEAPONS ? C_GOLD : CATEGORY_META[categoryOf(id as AbilityId)].color}${alpha}`;

const nameOf = (id: IconId): string =>
  (id in WEAPONS ? WEAPONS[id as WeaponId].name : ABILITIES[id as AbilityId].name).toUpperCase();

export interface ItemTileProps {
  id: IconId;
  width: number;
  onPress: () => void;
  /** The War Table's "this is your current pick" state (gold border + ✓). */
  current?: boolean;
  /** The line under the name — charge pips in the lobby, the price in the
   * Armory. Style with tileTextStyles for the shared typography. */
  sub?: ReactNode;
}

export const ItemTile = ({ id, width, onPress, current = false, sub }: ItemTileProps) => (
  <Pressable onPress={onPress} style={[styles.tile, { width }, current && styles.tileCur]}>
    {/* The category glow (the mode-card Skia idiom): one rounded rect whose
        top corners MATCH the tile's inner radius, so the gradient follows
        the corner curve instead of being cut by the tile's overflow clip.
        Vertically: a bright hairline at the edge falling fast into a soft
        wash, one shader. */}
    <View pointerEvents="none" style={styles.tileBand}>
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Taller than the band view on purpose: RoundedRect only rounds
            uniformly, so the bottom corners are pushed past the canvas clip
            — top corners follow the tile's curve, the sides stay straight
            through the fade. The gradient still dies at TILE_BAND_H
            (clamped past its end). */}
        <RoundedRect x={0} y={0} width={width - 3} height={TILE_BAND_H + 12} r={10.5}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, TILE_BAND_H)}
            colors={[bandColor(id, "e6"), bandColor(id, "45"), bandColor(id, "00")]}
            positions={[0, TILE_BAND_LINE / TILE_BAND_H, 1]}
          />
        </RoundedRect>
      </Canvas>
    </View>
    <LoadoutIcon id={id} size={44} />
    <Text style={styles.tileName} numberOfLines={1}>
      {nameOf(id)}
    </Text>
    {sub}
    {current ? <Text style={styles.tileCurBadge}>✓</Text> : null}
  </Pressable>
);

/** The sub-line typography, shared so every caller's footer matches. */
export const tileTextStyles = StyleSheet.create({
  sub: { color: C_MUTED, fontSize: 8, fontWeight: "800", letterSpacing: 1, fontVariant: ["tabular-nums"] },
  pips: { color: C_GOLD, letterSpacing: 1.5 },
  price: { color: C_GOLD, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
});

const styles = StyleSheet.create({
  tile: {
    alignItems: "center",
    gap: 5,
    backgroundColor: "#1d1915",
    borderWidth: 1.5,
    borderColor: "#2e2820",
    borderRadius: 12,
    paddingTop: 13,
    paddingBottom: 9,
    paddingHorizontal: 4,
    // Clips the band canvas to the rounded corners — the snug-fit rule.
    overflow: "hidden",
  },
  tileBand: { position: "absolute", top: 0, left: 0, right: 0, height: TILE_BAND_H },
  tileCur: { borderColor: C_GOLD, backgroundColor: "#26201a" },
  tileCurBadge: { position: "absolute", top: 3, right: 6, color: C_GOLD, fontSize: 10, fontWeight: "900" },
  tileName: { color: C_BONE, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
});
