/**
 * A finisher, shown by playing it (bits-cosmetics.md § F2/F3). Finishers
 * can't be tried in practice, so THIS is the whole pitch — and a pitch has
 * to look like the game (Tom, 2026-09-20: the first cut, a lone body on a
 * sand swatch, "wouldn't make me want to buy it", and with no death splatter
 * NONE looked broken). Two modes:
 *
 *  - LIVE (default): a real scripted match — FINISHER_KILL_SCENE through the
 *    Primer's rig (real sim, real renderer): an archer drops an advancing
 *    foe; arrow, splatter, death spray, pool, kill shake, and the finisher
 *    over the body. The floor is wiped each loop and the restart hides under
 *    a quick dip to black. ONE LIVE PREVIEW AT A TIME — the renderer's blood
 *    cache is a singleton (see PrimerArena) — so whoever covers a live
 *    preview must unmount it (`still` is the stand-in).
 *  - `still`: one seeded picture of the finisher's signature moment over a
 *    real death splatter (game/finisherStage.ts) — tiles, and the stand-in
 *    above. No frame loop, safe in any number.
 */
import { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Canvas, createPicture, Group, Picture, rect, rrect, Skia, type SkPicture } from "@shopify/react-native-skia";
import { FINISHER_NONE, type FinisherId } from "@heroic/blood-in-the-sand-sim";
import { FINISHER_KILL_SCENE } from "../game/finisherScene";
import { FINISHER_CATALOGUE, FinisherStage, STAGE_LEAD_MS, STAGE_TILE_ZOOM } from "../game/finisherStage";
import { PrimerArena } from "../primer/PrimerArena";

/** Every still of one finisher shares its dice — tiles match sheet to sheet. */
const STILL_SEED = 2;
/** Pictures outlive their last use by a beat: the UI thread may still be
 * replaying one when React is already done with it. */
const disposeSoon = (picture: SkPicture): void => {
  setTimeout(() => picture.dispose(), 120);
};

export interface FinisherPreviewProps {
  id: FinisherId;
  width: number;
  height: number;
  still?: boolean;
  /** Live only: play the kill sting for the first couple of loops
   * (PrimerArena `sound`). */
  sound?: boolean;
  /** Stills only: world → points (default: the tile camera). */
  zoom?: number;
  /** The card's INNER corner radius. The preview rounds itself inside its
   * canvas — a Skia canvas is a native surface that a parent's rounded
   * `overflow: hidden` doesn't reliably clip, so without this the art pokes
   * out past the card's corners (Tom, 2026-09-20). */
  radius?: number;
  /** `radius` rounds only the TOP corners (a tile's art sits over its label). */
  topOnly?: boolean;
  style?: StyleProp<ViewStyle>;
}

const StillPreview = ({ id, width, height, zoom = STAGE_TILE_ZOOM, radius = 0, topOnly = false, style }: FinisherPreviewProps) => {
  const picture = useMemo(() => {
    const stage = new FinisherStage(id, STILL_SEED);
    const at = STAGE_LEAD_MS + (id === FINISHER_NONE ? 600 : FINISHER_CATALOGUE[id].stillAtMs);
    return createPicture((canvas) => stage.draw(canvas, width, height, at, zoom), Skia.XYWHRect(0, 0, width, height));
  }, [id, width, height, zoom]);
  useEffect(() => () => disposeSoon(picture), [picture]);
  return (
    <Canvas style={[{ width, height }, style]} pointerEvents="none">
      {radius > 0 ? (
        // Top-only: the rounded rect runs past the canvas's bottom edge, so
        // its bottom corners are clipped away square (ItemTile's trick).
        <Group clip={rrect(rect(0, 0, width, topOnly ? height + radius : height), radius, radius)}>
          <Picture picture={picture} />
        </Group>
      ) : (
        <Picture picture={picture} />
      )}
    </Canvas>
  );
};

const LivePreview = ({ id, width, height, radius = 0, sound = false, style }: FinisherPreviewProps) => {
  // The loop's seam: fighters teleport and the floor wipes at a restart, so
  // the window dips to black across it like a cut.
  const veil = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(veil, { toValue: 0, duration: 320, useNativeDriver: true }).start();
  }, [veil]);
  const onLoop = (): void => {
    veil.setValue(1);
    Animated.timing(veil, { toValue: 0, duration: 380, delay: 60, useNativeDriver: true }).start();
  };
  return (
    <View style={[{ width, height, backgroundColor: "#0e0c0a", overflow: "hidden", borderRadius: radius }, style]} pointerEvents="none">
      <PrimerArena
        scenario={FINISHER_KILL_SCENE}
        w={width}
        h={height}
        finisher={id}
        sound={sound}
        freshEachLoop
        onLoop={onLoop}
        cornerRadius={radius}
      />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#0e0c0a", opacity: veil, borderRadius: radius }]} />
    </View>
  );
};

export const FinisherPreview = (props: FinisherPreviewProps) =>
  props.still ? <StillPreview {...props} /> : <LivePreview key={props.id} {...props} />;
