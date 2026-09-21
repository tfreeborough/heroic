/**
 * A finisher as a grid card (bits-cosmetics.md § F2/F3) — the ItemTile's
 * sibling: same card, same footer typography, but the art is a STILL of the
 * finisher itself (FinisherPreview) instead of a forged icon. The wardrobe
 * wears from it; the Armory sells from it.
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { FINISHER_NONE, type FinisherId } from "@heroic/blood-in-the-sand-sim";
import { FINISHER_CATALOGUE } from "../game/finisherStage";
import { C_BONE, C_GOLD, C_MUTED } from "../loadout/catalogue";
import { FinisherPreview } from "./FinisherPreview";

/** The still's frame, as a fraction of the tile's inner width. */
const ART_ASPECT = 0.7;
/** The tile's radius (12) inside its 1.5pt border — ItemTile's band radius. */
const ART_RADIUS = 10.5;

export const finisherName = (id: FinisherId): string =>
  id === FINISHER_NONE ? "NONE" : FINISHER_CATALOGUE[id].name.toUpperCase();

export interface FinisherTileProps {
  id: FinisherId;
  width: number;
  onPress: () => void;
  /** The wardrobe's "this is what you wear" state (gold border + ✓). */
  current?: boolean;
  /** Not yours yet (the earnable one): dimmed art under a padlock line. */
  locked?: boolean;
  /** The line under the name — the price in the Armory, the how in the
   * wardrobe. Style with ItemTile's tileTextStyles. */
  sub?: ReactNode;
}

export const FinisherTile = ({ id, width, onPress, current = false, locked = false, sub }: FinisherTileProps) => {
  const artW = width - 3; // inside the 1.5pt border, the ItemTile band rule
  const artH = Math.round(artW * ART_ASPECT);
  return (
    <Pressable onPress={onPress} style={[styles.tile, { width }, current && styles.tileCur]}>
      <View style={[{ width: artW, height: artH }, locked && styles.artLocked]}>
        {/* NONE is a still too: the plain death, blood and all — a body on
            clean sand read as broken (Tom, 2026-09-20). */}
        <FinisherPreview id={id} width={artW} height={artH} still radius={ART_RADIUS} topOnly />
      </View>
      {/* The finisher's own colour, a hairline under its art (ItemTile's
          category band, turned into an underline — the art owns the top). */}
      <View style={[styles.band, { backgroundColor: id === FINISHER_NONE ? "#3a332a" : FINISHER_CATALOGUE[id].color }, locked && styles.artLocked]} />
      <Text style={[styles.tileName, locked && styles.nameLocked]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {finisherName(id)}
      </Text>
      {sub}
      {current ? <Text style={styles.tileCurBadge}>✓</Text> : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  // ItemTile's card, minus its top padding: the still runs edge to edge.
  tile: {
    alignItems: "center",
    backgroundColor: "#1d1915",
    borderWidth: 1.5,
    borderColor: "#2e2820",
    borderRadius: 12,
    paddingBottom: 9,
    overflow: "hidden",
  },
  tileCur: { borderColor: C_GOLD, backgroundColor: "#26201a" },
  tileCurBadge: {
    position: "absolute",
    top: 4,
    right: 6,
    color: C_GOLD,
    fontSize: 11,
    fontWeight: "900",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 3,
  },
  band: { alignSelf: "stretch", height: 2, marginBottom: 7 },
  tileName: { color: C_BONE, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, paddingHorizontal: 4, marginBottom: 4 },
  nameLocked: { color: C_MUTED },
  artLocked: { opacity: 0.35 },
});
