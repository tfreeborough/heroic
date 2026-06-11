import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Canvas, Circle, Fill, Group, Path, Picture, Rect } from "@shopify/react-native-skia";
import { Easing, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import {
  addBody,
  addVelocityPerSecond,
  angleTo,
  approachVelocity,
  ATTACK_CYCLE_READY,
  createBlockerBody,
  createMoverBody,
  createPhysicsWorld,
  createRng,
  distance,
  faceMovement,
  getVelocityPerSecond,
  hitsInArc,
  makeCombatant,
  normalize,
  removeBody,
  resetBody,
  resolveAttack,
  selectTarget,
  setVelocityPerSecond,
  spawnVolley,
  stepAttackCycle,
  stepPhysics,
  stepProjectile,
  STICK_ZERO,
  sub,
  useGameLoop,
  type AttackCycleState,
  type Combatant,
  type HurtCircle,
  type ProjectileState,
  type StickSample,
  type Vec2,
} from "@heroic/engine";
import {
  ARC_FLASH_DURATION,
  ARENA_SIZE,
  ARENA_TILES,
  CAMERA_FIT_MARGIN,
  CAMERA_MIN_RADIUS,
  COLORS,
  CONTROLS_MIN_HEIGHT,
  DAMAGE_NUMBER_LIFE,
  DAMAGE_NUMBER_RISE,
  DUMMY_DEFENSE,
  DUMMY_FRICTION_AIR,
  DUMMY_MAX_HP,
  DUMMY_RADIUS,
  DUMMY_RESPAWN,
  DUMMY_SPAWNS,
  ENGAGEMENT_MARGIN,
  HIT_FLASH_DURATION,
  PLAY_HEIGHT_RATIO,
  PLAYER_ACCEL,
  PLAYER_DECEL,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  TILE_SIZE,
  WALL_THICKNESS,
} from "./constants";
import { WEAPONS, type WeaponDef, type WeaponId } from "./weapons";
import { Thumbstick } from "./Thumbstick";
import { WeaponPicker } from "./WeaponPicker";
import { EMPTY_COMBAT_PICTURE, recordCombatScene } from "./renderCombat";

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

/** A training dummy: a stationary hostile that soaks hits and respawns. */
interface Dummy {
  id: number;
  body: ReturnType<typeof createMoverBody>;
  combatant: Combatant;
  spawn: Vec2;
  /** Seconds of white hit-flash left. */
  flash: number;
  /** Seconds until respawn; null while alive. */
  respawnIn: number | null;
}

/** A projectile in flight plus everything needed to resolve its hits later. */
interface FlightProjectile extends ProjectileState {
  color: string;
  knockback: number;
  /** The firing weapon's stat block — kept so a mid-flight weapon swap can't retag the shot. */
  attacker: Combatant;
}

interface FlyingNumber {
  x: number;
  y: number;
  text: string;
  crit: boolean;
  age: number;
}

interface ArcFlash {
  x: number;
  y: number;
  facing: number;
  age: number;
}

export const GameScreen = () => {
  const { width, height } = useWindowDimensions();
  // Vertical layout: the play space targets 3:4 (w:h); the control deck takes
  // the remaining height but never less than CONTROLS_MIN_HEIGHT — on short
  // screens the play space shrinks instead. Taller screens just see more
  // world above/below, which is fine in singleplayer.
  const playHeight = Math.min(Math.round(width * PLAY_HEIGHT_RATIO), height - CONTROLS_MIN_HEIGHT);
  const anchorX = width / 2;
  const anchorY = playHeight / 2;
  const stickSize = Math.min(200, Math.round(width * 0.44));

  // The camera pins to the *equipped* weapon: zoom out just enough that its
  // attack-range ring fits the play-space width. A floor on the framed world
  // radius keeps short-reach melee from zooming in claustrophobically; the
  // 1:1 cap keeps big screens from zooming in past native scale.
  const zoomFor = (weapon: WeaponDef): number => {
    const framed = Math.max(weapon.config.reach + DUMMY_RADIUS, CAMERA_MIN_RADIUS);
    return Math.min(1, (width / 2 - CAMERA_FIT_MARGIN) / framed);
  };

  // Latest stick input, written by gesture callbacks and read by the sim each
  // step. A ref (not state) so input never causes a React render.
  const stickRef = useRef<StickSample>(STICK_ZERO);

  const { physics, player, dummies, weaponCombatants, rng } = useMemo(() => {
    const physics = createPhysicsWorld();
    const player = createMoverBody(ARENA_SIZE / 2, ARENA_SIZE / 2, PLAYER_RADIUS);
    addBody(physics, player);
    for (const w of WALLS) addBody(physics, createBlockerBody(w.x, w.y, w.w, w.h));

    const dummies: Dummy[] = DUMMY_SPAWNS.map((spawn, i) => {
      const body = createMoverBody(spawn.x, spawn.y, DUMMY_RADIUS, {
        frictionAir: DUMMY_FRICTION_AIR,
      });
      addBody(physics, body);
      return {
        id: i + 1,
        body,
        combatant: makeCombatant({
          maxHp: DUMMY_MAX_HP,
          attack: 0,
          defense: DUMMY_DEFENSE,
          critChance: 0,
          critMultiplier: 1,
        }),
        spawn,
        flash: 0,
        respawnIn: null,
      };
    });

    // One attacker stat block per weapon, reused across strikes (resolveAttack
    // only reads the attacker's stats — hp is irrelevant on this side).
    const weaponCombatants = new Map<WeaponId, Combatant>(
      WEAPONS.map((w) => [w.id, makeCombatant(w.stats)]),
    );

    return { physics, player, dummies, weaponCombatants, rng: createRng(0xc0ffee) };
  }, []);

  // Combat state lives in a ref: it's stepped by the game loop, never rendered
  // through React. The weapon picker is the only React-state piece.
  const combat = useRef({
    weapon: WEAPONS[0]!,
    cycle: ATTACK_CYCLE_READY as AttackCycleState,
    targetId: null as number | null,
    lockedId: null as number | null,
    lockedFacing: 0,
    projectiles: [] as FlightProjectile[],
    numbers: [] as FlyingNumber[],
    arcFlashes: [] as ArcFlash[],
  });

  const [weaponId, setWeaponId] = useState<WeaponId>(combat.current.weapon.id);
  const selectWeapon = (id: WeaponId) => {
    setWeaponId(id);
    const c = combat.current;
    c.weapon = WEAPONS.find((w) => w.id === id) as WeaponDef;
    // Swapping resets the cycle — no carrying a greatsword windup into a bow.
    c.cycle = ATTACK_CYCLE_READY;
    c.lockedId = null;
  };

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
  const combatPicture = useSharedValue(EMPTY_COMBAT_PICTURE);

  // Eased so a swap reads as a deliberate reframe, not a snap cut.
  const zoom = useSharedValue(zoomFor(combat.current.weapon));
  useEffect(() => {
    const weapon = WEAPONS.find((w) => w.id === weaponId) as WeaponDef;
    zoom.value = withTiming(zoomFor(weapon), {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
  }, [weaponId, width]);

  useGameLoop({
    onStep: (dt) => {
      const s = sim.current;
      const c = combat.current;
      const stick = stickRef.current;
      s.prevX = s.currX;
      s.prevY = s.currY;

      // --- Movement: the stick sets a *desired* velocity; the actual velocity
      // chases it at a capped rate (short ramp-up, small skid on release).
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
      const playerPos = { x: s.currX, y: s.currY };

      // --- Dummy upkeep: flash decay and respawns.
      for (const d of dummies) {
        d.flash = Math.max(0, d.flash - dt);
        if (d.respawnIn !== null) {
          d.respawnIn -= dt;
          if (d.respawnIn <= 0) {
            d.respawnIn = null;
            d.combatant.hp = d.combatant.stats.maxHp;
            resetBody(d.body, d.spawn.x, d.spawn.y);
            addBody(physics, d.body);
          }
        }
      }
      const aliveDummies = () => dummies.filter((d) => d.respawnIn === null);
      const hurtCircles = (): HurtCircle[] =>
        aliveDummies().map((d) => ({ id: d.id, pos: d.body.position, radius: DUMMY_RADIUS }));

      const applyHit = (d: Dummy, dir: Vec2, knockback: number, attacker: Combatant): void => {
        const result = resolveAttack(attacker, d.combatant, rng);
        d.flash = HIT_FLASH_DURATION;
        if (knockback > 0) addVelocityPerSecond(d.body, dir.x * knockback, dir.y * knockback);
        c.numbers.push({
          x: d.body.position.x,
          y: d.body.position.y - DUMMY_RADIUS - 16,
          text: String(result.damage),
          crit: result.crit,
          age: 0,
        });
        if (result.lethal) {
          d.respawnIn = DUMMY_RESPAWN;
          removeBody(physics, d.body);
          if (c.lockedId === d.id) c.lockedId = null;
        }
      };

      // --- Targeting: nearest hostile with hysteresis, inside the engagement
      // radius (which sits a margin beyond the weapon's attack range).
      const cfg = c.weapon.config;
      const engagement = cfg.reach + ENGAGEMENT_MARGIN;
      c.targetId = selectTarget(
        aliveDummies().map((d) => ({ id: d.id, pos: d.body.position })),
        playerPos,
        engagement,
        c.targetId,
      );
      const target = aliveDummies().find((d) => d.id === c.targetId) ?? null;

      // --- Attack cycle. Range gates on the target's edge; the windup lock
      // breaks if the locked target dies or leaves engagement.
      const locked = aliveDummies().find((d) => d.id === c.lockedId) ?? null;
      const step = stepAttackCycle(c.cycle, cfg, dt, {
        targetInRange:
          target !== null &&
          distance(playerPos, target.body.position) - DUMMY_RADIUS <= cfg.reach,
        lockValid: locked !== null && distance(playerPos, locked.body.position) <= engagement,
      });
      c.cycle = step.state;
      if (step.windupStarted && target) {
        c.lockedId = target.id;
        c.lockedFacing = angleTo(playerPos, target.body.position);
      }
      if (step.lockBroken) c.lockedId = null;

      if (step.struck) {
        if (cfg.shape === "arc") {
          // Melee is facing-authoritative: cleave whatever is in the cone now,
          // locked target or not (see whiff rules in the movement doc).
          for (const id of hitsInArc(playerPos, c.lockedFacing, cfg.reach, cfg.arcWidth!, hurtCircles())) {
            const d = dummies.find((dd) => dd.id === id)!;
            const dir = normalize(sub(d.body.position, playerPos));
            applyHit(d, dir, cfg.knockback ?? 0, weaponCombatants.get(c.weapon.id)!);
          }
          c.arcFlashes.push({ x: s.currX, y: s.currY, facing: c.lockedFacing, age: 0 });
        } else if (locked) {
          // Ranged auto-aims at the target's position at the moment of Strike.
          // The volley's flight pattern (straight, pincer, ...) is weapon data.
          for (const p of spawnVolley(playerPos, locked.body.position, {
            speed: cfg.projectileSpeed!,
            radius: c.weapon.projectileRadius,
            // Fly a little past attack range so a kiting target can't outrun
            // a shot that was legal when it fired (curved arms also spend
            // some of their range on the arc itself).
            maxRange: cfg.reach + 120,
            pierce: cfg.pierce,
            count: cfg.projectileCount,
            flight: cfg.flight,
            curveAngle: cfg.curveAngle,
          })) {
            c.projectiles.push({
              ...p,
              color: c.weapon.color,
              knockback: cfg.knockback ?? 0,
              attacker: weaponCombatants.get(c.weapon.id)!,
            });
          }
        }
        c.lockedId = null;
      }

      // --- Projectiles: move, resolve hits, expire on range/pierce/walls.
      for (let i = c.projectiles.length - 1; i >= 0; i--) {
        const p = c.projectiles[i]!;
        const result = stepProjectile(p, dt, hurtCircles());
        for (const id of result.hits) {
          applyHit(dummies.find((dd) => dd.id === id)!, p.dir, p.knockback, p.attacker);
        }
        const hitWall =
          p.pos.x < 0 || p.pos.x > ARENA_SIZE || p.pos.y < 0 || p.pos.y > ARENA_SIZE;
        if (result.expired || hitWall) c.projectiles.splice(i, 1);
      }

      // --- Facing: locked during windup; re-tracks the target otherwise;
      // falls back to movement direction when nothing is engaged.
      const faceTarget = aliveDummies().find((d) => d.id === c.targetId);
      if (c.cycle.phase === "windup") {
        s.facing = c.lockedFacing;
      } else if (faceTarget) {
        s.facing = angleTo(playerPos, faceTarget.body.position);
      } else {
        s.facing = faceMovement(s.facing, stick);
      }

      // --- Transient effects.
      for (let i = c.numbers.length - 1; i >= 0; i--) {
        const n = c.numbers[i]!;
        n.age += dt;
        n.y -= DAMAGE_NUMBER_RISE * dt;
        if (n.age >= DAMAGE_NUMBER_LIFE) c.numbers.splice(i, 1);
      }
      for (let i = c.arcFlashes.length - 1; i >= 0; i--) {
        const f = c.arcFlashes[i]!;
        f.age += dt;
        if (f.age >= ARC_FLASH_DURATION) c.arcFlashes.splice(i, 1);
      }
    },
    onRender: (alpha) => {
      const s = sim.current;
      const c = combat.current;
      playerX.value = s.prevX + (s.currX - s.prevX) * alpha;
      playerY.value = s.prevY + (s.currY - s.prevY) * alpha;
      facing.value = s.facing;

      const lockedDummy =
        c.cycle.phase === "windup"
          ? dummies.find((d) => d.id === c.lockedId && d.respawnIn === null)
          : undefined;
      combatPicture.value = recordCombatScene({
        player: { x: playerX.value, y: playerY.value },
        weapon: c.weapon,
        windup:
          c.cycle.phase === "windup"
            ? {
                progress: 1 - c.cycle.remaining / c.weapon.config.windup,
                facing: c.lockedFacing,
                targetX: lockedDummy?.body.position.x ?? playerX.value,
                targetY: lockedDummy?.body.position.y ?? playerY.value,
              }
            : null,
        targetId: c.targetId,
        dummies: dummies
          .filter((d) => d.respawnIn === null)
          .map((d) => ({
            id: d.id,
            x: d.body.position.x,
            y: d.body.position.y,
            hpFrac: d.combatant.hp / d.combatant.stats.maxHp,
            flash: d.flash / HIT_FLASH_DURATION,
          })),
        projectiles: c.projectiles.map((p) => ({
          x: p.pos.x,
          y: p.pos.y,
          dirX: p.dir.x,
          dirY: p.dir.y,
          radius: p.radius,
          color: p.color,
        })),
        numbers: c.numbers.map((n) => ({
          x: n.x,
          y: n.y,
          text: n.text,
          crit: n.crit,
          fade: 1 - n.age / DAMAGE_NUMBER_LIFE,
        })),
        arcFlashes: c.arcFlashes.map((f) => ({
          x: f.x,
          y: f.y,
          facing: f.facing,
          fade: 1 - f.age / ARC_FLASH_DURATION,
        })),
      });
    },
  });

  // World → screen: scale around the anchor (where the player sits), i.e.
  // translate(anchor) ∘ scale(zoom) ∘ translate(-player).
  const cameraTransform = useDerivedValue(() => [
    { translateX: anchorX },
    { translateY: anchorY },
    { scale: zoom.value },
    { translateX: -playerX.value },
    { translateY: -playerY.value },
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
      <View style={[styles.playArea, { height: playHeight }]}>
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
            <Picture picture={combatPicture} />
            <Group transform={playerTransform}>
              <Circle cx={0} cy={0} r={PLAYER_RADIUS} color={COLORS.player} />
              <Path path={NOTCH_PATH} color={COLORS.playerNotch} />
            </Group>
          </Group>
        </Canvas>
      </View>

      <View style={styles.controls}>
        <WeaponPicker selected={weaponId} onSelect={selectWeapon} />
        <Thumbstick size={stickSize} onChange={(sample) => (stickRef.current = sample)} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.void,
  },
  playArea: {
    width: "100%",
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  controls: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
});
