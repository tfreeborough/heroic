import { useMemo, useRef } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Canvas, Circle, Fill, Group, Path, Rect } from "@shopify/react-native-skia";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";
import {
  addBody,
  approachVelocity,
  createBlockerBody,
  createMoverBody,
  createPhysicsWorld,
  faceMovement,
  getVelocityPerSecond,
  setVelocityPerSecond,
  STICK_ZERO,
  stepPhysics,
  useGameLoop,
  type StickSample,
} from "@heroic/engine";
import {
  ARENA_SIZE,
  ARENA_TILES,
  COLORS,
  PLAYER_ACCEL,
  PLAYER_DECEL,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  TILE_SIZE,
  WALL_THICKNESS,
} from "./constants";
import { Thumbstick } from "./Thumbstick";

/** Arena boundary walls, centred rects shared by physics bodies and rendering. */
const WALLS = (() => {
  const s = ARENA_SIZE;
  const t = WALL_THICKNESS;
  return [
    { x: s / 2, y: -t / 2, w: s + 2 * t, h: t },
    { x: s / 2, y: s + t / 2, w: s + 2 * t, h: t },
    { x: -t / 2, y: s / 2, w: t, h: s + 2 * t },
    { x: s + t / 2, y: s / 2, w: t, h: s + 2 * t },
  ];
})();

/** Arrowhead inside the player circle pointing along +x (rotated by facing). */
const NOTCH_PATH = (() => {
  const r = PLAYER_RADIUS;
  return `M ${r * 0.95} 0 L ${r * 0.15} ${-r * 0.5} L ${r * 0.15} ${r * 0.5} Z`;
})();

export const GameScreen = () => {
  const { width, height } = useWindowDimensions();
  // Camera anchor: centre of the upper two thirds — the bottom third is controls.
  const anchorX = width / 2;
  const anchorY = height / 3;

  // Latest stick input, written by gesture callbacks and read by the sim each
  // step. A ref (not state) so input never causes a React render.
  const stickRef = useRef<StickSample>(STICK_ZERO);

  const { physics, player } = useMemo(() => {
    const physics = createPhysicsWorld();
    const player = createMoverBody(ARENA_SIZE / 2, ARENA_SIZE / 2, PLAYER_RADIUS);
    addBody(physics, player);
    for (const w of WALLS) addBody(physics, createBlockerBody(w.x, w.y, w.w, w.h));
    return { physics, player };
  }, []);

  // Previous + current simulated state, so the renderer can interpolate
  // between fixed steps (render fps and sim fps are decoupled).
  const sim = useRef({
    prevX: ARENA_SIZE / 2,
    prevY: ARENA_SIZE / 2,
    currX: ARENA_SIZE / 2,
    currY: ARENA_SIZE / 2,
    facing: -Math.PI / 2, // face "up" until the first input
  });

  // What the renderer sees. Written from the game loop, read by Skia via
  // Reanimated — no React re-renders during gameplay.
  const playerX = useSharedValue(ARENA_SIZE / 2);
  const playerY = useSharedValue(ARENA_SIZE / 2);
  const facing = useSharedValue(sim.current.facing);

  useGameLoop({
    onStep: (dt) => {
      const s = sim.current;
      const stick = stickRef.current;
      s.prevX = s.currX;
      s.prevY = s.currY;

      // The stick sets a *desired* velocity; the actual velocity chases it at
      // a capped rate, giving a short ramp-up and a small skid on release.
      const speed = PLAYER_MAX_SPEED * stick.magnitude;
      const desired = { x: stick.dir.x * speed, y: stick.dir.y * speed };
      const vel = approachVelocity(
        getVelocityPerSecond(player),
        desired,
        dt,
        PLAYER_ACCEL,
        PLAYER_DECEL,
      );
      setVelocityPerSecond(player, vel.x, vel.y);
      stepPhysics(physics, dt);

      s.currX = player.position.x;
      s.currY = player.position.y;
      // Facing follows input intent, not resolved velocity — sliding along a
      // wall shouldn't twist the character.
      s.facing = faceMovement(s.facing, stick);
    },
    onRender: (alpha) => {
      const s = sim.current;
      playerX.value = s.prevX + (s.currX - s.prevX) * alpha;
      playerY.value = s.prevY + (s.currY - s.prevY) * alpha;
      facing.value = s.facing;
    },
  });

  const cameraTransform = useDerivedValue(() => [
    { translateX: anchorX - playerX.value },
    { translateY: anchorY - playerY.value },
  ]);

  const playerTransform = useDerivedValue(() => [
    { translateX: playerX.value },
    { translateY: playerY.value },
    { rotate: facing.value },
  ]);

  // The checkerboard: a light base rect plus the dark squares on top. Static
  // elements — only the camera transform changes per frame.
  const darkTiles = useMemo(() => {
    const tiles: { x: number; y: number }[] = [];
    for (let row = 0; row < ARENA_TILES; row++) {
      for (let col = 0; col < ARENA_TILES; col++) {
        if ((row + col) % 2 === 1) tiles.push({ x: col * TILE_SIZE, y: row * TILE_SIZE });
      }
    }
    return tiles;
  }, []);

  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color={COLORS.void} />
        <Group transform={cameraTransform}>
          <Rect x={0} y={0} width={ARENA_SIZE} height={ARENA_SIZE} color={COLORS.tileLight} />
          {darkTiles.map((t) => (
            <Rect
              key={`${t.x}:${t.y}`}
              x={t.x}
              y={t.y}
              width={TILE_SIZE}
              height={TILE_SIZE}
              color={COLORS.tileDark}
            />
          ))}
          {WALLS.map((w) => (
            <Rect
              key={`${w.x}:${w.y}`}
              x={w.x - w.w / 2}
              y={w.y - w.h / 2}
              width={w.w}
              height={w.h}
              color={COLORS.wall}
            />
          ))}
          <Group transform={playerTransform}>
            <Circle cx={0} cy={0} r={PLAYER_RADIUS} color={COLORS.player} />
            <Path path={NOTCH_PATH} color={COLORS.playerNotch} />
          </Group>
        </Group>
      </Canvas>

      <View style={styles.controls}>
        <Thumbstick onChange={(sample) => (stickRef.current = sample)} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.void,
  },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "33%",
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 16,
  },
});
