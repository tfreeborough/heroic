/**
 * The arm clock (bits-arm-clock.md): a thin bar across the top of a ranked
 * arming lobby that drains over the 60 s arm deadline — green → amber → red →
 * flashing red — so nobody gets voided (and locked out) for a rule they
 * couldn't see. RoomScreen mounts it once, above the picker takeover and the
 * SAME ARMS offer, only while the player is unarmed.
 *
 * It owns a band under the safe-area inset (ARM_CLOCK_BAND tall) and
 * RoomScreen pushes every arming view down by that much while it shows — the
 * bar gets real breathing room instead of squeezing into the old top gap.
 * Colour is never the only signal: the red band adds a seconds readout. The first few ranked lobbies on a device also get a plain line
 * saying how long you have.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { playSound } from "../audio";
import { loadArmClockHints, saveArmClockHints } from "../settings";

/** Colour bands, by seconds left. */
const AMBER_AT_SEC = 30;
const RED_AT_SEC = 15;
const FLASH_AT_SEC = 10;
/** The warning tick plays on each of these last seconds. */
const TICK_FROM_SEC = 5;
/** How many ranked lobbies show the first-timer line before it retires. */
const ARM_CLOCK_HINT_LOBBIES = 3;

/** Band geometry: gap above the bar, the bar, gap, the label line. The label
 * line is always reserved so the layout never jumps when the copy changes. */
const TOP_GAP = 16;
const BAR_H = 6;
const LABEL_GAP = 8;
const LABEL_H = 16;
/** How far RoomScreen shifts its content down while the clock shows. */
export const ARM_CLOCK_BAND = TOP_GAP + BAR_H + LABEL_GAP + LABEL_H;

const C_GREEN = "#5fb04a";
const C_AMBER = "#e0a23a";
const C_RED = "#d94141";

export const ArmClock = ({ endsAtMs, totalSec }: { endsAtMs: number; totalSec: number }) => {
  const insets = useSafeAreaInsets();

  // Bands and the readout only need ~5 Hz; the fill itself drains natively.
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(force, 200);
    return () => clearInterval(id);
  }, []);
  const leftSec = Math.max(0, (endsAtMs - performance.now()) / 1000);
  const leftCeil = Math.ceil(leftSec);

  // The drain: one linear native timing from the current fraction to empty,
  // restarted only if the deadline itself moves (a rejoin's fresh welcome).
  const fill = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const leftMs = Math.max(0, endsAtMs - performance.now());
    fill.setValue(Math.min(1, leftMs / (totalSec * 1000)));
    const anim = Animated.timing(fill, { toValue: 0, duration: leftMs, easing: Easing.linear, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [endsAtMs, totalSec, fill]);

  const flashing = leftSec <= FLASH_AT_SEC;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!flashing) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 280, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [flashing, pulse]);

  const lastTick = useRef(0);
  useEffect(() => {
    if (leftCeil >= 1 && leftCeil <= TICK_FROM_SEC && leftCeil !== lastTick.current) {
      lastTick.current = leftCeil;
      playSound("armClockTick");
    }
  }, [leftCeil]);

  // Count this lobby against the first-timer allowance once, on mount.
  const [hint, setHint] = useState(false);
  useEffect(() => {
    let live = true;
    void loadArmClockHints().then((seen) => {
      if (!live || seen >= ARM_CLOCK_HINT_LOBBIES) return;
      setHint(true);
      saveArmClockHints(seen + 1);
    });
    return () => {
      live = false;
    };
  }, []);

  const colour = leftSec <= RED_AT_SEC ? C_RED : leftSec <= AMBER_AT_SEC ? C_AMBER : C_GREEN;
  const label =
    leftSec <= RED_AT_SEC ? `${leftCeil}s` : hint ? `You have ${totalSec} seconds to pick your loadout` : null;

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + TOP_GAP }]}>
      <Animated.View style={[styles.track, { opacity: pulse }]}>
        <Animated.View style={[styles.fill, { backgroundColor: colour, transform: [{ scaleX: fill }] }]} />
      </Animated.View>
      {label !== null ? <Text style={[styles.label, { color: leftSec <= RED_AT_SEC ? C_RED : "#e8dcc4" }]}>{label}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  // 24 pt side gutters line the bar up with the war table's grid and headings.
  wrap: { position: "absolute", left: 24, right: 24, alignItems: "center" },
  track: { alignSelf: "stretch", height: BAR_H, borderRadius: BAR_H / 2, backgroundColor: "#2a241d", overflow: "hidden" },
  fill: { flex: 1, transformOrigin: "0% 50%" },
  label: {
    marginTop: LABEL_GAP,
    fontSize: 12,
    lineHeight: LABEL_H,
    fontWeight: "700",
    letterSpacing: 0.3,
    fontVariant: ["tabular-nums"],
  },
});
