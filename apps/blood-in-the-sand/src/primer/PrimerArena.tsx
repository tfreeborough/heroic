/**
 * A scripted scene drawn by the REAL arena renderer (bits-onboarding.md §
 * live scenes). GameScreen's frame loop, distilled: a ScenarioRunner steps
 * the sim at the match tick, the sampled view is re-recorded through
 * `recordArena` with the same blood / crack / tar fields and status pulses
 * a match carries, and the sim's events feed the same impact numbers, rings
 * and cast flashes. Silent on purpose — a looping kill sting would grate —
 * and camera-directed (the scenario frames its own shot).
 *
 * `onFrame` hands the sampled view to the chapter overlay every rendered
 * frame (the Move chapter's pad, the Arm chapter's real button faces).
 */
import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Canvas, Picture, type SkPicture } from "@shopify/react-native-skia";
import { useSharedValue } from "react-native-reanimated";
import { useGameLoop } from "@heroic/engine";
import { TICK_DT, type InterpolatedView } from "@heroic/blood-in-the-sand-sim";
import { BloodField } from "../game/blood";
import { CrackField } from "../game/cracks";
import { TarField } from "../game/tar";
import { StatusPulses } from "../game/statusRings";
import { useArenaAtlas } from "../game/tilesets";
import { useAbilityIconImages } from "../game/abilityIcons";
import { EMPTY_ARENA_PICTURE, recordArena, type FxItem } from "../game/render";
import { ScenarioRunner, type Scenario } from "./scenario";

// The match's own FX lifetimes (GameScreen).
const NUMBER_TTL = 750;
const RING_TTL = 380;
const DETONATE_TTL = 1150;
const CAST_FLASH_TTL = 950;
const CAST_FLASH_RISE_FROM = 24;
const HARPOON_TTL = 260;

interface AgedFx {
  item: FxItem;
  bornMs: number;
  ttlMs: number;
}

export interface PrimerArenaProps {
  scenario: Scenario;
  w: number;
  h: number;
  onFrame?: (view: InterpolatedView, runner: ScenarioRunner, nowMs: number) => void;
}

export const PrimerArena = ({ scenario, w, h, onFrame }: PrimerArenaProps) => {
  const atlas = useArenaAtlas();
  const abilityIcons = useAbilityIconImages();
  const picture = useSharedValue<SkPicture>(EMPTY_ARENA_PICTURE);
  const retired = useRef<SkPicture[]>([]);
  // One runner per mount — the scene's whole life is this component's.
  const runner = useMemo(() => new ScenarioRunner(scenario), [scenario]);
  const blood = useMemo(() => new BloodField(), [runner]);
  const cracks = useMemo(() => new CrackField(), [runner]);
  const tar = useMemo(() => new TarField(), [runner]);
  const pulses = useMemo(() => new StatusPulses(), [runner]);
  const fx = useRef<AgedFx[]>([]);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(
    () => () => {
      for (const p of retired.current) p.dispose();
      retired.current.length = 0;
    },
    [],
  );

  useGameLoop(
    {
      onStep: () => {
        const now = performance.now();
        const events = runner.step(now);
        if (events.length === 0) return;
        const view = runner.sample(now);
        for (const e of events) {
          if (e.type === "hit") {
            const dot = e.bleed === true || e.poison === true;
            const attacker = view?.players.find((p) => p.id === e.attackerId);
            const victim = view?.players.find((p) => p.id === e.targetId);
            const dx = attacker ? e.x - attacker.x : victim ? -Math.cos(victim.facing) : 1;
            const dy = attacker ? e.y - attacker.y : victim ? -Math.sin(victim.facing) : 0;
            const len = Math.hypot(dx, dy) || 1;
            blood.splatter(e.x, e.y, e.damage, e.lethal, now, dx / len, dy / len);
            if (e.lethal) blood.deathBurst(e.x, e.y, dx / len, dy / len, now);
            fx.current.push({
              item: { kind: "number", x: e.x, y: e.y, life: 1, text: String(e.damage), crit: e.crit, bleed: e.bleed, poison: e.poison },
              bornMs: now,
              ttlMs: NUMBER_TTL,
            });
            if (!dot) fx.current.push({ item: { kind: "ring", x: e.x, y: e.y, life: 1 }, bornMs: now, ttlMs: RING_TTL });
          } else if (e.type === "cast") {
            const caster = view?.players.find((p) => p.id === e.playerId);
            if (!caster) continue;
            fx.current.push({
              item: { kind: "castFlash", x: caster.x, y: caster.y - CAST_FLASH_RISE_FROM, life: 1, ability: e.ability },
              bornMs: now,
              ttlMs: CAST_FLASH_TTL,
            });
            if (e.ability === "tremor") cracks.addSlam(caster.x, caster.y, 110, now);
          } else if (e.type === "harpoon") {
            fx.current.push({
              item: { kind: "line", x: e.fromX, y: e.fromY, x2: e.toX, y2: e.toY, life: 1 },
              bornMs: now,
              ttlMs: HARPOON_TTL,
            });
          } else if (e.type === "detonate") {
            fx.current.push({ item: { kind: "ring", x: e.x, y: e.y, life: 1, big: true }, bornMs: now, ttlMs: DETONATE_TTL });
          } else if (e.type === "heal") {
            fx.current.push({
              item: { kind: "number", x: e.x, y: e.y, life: 1, text: `+${e.amount}`, heal: true },
              bornMs: now,
              ttlMs: NUMBER_TTL,
            });
          }
        }
      },
      onRender: () => {
        const now = performance.now();
        const view = runner.sample(now);
        if (!view || w <= 0 || h <= 0) return;
        const list = fx.current;
        for (let i = list.length - 1; i >= 0; i--) {
          const f = list[i]!;
          f.item.life = 1 - (now - f.bornMs) / f.ttlMs;
          if (f.item.life <= 0) list.splice(i, 1);
        }
        blood.update(view.players, now);
        blood.crossings.length = 0;
        tar.update(view.players, view.deployables, now);
        cracks.update(now);
        pulses.update(view.players, now);
        const prev = picture.value;
        picture.value = recordArena({
          view,
          config: runner.config,
          myId: runner.youId,
          screenW: w,
          screenH: h,
          fx: list.map((f) => f.item),
          blood,
          cracks,
          tar,
          scarEpoch: blood.epoch,
          pulses,
          nowMs: now,
          atlas,
          abilityIcons,
          camera: runner.camera(view, w, h),
        });
        if (prev !== EMPTY_ARENA_PICTURE) {
          retired.current.push(prev);
          if (retired.current.length > 3) retired.current.shift()!.dispose();
        }
        onFrameRef.current?.(view, runner, now);
      },
    },
    { step: TICK_DT, maxStep: TICK_DT, maxSteps: 2 },
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
};
