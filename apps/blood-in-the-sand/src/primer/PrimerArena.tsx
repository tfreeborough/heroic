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
 *
 * The finisher shop window (components/FinisherPreview, bits-cosmetics.md
 * § F2/F3) is the rig's second customer: `finisher` plays over YOUR kills
 * exactly as GameScreen does it, and `freshEachLoop` wipes blood, marks and
 * cracks at every scene restart so each pass of the kill lands on clean sand.
 *
 * ONE AT A TIME: the renderer's scar cache and splat surface are module
 * singletons keyed to a single BloodField (render.ts scarLayer) — two of
 * these mounted together would thrash it and show each other's floor.
 */
import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Canvas, Group, Picture, rect, rrect, type SkPicture } from "@shopify/react-native-skia";
import { useSharedValue } from "react-native-reanimated";
import { useGameLoop } from "@heroic/engine";
import { ARENA_00, TICK_DT, type FinisherId, type InterpolatedView } from "@heroic/blood-in-the-sand-sim";
import { BloodField } from "../game/blood";
import { playSound } from "../audio";
import { FinisherCues } from "../game/finisherCues";
import { FinisherField } from "../game/finishers";
import { CrackField } from "../game/cracks";
import { TarField } from "../game/tar";
import { StatusPulses } from "../game/statusRings";
import { useArenaAtlas } from "../game/tilesets";
import { arenaScene } from "../game/scene";
import { useAbilityIconImages } from "../game/abilityIcons";
import { EMPTY_ARENA_PICTURE, KILL_KICK_MS, recordArena, type FxItem, type KillKick } from "../game/render";
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

/** How many of a preview's kills are heard before it loops on in silence. */
const PREVIEW_SOUND_LOOPS = 2;
/** A preview isn't a fight to be heard over — a touch under match level. */
const PREVIEW_SOUND_GAIN = 0.8;

export interface PrimerArenaProps {
  scenario: Scenario;
  w: number;
  h: number;
  onFrame?: (view: InterpolatedView, runner: ScenarioRunner, nowMs: number) => void;
  /** The kill finisher seat 0 wears ("none"/absent = the plain death). */
  finisher?: FinisherId;
  /** Play the finisher's kill sting (the shop window: sound is half the
   * pitch). Only for the first PREVIEW_SOUND_LOOPS kills after mount or a
   * change of finisher — a preview left looping on screen goes quiet rather
   * than screeching every six seconds. No haptics: nobody struck a blow. */
  sound?: boolean;
  /** Wipe the floor (blood, finisher marks, cracks) at every scene restart. */
  freshEachLoop?: boolean;
  /** A scene restart just happened (the shop window dips to black over it). */
  onLoop?: () => void;
  /** Round the picture's corners INSIDE the canvas. A Skia canvas is its own
   * native surface: a parent's rounded `overflow: hidden` doesn't reliably
   * clip it (the ItemTile band rule), so a card with rounded corners says so
   * here. */
  cornerRadius?: number;
}

export const PrimerArena = ({
  scenario,
  w,
  h,
  onFrame,
  finisher,
  sound = false,
  freshEachLoop = false,
  onLoop,
  cornerRadius = 0,
}: PrimerArenaProps) => {
  // The Primer is scripted against arena-00's layout — always that map.
  const atlas = useArenaAtlas(ARENA_00.id);
  const scene = arenaScene(ARENA_00.id);
  const abilityIcons = useAbilityIconImages();
  const picture = useSharedValue<SkPicture>(EMPTY_ARENA_PICTURE);
  const retired = useRef<SkPicture[]>([]);
  // One runner per mount — the scene's whole life is this component's.
  const runner = useMemo(() => new ScenarioRunner(scenario), [scenario]);
  // The floor lives in a ref, not a memo: `freshEachLoop` swaps the fields
  // for new ones at a restart (a new BloodField is also what tells the
  // renderer's splat surface to clear itself).
  const floor = useRef<{ runner: ScenarioRunner; blood: BloodField; cracks: CrackField; finishers: FinisherField } | null>(null);
  if (floor.current?.runner !== runner) {
    floor.current = { runner, blood: new BloodField(), cracks: new CrackField(), finishers: new FinisherField() };
  }
  const tar = useMemo(() => new TarField(), [runner]);
  const pulses = useMemo(() => new StatusPulses(), [runner]);
  const fx = useRef<AgedFx[]>([]);
  // Kill shakes (bits-blood.md §8a) — the shop window only: a kill there
  // must land as hard as a match's; the Primer's lessons stay steady.
  const kicks = useRef<KillKick[]>([]);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const live = useRef({ finisher, sound, freshEachLoop, onLoop });
  live.current = { finisher, sound, freshEachLoop, onLoop };
  // The kill stings (sound only), and how many of this finisher's kills have
  // been heard — a new finisher starts the count again.
  const cues = useRef(new FinisherCues());
  const heard = useRef<{ finisher: FinisherId | undefined; kills: number }>({ finisher, kills: 0 });
  if (heard.current.finisher !== finisher) heard.current = { finisher, kills: 0 };
  useEffect(() => {
    runner.onRestart = () => {
      if (live.current.freshEachLoop) {
        floor.current = { runner, blood: new BloodField(), cracks: new CrackField(), finishers: new FinisherField() };
        fx.current.length = 0;
      }
      live.current.onLoop?.();
    };
    return () => {
      runner.onRestart = null;
    };
  }, [runner]);

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
        const { blood, cracks, finishers } = floor.current!;
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
            if (e.lethal) {
              blood.deathBurst(e.x, e.y, dx / len, dy / len, now);
              if (live.current.finisher !== undefined) {
                kicks.current.push({ x: e.x, y: e.y, dirX: dx / len, dirY: dy / len, bornMs: now });
              }
              // The KILLER's finisher, GameScreen's rule: over your kills only.
              if (e.attackerId === runner.youId && e.targetId !== runner.youId && live.current.finisher) {
                const worn = live.current.finisher;
                finishers.spawn(worn, e.x, e.y, now, dx / len, dy / len);
                if (live.current.sound && worn !== "none" && heard.current.kills < PREVIEW_SOUND_LOOPS) {
                  heard.current.kills++;
                  cues.current.start(worn, now, PREVIEW_SOUND_GAIN, false);
                }
              }
            }
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
        const { blood, cracks, finishers } = floor.current!;
        blood.update(view.players, now);
        blood.crossings.length = 0;
        finishers.update(now);
        cues.current.update(now, (name, gain) => playSound("finisher", name, undefined, gain), () => {});
        const k = kicks.current;
        for (let i = k.length - 1; i >= 0; i--) if (now - k[i]!.bornMs >= KILL_KICK_MS) k.splice(i, 1);
        tar.update(view.players, view.deployables, now);
        cracks.update(now);
        pulses.update(view.players, now);
        const prev = picture.value;
        picture.value = recordArena({
          scene,
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
          finishers,
          kicks: k,
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
        {cornerRadius > 0 ? (
          <Group clip={rrect(rect(0, 0, w, h), cornerRadius, cornerRadius)}>
            <Picture picture={picture} />
          </Group>
        ) : (
          <Picture picture={picture} />
        )}
      </Canvas>
    </View>
  );
};
