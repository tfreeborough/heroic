/**
 * The ranked queue's presence around the app (bits-ranked.md § Queue roaming
 * & match accept). Since 2026-08-25 the queue follows the player: back out
 * of RankedScreen and the line is still yours — the Armory, Deeds, Settings,
 * even the title screen stay open while the matcher works. What every one of
 * those screens needs is the SAME three things — am I queued, how long, and
 * a way back to the ranked home — so they come as a context App provides
 * once, rather than a prop threaded through seven screens.
 *
 * `QueuePill` is the visible half: `IN QUEUE · 1:23`, breathing like the
 * ranked screen's SEARCHING line, tap → RankedScreen. It sits in the shared
 * header (ScreenHeader) and on the title screen; it renders nothing while
 * not queued, so mounting it everywhere costs nothing.
 */
import { createContext, useContext, useEffect, useReducer, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { playSound, unlockAudio } from "../audio";

export interface QueuePresence {
  /** This socket holds a place in line right now (server truth). */
  queued: boolean;
  /** The server's floored wait for the longest of our queued brackets —
   * undefined while not queued. Smooth it with useSmoothWait for display. */
  waitedSec: number | undefined;
  /** Back to the ranked home (App routes; a redial rides along). */
  goToRanked: () => void;
}

export const QueueContext = createContext<QueuePresence>({
  queued: false,
  waitedSec: undefined,
  goToRanked: () => {},
});

export const useQueuePresence = (): QueuePresence => useContext(QueueContext);

export const formatWait = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * The wait timer counts on the LOCAL clock — smooth by definition. The
 * server's waitedSec is floored AND arrives on a 2s beat, so it routinely
 * disagrees with local elapsed by up to ~2s; treating that as drift is what
 * made the digits jump. Anchor once on entry, and re-anchor only on a REAL
 * discontinuity (a void's re-queue that preserved earned wait). The 250ms
 * tick outpaces the second boundary so the display can never skip a digit.
 * (Lifted out of RankedScreen 2026-08-25 so the header pill counts the same.)
 */
export const useSmoothWait = (waitedSec: number | undefined): number => {
  const anchor = useRef<number | null>(null);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  if (waitedSec === undefined) {
    anchor.current = null;
  } else {
    const nowMs = performance.now();
    if (anchor.current === null) {
      anchor.current = nowMs - waitedSec * 1000;
    } else if (Math.abs((nowMs - anchor.current) / 1000 - waitedSec) > 2.5) {
      anchor.current = nowMs - waitedSec * 1000;
    }
  }
  const counting = waitedSec !== undefined;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [counting]);
  return anchor.current === null ? 0 : Math.max(0, Math.floor((performance.now() - anchor.current) / 1000));
};

export const QueuePill = ({ style }: { style?: StyleProp<ViewStyle> }) => {
  const { queued, waitedSec, goToRanked } = useQueuePresence();
  const wait = useSmoothWait(waitedSec);
  const pulse = useRef(new Animated.Value(0)).current;
  // The same breath as RankedScreen's SEARCHING line — one search, one pulse.
  useEffect(() => {
    if (!queued) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [queued, pulse]);
  if (!queued) return null;
  return (
    <Pressable
      onPress={() => {
        unlockAudio();
        playSound("uiTap");
        goToRanked();
      }}
      hitSlop={8}
      style={[styles.pill, style]}
    >
      <Animated.View style={[styles.dot, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }]} />
      <Text style={styles.text}>{`IN QUEUE · ${formatWait(wait)}`}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderColor: "rgba(232,200,122,0.6)",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: "rgba(30,24,16,0.72)",
  },
  // The brand's rationed red: the one live thing in a quiet header.
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#c0392b" },
  text: { color: "#e8c87a", fontSize: 10, fontWeight: "900", letterSpacing: 1.5, fontVariant: ["tabular-nums"] },
});
