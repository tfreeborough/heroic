/**
 * A finisher's poster (bits-cosmetics.md § F2/F3): the match preview filling
 * a card, a scrim rising from the bottom edge, and the name + pitch set over
 * it in the finisher's own colour — the wardrobe's hero, the Armory's
 * featured card and its sheet. One component so the three read as one shelf.
 *
 * `live` plays the real scripted kill; without it the poster shows the
 * still. Only ONE live preview may be mounted at a time (FinisherPreview) —
 * the screen decides which poster is the live one.
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Canvas, LinearGradient, RoundedRect, vec } from "@shopify/react-native-skia";
import { FINISHER_NONE, type FinisherId } from "@heroic/blood-in-the-sand-sim";
import { FINISHER_CATALOGUE } from "../game/finisherStage";
import { C_BONE } from "../loadout/catalogue";
import { DISPLAY_FONT } from "../typography";
import { FinisherPreview } from "./FinisherPreview";

const BARE = {
  name: "No finisher",
  pitch: "Your kills fall the plain way. Wear one and it plays over every kill you make, for everyone in the arena.",
  color: "#b8ab95",
};
/** The poster's radius (14) inside its 1pt border. */
const INNER_RADIUS = 13;
/** The scrim's height, as a share of the poster. */
const SCRIM = 0.52;

export interface FinisherPosterProps {
  id: FinisherId;
  width: number;
  height: number;
  live: boolean;
  /** Live only: the kill sting plays for the first couple of loops. Off for
   * a poster nobody asked to see (the Armory's featured card). */
  sound?: boolean;
  /** Small caps over the name ("FEATURED", "WORN"). */
  eyebrow?: string;
  /** Hide the name where the surface already carries it (the Armory sheet's
   * head row) — the poster keeps just the pitch. */
  title?: boolean;
  /** Bottom-right of the text block — the Armory's price. */
  children?: ReactNode;
}

export const FinisherPoster = ({ id, width, height, live, sound = false, eyebrow, title = true, children }: FinisherPosterProps) => {
  const entry = id === FINISHER_NONE ? BARE : FINISHER_CATALOGUE[id];
  const scrimH = Math.round(height * SCRIM);
  // Everything inside is a Skia canvas, which the card's rounded overflow
  // doesn't reliably clip — so each one rounds itself to the inner radius,
  // sized to the box INSIDE the border.
  const w = width - 2;
  const h = height - 2;
  return (
    <View style={[styles.poster, { width, height, borderColor: `${entry.color}66` }]}>
      {/* The still's camera leans out to the poster's size: the tile zoom is
          for a 110pt tile, a poster wants the kill about match-sized. */}
      <FinisherPreview id={id} width={w} height={h} still={!live} sound={sound} zoom={0.62} radius={INNER_RADIUS} />
      <Canvas style={[styles.scrim, { width: w, height: scrimH }]} pointerEvents="none">
        {/* Rounded at the bottom only: the rect starts above the canvas, so
            its top corners are clipped away square. */}
        <RoundedRect x={0} y={-INNER_RADIUS} width={w} height={scrimH + INNER_RADIUS} r={INNER_RADIUS}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, scrimH)}
            colors={["rgba(14,12,10,0)", "rgba(14,12,10,0.72)", "rgba(14,12,10,0.94)"]}
            positions={[0, 0.5, 1]}
          />
        </RoundedRect>
      </Canvas>
      <View style={styles.text} pointerEvents="none">
        <View style={styles.textMain}>
          {eyebrow !== undefined ? <Text style={[styles.eyebrow, { color: entry.color }]}>{eyebrow}</Text> : null}
          {title ? (
            <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {entry.name.toUpperCase()}
            </Text>
          ) : null}
          <Text style={styles.pitch} numberOfLines={3}>
            {entry.pitch}
          </Text>
        </View>
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  poster: { borderRadius: 14, borderWidth: 1, overflow: "hidden", backgroundColor: "#0e0c0a" },
  scrim: { position: "absolute", left: 0, bottom: 0 },
  text: { position: "absolute", left: 14, right: 14, bottom: 12, flexDirection: "row", alignItems: "flex-end", gap: 10 },
  textMain: { flex: 1, gap: 3 },
  eyebrow: { fontSize: 9.5, fontWeight: "900", letterSpacing: 3 },
  name: { color: C_BONE, fontSize: 24, fontFamily: DISPLAY_FONT, letterSpacing: 1.5 },
  pitch: { color: "#d8cfbe", fontSize: 12.5, lineHeight: 17.5 },
});
