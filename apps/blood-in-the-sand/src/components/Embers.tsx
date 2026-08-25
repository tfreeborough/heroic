/**
 * Rising gold embers — the Chronicle's candlelight (DeedsScreen), shared
 * since the Primer (bits-onboarding.md) runs the same field over its
 * backdrop. Same native-driven pattern as the title screen's motes: one
 * looping Animated.Value per ember, every property hashed off its seed so
 * the field is deterministic and free of per-frame JS work.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";

export const Ember = ({ w, h, seed }: { w: number; h: number; seed: number }) => {
  const t = useRef(new Animated.Value(0)).current;
  const x0 = (((seed * 89) % 100) / 100) * w;
  const y0 = h * 0.3 + (((seed * 53) % 100) / 100) * h * 0.65;
  const dur = 11000 + ((seed * 131) % 8) * 1500;
  const size = 2 + (seed % 3);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [t, dur]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x0,
        top: y0,
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: seed % 5 === 0 ? "#fff3d0" : seed % 2 === 0 ? "#f2cd6e" : "#e8c87a",
        opacity: t.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 0.42, 0.3, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -(60 + (seed % 4) * 18)] }) },
          {
            translateX: t.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, (seed % 2 === 0 ? 1 : -1) * (8 + (seed % 3) * 5), (seed % 2 === 0 ? 1 : -1) * (14 + (seed % 3) * 7)],
            }),
          },
        ],
      }}
    />
  );
};

/** A whole field: `count` embers spread over a w×h surface. Render it
 * absolutely positioned as a sibling of the content it should drift behind
 * (or over — it never eats touches). */
export const Embers = ({ w, h, count = 16, seed = 7 }: { w: number; h: number; count?: number; seed?: number }) => (
  <>
    {Array.from({ length: count }, (_, i) => (
      <Ember key={i} w={w} h={h} seed={i + seed} />
    ))}
  </>
);
