/**
 * The Deed Map board (achievements.md § map): a pan/zoom canvas of one
 * board's nodes. Visual language (reworked 2026-08-04, Tom's board pass):
 * - Every node is VISIBLE. Unlocked = glow + full-colour icon + title and
 *   description below; frontier (parent unlocked) = greyscale ghost + title;
 *   deeper = darker ghost + "???" — the how AND the what stay the reveal.
 * - Chain tiers carry roman numerals over the icon (I, II, III…); tiers
 *   after the first fade their icon so the numeral reads. NO colour rings —
 *   tier is the numeral's job now.
 * - Edges are axis-aligned subway lines (routeEdge L-elbows, no diagonals);
 *   unlocked edges animate their dashes parent→child — direction of travel.
 * - The camera is an infinite canvas: free pan with fling momentum, pinch
 *   anchored to the INITIAL touch midpoint, and a re-centre button home.
 *
 * Imported via `@heroic/achievements/map` ONLY — the package root stays
 * free of React Native so servers can keep importing the engine.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import {
  Canvas,
  Picture,
  Skia,
  matchFont,
  type SkFont,
  type SkImage,
  type SkPath,
  type SkPicture,
} from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from "react-native-reanimated";
import { visibility } from "../frontier";
import type { AchievementDef, NodeVisibility } from "../types";
import {
  MAX_SCALE,
  MIN_SCALE,
  NODE_RADIUS,
  ROOT_RADIUS,
  hitTest,
  offsetFor,
  routeEdge,
  screenToCanvas,
  worldBounds,
  type HitNode,
  type WorldBounds,
} from "./mapMath";

/** The map reads only display fields — the summary type is irrelevant. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAchievementDef = AchievementDef<any>;

export interface DeedMapTheme {
  /** Edge into an unlocked child (the animated flow). */
  edge: string;
  /** Edge into a locked child (static, dashed). */
  edgeDim: string;
  /** Dark disc under every icon. */
  unlockedFill: string;
  /** The re-centre button's ring (and any future chrome). */
  unlockedRing: string;
  /** The earned glow halo. */
  unlockedGlow: string;
  frontierFill: string;
  frontierRing: string;
  selectedRing: string;
  labelTitle: string;
  labelTitleLocked: string;
  labelDesc: string;
  labelMystery: string;
  numeral: string;
}

export const DEFAULT_DEED_MAP_THEME: DeedMapTheme = {
  edge: "#a8854f",
  edgeDim: "#4a3f30",
  unlockedFill: "#221c14",
  unlockedRing: "#8a6d44",
  unlockedGlow: "rgba(232,176,72,0.55)",
  frontierFill: "#1a1611",
  frontierRing: "#5a4c38",
  selectedRing: "#f2cd6e",
  labelTitle: "#e8d9b8",
  labelTitleLocked: "#8a7f70",
  labelDesc: "#a89a83",
  labelMystery: "#5a4c38",
  numeral: "#f0e8d8",
};

export interface DeedMapProps {
  /** ONE board's definitions — visibility never crosses boards. */
  defs: readonly AnyAchievementDef[];
  unlocked: ReadonlySet<string>;
  selectedId?: string | null;
  /** Fired with the tapped node id (any node — mystery included), or null
   * for a tap on empty sand. */
  onSelect?: (id: string | null) => void;
  theme?: Partial<DeedMapTheme>;
  /** Decoded icon images keyed by the defs' `icon` field — nodes with no
   * entry render as bare discs, so missing art never breaks the map. */
  icons?: ReadonlyMap<string, SkImage>;
  /** Fired when the re-centre button is pressed (in addition to the
   * animation) — the screen's hook for a UI tap sound. */
  onRecenter?: () => void;
}

interface BoardNode {
  def: AnyAchievementDef;
  vis: NodeVisibility;
  /** Canvas coordinates (authored pos − bounds min). */
  x: number;
  y: number;
  radius: number;
  /** 0-based tier index within its chain (same-icon milestone group),
   * null = a single deed. Drives the numeral + the post-I icon fade. */
  tier: number | null;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"] as const;

/** 0-based tier index per def id, for same-icon milestone chains (>1). */
const tierIndexes = (defs: readonly AnyAchievementDef[]): Map<string, number> => {
  const byIcon = new Map<string, AnyAchievementDef[]>();
  for (const d of defs) {
    const group = byIcon.get(d.icon);
    if (group) group.push(d);
    else byIcon.set(d.icon, [d]);
  }
  const indexes = new Map<string, number>();
  for (const group of byIcon.values()) {
    const tiers = group
      .filter((d) => d.trigger.kind === "milestone")
      .sort(
        (a, b) =>
          (a.trigger.kind === "milestone" ? a.trigger.threshold : 0) -
          (b.trigger.kind === "milestone" ? b.trigger.threshold : 0),
      );
    if (tiers.length < 2) continue;
    tiers.forEach((d, i) => indexes.set(d.id, i));
  }
  return indexes;
};

/** Greedy word-wrap with an ellipsis past maxLines. */
const wrapText = (font: SkFont, text: string, maxWidth: number, maxLines: number): string[] => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const tryLine = line.length > 0 ? `${line} ${word}` : word;
    if (font.measureText(tryLine).width <= maxWidth || line.length === 0) {
      line = tryLine;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line.length > 0) lines.push(line);
  if (lines.length > maxLines || (lines.length === maxLines && line.length > 0 && lines[maxLines - 1] !== line)) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/…$/, "")}…`;
  }
  return lines;
};

const LABEL_WIDTH = 118;

interface Fonts {
  numeral: SkFont;
  title: SkFont;
  desc: SkFont;
}

const buildPicture = (
  nodes: readonly BoardNode[],
  world: WorldBounds,
  selectedId: string | null,
  theme: DeedMapTheme,
  icons: ReadonlyMap<string, SkImage> | undefined,
  fonts: Fonts,
  edges: { flowing: SkPath; dormant: SkPath },
): SkPicture => {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, world.width, world.height));

  // Edges live in the STATIC layer (the plasma beads animate in a separate
  // thin overlay canvas — see the render; re-rastering THIS layer per frame
  // was the all-unlocked frame drop). Dormant = dim dashes; flowing = a
  // soft continuous conduit the beads travel along.
  const dormantEdge = Skia.Paint();
  dormantEdge.setStyle(1);
  dormantEdge.setStrokeWidth(2);
  dormantEdge.setColor(Skia.Color(theme.edgeDim));
  dormantEdge.setPathEffect(Skia.PathEffect.MakeDash([6, 7], 0));
  canvas.drawPath(edges.dormant, dormantEdge);
  const conduitGlow = Skia.Paint();
  conduitGlow.setStyle(1);
  conduitGlow.setStrokeWidth(6);
  conduitGlow.setColor(Skia.Color(theme.unlockedGlow));
  conduitGlow.setMaskFilter(Skia.MaskFilter.MakeBlur(0, 4, true));
  canvas.drawPath(edges.flowing, conduitGlow);
  const conduitCore = Skia.Paint();
  conduitCore.setStyle(1);
  conduitCore.setStrokeWidth(2);
  conduitCore.setColor(Skia.Color(theme.edge));
  canvas.drawPath(edges.flowing, conduitCore);

  const glow = Skia.Paint();
  glow.setColor(Skia.Color(theme.unlockedGlow));
  glow.setMaskFilter(Skia.MaskFilter.MakeBlur(0, 14, true));
  const baseFill = Skia.Paint();
  baseFill.setColor(Skia.Color(theme.unlockedFill));
  const frontierFill = Skia.Paint();
  frontierFill.setColor(Skia.Color(theme.frontierFill));
  const frontierRing = Skia.Paint();
  frontierRing.setStyle(1);
  frontierRing.setStrokeWidth(2);
  frontierRing.setColor(Skia.Color(theme.frontierRing));
  frontierRing.setPathEffect(Skia.PathEffect.MakeDash([5, 5], 0));
  const selectedRing = Skia.Paint();
  selectedRing.setStyle(1);
  selectedRing.setStrokeWidth(3);
  selectedRing.setColor(Skia.Color(theme.selectedRing));

  // Icon paints: full for tier I / single deeds, faded past it (the numeral
  // must read), greyscale ghosts for the locked states.
  const iconFull = Skia.Paint();
  const iconFaded = Skia.Paint();
  iconFaded.setAlphaf(0.55);
  const greyMatrix = (k: number) => [
    0.2126 * k, 0.7152 * k, 0.0722 * k, 0, 0,
    0.2126 * k, 0.7152 * k, 0.0722 * k, 0, 0,
    0.2126 * k, 0.7152 * k, 0.0722 * k, 0, 0,
    0, 0, 0, 1, 0,
  ];
  const ghostFrontier = Skia.Paint();
  ghostFrontier.setAlphaf(0.4);
  ghostFrontier.setColorFilter(Skia.ColorFilter.MakeMatrix(greyMatrix(0.5)));
  const ghostMystery = Skia.Paint();
  ghostMystery.setAlphaf(0.22);
  ghostMystery.setColorFilter(Skia.ColorFilter.MakeMatrix(greyMatrix(0.35)));

  const numeralFill = Skia.Paint();
  numeralFill.setColor(Skia.Color(theme.numeral));
  const numeralHalo = Skia.Paint();
  numeralHalo.setColor(Skia.Color("rgba(0,0,0,0.85)"));
  numeralHalo.setStyle(1);
  numeralHalo.setStrokeWidth(3);
  const numeralDim = Skia.Paint();
  numeralDim.setColor(Skia.Color(theme.labelTitleLocked));

  const titlePaint = Skia.Paint();
  titlePaint.setColor(Skia.Color(theme.labelTitle));
  const titleLockedPaint = Skia.Paint();
  titleLockedPaint.setColor(Skia.Color(theme.labelTitleLocked));
  const descPaint = Skia.Paint();
  descPaint.setColor(Skia.Color(theme.labelDesc));
  const mysteryPaint = Skia.Paint();
  mysteryPaint.setColor(Skia.Color(theme.labelMystery));

  const drawIcon = (node: BoardNode, paint: ReturnType<typeof Skia.Paint>): void => {
    const img = icons?.get(node.def.icon);
    if (!img) return;
    const side = node.radius * 1.6;
    canvas.drawImageRect(
      img,
      Skia.XYWHRect(0, 0, img.width(), img.height()),
      Skia.XYWHRect(node.x - side / 2, node.y - side / 2, side, side),
      paint,
    );
  };

  const drawCentred = (font: SkFont, text: string, x: number, y: number, paint: ReturnType<typeof Skia.Paint>): void => {
    const w = font.measureText(text).width;
    canvas.drawText(text, x - w / 2, y, paint, font);
  };

  for (const node of nodes) {
    const numeral = node.tier !== null ? (ROMAN[node.tier] ?? `${node.tier + 1}`) : null;

    if (node.vis === "unlocked") {
      canvas.drawCircle(node.x, node.y, node.radius + 10, glow);
      canvas.drawCircle(node.x, node.y, node.radius, baseFill);
      drawIcon(node, node.tier !== null && node.tier > 0 ? iconFaded : iconFull);
    } else {
      canvas.drawCircle(node.x, node.y, node.radius, frontierFill);
      drawIcon(node, node.vis === "frontier" ? ghostFrontier : ghostMystery);
      canvas.drawCircle(node.x, node.y, node.radius, frontierRing);
    }
    if (node.def.id === selectedId) {
      canvas.drawCircle(node.x, node.y, node.radius + 7, selectedRing);
    }

    // The numeral over the icon — halo first so it reads on any art.
    if (numeral !== null && node.vis !== "hidden") {
      const ny = node.y + 5;
      const w = fonts.numeral.measureText(numeral).width;
      canvas.drawText(numeral, node.x - w / 2, ny, numeralHalo, fonts.numeral);
      canvas.drawText(numeral, node.x - w / 2, ny, node.vis === "unlocked" ? numeralFill : numeralDim, fonts.numeral);
    }

    // Labels below (achievements.md § map, Tom 2026-08-04): unlocked =
    // title + description; frontier = title only; deeper = "???".
    let labelY = node.y + node.radius + 16;
    if (node.vis === "unlocked") {
      for (const line of wrapText(fonts.title, node.def.title, LABEL_WIDTH, 2)) {
        drawCentred(fonts.title, line, node.x, labelY, titlePaint);
        labelY += 12;
      }
      for (const line of wrapText(fonts.desc, node.def.description, LABEL_WIDTH, 2)) {
        drawCentred(fonts.desc, line, node.x, labelY, descPaint);
        labelY += 10;
      }
    } else if (node.vis === "frontier") {
      for (const line of wrapText(fonts.title, node.def.title, LABEL_WIDTH, 2)) {
        drawCentred(fonts.title, line, node.x, labelY, titleLockedPaint);
        labelY += 12;
      }
    } else {
      drawCentred(fonts.title, "???", node.x, labelY, mysteryPaint);
    }
  }

  return recorder.finishRecordingAsPicture();
};

export const DeedMap = ({ defs, unlocked, selectedId = null, onSelect, theme, icons, onRecenter }: DeedMapProps) => {
  const fullTheme = useMemo(() => ({ ...DEFAULT_DEED_MAP_THEME, ...theme }), [theme]);

  const fontFamily = Platform.select({ ios: "Copperplate", default: "serif" });
  const fonts = useMemo<Fonts>(
    () => ({
      numeral: matchFont({ fontFamily, fontSize: 15, fontWeight: "bold" }),
      title: matchFont({ fontFamily, fontSize: 10, fontWeight: "bold" }),
      desc: matchFont({ fontFamily: Platform.select({ ios: "Helvetica", default: "sans-serif" }), fontSize: 8 }),
    }),
    [fontFamily],
  );

  const nodes = useMemo(() => {
    const vis = visibility(defs, unlocked);
    const tiers = tierIndexes(defs);
    // EVERY def is on the board now (mystery nodes show "???"), so bounds
    // cover the whole authored world and never shift as things unlock.
    const world = worldBounds(defs.map((d) => d.pos));
    const list: BoardNode[] = defs.map((d) => ({
      def: d,
      vis: vis.get(d.id)!,
      x: d.pos.x - world.minX,
      y: d.pos.y - world.minY,
      radius: d.parent === null ? ROOT_RADIUS : NODE_RADIUS,
      tier: tiers.get(d.id) ?? null,
    }));
    return { list, byId: new Map(list.map((n) => [n.def.id, n])), world };
  }, [defs, unlocked]);

  // Subway lines: axis-aligned polylines, one SkPath per style so the
  // unlocked flow animates as a single draw.
  const edges = useMemo(() => {
    const obstacles: HitNode[] = nodes.list.map((n) => ({ id: n.def.id, x: n.x, y: n.y, radius: n.radius }));
    const flowing = Skia.Path.Make();
    const dormant = Skia.Path.Make();
    for (const node of nodes.list) {
      if (node.def.parent === null) continue;
      const parent = nodes.byId.get(node.def.parent);
      if (!parent) continue;
      const route = routeEdge(
        { id: parent.def.id, x: parent.x, y: parent.y },
        { id: node.def.id, x: node.x, y: node.y },
        obstacles,
      );
      const target = node.vis === "unlocked" ? flowing : dormant;
      target.moveTo(route[0]!.x, route[0]!.y);
      for (let i = 1; i < route.length; i++) target.lineTo(route[i]!.x, route[i]!.y);
    }
    return { flowing, dormant };
  }, [nodes]);

  const picture = useMemo(
    () => buildPicture(nodes.list, nodes.world, selectedId, fullTheme, icons, fonts, edges),
    [nodes, selectedId, fullTheme, icons, fonts, edges],
  );

  const [view, setView] = useState<{ w: number; h: number } | null>(null);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const startScale = useSharedValue(1);
  const focal0X = useSharedValue(0);
  const focal0Y = useSharedValue(0);
  const [placed, setPlaced] = useState(false);

  const worldW = nodes.world.width;
  const worldH = nodes.world.height;

  /** Home framing (root at viewport centre, scale 1) — the first placement
   * and the re-centre button's target. */
  const home = useRef({ tx: 0, ty: 0 });

  useEffect(() => {
    if (!view || placed) return;
    const root = nodes.list.find((n) => n.def.parent === null) ?? nodes.list[0];
    const at = root
      ? offsetFor(root.x, root.y, view.w / 2, view.h / 2, 1, nodes.world)
      : { tx: 0, ty: 0 };
    home.current = at;
    tx.value = at.tx;
    ty.value = at.ty;
    setPlaced(true);
  }, [view, placed, nodes, tx, ty]);

  const recenter = (): void => {
    const timing = { duration: 500, easing: Easing.out(Easing.cubic) };
    tx.value = withTiming(home.current.tx, timing);
    ty.value = withTiming(home.current.ty, timing);
    scale.value = withTiming(1, timing);
    onRecenter?.();
  };

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // One finger only — a two-finger touch is the pinch's, and a pan
        // fighting the pinch's focal math was why zoom never expanded on
        // the pinched point (Tom's device pass, 2026-08-04).
        .maxPointers(1)
        .minDistance(6)
        .onStart(() => {
          startTx.value = tx.value;
          startTy.value = ty.value;
        })
        .onUpdate((e) => {
          tx.value = startTx.value + e.translationX;
          ty.value = startTy.value + e.translationY;
        })
        .onEnd((e) => {
          tx.value = withDecay({ velocity: e.velocityX, deceleration: 0.995 });
          ty.value = withDecay({ velocity: e.velocityY, deceleration: 0.995 });
        }),
    [startTx, startTy, tx, ty],
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart((e) => {
          startTx.value = tx.value;
          startTy.value = ty.value;
          startScale.value = scale.value;
          focal0X.value = e.focalX;
          focal0Y.value = e.focalY;
        })
        .onUpdate((e) => {
          const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale.value * e.scale));
          // Anchor the canvas point under the INITIAL midpoint and let it
          // follow the CURRENT midpoint — zoom expands where you pinched,
          // and a two-finger drag pans: T' = F − C − (F₀ − T₀ − C)·(s'/s₀).
          const cx = worldW / 2;
          const cy = worldH / 2;
          const ratio = next / startScale.value;
          scale.value = next;
          tx.value = e.focalX - cx - (focal0X.value - startTx.value - cx) * ratio;
          ty.value = e.focalY - cy - (focal0Y.value - startTy.value - cy) * ratio;
        }),
    [startTx, startTy, startScale, focal0X, focal0Y, tx, ty, scale, worldW, worldH],
  );

  const handleTap = (px: number, py: number, atTx: number, atTy: number, atScale: number): void => {
    const p = screenToCanvas(px, py, atTx, atTy, atScale, nodes.world);
    const hits: HitNode[] = nodes.list.map((n) => ({ id: n.def.id, x: n.x, y: n.y, radius: n.radius }));
    onSelect?.(hitTest(hits, p.x, p.y));
  };

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDeltaX(10)
        .maxDeltaY(10)
        .onEnd((e, success) => {
          if (success) runOnJS(handleTap)(e.x, e.y, tx.value, ty.value, scale.value);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleTap reads latest props via closure each build
    [nodes, onSelect, tx, ty, scale],
  );

  const composed = useMemo(() => Gesture.Exclusive(Gesture.Simultaneous(pan, pinch), tap), [pan, pinch, tap]);

  const boardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <View
        style={{ flex: 1, overflow: "hidden" }}
        onLayout={(e) => setView({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {view && (
          <Animated.View style={[{ width: worldW, height: worldH, opacity: placed ? 1 : 0 }, boardStyle]}>
            {/* One static board layer — the glowing conduit on unlocked
                edges is baked in; nothing animates per-frame (the beads
                were cut 2026-08-04: cheap-looking, and the perf cost of
                animated edges never earned its keep). */}
            <Canvas style={{ width: worldW, height: worldH }}>
              <Picture picture={picture} />
            </Canvas>
          </Animated.View>
        )}
        {/* The way home on an infinite canvas — top-right so the screen's
            bottom detail card never covers it. */}
        {placed && (
          <Pressable
            onPress={recenter}
            hitSlop={8}
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              width: 44,
              height: 44,
              borderRadius: 22,
              borderWidth: 1.5,
              borderColor: fullTheme.unlockedRing,
              backgroundColor: "rgba(16,13,10,0.82)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: fullTheme.selectedRing, fontSize: 21, lineHeight: 24 }}>⌖</Text>
          </Pressable>
        )}
      </View>
    </GestureDetector>
  );
};
