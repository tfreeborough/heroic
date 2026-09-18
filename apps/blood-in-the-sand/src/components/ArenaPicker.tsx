import { useMemo, useRef, type ReactNode } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import { ARENAS } from "@heroic/blood-in-the-sand-sim";
import { ARENA_CARD_IMAGES } from "../game/arenaCards.generated";
import { DISPLAY_FONT } from "../typography";

export interface ArenaPickerProps {
  /** The arenas on offer, in order: the whole registry for practice, the
   *  rotation for a skirmish host (bits-arenas.md § Picker cards). */
  ids: readonly string[];
  /** The pick — null is RANDOM. */
  value: string | null;
  onChange: (id: string | null) => void;
}

/**
 * The map picker: a sideways row of cards, RANDOM first, each arena showing
 * its rendered map (assets/arenas, `bun run arena:cards` in Realmsmith) with
 * its name across the foot of the art. An arena with no card yet — freshly made, script not re-run —
 * still gets a plain named card, so a new map is never unpickable. The row
 * scrolls; the last card peeking past the edge is the cue that it does.
 */
export const ArenaPicker = ({ ids, value, onChange }: ArenaPickerProps) => {
  // RANDOM wears a strip of every map on offer — it's "one of these".
  const strips = ids.map((id) => ARENA_CARD_IMAGES[id]).filter((img): img is number => img !== undefined);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroller} contentContainerStyle={styles.row}>
      <Card name="Random" on={value === null} onPress={() => onChange(null)}>
        <View style={styles.strips}>
          {strips.map((img, i) => (
            <Image key={i} source={img} resizeMode="cover" style={styles.strip} />
          ))}
        </View>
        <View style={styles.randomVeil}>
          <Text style={styles.randomMark}>?</Text>
        </View>
      </Card>
      {ids.map((id) => {
        const img = ARENA_CARD_IMAGES[id];
        return (
          <Card key={id} name={ARENAS[id]?.name ?? id} on={value === id} onPress={() => onChange(id)}>
            {img !== undefined ? <Image source={img} resizeMode="cover" style={styles.art} /> : null}
          </Card>
        );
      })}
    </ScrollView>
  );
};

const Card = ({
  name,
  on,
  onPress,
  children,
}: {
  name: string;
  on: boolean;
  onPress: () => void;
  children: ReactNode;
}) => {
  // Taps are read from RAW TOUCHES on a Manual gesture, not a Pressable. While
  // the row is still gliding the scroll view owns the touch — it catches the
  // glide and the press never reaches a Pressable, so picking a card you'd
  // just flicked into view took two taps. Raw touches arrive per handler,
  // before and regardless of that arbitration (the AbilityButton lesson), so
  // we time the tap ourselves: down and up close together in SCREEN space (the
  // card moves under a dragging finger, so card-local coords can't tell a tap
  // from a scroll). A touch that stops a glide now also picks what it landed on.
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  // The parent hands a fresh onPress every render; read it through a ref so
  // the gesture is built once and never swapped out mid-touch.
  const press = useRef(onPress);
  press.current = onPress;
  const tap = useMemo(
    () =>
      Gesture.Manual()
        .runOnJS(true)
        .onTouchesDown((e) => {
          const f = e.allTouches[0];
          down.current = f && e.numberOfTouches === 1 ? { x: f.absoluteX, y: f.absoluteY, t: Date.now() } : null;
        })
        .onTouchesUp((e) => {
          const d = down.current;
          const f = e.changedTouches[0];
          down.current = null;
          if (!d || !f || Date.now() - d.t > TAP_MAX_MS) return;
          if (Math.hypot(f.absoluteX - d.x, f.absoluteY - d.y) > TAP_SLOP) return;
          press.current();
        })
        .onTouchesCancelled(() => {
          down.current = null;
        }),
    [],
  );
  // The rounding lives on a plain View, which clips the art to the card.
  return (
    <GestureDetector gesture={tap}>
      <View style={styles.card} collapsable={false}>
        {children}
        {/* Unpicked maps sit back under a veil so the pick reads at a glance. */}
        {on ? null : <View style={styles.offVeil} />}
        {/* The name rides the art on a stepped scrim — a cheap fade to black. */}
        <View style={styles.scrim}>
          <View style={styles.scrimSoft} />
          <View style={styles.scrimMid} />
          <View style={styles.scrimDeep}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.name, on && styles.nameOn]}>
              {name.toUpperCase()}
            </Text>
            <View style={[styles.underline, on && styles.underlineOn]} />
          </View>
        </View>
        {/* The border is a ring drawn OVER the art, so nothing can poke past it. */}
        <View style={[styles.ring, on && styles.ringOn]} />
      </View>
    </GestureDetector>
  );
};

/** A tap: finger up within this long and this far (screen px) of where it landed. */
const TAP_MAX_MS = 350;
const TAP_SLOP = 10;

const CARD_W = 124;
const CARD_H = 150;
const RADIUS = 12;
const NAME_SPACING = 1.5;

const fill = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

const styles = StyleSheet.create({
  // Bleed to the parent's edge isn't worth the coupling — the row just clips
  // at the content width and the peeking card says "there's more".
  scroller: { flexGrow: 0 },
  row: { gap: 10 },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: RADIUS,
    backgroundColor: "#2b251e",
    overflow: "hidden",
  },
  // The art carries the radius itself as well — belt and braces on Android,
  // where a parent's overflow clip and an Image don't always agree.
  art: { ...fill, width: CARD_W, height: CARD_H, borderRadius: RADIUS },
  strips: { ...fill, flexDirection: "row", borderRadius: RADIUS, overflow: "hidden" },
  strip: { flex: 1, height: CARD_H },
  randomVeil: {
    ...fill,
    backgroundColor: "rgba(20, 18, 16, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 28, // optically centred in the art above the name
  },
  randomMark: {
    fontFamily: DISPLAY_FONT,
    color: "#f5ede0",
    fontSize: 44,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  offVeil: { ...fill, backgroundColor: "rgba(20, 18, 16, 0.45)" },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0 },
  scrimSoft: { height: 10, backgroundColor: "rgba(12, 10, 8, 0.25)" },
  scrimMid: { height: 10, backgroundColor: "rgba(12, 10, 8, 0.5)" },
  scrimDeep: {
    backgroundColor: "rgba(12, 10, 8, 0.78)",
    paddingTop: 4,
    paddingBottom: 10,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  // Full width + textAlign, not a shrink-wrapped Text: and letterSpacing pads
  // the LAST letter too, so the same gap goes on the left to keep it centred.
  name: {
    alignSelf: "stretch",
    textAlign: "center",
    paddingLeft: NAME_SPACING,
    fontFamily: DISPLAY_FONT,
    color: "#cfc4b0",
    fontSize: 12,
    letterSpacing: NAME_SPACING,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  nameOn: { color: "#f3d48e" },
  underline: { marginTop: 5, height: 2, width: 22, borderRadius: 1, backgroundColor: "transparent" },
  underlineOn: { backgroundColor: "#d9b46a" },
  ring: { ...fill, borderRadius: RADIUS, borderWidth: 1, borderColor: "rgba(138, 109, 68, 0.55)" },
  ringOn: { borderWidth: 2, borderColor: "#d9b46a" },
});
