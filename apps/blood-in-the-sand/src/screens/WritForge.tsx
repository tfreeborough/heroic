/**
 * The Writ Forge (bits-store.md § the Writ Forge) — the ONE surface where
 * Glory becomes Writs, rebuilt as a ritual (Tom, 2026-08-15: the tap-and-
 * it-happens version was "super underwhelming"; conversion must feel mega
 * premium so forging again is its own reward).
 *
 * The ritual: HOLD to forge. The press charges the seal — heat blooms
 * behind it, the wax runs molten, haptic ticks climb — release early and
 * it cools; hold to full and THE STRIKE falls: stamp slam, spark burst,
 * the Glory count visibly drains, and the finished Writ flies down onto a
 * growing fan of sealed documents. The stack is the point: every forge
 * adds a card you can SEE.
 *
 * Anatomy: `charge` is JS-driven (it feeds width/colour, which the native
 * driver can't animate) — one 850ms value on a menu screen, cheap. The
 * strike/sparks/fly ride native-driver values. Commerce stays in the
 * parent (pure, silent); every sound/haptic lives here with the visuals.
 * The strike fires optimistically at full charge — the ~300ms server
 * round-trip hides entirely inside the 480ms slam — and a refused forge
 * (race/offline) says so in place, nothing charged.
 *
 * Owed from the Forge: writ_exchange_1 (the strike itself — see the brief
 * in audio/catalogue.ts); a charge-loop hiss is a possible later layer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Blur, Canvas, Circle } from "@shopify/react-native-skia";
import { ForgeEmbers } from "./forgeEmbers";
import { playSound, unlockAudio } from "../audio";
import { playStrikeHaptic } from "../game/haptics";
import type { Wallet } from "../net/api";
import { useBackClose } from "../components/sheetGestures";
import { C_BONE, C_GOLD, C_MUTED } from "../loadout/catalogue";
import { DISPLAY_FONT } from "../typography";

/** Hold this long for the strike — long enough to feel like work, short
 * enough to chain-forge without impatience. */
const HOLD_MS = 850;
/** Haptic ticks as the charge climbs (playStrikeHaptic min-gaps them). */
const CHARGE_TICKS = [0.3, 0.55, 0.8];
const STACK_MAX_CARDS = 7;

export type ForgeOutcome = "ok" | "insufficient" | "unavailable";

interface WritForgeProps {
  wallet: Wallet;
  price: number;
  /** Pure commerce — no sounds, no haptics; the forge narrates. */
  onForge: () => Promise<ForgeOutcome>;
  onClose: () => void;
}

/** One red diamond of the Glory stream — loops from the purse down into the
 * seal while the charge is held. Per-diamond period + delay differ, so the
 * stream drifts organically out of phase instead of marching. */
const StreamDiamond = ({ delay, fromX, duration }: { delay: number; fromX: number; duration: number }) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(t, { toValue: 1, duration, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        // Reset instantly for the next pass (loop resets the value itself,
        // but an explicit 0-duration step keeps the sequence shape honest).
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, delay, duration]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.streamDiamond,
        {
          opacity: t.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 0.9, 0] }),
          transform: [
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-118, -4] }) },
            { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
            { rotate: "45deg" },
            { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }) },
          ],
        },
      ]}
    />
  );
};

/** The stream itself — mounted only while the button is held. */
const GloryStream = () => (
  <View pointerEvents="none" style={styles.sparkStage}>
    {[-34, -18, -6, 8, 20, 32].map((x, i) => (
      <StreamDiamond key={x} fromX={x} delay={i * 85} duration={470 + (i % 3) * 60} />
    ))}
  </View>
);

/** One strike's spark burst — keyed by seed so every strike gets a fresh
 * random spread. Pure spectacle, native-driver, gone in half a second. */
const Sparks = ({ seed }: { seed: number }) => {
  const t = useRef(new Animated.Value(0)).current;
  const darts = useMemo(
    () =>
      Array.from({ length: 12 }, () => {
        const angle = Math.random() * Math.PI * 2;
        const dist = 55 + Math.random() * 75;
        return {
          x: Math.cos(angle) * dist,
          // Sparks fly UP-and-out more than down — forge physics.
          y: Math.sin(angle) * dist * 0.8 - 24,
          spin: `${Math.round(Math.random() * 300 - 150)}deg`,
          long: Math.random() > 0.5,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed],
  );
  useEffect(() => {
    if (seed === 0) return;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 460, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [seed, t]);
  if (seed === 0) return null;
  return (
    <View pointerEvents="none" style={styles.sparkStage}>
      {darts.map((d, i) => (
        <Animated.View
          key={`${seed}-${i}`}
          style={[
            d.long ? styles.sparkLong : styles.spark,
            {
              opacity: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0.9, 0] }),
              transform: [
                { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, d.x] }) },
                { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, d.y] }) },
                { rotate: d.spin },
                { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
};

/** The freshly-struck Writ arcing down onto the stack. */
const FlyingWrit = ({ seed, onLand }: { seed: number; onLand: () => void }) => {
  const t = useRef(new Animated.Value(0)).current;
  const landed = useRef(false);
  useEffect(() => {
    if (seed === 0) return;
    landed.current = false;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 420, easing: Easing.bezier(0.4, 0, 0.6, 1), useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished && !landed.current) {
          landed.current = true;
          onLand();
        }
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, t]);
  if (seed === 0) return null;
  return (
    <Animated.View
      pointerEvents="none"
      key={seed}
      style={[
        styles.flying,
        {
          opacity: t.interpolate({ inputRange: [0, 0.1, 0.92, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, 168] }) },
            { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1.1, 0.72] }) },
            { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-9deg"] }) },
          ],
        },
      ]}
    >
      <WritCard />
    </Animated.View>
  );
};

/** One sealed document — the thing this room exists to make. */
const WritCard = () => (
  <View style={styles.writCard}>
    <View style={styles.writCardSeal} />
    <View style={styles.writCardLine} />
    <View style={[styles.writCardLine, { width: 16 }]} />
  </View>
);

export const WritForge = ({ wallet, price, onForge, onClose }: WritForgeProps) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  useBackClose(onClose);
  const canForge = wallet.glory >= price;

  const [phase, setPhase] = useState<"idle" | "charging" | "striking">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [sparkSeed, setSparkSeed] = useState(0);
  const [flySeed, setFlySeed] = useState(0);
  // The stack lags the wallet: a new Writ joins when its card LANDS.
  const [shownWrits, setShownWrits] = useState(wallet.writs);

  // JS-driven on purpose — feeds width/colour (see header).
  const charge = useRef(new Animated.Value(0)).current;
  const strikeT = useRef(new Animated.Value(0)).current;

  // The charge as React state (quantised to 1/50ths so re-renders stay
  // bounded) — it ticks the Glory readout down live, stokes the ember
  // shader, and gates the diamond stream.
  const [chargeVal, setChargeVal] = useState(0);
  // The purse frozen at press-in: the readout drains against THIS number,
  // so the server's own debit landing mid-ritual can never double-dip it.
  const baseGlory = useRef(0);

  // Climbing haptic ticks + the live charge state, one listener.
  const prevCharge = useRef(0);
  useEffect(() => {
    const sub = charge.addListener(({ value }) => {
      const prev = prevCharge.current;
      prevCharge.current = value;
      setChargeVal(Math.round(value * 50) / 50);
      if (value <= prev) return;
      for (const tick of CHARGE_TICKS) {
        if (prev < tick && value >= tick) playStrikeHaptic("soft");
      }
    });
    return () => charge.removeListener(sub);
  }, [charge]);

  // What the purse reads: live wallet at rest; during the ritual it drains
  // with the hold and stays drained through the strike — always continuous,
  // because at "ok" the wallet drops by exactly the price the hold showed.
  const shownGlory =
    phase === "idle"
      ? wallet.glory
      : Math.max(0, baseGlory.current - (phase === "striking" ? price : Math.round(chargeVal * price)));

  // True while the finger is down — a strike doesn't end the hold, and a
  // still-held button chains straight into the next charge (Tom,
  // 2026-08-15: keep holding to queue the next forge).
  const held = useRef(false);

  const coolDown = (): void => {
    setPhase("idle");
    Animated.timing(charge, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  };

  const beginCharge = (): void => {
    baseGlory.current = wallet.glory;
    setPhase("charging");
    charge.setValue(0);
    Animated.timing(charge, { toValue: 1, duration: HOLD_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start(
      ({ finished }) => {
        if (finished) strike();
      },
    );
  };

  const strike = (): void => {
    setPhase("striking");
    setNotice(null);
    // The slam is optimistic — the server answer lands inside it.
    playSound("writExchange");
    playStrikeHaptic("heavy", true);
    strikeT.setValue(0);
    Animated.timing(strikeT, { toValue: 1, duration: 480, easing: Easing.out(Easing.back(2.2)), useNativeDriver: true }).start();
    setSparkSeed((s) => s + 1);
    void onForge().then((outcome) => {
      if (outcome === "ok") {
        setFlySeed((s) => s + 1); // the payoff — onLand closes the loop
        Animated.timing(charge, { toValue: 0, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
        return;
      }
      playSound("uiError");
      setNotice(
        outcome === "insufficient"
          ? "THE GLORY MOVED — NOT ENOUGH FOR A WRIT. NOTHING WAS SPENT."
          : "THE LEDGER IS OUT OF REACH — NOTHING WAS SPENT.",
      );
      coolDown();
    });
  };

  const onPressIn = (): void => {
    held.current = true;
    if (phase !== "idle" || !canForge) return;
    unlockAudio();
    beginCharge();
  };
  const onPressOut = (): void => {
    held.current = false;
    // Only a live charge cools — once the strike has fallen it falls.
    if (phase === "charging") coolDown();
  };

  const stackCards = Math.min(shownWrits, STACK_MAX_CARDS);

  return (
    <View style={styles.scrim}>
      {/* The ember field — full-screen SkSL, stoked by the held charge. */}
      <ForgeEmbers w={width} h={height} boost={chargeVal} />
      <Pressable onPress={onClose} hitSlop={12} style={[styles.close, { top: insets.top + 14 }]}>
        <Text style={styles.closeGlyph}>✕</Text>
      </Pressable>

      <Text style={styles.titleText}>THE WRIT FORGE</Text>
      <Text style={styles.tagline}>RENOWN, PRESSED INTO WAX.</Text>

      {/* The purse feeding the seal — drains as the strike lands. */}
      <View style={styles.gloryRow}>
        <View style={styles.gloryGem} />
        <Text style={styles.gloryText}>{shownGlory.toLocaleString()}</Text>
        <Text style={styles.gloryLabel}>GLORY</Text>
      </View>

      {/* ── The seal stage: heat, wax, strike, sparks. ── */}
      <View style={styles.stage}>
        {/* Heat blooms with the charge (the EmberGlow recipe — real blur). */}
        {/* Canvas runs well past the glow's blur tails — a gaussian clipped
            at the canvas edge reads as a SQUARE the moment it scales up
            (Tom's device pass, 2026-08-15), so the canvas is padded far
            beyond the largest scaled tail. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.heat,
            {
              opacity: charge.interpolate({ inputRange: [0, 1], outputRange: [0.14, 1] }),
              transform: [{ scale: charge.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.18] }) }],
            },
          ]}
        >
          <Canvas style={styles.heatCanvas}>
            <Circle cx={160} cy={160} r={78} color="rgba(217,65,44,0.45)">
              <Blur blur={26} />
            </Circle>
            <Circle cx={160} cy={160} r={46} color="rgba(255,122,64,0.45)">
              <Blur blur={12} />
            </Circle>
            <Circle cx={160} cy={160} r={26} color="rgba(255,196,128,0.5)">
              <Blur blur={6} />
            </Circle>
          </Canvas>
        </Animated.View>

        {/* The seal presses down as it charges — effort you can see. */}
        <Animated.View
          style={{
            transform: [{ scale: charge.interpolate({ inputRange: [0, 1], outputRange: [1, 0.93] }) }],
          }}
        >
          <View style={styles.seal}>
            <View style={styles.sealWax}>
              {/* Molten overlay — the wax runs hot under the hold. */}
              <Animated.View style={[styles.sealMolten, { opacity: charge }]} />
            </View>
          </View>
        </Animated.View>

        {/* The strike: stamp ring slams in, shockwave rolls out. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.stamp,
            {
              opacity: strikeT.interpolate({ inputRange: [0, 0.12, 0.55, 1], outputRange: [0, 1, 0.5, 0] }),
              transform: [{ scale: strikeT.interpolate({ inputRange: [0, 1], outputRange: [1.7, 1] }) }],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shockwave,
            {
              opacity: strikeT.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.65, 0] }),
              transform: [{ scale: strikeT.interpolate({ inputRange: [0, 1], outputRange: [0.9, 2.4] }) }],
            },
          ]}
        />
        {/* Glory feeding the seal — red diamonds stream in while held. */}
        {phase === "charging" ? <GloryStream /> : null}
        <Sparks seed={sparkSeed} />
        <FlyingWrit
          seed={flySeed}
          onLand={() => {
            playStrikeHaptic("light");
            setShownWrits(wallet.writs);
            // Still holding and still funded → the next charge begins by
            // itself; the chain breaks on release, an empty purse, or a
            // refused forge (failures always require a fresh press).
            if (held.current && wallet.glory >= price) beginCharge();
            else setPhase("idle");
          }}
        />
      </View>

      {/* The rate — the one place both currencies are allowed to meet. */}
      <View style={styles.rate}>
        <Text style={styles.rateText}>{`${price.toLocaleString()} GLORY`}</Text>
        <Text style={styles.rateArrow}>→</Text>
        <Text style={styles.rateText}>1 WRIT</Text>
      </View>

      {/* HOLD to forge — the charge fills the button under the thumb. */}
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.hold, !canForge && styles.holdGhost]}
      >
        <Animated.View
          style={[styles.holdFill, { width: charge.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]}
        />
        <Text style={[styles.holdText, !canForge && styles.holdGhostText]}>
          {canForge ? "HOLD TO FORGE" : `EARN ${(price - wallet.glory).toLocaleString()} MORE GLORY IN THE PIT`}
        </Text>
      </Pressable>
      {notice !== null ? <Text style={styles.notice}>{notice}</Text> : null}

      {/* The fan of struck Writs — every forge visibly adds to the pile. */}
      <View style={styles.stack}>
        {stackCards === 0 ? (
          <Text style={styles.stackEmpty}>NO WRITS HELD — THE WAX WAITS</Text>
        ) : (
          <>
            <View style={styles.stackFan}>
              {Array.from({ length: stackCards }, (_, i) => (
                <View
                  key={i}
                  style={[
                    styles.stackSlot,
                    { transform: [{ rotate: `${(i - (stackCards - 1) / 2) * 7}deg` }, { translateY: Math.abs(i - (stackCards - 1) / 2) * 3 }] },
                  ]}
                >
                  <WritCard />
                </View>
              ))}
            </View>
            <Text style={styles.stackCount}>{`${shownWrits} WRIT${shownWrits === 1 ? "" : "S"} HELD`}</Text>
          </>
        )}
      </View>

      <Pressable onPress={onClose} style={styles.done}>
        <Text style={styles.doneText}>TO THE RACKS ›</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,7,5,0.98)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 10,
  },
  close: { position: "absolute", right: 20 },
  closeGlyph: { color: C_MUTED, fontSize: 20, fontWeight: "700" },
  titleText: { color: C_BONE, fontSize: 22, letterSpacing: 3, fontFamily: DISPLAY_FONT, textAlign: "center" },
  tagline: { color: C_MUTED, fontSize: 9, fontWeight: "900", letterSpacing: 2.5, marginRight: -2.5 },

  gloryRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 6 },
  gloryGem: { width: 7, height: 7, backgroundColor: "#8c2f2f", transform: [{ rotate: "45deg" }] },
  gloryText: { color: "#e8c87a", fontSize: 15, fontWeight: "900", letterSpacing: 1, fontVariant: ["tabular-nums"] },
  gloryLabel: { color: C_MUTED, fontSize: 9, fontWeight: "900", letterSpacing: 2 },

  stage: { width: 220, height: 190, alignItems: "center", justifyContent: "center" },
  heat: { position: "absolute", left: -50, top: -65, width: 320, height: 320 },
  heatCanvas: { width: 320, height: 320 },
  seal: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 3,
    borderColor: C_GOLD,
    alignItems: "center",
    justifyContent: "center",
  },
  sealWax: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#7e2020",
    borderWidth: 3,
    borderColor: "#5d1717",
    overflow: "hidden",
  },
  sealMolten: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 27,
    backgroundColor: "#ff7a40",
  },
  stamp: {
    position: "absolute",
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 4,
    borderColor: "#ffe9b0",
  },
  shockwave: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: C_GOLD,
  },
  sparkStage: { position: "absolute", width: 0, height: 0, alignItems: "center", justifyContent: "center" },
  // The Glory gem, in flight (rotation lives in the transform).
  streamDiamond: { position: "absolute", width: 8, height: 8, backgroundColor: "#8c2f2f" },
  spark: { position: "absolute", width: 5, height: 5, borderRadius: 2.5, backgroundColor: "#ffcf7a" },
  sparkLong: { position: "absolute", width: 11, height: 3, borderRadius: 1.5, backgroundColor: "#ffe9b0" },
  flying: { position: "absolute" },

  writCard: {
    width: 34,
    height: 44,
    borderRadius: 4,
    backgroundColor: "#25201a",
    borderWidth: 1,
    borderColor: C_GOLD,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  writCardSeal: { width: 11, height: 11, borderRadius: 6, backgroundColor: "#7e2020", borderWidth: 1.5, borderColor: "#5d1717" },
  writCardLine: { width: 20, height: 2, borderRadius: 1, backgroundColor: "rgba(217,154,65,0.45)" },

  rate: { flexDirection: "row", alignItems: "center", gap: 12 },
  rateText: { color: C_BONE, fontSize: 12, fontWeight: "900", letterSpacing: 1.5, fontVariant: ["tabular-nums"] },
  rateArrow: { color: C_GOLD, fontSize: 15, fontWeight: "900" },

  hold: {
    alignSelf: "stretch",
    marginTop: 8,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: C_GOLD,
    overflow: "hidden",
    alignItems: "center",
    paddingVertical: 15,
    backgroundColor: "rgba(217,154,65,0.12)",
  },
  // The fill carries its OWN radius — Android's overflow clip is unreliable
  // against a bordered, rounded parent (square corners + edge gaps, Tom's
  // device pass 2026-08-15); insetting past the border and self-rounding
  // needs no clipping at all.
  holdFill: {
    position: "absolute",
    top: 1,
    bottom: 1,
    left: 1,
    borderRadius: 10.5,
    backgroundColor: C_GOLD,
  },
  holdText: { color: C_BONE, fontSize: 13, fontWeight: "900", letterSpacing: 2.5 },
  holdGhost: { borderColor: "#3a332a", backgroundColor: "transparent" },
  holdGhostText: { color: C_MUTED, fontSize: 11 },
  notice: { color: "#c96a4a", fontSize: 9, fontWeight: "800", letterSpacing: 0.8, textAlign: "center", lineHeight: 13 },

  stack: { alignItems: "center", gap: 8, marginTop: 10, minHeight: 74 },
  stackFan: { flexDirection: "row", alignItems: "center" },
  stackSlot: { marginHorizontal: -7 },
  stackEmpty: { color: "#6a6155", fontSize: 8.5, fontWeight: "800", letterSpacing: 1.5, marginTop: 18 },
  stackCount: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 2, fontVariant: ["tabular-nums"] },

  done: { marginTop: 10 },
  doneText: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 2 },
});
