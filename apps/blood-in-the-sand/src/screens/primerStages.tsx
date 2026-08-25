/**
 * The Primer's chapter stages (bits-onboarding.md § the five chapters).
 * Chapters I–IV are LIVE SCENES — the real sim stepped by a script and drawn
 * by the real arena renderer (primer/PrimerArena.tsx) — with a thin overlay
 * each: the round pips, the stick's pad chrome, the real button faces.
 * Chapter V is a composition (crest, deeds, ladder) on the forge's embers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Blur, Canvas, Circle, Image as SkiaImage, Picture, useImage, type SkPicture } from "@shopify/react-native-skia";
import ReAnimated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { ABILITIES, WINS_TO_TAKE_MATCH, type AbilityId, type InterpolatedView, type WeaponId } from "@heroic/blood-in-the-sand-sim";
import { ABILITY_BUTTON_SIZE, EMPTY_BUTTON_PICTURE, recordAbilityButton } from "../game/AbilityButton";
import { ICON_SOURCES } from "../loadout/icons";
import { DEED_ICONS } from "../deeds/deedIcons";
import { RANK_BADGES } from "../components/rankBadges";
import { PrimerArena } from "../primer/PrimerArena";
import { ARM_SCENE, MOVE_SCENE, moveStickAt, SAND_SCENE, STRIKE_SCENE } from "../primer/scenes";
import type { ScenarioRunner } from "../primer/scenario";
import { ForgeEmbers } from "./forgeEmbers";
import { DISPLAY_FONT } from "../typography";

export interface StageProps {
  w: number;
  h: number;
}

const C_GOLD = "#f2cd6e";

/** A 0→1 loop clock (linear) for the composed chapter. */
const useLoop = (ms: number): Animated.Value => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    t.setValue(0);
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [t, ms]);
  return t;
};

const Label = ({ text, style }: { text: string; style?: object }) => (
  <Text style={[styles.label, style]} pointerEvents="none">
    {text}
  </Text>
);

// ── I · THE SAND ────────────────────────────────────────────────────────────

/** A real 1v1 closes and one fighter falls; the round pips keep the score. */
export const TheSandStage = ({ w, h }: StageProps) => {
  const [wins, setWins] = useState(0);
  const onFrame = useCallback((view: InterpolatedView) => {
    setWins((prev) => (prev === view.round.wins[0] ? prev : view.round.wins[0]));
  }, []);
  return (
    <View style={StyleSheet.absoluteFill}>
      <PrimerArena scenario={SAND_SCENE} w={w} h={h} onFrame={onFrame} />
      <Label text={`FIRST TO ${WINS_TO_TAKE_MATCH}`} style={{ top: 10 }} />
      <View style={[styles.pips, { bottom: 12 }]} pointerEvents="none">
        {Array.from({ length: WINS_TO_TAKE_MATCH }, (_, i) => (
          <View key={i} style={styles.pipWell}>
            {i < wins ? <View style={styles.pipLit} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
};

// ── II · MOVE ───────────────────────────────────────────────────────────────

const PAD = 132;
const KNOB = 44;
const TRAVEL = (PAD - KNOB) / 2;

/** The real fighter walks the script; the pad + a ghost thumb show the
 * stick that drives it — the same function of scene time, so they agree. */
export const MoveStage = ({ w, h }: StageProps) => {
  const kx = useSharedValue(0);
  const ky = useSharedValue(0);
  const active = useSharedValue(0);
  const onFrame = useCallback(
    (_view: InterpolatedView, runner: ScenarioRunner) => {
      const s = moveStickAt(runner.time);
      const mag = Math.hypot(s.sx, s.sy);
      // Full speed lands at ~55% travel in the real stick; the demo thumb
      // pushes a little past it so the pad visibly works.
      const k = TRAVEL * 0.75;
      kx.value = s.sx * k;
      ky.value = s.sy * k;
      active.value = mag > 0.02 ? 1 : 0.35;
    },
    [kx, ky, active],
  );
  const padStyle = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * active.value }));
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: kx.value }, { translateY: ky.value }] }));
  const thumbStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [{ translateX: kx.value }, { translateY: ky.value }],
  }));
  const padLeft = 22;
  const padTop = h - PAD - 18;
  return (
    <View style={StyleSheet.absoluteFill}>
      <PrimerArena scenario={MOVE_SCENE} w={w} h={h} onFrame={onFrame} />
      <View style={[styles.region, { left: 10, top: 10, width: w * 0.5, bottom: 10 }]} pointerEvents="none" />
      <Label text="TOUCH ANYWHERE HERE" style={{ top: 16, left: 10, width: w * 0.5 }} />
      <ReAnimated.View pointerEvents="none" style={[styles.pad, { left: padLeft, top: padTop }, padStyle]}>
        <ReAnimated.View style={[styles.knob, knobStyle]} />
      </ReAnimated.View>
      <ReAnimated.View
        pointerEvents="none"
        style={[styles.thumb, { left: padLeft + PAD / 2 - 21, top: padTop + PAD / 2 - 21 }, thumbStyle]}
      />
    </View>
  );
};

// ── III · STRIKE ────────────────────────────────────────────────────────────

/** The enemy walks into your reach ring (the renderer's own) and the staff
 * answers by itself. */
export const StrikeStage = ({ w, h }: StageProps) => (
  <View style={StyleSheet.absoluteFill}>
    <PrimerArena scenario={STRIKE_SCENE} w={w} h={h} />
    <Label text="YOUR REACH — NO AIMING" style={{ top: 10 }} />
  </View>
);

// ── IV · ARM YOURSELF ───────────────────────────────────────────────────────

const ARM_WEAPON: WeaponId = "blade";
const ARM_POWERS: readonly AbilityId[] = ["dash", "ironhide"];

/** One in-match ability button, the real chrome, fed by the live slot. */
const ButtonFace = ({ id, face }: { id: AbilityId; face: SharedValue<SkPicture> }) => {
  const icon = useImage(ICON_SOURCES[id]);
  const s = ABILITY_BUTTON_SIZE;
  const glyph = 46;
  const inset = (s - glyph) / 2;
  return (
    <Canvas style={{ width: s, height: s }}>
      {icon && <SkiaImage image={icon} x={inset} y={inset} width={glyph} height={glyph} fit="contain" />}
      <Picture picture={face} />
    </Canvas>
  );
};

/** The picks as sockets, and the SAME picks as the in-match buttons — whose
 * faces are re-recorded from the live sim's slots, exactly as a match does. */
export const ArmStage = ({ w, h }: StageProps) => {
  const face0 = useSharedValue<SkPicture>(EMPTY_BUTTON_PICTURE);
  const face1 = useSharedValue<SkPicture>(EMPTY_BUTTON_PICTURE);
  const faces = useMemo(() => [face0, face1], [face0, face1]);
  const keys = useRef(["", ""]);
  const onFrame = useCallback(
    (view: InterpolatedView, runner: ScenarioRunner) => {
      const me = view.players.find((p) => p.id === runner.youId);
      const slots = me?.abilities ?? [];
      for (let i = 0; i < faces.length; i++) {
        const slot = slots[i];
        if (!slot) continue;
        const def = ABILITIES[slot.id];
        const frac = Math.min(1, Math.max(0, Math.round((slot.cd / def.cooldown) * 100) / 100));
        const active = slot.active > 0;
        const key = `${slot.id}:${frac}:${active}:${slot.charges}`;
        if (key === keys.current[i]) continue;
        keys.current[i] = key;
        faces[i]!.value = recordAbilityButton(frac, active, slot.charges, def.charges);
      }
    },
    [faces],
  );
  const big = 64;
  const small = 54;
  const gap = 10;
  const s = ABILITY_BUTTON_SIZE;
  const colX = w - 14 - s;
  const colY = h / 2 - s - 6;
  return (
    <View style={StyleSheet.absoluteFill}>
      <PrimerArena scenario={ARM_SCENE} w={w} h={h} onFrame={onFrame} />
      <Label text="PICK ORDER" style={{ top: 12, left: 14, width: big + small * 2 + gap * 2, textAlign: "center" }} />
      <View style={[styles.socketRow, { left: 14, top: 30, gap }]} pointerEvents="none">
        <View style={[styles.socket, styles.socketWeapon, { width: big, height: big }]}>
          <Animated.Image source={ICON_SOURCES[ARM_WEAPON]} style={{ width: big * 0.68, height: big * 0.68 }} />
        </View>
        {ARM_POWERS.map((id) => (
          <View key={id} style={[styles.socket, { width: small, height: small }]}>
            <Animated.Image source={ICON_SOURCES[id]} style={{ width: small * 0.68, height: small * 0.68 }} />
          </View>
        ))}
      </View>
      <Label text="BUTTONS" style={{ top: colY - 22, left: colX - 20, width: s + 40, textAlign: "center" }} />
      <View style={{ position: "absolute", left: colX, top: colY, gap: 12 }} pointerEvents="none">
        {ARM_POWERS.map((id, i) => (
          <ButtonFace key={id} id={id} face={faces[i]!} />
        ))}
      </View>
    </View>
  );
};

// ── V · GLORY ───────────────────────────────────────────────────────────────

const ORBIT_DEEDS = ["deed-first-match", "deed-kills", "deed-wins"] as const;
const LADDER = ["initiate", "pit-fighter", "gladiator", "champion", "warlord", "immortal"] as const;
const GLORY_SWELL = 25;

/** The Initiate crest on a stoked forge; deeds orbit it; Glory ticks up;
 * the ladder runs beneath with a marker climbing. */
export const GloryStage = ({ w, h }: StageProps) => {
  const intro = useRef(new Animated.Value(0)).current;
  const orbit = useLoop(16000);
  const t = useLoop(6400);
  const [glory, setGlory] = useState(0);
  useEffect(() => {
    Animated.timing(intro, { toValue: 1, duration: 800, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
  }, [intro]);
  useEffect(() => {
    let last = -1;
    const sub = t.addListener(({ value }) => {
      const k = Math.min(1, Math.max(0, (value - 0.12) / 0.4));
      const n = Math.round(GLORY_SWELL * (1 - Math.pow(1 - k, 3)));
      if (n !== last) {
        last = n;
        setGlory(n);
      }
    });
    return () => t.removeListener(sub);
  }, [t]);
  const spin = orbit.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const unspin = orbit.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] });
  const crest = 108;
  const cx = w / 2;
  const cy = h * 0.42;
  const orbitR = crest * 0.78;
  const ladderY = h - 40;
  const ladderPad = w * 0.1;
  const step = (w - ladderPad * 2) / (LADDER.length - 1);
  const marker = t.interpolate({ inputRange: [0, 0.12, 0.88, 1], outputRange: [0, 0, step * (LADDER.length - 1), step * (LADDER.length - 1)] });
  const gloryAlpha = t.interpolate({ inputRange: [0, 0.1, 0.18, 0.7, 0.8, 1], outputRange: [0, 0, 1, 1, 0, 0] });
  const gloryRise = t.interpolate({ inputRange: [0, 0.1, 0.18, 1], outputRange: [8, 8, 0, 0] });
  return (
    <View style={StyleSheet.absoluteFill}>
      <ForgeEmbers w={w} h={h} boost={1} />
      {/* the crest's heat */}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Circle cx={cx} cy={cy} r={crest * 0.62} color="rgba(232,176,72,0.32)">
          <Blur blur={26} />
        </Circle>
      </Canvas>
      {/* deeds orbit the crest — counter-spun so each emblem stays upright */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: cx - orbitR,
          top: cy - orbitR,
          width: orbitR * 2,
          height: orbitR * 2,
          opacity: intro,
          transform: [{ rotate: spin }],
        }}
      >
        {ORBIT_DEEDS.map((id, i) => {
          const a = (i / ORBIT_DEEDS.length) * Math.PI * 2 - Math.PI / 2;
          const src = DEED_ICONS[id];
          if (!src) return null;
          return (
            <Animated.Image
              key={id}
              source={src}
              style={{
                position: "absolute",
                width: 40,
                height: 40,
                left: orbitR + Math.cos(a) * orbitR - 20,
                top: orbitR + Math.sin(a) * orbitR - 20,
                transform: [{ rotate: unspin }],
              }}
            />
          );
        })}
      </Animated.View>
      {RANK_BADGES.initiate ? (
        <Animated.Image
          source={RANK_BADGES.initiate}
          style={{
            position: "absolute",
            left: cx - crest / 2,
            top: cy - crest / 2,
            width: crest,
            height: crest,
            opacity: intro.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
            transform: [{ scale: intro.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          }}
        />
      ) : null}
      <Animated.Text
        pointerEvents="none"
        style={[styles.glory, { top: cy + crest / 2 + 12, opacity: gloryAlpha, transform: [{ translateY: gloryRise }] }]}
      >
        +{glory} GLORY
      </Animated.Text>
      {/* the ladder */}
      <View style={{ position: "absolute", left: ladderPad, top: ladderY - 13, right: ladderPad, height: 26 }} pointerEvents="none">
        {LADDER.map((tier, i) => {
          const src = RANK_BADGES[tier];
          if (!src) return null;
          const at = i * step;
          const lit = marker.interpolate({
            inputRange: [at - step * 0.5, at, at + step * 0.5],
            outputRange: [0.35, 1, 0.35],
            extrapolate: "clamp",
          });
          return (
            <Animated.Image
              key={tier}
              source={src}
              style={{ position: "absolute", left: at - 13, top: 0, width: 26, height: 26, opacity: lit }}
            />
          );
        })}
        <Animated.View style={[styles.ladderMarker, { transform: [{ translateX: marker }, { rotate: "45deg" }] }]} />
      </View>
    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  label: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#d9cbb4",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  pips: { position: "absolute", left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 10 },
  pipWell: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(242,205,110,0.7)",
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  pipLit: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C_GOLD,
    shadowColor: C_GOLD,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  region: {
    position: "absolute",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  pad: {
    position: "absolute",
    width: PAD,
    height: PAD,
    borderRadius: PAD / 2,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
  },
  thumb: {
    position: "absolute",
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(240,232,216,0.16)",
    borderWidth: 1,
    borderColor: "rgba(240,232,216,0.55)",
  },
  socketRow: { position: "absolute", flexDirection: "row", alignItems: "center" },
  socket: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(10,7,5,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  socketWeapon: { borderColor: "rgba(242,193,78,0.6)" },
  glory: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: DISPLAY_FONT,
    color: C_GOLD,
    fontSize: 18,
    letterSpacing: 3,
    textShadowColor: "rgba(232,176,72,0.7)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  ladderMarker: {
    position: "absolute",
    left: -4,
    top: 30,
    width: 8,
    height: 8,
    backgroundColor: "#8c2f2f",
  },
});
