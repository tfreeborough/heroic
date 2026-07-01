import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Canvas, Fill, Picture, useFont, type SkPicture } from "@shopify/react-native-skia";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useIsFocused } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { GrenzeGotisch_700Bold } from "@expo-google-fonts/grenze-gotisch";
import { useSettings } from "../settings/SettingsContext";
import type { RootStackParamList } from "../navigation/types";
import { UI } from "../ui/theme";
import {
  addBody,
  addVelocityPerSecond,
  angleTo,
  approachVelocity,
  ATTACK_CYCLE_READY,
  brainTelegraph,
  buildNavGrid,
  closestPointOnAabb,
  computeFlowField,
  createAudioDirector,
  createBlockerBody,
  createFlowField,
  createFogGrid,
  createMoverBody,
  createPhysicsWorld,
  createMover,
  createRng,
  createSpatialGrid,
  distance,
  distanceToAabb,
  faceMovement,
  forEachNeighbor,
  getVelocityPerSecond,
  hitsInArc,
  initMusicState,
  makeCombatant,
  makeCreatureBrain,
  markVisibleCircle,
  normalize,
  rebuildGrid,
  releaseNavBlocker,
  rectEdges,
  removeBody,
  resolveAttack,
  segmentClear,
  selectTarget,
  setVelocityPerSecond,
  spawnVolley,
  stepAbility,
  stepAttackCycle,
  stepMusicState,
  stepCrowd,
  stepPhysics,
  stepProjectile,
  stepSpawner,
  parseSpawnerConfig,
  parseCreatureId,
  initSpawnerState,
  addKey,
  spendKey,
  hasKey,
  emptyInventory,
  isKeyColor,
  playerAtDoor,
  playerAtKey,
  SPAWNER_NEST_TILES,
  STICK_ZERO,
  sub,
  tickBrain,
  useGameLoop,
  type Aabb,
  type AttackCycleState,
  type AudioDirector,
  type Brain,
  type Breakable,
  type Combatant,
  type FlowField,
  type CombatStats,
  type HurtCircle,
  type HurtTarget,
  type KeyColor,
  type KeyInventory,
  type Mover,
  type NavGrid,
  type ProjectileState,
  type SpawnerConfig,
  type SpawnerState,
  type StickSample,
  type Vec2,
  type VisionSegment,
} from "@heroic/engine";
import {
  ARC_FLASH_DURATION,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  CAMERA_FIT_MARGIN,
  CAMERA_FOLLOW_RATE,
  CAMERA_FRAME_PADDING,
  CAMERA_MIN_RADIUS,
  COLORS,
  COMBAT_MUSIC_RADIUS,
  CONTROLS_MIN_HEIGHT,
  CREATURES,
  CREATURE_VISUALS,
  CROWD_PUSH,
  DAMAGE_NUMBER_LIFE,
  DAMAGE_NUMBER_RISE,
  ENEMY_ACCEL,
  ENEMY_DECEL,
  ENEMY_GRID_CELL,
  ENEMY_RADIUS,
  ENGAGEMENT_MARGIN,
  EXPLOSION_FUSE_DELAY,
  EXPLOSION_FX_DURATION,
  EXPLOSION_KNOCKBACK,
  FLOW_MIN_ENEMIES,
  FLOW_RADIUS,
  FLOW_RESWEEP_STEPS,
  FOG_CELL,
  HIT_FLASH_DURATION,
  LOS_RECHECK_STEPS,
  LOW_HP_PULSE_MAX_HZ,
  LOW_HP_PULSE_MIN_HZ,
  LOW_HP_THRESHOLD,
  MAX_REPATHS_PER_STEP,
  NAV_CELL,
  OFFSCREEN_SIM_MARGIN,
  OCCLUDERS,
  PLAY_HEIGHT_RATIO,
  PLAYER_ACCEL,
  PLAYER_DECEL,
  PLAYER_IFRAMES,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  PLAYER_STATS,
  PILLARS,
  SOLIDS,
  SPAWN,
  VISION,
  WALLS,
  ZONE,
  type EnemyTypeId,
} from "./constants";
import { WEAPONS, type WeaponDef, type WeaponId } from "./weapons";
import { AUDIO_MANIFEST } from "./audio/manifest";
import { playStrikeHaptic } from "./haptics";
import { Thumbstick } from "./Thumbstick";
import { KeyHud } from "./KeyHud";
import { DoorNotice } from "./DoorNotice";
import { WeaponButton } from "./WeaponButton";
import { DashButton, DASH_READY_PICTURE, recordDashButton } from "./DashButton";
import {
  applyDashShove,
  beginDash,
  createDashRuntime,
  dashCooldownFrac,
  dashInvulnerable,
  dashVelocity,
  DASH_CONFIG,
  isDashing,
  tickDashInvuln,
} from "./skills/dash";
import { EMPTY_COMBAT_PICTURE, recordCombatScene, RENDER_PHASES, setRenderDebug, setRenderProfiling, type CombatScene } from "./renderCombat";
import { bakeFloorChunks } from "./zoneRender";

/** A hostile with a brain: chases/circles/kites per its type, soaks hits. */
interface Enemy {
  id: number;
  type: EnemyTypeId;
  /** Flies over voids: routes/collides against walls only, ignoring chasms. */
  flying: boolean;
  /** Kinematic mover (position + velocity, px/s): integrated and collided in core. */
  mover: Mover;
  combatant: Combatant;
  brain: Brain;
  /** Cached line-of-sight to the player, refreshed every LOS_RECHECK_STEPS steps. */
  los: boolean;
  /** Steps until the next LOS recheck (staggered per enemy so they don't all align). */
  losTimer: number;
  /** Seconds of white hit-flash left. */
  flash: number;
  /** Ranged creatures only (else null): their attack cycle + attacker stats. */
  cycle: AttackCycleState | null;
  attackCombatant: Combatant | null;
  /** Summoners only (else null): their summon cycle + the ids of living minions. */
  summonCycle: AttackCycleState | null;
  minionIds: number[];
  /**
   * Render interpolation: body position at the previous and current sim step.
   * The renderer lerps between them by the frame alpha, so enemies move as
   * smoothly as the (interpolated) camera — without this they snap at the sim
   * rate and their bars/rings jitter against the scrolling world while you move.
   */
  prevX: number;
  prevY: number;
  currX: number;
  currY: number;
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
  /** True for damage the *player* took (rendered red). */
  hostile: boolean;
  age: number;
}

interface ArcFlash {
  x: number;
  y: number;
  facing: number;
  age: number;
}

/** A transient explosion VFX (cosmetic only — damage is dealt instantly on break). */
interface Explosion {
  x: number;
  y: number;
  /** The AoE radius it dealt damage in; the shockwave ring grows to this. */
  radius: number;
  age: number;
  /** Per-blast angle offset so the debris sparks don't all point the same way. */
  seed: number;
}

/** A breakable resolved for this session: zone state plus transient battle state. */
interface LiveBreakable extends Breakable {
  /** Seconds of white hit-flash left (the same feedback a struck enemy gets). */
  flash: number;
  /**
   * Fuse: seconds until detonation once primed (hp hit 0 on an explosive one),
   * else null. While set the barrel still blocks but can't be re-hit/re-primed,
   * and glows hotter as it counts down; at 0 it actually bursts (see breakOne).
   */
  fuse: number | null;
}

/**
 * A key pickup resolved for this session: its color, world position, and whether
 * it's been collected. A collected key vanishes from the world and is skipped by
 * the pickup pass — there's no respawn within a run.
 */
interface LiveKey {
  id: string;
  color: KeyColor;
  x: number;
  y: number;
  taken: boolean;
}

/**
 * A spawner nest (docs/design/spawners.md). The destructible *structure* is a
 * `LiveBreakable` (`kind: "spawner"`) held in the breakables list, so it reuses
 * the whole hit / auto-target / world-geometry / render path — to the combat
 * system a nest is just a solid box with hp. This record adds the behaviour: the
 * pure FSM state, the parsed config, and the ids of the creatures it has spawned
 * (to enforce the max-alive cap).
 */
interface SpawnerRuntime {
  id: string;
  config: SpawnerConfig;
  state: SpawnerState;
  /** The destructible structure standing in for this nest in `breakables`. */
  nest: LiveBreakable;
  /** Ids of this nest's currently-living spawned creatures. */
  liveIds: number[];
  /** Latched once the player has had line of sight to the nest — it stays silent
   *  until revealed, so breaking open a wall to expose it is when it springs to life. */
  everSeen: boolean;
}

/**
 * Recompute the dynamic world geometry from the *alive* breakables. The crowd
 * walls, the sight/projectile occluders, and the enemy nav grid each fold every
 * standing breakable in on top of the static zone. Two movement domains:
 *   - **grounded** builds on SOLIDS (walls + voids — nothing walks into a chasm);
 *   - **flying** builds on PILLARS (walls only — flyers cross voids), so flying
 *     enemies path over and hover above a pit while ground enemies are fenced out.
 * Both fold in standing breakables (a flyer is still stopped by a crate/wall).
 * Occluders build on OCCLUDERS (walls only — you see/shoot across a void either way).
 * Built in full at load; on a break the cheap walls/occluders are re-derived
 * (computeDynamicGeometry) while the nav grids reopen just the downed box's cells
 * in place (releaseNavBlocker) — so a wall opens collision, sightline, and pathing
 * at once without a full-grid rebuild (see docs/design/world-representation.md).
 */
const computeDynamicGeometry = (
  breakables: readonly LiveBreakable[],
): {
  walls: Aabb[];
  flyingWalls: Aabb[];
  occluders: VisionSegment[];
  visionOccluders: VisionSegment[];
} => {
  const liveBoxes = breakables.filter((b) => b.alive).map((b) => b.box);
  const walls = liveBoxes.length > 0 ? [...SOLIDS, ...liveBoxes] : SOLIDS;
  const flyingWalls = liveBoxes.length > 0 ? [...PILLARS, ...liveBoxes] : PILLARS;
  // A locked door is a one-way window, so it needs TWO occluder sets:
  //   - `occluders` (enemy line-of-sight, auto-target, projectiles): a door DOES
  //     block these, so enemies can't detect or shoot the player through it (nor
  //     the player through it). Any occluding wall, OR any door (its `lock`),
  //     whatever the door's own `occludes` flag says.
  //   - `visionOccluders` (the PLAYER's fog of war only): a door does NOT block
  //     this, so the player's lit radius spills through into the room beyond.
  //     Occluding walls only — doors excluded.
  // Both still block *movement* (they're in liveBoxes above). See docs/design/doors-and-keys.md.
  const edges = (b: LiveBreakable) => rectEdges(b.box.x, b.box.y, b.box.w, b.box.h);
  const occludingEdges = breakables
    .filter((b) => b.alive && (b.occludes || b.lock != null))
    .flatMap(edges);
  const visionEdges = breakables
    .filter((b) => b.alive && b.occludes && b.lock == null)
    .flatMap(edges);
  const occluders = occludingEdges.length > 0 ? [...OCCLUDERS, ...occludingEdges] : OCCLUDERS;
  const visionOccluders = visionEdges.length > 0 ? [...OCCLUDERS, ...visionEdges] : OCCLUDERS;
  return { walls, flyingWalls, occluders, visionOccluders };
};

const computeWorld = (
  breakables: readonly LiveBreakable[],
): {
  walls: Aabb[];
  flyingWalls: Aabb[];
  occluders: VisionSegment[];
  visionOccluders: VisionSegment[];
  navGrid: NavGrid;
  flyingNavGrid: NavGrid;
} => {
  const dyn = computeDynamicGeometry(breakables);
  const navGrid = buildNavGrid(ARENA_WIDTH, NAV_CELL, dyn.walls, ENEMY_RADIUS, ARENA_HEIGHT);
  const flyingNavGrid = buildNavGrid(ARENA_WIDTH, NAV_CELL, dyn.flyingWalls, ENEMY_RADIUS, ARENA_HEIGHT);
  return { ...dyn, navGrid, flyingNavGrid };
};

/**
 * Defender stats for a breakable taking a hit: no defense, so it takes damage at
 * face value through resolveAttack (only `hp` matters; the rest is unused here).
 */
const BREAKABLE_STATS: CombatStats = {
  maxHp: 1,
  attack: 0,
  defense: 0,
  critChance: 0,
  critMultiplier: 1,
};

/** The thing the player is currently auto-attacking — an enemy or a breakable. */
type ActiveTarget =
  | { kind: "enemy"; id: number; enemy: Enemy; pos: Vec2 }
  | { kind: "breakable"; id: number; breakable: LiveBreakable; pos: Vec2 };

/** Largest explosion radius across a breakable's onBreak effects (0 if it doesn't explode). */
const blastRadius = (b: LiveBreakable): number =>
  b.onBreak.reduce((m, e) => (e.type === "explode" ? Math.max(m, e.radius) : m), 0);

export const GameScreen = () => {
  const { width, height } = useWindowDimensions();
  // System-bar insets: the app draws edge-to-edge (Android default), so the
  // bottom navigation bar would otherwise overlap the control deck. We reserve
  // the bottom inset out of the play space (below) and pad the deck past it.
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Player settings (volume, control layout). Read live: the audio effect below
  // pushes volume changes into the director, and the control deck flips sides.
  const { settings } = useSettings();

  // Pause the sim whenever the Game screen isn't the focused route — i.e. while
  // the Pause overlay or Settings sit on top of it. The screen stays mounted, so
  // the run resumes exactly where it left off; we just stop stepping. Mirrored to
  // a ref so onStep can read it without the loop restarting on focus changes.
  const isFocused = useIsFocused();
  const pausedRef = useRef(false);
  pausedRef.current = !isFocused;

  // Fantasy HUD font for the floating damage numbers, at the two sizes the scene
  // draws (crit is larger). Each is null until loaded; renderCombat falls back to
  // the system font meanwhile, so numbers are never missing.
  const damageFont = useFont(GrenzeGotisch_700Bold, 16);
  const critFont = useFont(GrenzeGotisch_700Bold, 21);

  // Vertical layout: the play space targets 3:4 (w:h); the control deck takes
  // the remaining height but never less than CONTROLS_MIN_HEIGHT *above the nav
  // bar* — on short screens the play space shrinks instead. Taller screens just
  // see more world above/below, which is fine in singleplayer.
  const playHeight = Math.min(
    Math.round(width * PLAY_HEIGHT_RATIO),
    height - CONTROLS_MIN_HEIGHT - insets.bottom,
  );
  const anchorX = width / 2;
  const anchorY = playHeight / 2;
  const stickSize = Math.min(200, Math.round(width * 0.44));

  // The camera pins to the *equipped* weapon: zoom out just enough that its
  // attack-range ring fits the play-space width. A floor on the framed world
  // radius keeps short-reach melee from zooming in claustrophobically; the
  // 1:1 cap keeps big screens from zooming in past native scale.
  const zoomFor = (weapon: WeaponDef): number => {
    const framed =
      Math.max(weapon.config.reach + ENEMY_RADIUS, CAMERA_MIN_RADIUS) * CAMERA_FRAME_PADDING;
    return Math.min(1, (width / 2 - CAMERA_FIT_MARGIN) / framed);
  };

  // Latest stick input, written by gesture callbacks and read by the sim each
  // step. A ref (not state) so input never causes a React render.
  const stickRef = useRef<StickSample>(STICK_ZERO);

  const { physics, player, weaponCombatants, rng, breakables, breakableBodies, spawners, keys } =
    useMemo(() => {
    const physics = createPhysicsWorld();
    const player = createMoverBody(SPAWN.x, SPAWN.y, PLAYER_RADIUS);
    addBody(physics, player);
    for (const w of WALLS) addBody(physics, createBlockerBody(w.x, w.y, w.w, w.h));
    // Every movement-blocker (walls + voids), so the player can't walk into a void.
    for (const p of SOLIDS) addBody(physics, createBlockerBody(p.x, p.y, p.w, p.h));

    // Breakables: a per-session live copy of the zone's authored blockers, so a
    // remount/hot-reload starts fresh and we never mutate the shared loaded zone.
    // Each gets a matter.js static body so it stops the *player* like a wall (the
    // crowd sim handles enemies); the body is removed when it breaks. The array
    // index is the breakable's hit id (negated below, so it can't collide with
    // the positive enemy ids that share the hurt-target list).
    const breakables: LiveBreakable[] = ZONE.breakables.map((b) => ({
      ...b,
      box: { ...b.box },
      hp: b.maxHp,
      alive: true,
      flash: 0,
      fuse: null,
    }));

    // Spawners (docs/design/spawners.md): each placed `spawner` object becomes a
    // destructible NEST — a solid box appended to `breakables` so it reuses the
    // whole hit / auto-target / world / render path — plus a SpawnerRuntime
    // carrying the FSM that pumps out creatures while the player is near. Config
    // (creature, cadence, cap, radii, hp) rides the object's `props`. The nest is
    // see/shoot-through for v1 (occludes: false) so you can watch it work.
    const spawners: SpawnerRuntime[] = [];
    const nestSize = SPAWNER_NEST_TILES * ZONE.tileSize;
    for (const o of ZONE.objects) {
      if (o.kind !== "spawner") continue;
      const config = parseSpawnerConfig(o.props);
      const nest: LiveBreakable = {
        id: o.id,
        kind: "spawner",
        box: { x: o.x, y: o.y, w: nestSize, h: nestSize },
        hp: config.maxHp,
        maxHp: config.maxHp,
        occludes: false,
        onBreak: [],
        alive: true,
        flash: 0,
        fuse: null,
      };
      breakables.push(nest);
      spawners.push({ id: o.id, config, state: initSpawnerState(), nest, liveIds: [], everSeen: false });
    }

    // Keys (docs/design/doors-and-keys.md): each placed `key` object becomes a
    // floor pickup. `props.color` names a KeyColor; an unknown color is dropped
    // (like a stale creature id) so a bad authored value can't crash the run.
    const keys: LiveKey[] = [];
    for (const o of ZONE.objects) {
      if (o.kind !== "key") continue;
      if (!isKeyColor(o.props.color)) continue;
      keys.push({ id: o.id, color: o.props.color, x: o.x, y: o.y, taken: false });
    }

    const breakableBodies = new Map<string, ReturnType<typeof createBlockerBody>>();
    for (const b of breakables) {
      const body = createBlockerBody(b.box.x, b.box.y, b.box.w, b.box.h);
      breakableBodies.set(b.id, body);
      addBody(physics, body);
    }

    // One attacker stat block per weapon, reused across strikes (resolveAttack
    // only reads the attacker's stats — hp is irrelevant on this side).
    const weaponCombatants = new Map<WeaponId, Combatant>(
      WEAPONS.map((w) => [w.id, makeCombatant(w.stats)]),
    );

    return {
      physics,
      player,
      weaponCombatants,
      rng: createRng(0xc0ffee),
      breakables,
      breakableBodies,
      spawners,
      keys,
    };
  }, []);

  // The live enemy list: seeded once from the zone's authored `creature` objects
  // (below), then grown over the visit by spawners and summoners. No respawn — the
  // dead are removed outright. A mutable list the sim reads and mutates each step,
  // plus a monotonic id source. A ref, not state — the sim owns it; populating
  // never needs a React render.
  const enemiesRef = useRef<Enemy[]>([]);
  const nextEnemyId = useRef(1);

  /** Build one enemy and add its body to the world (does not enlist it). */
  const makeEnemy = (type: EnemyTypeId, x: number, y: number): Enemy => {
    const def = CREATURES[type];
    // Enemies live outside the matter.js world: their movement, crowd spacing,
    // and collision against pillars + the player are integrated in core each step
    // (stepCrowd). Velocity is px/s, driven by the brain through the same
    // acceleration-limited locomotion as the player; knockback adds to it and
    // decays through decel. See docs/design/enemy-physics-and-crowds.md (Phase 2).
    const mover = createMover(x, y, ENEMY_RADIUS);
    const id = nextEnemyId.current++;
    return {
      id,
      type,
      flying: def.flying ?? false,
      mover,
      combatant: makeCombatant(def.stats),
      brain: makeCreatureBrain(def, id),
      // Start blind — assume NO sight until the first real LOS check confirms it.
      // Now that aggro's first notice is gated on sight (updateAggro), assuming
      // visible would let a creature spawned next to the player (but behind a door)
      // engage in the few frames before its first recheck, then leash forever. So a
      // fresh creature waits for a genuine sighting (≤ LOS_RECHECK_STEPS = ~0.1s).
      // Timers still stagger by id so the population's checks spread across steps.
      los: false,
      losTimer: id % LOS_RECHECK_STEPS,
      flash: 0,
      cycle: def.attack ? { ...ATTACK_CYCLE_READY } : null,
      attackCombatant: def.attack ? makeCombatant(def.attack.stats) : null,
      summonCycle: def.summon ? { ...ATTACK_CYCLE_READY } : null,
      minionIds: [],
      prevX: x,
      prevY: y,
      currX: x,
      currY: y,
    };
  };

  // Seed the standing population once, from the zone's authored `creature` objects
  // (placed in Realmsmith): one enemy per marker, at its spot, of the creature its
  // props name. This is the whole starting roster now that the dev spawn HUD is
  // gone — spawners then add to it over the visit. Guarded so a double render can't
  // double-seed the ref (and `parseCreatureId` drops any creature a stale zone
  // names that no longer exists).
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    for (const o of ZONE.objects) {
      if (o.kind !== "creature") continue;
      enemiesRef.current.push(makeEnemy(parseCreatureId(o.props.creature), o.x, o.y));
    }
  }

  // Combat state lives in a ref: it's stepped by the game loop, never rendered
  // through React. The weapon picker is the only React-state piece.
  const combat = useRef({
    weapon: WEAPONS[0]!,
    cycle: ATTACK_CYCLE_READY as AttackCycleState,
    targetId: null as number | null,
    lockedId: null as number | null,
    lockedFacing: 0,
    projectiles: [] as FlightProjectile[],
    /** Enemy shots in flight — stepped against the player, not the enemies. */
    enemyProjectiles: [] as FlightProjectile[],
    numbers: [] as FlyingNumber[],
    arcFlashes: [] as ArcFlash[],
    explosions: [] as Explosion[],
    playerCombatant: makeCombatant(PLAYER_STATS),
    /** Post-hit invulnerability time left; any hit is ignored while > 0. */
    iFrames: 0,
    /** Color keys held this run (count per color); spent to open matching doors. */
    keys: emptyInventory() as KeyInventory,
  });

  // Dash skill runtime: the generic ability lifecycle plus the dash's own effect
  // state (locked direction, dodge i-frames). A ref — the sim owns it, no render.
  // The first of what will be a skill roster; each new skill gets a runtime here.
  const dashRuntime = useRef(createDashRuntime());

  const [weaponId, setWeaponId] = useState<WeaponId>(combat.current.weapon.id);
  // HUD mirror of the run's key inventory. The sim owns the authoritative copy
  // (combat.current.keys, read each step); we snapshot it into React state only
  // when it changes, so the on-screen key strip re-renders on pickup/spend rather
  // than every frame.
  const [keyHud, setKeyHud] = useState<KeyInventory>(emptyInventory());
  // Locked-door hint: the color of a door the player is bumping but can't open,
  // surfaced (ghosted) on the HUD so they learn what to hunt for. A ref shadows
  // the state so the sim only re-renders on the rare enter/leave transition.
  const [lockedNeed, setLockedNeed] = useState<KeyColor | null>(null);
  const lockedNeedRef = useRef<KeyColor | null>(null);
  const selectWeapon = (id: WeaponId) => {
    setWeaponId(id);
    const c = combat.current;
    c.weapon = WEAPONS.find((w) => w.id === id) as WeaponDef;
    // Swapping resets the cycle — no carrying a greatsword windup into a bow.
    c.cycle = ATTACK_CYCLE_READY;
    c.lockedId = null;
  };
  /** Equip the next weapon in WEAPONS, wrapping at the end. */
  const cycleWeapon = () => {
    const idx = WEAPONS.findIndex((w) => w.id === combat.current.weapon.id);
    selectWeapon(WEAPONS[(idx + 1) % WEAPONS.length]!.id);
  };

  // Previous + current simulated state, so the renderer can interpolate
  // between fixed steps (render fps and sim fps are decoupled).
  const sim = useRef({
    prevX: SPAWN.x,
    prevY: SPAWN.y,
    currX: SPAWN.x,
    currY: SPAWN.y,
    facing: -Math.PI / 2, // face "up" until the first input
    // The camera is its own simulated object that chases the player rather
    // than pinning to them — moving lets the player drift off-centre and the
    // camera catch up, like a human operator (see CAMERA_FOLLOW_RATE).
    camPrevX: SPAWN.x,
    camPrevY: SPAWN.y,
    camCurrX: SPAWN.x,
    camCurrY: SPAWN.y,
    // Monotonic seconds, advanced each step — the drifting-mist shader's clock.
    time: 0,
    // Low-health pulse phase (whole beats). Advanced only while below the HP
    // threshold, at a rate that climbs with danger; prev/curr so the renderer
    // interpolates it like every other simulated value (no beat stutter at the
    // coarser sim tiers).
    lowHpPhasePrev: 0,
    lowHpPhaseCurr: 0,
  });

  // Fog-of-war memory: a persistent grid the renderer sweeps with the sight
  // polygon each frame. Created once and never reset (the arena is fixed for the
  // demo); a new realm would call resetFog.
  const fog = useMemo(() => createFogGrid(ARENA_WIDTH, FOG_CELL, ARENA_HEIGHT), []);

  // Baked per-chunk floor pictures: recorded once from the zone's tile data, then
  // replayed (culled to the view) each frame — the big static-render lever.
  const floorChunks = useMemo(() => bakeFloorChunks(ZONE), []);

  // Reused per-frame scene buffers. The scene used to rebuild enemy render data in
  // THREE passes (one .map + two .flatMap, each walking the whole horde and
  // allocating a fresh array), plus a [...a, ...b] projectile spread — all garbage
  // every rendered frame. These persistent arrays are refilled in a single pass in
  // onRender; the picture is recorded synchronously from them in the same tick, so
  // nothing retains them across frames and reuse is safe.
  const renderScratch = useRef({
    enemies: [] as CombatScene["enemies"],
    casts: [] as CombatScene["enemyCasts"],
    summons: [] as CombatScene["summonTelegraphs"],
    projectiles: [] as CombatScene["projectiles"],
  });

  // Dynamic world geometry — the crowd walls, the sight/projectile occluders, and
  // the enemy nav grid — each = the static zone (PILLARS / OCCLUDERS) plus every
  // alive breakable. Held in refs so a break rebuilds them in place (no React
  // render); the per-frame sim reads `.current` rather than the static consts, so
  // a downed wall opens collision, sightlines, and pathing at once. Built once
  // here (useMemo, not per-render) including the breakables that start alive.
  const initialWorld = useMemo(() => computeWorld(breakables), []);
  const worldWalls = useRef<Aabb[]>(initialWorld.walls);
  const flyingWalls = useRef<Aabb[]>(initialWorld.flyingWalls);
  const worldOccluders = useRef<VisionSegment[]>(initialWorld.occluders);
  // Player-vision occluders: same as `worldOccluders` but with locked doors removed,
  // so the player's fog of war sees through doors while enemies/projectiles don't.
  const worldVisionOccluders = useRef<VisionSegment[]>(initialWorld.visionOccluders);
  const navGridRef = useRef<NavGrid>(initialWorld.navGrid);
  const flyingNavGridRef = useRef<NavGrid>(initialWorld.flyingNavGrid);

  // Flow fields (docs/design/flow-field-pathfinding.md): the crowd's shared "route
  // toward the player around walls", one per movement domain. Sized once to the nav
  // grid (dimensions are fixed); re-flooded from the player on a throttle in onStep,
  // reading each nav grid's live walkability so a broken wall opens the route too.
  const groundFlow = useMemo<FlowField>(() => createFlowField(navGridRef.current), []);
  const flyingFlow = useMemo<FlowField>(() => createFlowField(flyingNavGridRef.current), []);
  const flowTimer = useRef(0); // steps until the next re-flood (0 = flood this step)

  // Player vision is a simple lit radius now (no line-of-sight polygon): the
  // renderer draws a soft radial bubble around the player and the exploration fog,
  // and discovery is a plain proximity reveal (markVisibleCircle in onRender). Enemy
  // LOS + pathfinding still use the occluders in onStep — only the player's expensive
  // shadow-casting was removed. See docs (fog-of-war simplification).

  /**
   * Re-derive the dynamic world after a breakable's alive-state changed. The crowd
   * walls and sight occluders are cheap to rebuild outright; the nav grids are NOT
   * (two full grids over the whole zone — a visible hitch on a large map), so when a
   * single box is `removed` we reopen just its footprint in place. `removed` omitted
   * ⇒ full nav rebuild (the safe fallback).
   */
  const rebuildWorld = (removed?: Aabb) => {
    const dyn = computeDynamicGeometry(breakables);
    worldWalls.current = dyn.walls;
    flyingWalls.current = dyn.flyingWalls;
    worldOccluders.current = dyn.occluders;
    worldVisionOccluders.current = dyn.visionOccluders;
    if (removed) {
      releaseNavBlocker(navGridRef.current, removed, ENEMY_RADIUS, dyn.walls);
      releaseNavBlocker(flyingNavGridRef.current, removed, ENEMY_RADIUS, dyn.flyingWalls);
    } else {
      navGridRef.current = buildNavGrid(ARENA_WIDTH, NAV_CELL, dyn.walls, ENEMY_RADIUS, ARENA_HEIGHT);
      flyingNavGridRef.current = buildNavGrid(ARENA_WIDTH, NAV_CELL, dyn.flyingWalls, ENEMY_RADIUS, ARENA_HEIGHT);
    }
  };

  // Spatial grid for enemy separation: every enemy is bucketed into it each step,
  // so separation only scans its 3×3 cell neighbourhood instead of the whole
  // swarm (the old O(n²) all-pairs scan). Created once; `neighborScratch` is the
  // reused per-query result buffer, so neighbour lookups allocate nothing.
  const enemyGrid = useMemo(() => createSpatialGrid(ARENA_WIDTH, ENEMY_GRID_CELL, ARENA_HEIGHT), []);
  const neighborScratch = useRef<Vec2[]>([]);

  // The only thing the Skia tree reads: one picture holding the whole world,
  // re-recorded each frame from the game loop. No React re-renders in play.
  const combatPicture = useSharedValue(EMPTY_COMBAT_PICTURE);

  // Dash button: a one-shot request flag the button raises and the sim consumes
  // (so the sim stays the authority on whether the roll is actually ready), plus
  // the button face the sim re-records while the cooldown clock sweeps.
  const dashRequest = useRef(false);
  const requestDash = () => {
    dashRequest.current = true;
  };
  const dashOverlay = useSharedValue<SkPicture>(DASH_READY_PICTURE);
  const dashCooling = useRef(false);

  // --- Frame profiler (dev only). Accumulate the JS-thread time spent each frame
  // in the sim step(s) and in the scene-record/picture-recording, then sample it
  // into state ~2×/sec for a tiny on-screen readout. Refs (not state) for the
  // per-frame writes so they never trigger a React render; the interval is the
  // only thing that does, twice a second. This measures the JS thread only — for
  // the UI/render thread, enable React Native's Perf Monitor (it shows UI vs JS
  // fps separately), which is the other half of the picture.
  const perf = useRef({ stepMs: 0, steps: 0, simVisMs: 0, simAiMs: 0, simPhysMs: 0, simCrowdMs: 0, renderMs: 0, frames: 0 });
  const [perfText, setPerfText] = useState("");
  // Driven by the Settings "Performance overlay" toggle, so it works in release
  // builds (not just __DEV__). When off, every timing branch below is skipped, so
  // the profiler costs nothing when you're not using it.
  const perfOn = settings.showPerfOverlay;
  // Diagnostic: when on, onRender pushes an empty picture (draws nothing) so we can
  // tell whether the frame-rate wall is our scene's raster or the present pipeline.
  const blankRender = settings.disableSceneRender;
  // Mirror the gate into the renderer (its phase timers are off until this flips on).
  useEffect(() => {
    setRenderProfiling(perfOn);
  }, [perfOn]);
  // Mirror the GPU diagnostic switches (fog / mist) into the renderer.
  useEffect(() => {
    setRenderDebug({ disableFog: settings.disableFog, disableMist: settings.disableMist });
  }, [settings.disableFog, settings.disableMist]);
  useEffect(() => {
    if (!perfOn) {
      setPerfText("");
      return;
    }
    // Zero the accumulators so the first sample after enabling isn't stale (they may
    // have drifted while the overlay was off, or just been left from a prior run).
    const p = perf.current;
    p.stepMs = p.steps = p.simVisMs = p.simAiMs = p.simPhysMs = p.simCrowdMs = p.renderMs = p.frames = 0;
    RENDER_PHASES.world = RENDER_PHASES.live = RENDER_PHASES.fog = RENDER_PHASES.ui = 0;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - last) / 1000;
      last = now;
      const f = Math.max(1, p.frames);
      const fps = elapsed > 0 ? p.frames / elapsed : 0;
      const rp = RENDER_PHASES;
      // Per-frame averages. `sim …×` is steps/frame (the fixed-step catch-up
      // multiplier); `rec` is split into world/live/fog/ui (world is baked once now,
      // so it should sit near 0).
      setPerfText(
        `JS ${fps.toFixed(0)}fps  sim ${(p.stepMs / f).toFixed(1)}ms (${(p.steps / f).toFixed(1)}×)  rec ${(p.renderMs / f).toFixed(1)}ms (vis ${(p.simVisMs / f).toFixed(1)})\n` +
          `sim: ai ${(p.simAiMs / f).toFixed(1)}  phys ${(p.simPhysMs / f).toFixed(1)}  crowd ${(p.simCrowdMs / f).toFixed(1)}  rest ${((p.stepMs - p.simAiMs - p.simPhysMs - p.simCrowdMs) / f).toFixed(1)}\n` +
          `rec: world ${(rp.world / f).toFixed(1)}  live ${(rp.live / f).toFixed(1)}  fog ${(rp.fog / f).toFixed(1)}  ui ${(rp.ui / f).toFixed(1)}`,
      );
      p.stepMs = 0;
      p.steps = 0;
      p.simVisMs = 0;
      p.simAiMs = 0;
      p.simPhysMs = 0;
      p.simCrowdMs = 0;
      p.renderMs = 0;
      p.frames = 0;
      rp.world = 0;
      rp.live = 0;
      rp.fog = 0;
      rp.ui = 0;
    }, 500);
    return () => clearInterval(id);
  }, [perfOn]);

  // Zoom is a plain number eased in JS (the picture recorder needs it per
  // frame); a swap sets the target and onRender glides toward it.
  const zoomTarget = useRef(zoomFor(combat.current.weapon));
  const zoomCurrent = useRef(zoomTarget.current);
  useEffect(() => {
    const weapon = WEAPONS.find((w) => w.id === weaponId) as WeaponDef;
    zoomTarget.current = zoomFor(weapon);
  }, [weaponId, width]);

  // Music: one AudioDirector for the session. It loops the zone's idle bed and
  // (once a combat bed exists) crossfades when enemies close in — the idle/combat
  // decision is fed from the sim each step, its state held in `musicState`.
  // Created once; disposed on unmount. AppState drives suspend/resume so the
  // soundtrack stops cleanly when the app backgrounds and the OS session frees.
  const audioRef = useRef<AudioDirector | null>(null);
  const musicState = useRef(initMusicState());
  /** Web blocks audio until the first user gesture; the first thumbstick touch unlocks it. */
  const audioUnlocked = useRef(false);
  useEffect(() => {
    const director = createAudioDirector(AUDIO_MANIFEST);
    audioRef.current = director;
    director.setZone(ZONE.audio);
    director.resume(); // native autoplays; web waits for the first touch (see handleStick)
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") director.resume();
      else director.suspend();
    });
    return () => {
      sub.remove();
      director.dispose();
      audioRef.current = null;
    };
  }, []);

  // Push the player's volume/mute settings into the director — on mount (the
  // director-creation effect above runs first, so it exists) and whenever the
  // settings change. The director multiplies music/SFX under master and silences
  // all when muted, so we just mirror the four values across.
  useEffect(() => {
    const director = audioRef.current;
    if (!director) return;
    director.setMasterVolume(settings.masterVolume);
    director.setMusicVolume(settings.musicVolume);
    director.setSfxVolume(settings.sfxVolume);
    director.setMuted(settings.muted);
  }, [settings.masterVolume, settings.musicVolume, settings.sfxVolume, settings.muted]);

  /** Thumbstick sink: store the sample and unlock web audio on the first touch. */
  const handleStick = (sample: StickSample) => {
    stickRef.current = sample;
    if (!audioUnlocked.current) {
      audioUnlocked.current = true;
      audioRef.current?.resume();
    }
  };

  useGameLoop({
    onStep: (dt) => {
      // Paused (Pause overlay / Settings on top): freeze the sim. onRender keeps
      // running so the frozen frame still draws behind the dimmed overlay; the
      // raf keeps `last` current, so there's no time jump on resume.
      if (pausedRef.current) return;
      const _t0 = perfOn ? performance.now() : 0;
      const s = sim.current;
      const c = combat.current;
      const stick = stickRef.current;
      const enemies = enemiesRef.current;
      const dash = dashRuntime.current;
      s.time += dt;
      s.prevX = s.currX;
      s.prevY = s.currY;
      s.lowHpPhasePrev = s.lowHpPhaseCurr;
      // Mirror the player's prev/curr snapshot for every enemy, so the renderer
      // can interpolate their positions too (see Enemy.prevX).
      for (const e of enemies) {
        e.prevX = e.currX;
        e.prevY = e.currY;
      }

      // --- Dash skill: advance its lifecycle (ready → active → cooldown). The
      // queued button press only fires from Ready, so presses mid-roll or on
      // cooldown are ignored. On the activation step we lock the roll direction
      // (the stick's, or facing when the stick is idle) and open the dodge
      // i-frames — the skill's on-activate effects (see skills/dash.ts).
      const dashStep = stepAbility(dash.ability, DASH_CONFIG, dt, dashRequest.current);
      dashRequest.current = false;
      dash.ability = dashStep.state;
      if (dashStep.activated) {
        if (stick.magnitude > 0) beginDash(dash, stick.dir.x, stick.dir.y);
        else beginDash(dash, Math.cos(s.facing), Math.sin(s.facing));
        playStrikeHaptic("light");
      }
      tickDashInvuln(dash, dt);

      // --- Movement: while rolling, velocity is pinned to the committed dash
      // (bypassing the ramp) and matter.js collides it against walls as usual;
      // otherwise the stick sets a *desired* velocity the actual velocity chases
      // at a capped rate (short ramp-up, a small skid on release — which also
      // carries the roll's momentum out into a brief slide).
      if (isDashing(dash)) {
        const v = dashVelocity(dash);
        setVelocityPerSecond(player, v.x, v.y);
      } else {
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
      }

      // --- Flow fields: re-flood the crowd's shared "route toward the player around
      // walls" on a throttle, from last step's player position (one step stale — fine
      // at this cadence). Reads each nav grid's live walkability, so a wall broken this
      // run reopens the route. Enemies then read it in O(1) below, falling back to A*
      // only when uncovered. Counted into the `ai` timer since it's AI-loop work.
      //
      // Gated on enemy count: the flood is a FIXED cost, so below FLOW_MIN_ENEMIES a
      // few A* searches are cheaper — skip the flood entirely and let enemies path with
      // A* (flowField passed as null below). It only kicks in when the crowd is big
      // enough to amortise it, so it never regresses a light fight.
      const useFlow = enemies.length >= FLOW_MIN_ENEMIES;
      const _tf = perfOn ? performance.now() : 0;
      if (useFlow) {
        if (flowTimer.current <= 0) {
          flowTimer.current = FLOW_RESWEEP_STEPS;
          computeFlowField(groundFlow, navGridRef.current, player.position, FLOW_RADIUS);
          computeFlowField(flyingFlow, flyingNavGridRef.current, player.position, FLOW_RADIUS);
        } else {
          flowTimer.current -= 1;
        }
      } else {
        flowTimer.current = 0; // re-flood immediately when the crowd next grows past the gate
      }
      if (perfOn) perf.current.simAiMs += performance.now() - _tf;

      // --- Enemy AI: each brain reads perception and yields a desired
      // velocity, shaped through the same acceleration-limited locomotion as
      // the player — so enemies inherit the weight/skid feel, and knockback
      // impulses decay through decel instead of physics damping. Positions
      // and facing are last step's resolved values; one step of lag is
      // imperceptible and keeps the order simple.
      const living = enemies;
      const _ta = perfOn ? performance.now() : 0;
      // Bucket every enemy into the spatial grid once per step (O(n)), so each
      // enemy's separation below scans only its 3×3 cell neighbourhood rather than
      // the whole swarm — the old per-enemy neighbour list was O(n²) and the main
      // crowd-time AI cost. See docs/design/enemy-physics-and-crowds.md (Phase 1).
      rebuildGrid(enemyGrid, living.length, (idx) => living[idx]!.mover.pos);
      // Shared A* allowance for this step: at most MAX_REPATHS_PER_STEP enemies
      // re-path, the rest defer — bounds the pathfinding spike when a crowd loses
      // line of sight together (e.g. you round a pillar). See pursue().
      const repathBudget = { remaining: MAX_REPATHS_PER_STEP };
      const neighbors = neighborScratch.current;
      // Hoisted so it's one closure per step, not one per enemy; `selfIndex` is
      // set before each query and skipped so an enemy never separates from itself.
      let selfIndex = 0;
      const collectNeighbor = (j: number): void => {
        if (j !== selfIndex) neighbors.push(living[j]!.mover.pos);
      };
      // Level-of-detail cutoff for the *uncapped* per-enemy AI costs (the LOS
      // raycast + wall pathfinding): the visible world's half-diagonal — derived
      // from the live zoom, so it tracks how much is actually on screen — grown
      // by OFFSCREEN_SIM_MARGIN. Compared squared, so no per-enemy sqrt.
      const zoom = zoomCurrent.current || 1;
      const viewRadius = (0.5 / zoom) * Math.hypot(width, playHeight);
      const simRadius = viewRadius * OFFSCREEN_SIM_MARGIN;
      const simRadiusSq = simRadius * simRadius;

      // Occluders near the player, culled ONCE per step for every player-centric sight
      // query below (enemy LOS, auto-target, ranged-fire gating, spawner reveal). Each
      // of those segments has the player as an endpoint and is at most `simRadius` long
      // (LOS is only tested inside that radius; targeting/fire/reveal are gated by
      // engagement ≤ reach + margin), so any wall that could block one lies within an
      // `occCullR` box of the player — the rest can't matter. This turns each query
      // from O(all walls) into O(walls-near-you), so a wall-dense zone plus a big horde
      // stays cheap (segmentClear is O(segments), called per enemy/candidate). Note:
      // projectile-vs-wall is NOT player-centric, so it keeps the full set; and a wall
      // broken mid-step leaves this set one frame stale — harmless, it only over-blocks
      // for a frame (breaks only remove occluders), then the next step rebuilds it.
      const occCullR = simRadius + ENGAGEMENT_MARGIN;
      const occBoxMinX = player.position.x - occCullR;
      const occBoxMaxX = player.position.x + occCullR;
      const occBoxMinY = player.position.y - occCullR;
      const occBoxMaxY = player.position.y + occCullR;
      const nearOccluders: VisionSegment[] = [];
      for (const s of worldOccluders.current) {
        const sMinX = s.ax < s.bx ? s.ax : s.bx;
        const sMaxX = s.ax > s.bx ? s.ax : s.bx;
        const sMinY = s.ay < s.by ? s.ay : s.by;
        const sMaxY = s.ay > s.by ? s.ay : s.by;
        if (sMaxX >= occBoxMinX && sMinX <= occBoxMaxX && sMaxY >= occBoxMinY && sMinY <= occBoxMaxY) {
          nearOccluders.push(s);
        }
      }
      for (let i = 0; i < living.length; i++) {
        const e = living[i]!;
        selfIndex = i;
        neighbors.length = 0;
        forEachNeighbor(enemyGrid, e.mover.pos.x, e.mover.pos.y, collectNeighbor);
        // On-screen enemies refresh line-of-sight on a throttle (staggered per
        // enemy): it's a ray test against every occluder and only gates pathing,
        // so a few frames of lag is invisible. When a wall blocks the sightline,
        // the runtime routes around it via A* on navGrid. Off-screen enemies skip
        // both the raycast and A* — they're treated as sighted (steer straight,
        // the leash keeps them coming), and their LOS timer keeps ticking down so
        // they re-check the instant they come back on screen.
        const dxp = e.mover.pos.x - player.position.x;
        const dyp = e.mover.pos.y - player.position.y;
        const near = dxp * dxp + dyp * dyp <= simRadiusSq;
        if (near) {
          if (e.losTimer <= 0) {
            e.los = segmentClear(e.mover.pos, player.position, nearOccluders);
            e.losTimer = LOS_RECHECK_STEPS;
          } else {
            e.losTimer -= 1;
          }
        } else if (e.losTimer > 0) {
          e.losTimer -= 1;
        }
        const desired = tickBrain(
          e.brain,
          {
            selfPos: e.mover.pos,
            playerPos: player.position,
            playerFacing: s.facing,
            neighbors,
            hasLineOfSight: near ? e.los : true,
            navGrid: near ? (e.flying ? flyingNavGridRef.current : navGridRef.current) : null,
            flowField: near && useFlow ? (e.flying ? flyingFlow : groundFlow) : null,
            repathBudget,
          },
          dt,
        );
        // Enemy velocity lives on the mover (px/s); the same acceleration-limited
        // locomotion as the player shapes it, then stepCrowd integrates it below.
        const eVel = approachVelocity(e.mover.vel, desired, dt, ENEMY_ACCEL, ENEMY_DECEL);
        e.mover.vel.x = eVel.x;
        e.mover.vel.y = eVel.y;
      }
      if (perfOn) perf.current.simAiMs += performance.now() - _ta;

      // Matter now steps only the player (+ static walls) — ~10 bodies, trivial.
      const _tp = perfOn ? performance.now() : 0;
      stepPhysics(physics, dt);
      if (perfOn) perf.current.simPhysMs += performance.now() - _tp;

      s.currX = player.position.x;
      s.currY = player.position.y;
      const playerPos = { x: s.currX, y: s.currY };

      // Enemies are integrated + collided in core, off matter.js (whose broadphase
      // is O(n²) for a pile — see docs/design/enemy-physics-and-crowds.md). Apply
      // velocities, push the crowd apart via the grid, resolve against the pillars
      // and the just-moved player, then clamp to the arena. This is the Phase 2 win.
      //
      // Two passes, one per movement domain: ground enemies collide against the full
      // SOLIDS (walls + voids), flyers against walls only — so a flyer crosses a chasm
      // a grounder can't. The layers are separate, so they crowd-separate only within
      // their own group (flyers are "above"); both still resolve against the player and
      // the arena bounds. The grid is rebuilt per call, so reusing it is fine.
      const _tc = perfOn ? performance.now() : 0;
      const groundMovers: Mover[] = [];
      const flyingMovers: Mover[] = [];
      for (const e of enemies) (e.flying ? flyingMovers : groundMovers).push(e.mover);
      const crowdBase = {
        grid: enemyGrid,
        player: { pos: playerPos, radius: PLAYER_RADIUS },
        worldSize: ARENA_WIDTH,
        worldHeight: ARENA_HEIGHT,
        pushStrength: CROWD_PUSH,
      };
      if (groundMovers.length > 0) stepCrowd(groundMovers, dt, { ...crowdBase, walls: worldWalls.current });
      if (flyingMovers.length > 0) stepCrowd(flyingMovers, dt, { ...crowdBase, walls: flyingWalls.current });
      if (perfOn) perf.current.simCrowdMs += performance.now() - _tc;

      for (const e of enemies) {
        e.currX = e.mover.pos.x;
        e.currY = e.mover.pos.y;
      }

      // --- Camera: exponentially close the gap to the player. Stepped at the
      // fixed sim rate, so the feel is identical whatever the render fps.
      s.camPrevX = s.camCurrX;
      s.camPrevY = s.camCurrY;
      const catchUp = 1 - Math.exp(-CAMERA_FOLLOW_RATE * dt);
      s.camCurrX += (s.currX - s.camCurrX) * catchUp;
      s.camCurrY += (s.currY - s.camCurrY) * catchUp;

      // --- Enemy upkeep: just flash decay now (no respawn — the dead are removed
      // outright; population comes from authored creatures + spawners). Breakables
      // decay their flash too.
      for (const d of enemies) d.flash = Math.max(0, d.flash - dt);
      for (const b of breakables) if (b.flash > 0) b.flash = Math.max(0, b.flash - dt);

      // Hittable targets for the player's melee + shots: every enemy as a circle,
      // plus each alive breakable as its box. A breakable takes a *negative* hit
      // id (−index−1) so the shared id space never collides with the positive
      // enemy ids — that's how a returned hit is routed back to the right thing.
      const hurtTargets = (): HurtTarget[] => {
        const targets: HurtTarget[] = enemies.map((d) => ({
          id: d.id,
          pos: d.mover.pos,
          radius: ENEMY_RADIUS,
        }));
        for (let i = 0; i < breakables.length; i++) {
          const b = breakables[i]!;
          if (b.alive && b.fuse === null) targets.push({ id: -(i + 1), box: b.box });
        }
        return targets;
      };

      /** Drop a slain enemy from the world + the list, releasing any lock on it. */
      const removeEnemy = (d: Enemy) => {
        const idx = enemies.indexOf(d);
        if (idx !== -1) enemies.splice(idx, 1);
        if (c.lockedId === d.id) c.lockedId = null;
        if (c.targetId === d.id) c.targetId = null;
      };

      /** Returns whether the hit crit, so callers can voice it haptically. */
      const applyHit = (d: Enemy, dir: Vec2, knockback: number, attacker: Combatant): boolean => {
        if (d.combatant.hp <= 0) return false; // already slain this step
        const result = resolveAttack(attacker, d.combatant, rng);
        d.flash = HIT_FLASH_DURATION;
        // Knockback is an impulse straight onto the mover's velocity (px/s); it
        // decays back toward the brain's intent through the locomotion decel.
        if (knockback > 0) {
          d.mover.vel.x += dir.x * knockback;
          d.mover.vel.y += dir.y * knockback;
        }
        c.numbers.push({
          x: d.mover.pos.x,
          y: d.mover.pos.y - ENEMY_RADIUS - 16,
          text: String(result.damage),
          crit: result.crit,
          hostile: false,
          age: 0,
        });
        if (result.lethal) removeEnemy(d);
        return result.crit;
      };

      /**
       * Apply one incoming hit to the player (contact bite or enemy projectile).
       * Gated by i-frames so overlap/volleys can't drain HP per-step — one hit
       * per window, first to land wins. Also ignored entirely during a roll's
       * invulnerability window (a dodge). No death in the tech demo: an emptied
       * bar refills. Returns whether the hit landed.
       */
      const damagePlayer = (attacker: Combatant, fromX: number, fromY: number, knockback: number): boolean => {
        if (c.iFrames > 0 || dashInvulnerable(dash)) return false;
        const result = resolveAttack(attacker, c.playerCombatant, rng);
        c.iFrames = PLAYER_IFRAMES;
        const away = normalize(sub(playerPos, { x: fromX, y: fromY }));
        if (knockback > 0) addVelocityPerSecond(player, away.x * knockback, away.y * knockback);
        c.numbers.push({
          x: playerPos.x,
          y: playerPos.y - PLAYER_RADIUS - 16,
          text: String(result.damage),
          crit: false,
          hostile: true,
          age: 0,
        });
        // The heavy pulse is reserved for exactly this (see haptics.ts).
        playStrikeHaptic("heavy");
        if (result.lethal) c.playerCombatant.hp = c.playerCombatant.stats.maxHp;
        return true;
      };

      // --- Breakables. The player damages them through the same path as enemies
      // (their box is a hurt target); `breakOne` is the single destruction sink —
      // it drops the matter.js blocker, rebuilds the world geometry (collision /
      // nav / occluders), then fires onBreak. An `explode` AoE catches enemies,
      // the player, and *other* breakables, so barrels chain-detonate; the alive
      // guard makes breaking idempotent, so a chain can't loop back on itself.
      const breakOne = (b: LiveBreakable) => {
        if (!b.alive) return;
        b.alive = false;
        b.hp = 0;
        const body = breakableBodies.get(b.id);
        if (body) {
          removeBody(physics, body);
          breakableBodies.delete(b.id);
        }
        rebuildWorld(b.box);
        for (const eff of b.onBreak) {
          if (eff.type === "explode") explode(b.box.x, b.box.y, eff.radius, eff.damage);
          // "drop" (loot) waits on an item system — see the design doc.
        }
      };

      /** Apply a hit to a breakable; at 0 hp it primes a fuse (explosive) or breaks now. */
      const damageBreakable = (b: LiveBreakable, attacker: Combatant): boolean => {
        if (!b.alive || b.fuse !== null) return false; // already primed → ignore
        if (b.lock) return false; // a locked door shrugs off weapons — only its key opens it
        // Wrap its hp in a throwaway Combatant so it takes damage through the
        // exact resolveAttack path enemies do (variance, crits, defense=0).
        const defender: Combatant = { hp: b.hp, stats: BREAKABLE_STATS };
        const result = resolveAttack(attacker, defender, rng);
        b.hp = defender.hp;
        b.flash = HIT_FLASH_DURATION;
        c.numbers.push({
          x: b.box.x,
          y: b.box.y - b.box.h / 2 - 8,
          text: String(result.damage),
          crit: result.crit,
          hostile: false,
          age: 0,
        });
        if (defender.hp <= 0) {
          // Explosive → light the fuse (it bursts after EXPLOSION_FUSE_DELAY, so a
          // cluster cascades); anything else just vanishes now.
          if (blastRadius(b) > 0) b.fuse = EXPLOSION_FUSE_DELAY;
          else breakOne(b);
        }
        return result.crit;
      };

      /** AoE blast at (cx,cy): damages enemies, the player, and other breakables. */
      const explode = (cx: number, cy: number, radius: number, damage: number) => {
        const at = { x: cx, y: cy };
        // Cosmetic blast (flash + fireball + shockwave ring sized to the AoE +
        // sparks); the damage below is instant. seed varies the spark fan per blast.
        c.explosions.push({ x: cx, y: cy, radius, age: 0, seed: rng.next() * Math.PI * 2 });
        // A flat-damage attacker (no defense interplay): the blast hits for its
        // authored number, reusing applyHit / damagePlayer for flash + knockback.
        const blast = makeCombatant({
          maxHp: 1,
          attack: damage,
          defense: 0,
          critChance: 0,
          critMultiplier: 1,
        });
        // Enemies (range to their edge). Snapshot — applyHit can splice the list.
        for (const e of [...enemies]) {
          if (distance(at, e.mover.pos) - ENEMY_RADIUS > radius) continue;
          applyHit(e, normalize(sub(e.mover.pos, at)), EXPLOSION_KNOCKBACK, blast);
        }
        // The player (risk/reward: pop a barrel too close and it stings). Gated by
        // the same i-frames / dodge rules as any other incoming hit.
        if (distance(at, playerPos) - PLAYER_RADIUS <= radius) {
          damagePlayer(blast, cx, cy, EXPLOSION_KNOCKBACK);
        }
        // Other breakables in range → chain. Distance is to the box, so a wide
        // wall is caught by a blast against any of its faces.
        for (const other of breakables) {
          if (!other.alive) continue;
          if (distanceToAabb(at, other.box) > radius) continue;
          damageBreakable(other, blast);
        }
      };

      // --- Keys & locked doors (docs/design/doors-and-keys.md). Both trigger on
      // contact: walk over a key to pocket it; walk into a matching-color door to
      // spend that key and open it. Opening reuses breakOne — a door is just a
      // breakable that a key (not a weapon) destroys — so collision, the nav grid,
      // and occluders all reopen through the one existing destruction path.
      for (const k of keys) {
        if (k.taken) continue;
        if (!playerAtKey({ x: k.x, y: k.y }, playerPos, PLAYER_RADIUS)) continue;
        k.taken = true;
        c.keys = addKey(c.keys, k.color);
        setKeyHud(c.keys);
        // TODO(audio): key-pickup chime once a sound-event layer exists.
      }
      let blockedColor: KeyColor | null = null;
      for (const b of breakables) {
        if (!b.alive || !b.lock) continue;
        if (!playerAtDoor(b.box, playerPos, PLAYER_RADIUS)) continue;
        if (hasKey(c.keys, b.lock.color)) {
          c.keys = spendKey(c.keys, b.lock.color);
          setKeyHud(c.keys);
          breakOne(b); // open it (a door authors no onBreak effects, so it just vanishes)
          // TODO(audio): unlock "clunk" once a sound-event layer exists.
        } else if (blockedColor === null) {
          // Pressed against a door we can't open → remember its color for the HUD hint.
          // TODO(audio): locked "rattle" once a sound-event layer exists.
          blockedColor = b.lock.color;
        }
      }
      // Push the hint only on a change (enter/leave a door we can't open), not per frame.
      if (blockedColor !== lockedNeedRef.current) {
        lockedNeedRef.current = blockedColor;
        setLockedNeed(blockedColor);
      }

      c.iFrames = Math.max(0, c.iFrames - dt);

      // --- Contact damage: a touching enemy bites (self-gated by i-frames, and
      // by the roll's invulnerability — you can't be bitten mid-dodge).
      for (const e of enemies) {
        if (distance(playerPos, e.mover.pos) > PLAYER_RADIUS + ENEMY_RADIUS + 1) continue;
        if (damagePlayer(e.combatant, e.mover.pos.x, e.mover.pos.y, CREATURES[e.type].contactKnockback)) {
          break; // one bite per window; the rest no-op anyway
        }
      }

      // --- Dash barge: while rolling, shove any enemy in contact outward (no
      // damage — it's a reposition, not an attack). See skills/dash.ts.
      applyDashShove(dash, playerPos, enemies);

      // --- Targeting: nearest target with hysteresis, inside the engagement radius
      // (a margin beyond attack range) and in line of sight — the player never locks
      // onto, faces, or auto-fires at something behind a wall, and a target that ducks
      // behind cover is dropped. Enemies and breakables/spawners are EQUAL priority —
      // you target whatever's nearest, so you can chip a spawner or pop a barrel even
      // with enemies around (fighting around objects no longer makes them dead weight).
      const cfg = c.weapon.config;
      const engagement = cfg.reach + ENGAGEMENT_MARGIN;

      /** Resolve a (possibly negative) target id to the live enemy/breakable it names. */
      const resolveTarget = (id: number | null): ActiveTarget | null => {
        if (id === null) return null;
        if (id < 0) {
          const b = breakables[-id - 1];
          return b && b.alive
            ? { kind: "breakable", id, breakable: b, pos: { x: b.box.x, y: b.box.y } }
            : null;
        }
        const e = enemies.find((d) => d.id === id);
        return e ? { kind: "enemy", id, enemy: e, pos: e.mover.pos } : null;
      };
      // Distance to the target's *edge* — what attack range gates on: centre minus
      // body radius for an enemy, distance to the footprint for a breakable.
      const edgeDistance = (t: ActiveTarget): number =>
        t.kind === "enemy"
          ? distance(playerPos, t.pos) - ENEMY_RADIUS
          : distanceToAabb(playerPos, t.breakable.box);

      // One candidate list — enemies and breakables/spawners together, ranked purely
      // by nearness. Distance-gated (cheap) *before* the line-of-sight ray, so we don't
      // ray every candidate in the zone every step just to discard the far ones.
      const candidates: { id: number; pos: Vec2 }[] = [];
      for (const d of enemies) {
        if (distance(playerPos, d.mover.pos) > engagement) continue;
        if (!segmentClear(playerPos, d.mover.pos, nearOccluders)) continue;
        candidates.push({ id: d.id, pos: d.mover.pos });
      }
      for (let i = 0; i < breakables.length; i++) {
        const b = breakables[i]!;
        if (!b.alive || b.fuse !== null) continue; // primed → already going off
        if (b.lock) continue; // a locked door isn't an attack target — you open it by walking in
        if (distanceToAabb(playerPos, b.box) > engagement) continue;
        // Sight to the box's NEAREST point, not its centre: a ray to the centre would
        // cross the box's own occluder edges, so an occluding wall would block sight to
        // itself; the near-face touch is an endpoint segmentClear ignores (another wall
        // in the way still blocks). Explosive barrels are eligible at any range now —
        // meleeing one in your face pops it, by design (risk/reward).
        if (!segmentClear(playerPos, closestPointOnAabb(playerPos, b.box), nearOccluders)) {
          continue;
        }
        candidates.push({ id: -(i + 1), pos: { x: b.box.x, y: b.box.y } });
      }
      c.targetId = selectTarget(candidates, playerPos, engagement, c.targetId);
      const target = resolveTarget(c.targetId);

      // --- Attack cycle. Range gates on the target's edge; the windup lock breaks
      // if the locked target dies/breaks or leaves engagement.
      const locked = resolveTarget(c.lockedId);
      const step = stepAttackCycle(c.cycle, cfg, dt, {
        targetInRange: target !== null && edgeDistance(target) <= cfg.reach,
        lockValid: locked !== null && distance(playerPos, locked.pos) <= engagement,
      });
      c.cycle = step.state;
      if (step.windupStarted && target) {
        c.lockedId = target.id;
        c.lockedFacing = angleTo(playerPos, target.pos);
      }
      if (step.lockBroken) c.lockedId = null;

      if (step.struck) {
        if (cfg.shape === "arc") {
          // Melee is facing-authoritative: cleave whatever is in the cone now,
          // locked target or not (see whiff rules in the movement doc).
          let landed = false;
          let crit = false;
          const attacker = weaponCombatants.get(c.weapon.id)!;
          for (const id of hitsInArc(playerPos, c.lockedFacing, cfg.reach, cfg.arcWidth!, hurtTargets())) {
            if (id < 0) {
              // Negative id → a breakable (−index−1); a cleave through it counts.
              crit = damageBreakable(breakables[-id - 1]!, attacker) || crit;
              landed = true;
              continue;
            }
            const d = enemies.find((dd) => dd.id === id);
            if (!d) continue;
            const dir = normalize(sub(d.mover.pos, playerPos));
            crit = applyHit(d, dir, cfg.knockback ?? 0, attacker) || crit;
            landed = true;
          }
          // One pulse per swing however many it cleaves — haptics count
          // events, not victims. Whiffs are silent: the haptic *is* contact.
          if (landed) playStrikeHaptic(c.weapon.haptic, crit);
          c.arcFlashes.push({ x: s.currX, y: s.currY, facing: c.lockedFacing, age: 0 });
        } else if (locked) {
          // Ranged auto-aims at the target's position at the moment of Strike.
          // The volley's flight pattern (straight, pincer, ...) is weapon data.
          for (const p of spawnVolley(playerPos, locked.pos, {
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
          // Ranged haptics are the *recoil*: one pulse per volley at release,
          // whatever the projectile count. Impacts happen far away and out of
          // hand, so they stay silent (crits excepted, below).
          playStrikeHaptic(c.weapon.haptic);
        }
        c.lockedId = null;
      }

      // --- Projectiles: move, resolve hits, expire on range/pierce/walls.
      // Snapshot the hurt-target list ONCE for the whole volley — it was being
      // rebuilt per projectile (O(projectiles × (enemies + breakables)) fresh
      // allocations every step, a real GC sink with a multishot in a horde). The
      // snapshot can't go stale within the step: an enemy killed mid-loop just
      // won't resolve via enemies.find, and a broken/primed breakable is re-guarded
      // inside damageBreakable — so reusing it is correct as well as cheaper.
      let projectileCrit = false;
      const projectileTargets = hurtTargets();
      for (let i = c.projectiles.length - 1; i >= 0; i--) {
        const p = c.projectiles[i]!;
        const from = { x: p.pos.x, y: p.pos.y };
        const result = stepProjectile(p, dt, projectileTargets);
        // A shot dies on *static* wall/pillar it crossed this step — so a hit it
        // might have landed on the far side doesn't count. Breakables are NOT in
        // this test (only the static OCCLUDERS): a shot that reaches a breakable
        // registers as a box hit below and damages it, even an occluding wall one.
        const hitWall =
          !segmentClear(from, p.pos, OCCLUDERS) ||
          p.pos.x < 0 || p.pos.x > ARENA_WIDTH || p.pos.y < 0 || p.pos.y > ARENA_HEIGHT;
        if (!hitWall) {
          for (const id of result.hits) {
            if (id < 0) {
              if (damageBreakable(breakables[-id - 1]!, p.attacker)) projectileCrit = true;
              continue;
            }
            const d = enemies.find((dd) => dd.id === id);
            if (d && applyHit(d, p.dir, p.knockback, p.attacker)) projectileCrit = true;
          }
        }
        if (result.expired || hitWall) c.projectiles.splice(i, 1);
      }
      // The lone exception to silent remote impacts: a crit anywhere this
      // step gets the sharp pulse (once, even if several shots crit at once).
      if (projectileCrit) playStrikeHaptic(null, true);

      // --- Enemy ranged attacks: each ranged creature runs the *same* attack
      // cycle the player does (combat.md — one shared attack library), aimed at
      // the player. The windup is the telegraph; the lock breaks if the player
      // dodges out of range OR behind cover mid-windup. On Strike it looses a
      // volley. Gated on line of sight: no firing (or holding a windup) through
      // a wall — duck behind a pillar and the shot is cancelled.
      for (const e of enemies) {
        const def = CREATURES[e.type];
        if (!def.attack || !e.cycle || !e.attackCombatant) continue;
        const acfg = def.attack.config;
        const inRange = distance(playerPos, e.mover.pos) - PLAYER_RADIUS <= acfg.reach;
        const engaged = inRange && segmentClear(e.mover.pos, playerPos, nearOccluders);
        const eStep = stepAttackCycle(e.cycle, acfg, dt, {
          targetInRange: engaged,
          lockValid: engaged,
        });
        e.cycle = eStep.state;
        if (eStep.struck) {
          for (const p of spawnVolley(e.mover.pos, playerPos, {
            speed: acfg.projectileSpeed!,
            radius: def.attack.projectileRadius,
            maxRange: acfg.reach + 120,
            pierce: acfg.pierce,
            count: acfg.projectileCount,
            flight: acfg.flight,
            curveAngle: acfg.curveAngle,
          })) {
            c.enemyProjectiles.push({
              ...p,
              color: CREATURE_VISUALS[e.type].projectileColor ?? CREATURE_VISUALS[e.type].color,
              knockback: acfg.knockback ?? 0,
              attacker: e.attackCombatant,
            });
          }
        }
      }

      // --- Enemy projectiles: move, resolve against the player, expire on
      // range/walls. The player is the lone hurt circle here.
      const playerCircle: HurtCircle = { id: 0, pos: playerPos, radius: PLAYER_RADIUS };
      const playerTargets = [playerCircle]; // one reused array, not a literal per shot
      for (let i = c.enemyProjectiles.length - 1; i >= 0; i--) {
        const p = c.enemyProjectiles[i]!;
        const from = { x: p.pos.x, y: p.pos.y };
        const result = stepProjectile(p, dt, playerTargets);
        const hitWall =
          !segmentClear(from, p.pos, worldOccluders.current) ||
          p.pos.x < 0 || p.pos.x > ARENA_WIDTH || p.pos.y < 0 || p.pos.y > ARENA_HEIGHT;
        if (!hitWall && result.hits.length > 0) damagePlayer(p.attacker, p.pos.x, p.pos.y, p.knockback);
        if (result.expired || hitWall) c.enemyProjectiles.splice(i, 1);
      }

      // --- Summoners: each runs a summon cycle (the attack cycle reused) and,
      // on strike, spawns `count` × its `minionType` near itself — capped per
      // summoner so it can't flood. `minionType` is data, so a wizard summons
      // whatever its creature names. Snapshot first: spawning pushes into
      // `enemies`, and we don't want to iterate into the fresh minions.
      const summoners = enemies.filter((e) => e.summonCycle !== null);
      for (const e of summoners) {
        const summon = CREATURES[e.type].summon!;
        // Forget minions that have since died.
        if (e.minionIds.length > 0) {
          e.minionIds = e.minionIds.filter((id) => enemies.some((o) => o.id === id));
        }
        const canSummon =
          distance(playerPos, e.mover.pos) <= summon.engageRange &&
          e.minionIds.length < summon.maxAlive;
        const step = stepAttackCycle(e.summonCycle!, summon, dt, {
          targetInRange: canSummon,
          lockValid: canSummon,
        });
        e.summonCycle = step.state;
        if (step.struck) {
          const margin = ENEMY_RADIUS + 8;
          const clampX = (v: number) => Math.max(margin, Math.min(ARENA_WIDTH - margin, v));
          const clampY = (v: number) => Math.max(margin, Math.min(ARENA_HEIGHT - margin, v));
          for (let k = 0; k < summon.count; k++) {
            const ang = rng.next() * Math.PI * 2;
            const r = rng.next() * summon.spawnRadius;
            const minion = makeEnemy(
              summon.minionType,
              clampX(e.mover.pos.x + Math.cos(ang) * r),
              clampY(e.mover.pos.y + Math.sin(ang) * r),
            );
            enemies.push(minion);
            e.minionIds.push(minion.id);
          }
        }
      }

      // --- Spawners: each NEST runs the pure dormant→active→destroyed FSM. While
      // the player is within its activation radius it pumps out its creature on a
      // cadence, capped at maxAlive of its own brood; the player destroys it by
      // attacking the structure (it takes hits as a breakable), which stops it for
      // the run. What it spawns is data (config.creature). See spawners.md.
      for (const sp of spawners) {
        // Forget spawned creatures that have died, freeing cap slots.
        if (sp.liveIds.length > 0) {
          sp.liveIds = sp.liveIds.filter((id) => enemies.some((e) => e.id === id));
        }
        const nest = sp.nest;
        const nestCentre = { x: nest.box.x, y: nest.box.y };
        const playerDist = distance(playerPos, nestCentre);
        // Reveal: latch `everSeen` the first time the nest is within discovery range
        // AND in clear line of sight (so a nest behind a wall — including a breakable
        // wood-wall — stays hidden until you break through). Once seen, skip the ray.
        if (!sp.everSeen) {
          sp.everSeen =
            playerDist <= VISION.discoverRadius &&
            segmentClear(playerPos, nestCentre, nearOccluders);
        }
        const stepR = stepSpawner(sp.state, sp.config, {
          dt,
          playerDist,
          seen: sp.everSeen,
          aliveCount: sp.liveIds.length,
          destroyed: !nest.alive,
        });
        sp.state = stepR.state;
        if (stepR.spawn > 0 && nest.alive) {
          const margin = ENEMY_RADIUS + 8;
          const clampX = (v: number) => Math.max(margin, Math.min(ARENA_WIDTH - margin, v));
          const clampY = (v: number) => Math.max(margin, Math.min(ARENA_HEIGHT - margin, v));
          for (let k = 0; k < stepR.spawn; k++) {
            // Spawn hugging the nest: from just outside its footprint to ~one tile
            // beyond, so creatures pour out of it rather than popping in around it.
            const ang = rng.next() * Math.PI * 2;
            const r = nest.box.w / 2 + ENEMY_RADIUS + rng.next() * ZONE.tileSize;
            const minion = makeEnemy(
              sp.config.creature,
              clampX(nest.box.x + Math.cos(ang) * r),
              clampY(nest.box.y + Math.sin(ang) * r),
            );
            enemies.push(minion);
            sp.liveIds.push(minion.id);
          }
        }
      }

      // --- Facing: locked during windup; re-tracks the target otherwise;
      // falls back to movement direction when nothing is engaged.
      const faceTarget = enemies.find((d) => d.id === c.targetId);
      if (c.cycle.phase === "windup") {
        s.facing = c.lockedFacing;
      } else if (faceTarget) {
        s.facing = angleTo(playerPos, faceTarget.mover.pos);
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
      for (let i = c.explosions.length - 1; i >= 0; i--) {
        const e = c.explosions[i]!;
        e.age += dt;
        if (e.age >= EXPLOSION_FX_DURATION) c.explosions.splice(i, 1);
      }
      // Burn down primed fuses; at 0 the barrel finally bursts (which, via its
      // blast, primes any neighbours → the chain cascades a fuse-length apart).
      for (const b of breakables) {
        if (b.fuse === null) continue;
        b.fuse -= dt;
        if (b.fuse <= 0) {
          b.fuse = null;
          breakOne(b);
        }
      }

      // --- Low-health pulse: while under the threshold, advance the beat at a
      // rate that ramps from MIN_HZ (just under it) to MAX_HZ (near death), so
      // the warning vignette throbs faster the lower you get. Left untouched
      // above the threshold (prev==curr → the renderer reads a steady phase).
      const hpFrac = c.playerCombatant.hp / c.playerCombatant.stats.maxHp;
      if (hpFrac < LOW_HP_THRESHOLD) {
        const severity = (LOW_HP_THRESHOLD - hpFrac) / LOW_HP_THRESHOLD; // 0 → 1 toward death
        const hz = LOW_HP_PULSE_MIN_HZ + (LOW_HP_PULSE_MAX_HZ - LOW_HP_PULSE_MIN_HZ) * severity;
        s.lowHpPhaseCurr += dt * hz;
      }

      // (Exploration-fog discovery is a cheap proximity reveal done in onRender now;
      // the player line-of-sight solve was removed. Enemy LOS still runs in the AI
      // loop above.)

      // --- Music: combat when any living enemy is within COMBAT_MUSIC_RADIUS,
      // idle otherwise (with a hangover so it doesn't snap back the instant a
      // fight ends). The director crossfades to the matching bed; a situation
      // the zone has no bed for just holds the current one. `tick(dt)` advances
      // the crossfade in real time.
      const director = audioRef.current;
      if (director) {
        const inCombat = enemies.some(
          (e) => distance(playerPos, e.mover.pos) <= COMBAT_MUSIC_RADIUS,
        );
        director.setSituation(stepMusicState(musicState.current, inCombat, dt));
        director.tick(dt);
      }

      if (perfOn) {
        perf.current.stepMs += performance.now() - _t0;
        perf.current.steps += 1;
      }
    },
    onRender: (alpha) => {
      const _t0 = perfOn ? performance.now() : 0;
      // Diagnostic: skip all scene drawing, just present an empty picture. The sim
      // above still ran; this isolates the present/compositing cost from raster.
      if (blankRender) {
        combatPicture.value = EMPTY_COMBAT_PICTURE;
        if (perfOn) {
          perf.current.renderMs += performance.now() - _t0;
          perf.current.frames += 1;
        }
        return;
      }
      const s = sim.current;
      const c = combat.current;
      const enemies = enemiesRef.current;
      const dash = dashRuntime.current;

      // Interpolate between the last two sim states (player, camera, every
      // enemy) by the frame alpha. Everything the renderer sees flows through
      // this one path into the single picture, so nothing can drift apart.
      const px = s.prevX + (s.currX - s.prevX) * alpha;
      const py = s.prevY + (s.currY - s.prevY) * alpha;
      const camX = s.camPrevX + (s.camCurrX - s.camPrevX) * alpha;
      const camY = s.camPrevY + (s.camCurrY - s.camPrevY) * alpha;
      const enemyX = (d: Enemy) => d.prevX + (d.currX - d.prevX) * alpha;
      const enemyY = (d: Enemy) => d.prevY + (d.currY - d.prevY) * alpha;
      // Ease the zoom toward its target in JS (cosmetic, on weapon swap).
      zoomCurrent.current += (zoomTarget.current - zoomCurrent.current) * 0.2;

      // Exploration-fog discovery: a plain proximity reveal around the player (no
      // line-of-sight polygon — that whole O(walls²) solve is gone). Cheap.
      const _tv = perfOn ? performance.now() : 0;
      markVisibleCircle(fog, { x: px, y: py }, VISION.discoverRadius);
      if (perfOn) perf.current.simVisMs += performance.now() - _tv;

      // Where the windup telegraph points: the locked enemy (interpolated) or, for
      // a breakable lock (negative id), its static box centre — else the player.
      let windupTargetX = px;
      let windupTargetY = py;
      if (c.cycle.phase === "windup" && c.lockedId !== null) {
        if (c.lockedId < 0) {
          const b = breakables[-c.lockedId - 1];
          if (b) {
            windupTargetX = b.box.x;
            windupTargetY = b.box.y;
          }
        } else {
          const e = enemies.find((d) => d.id === c.lockedId);
          if (e) {
            windupTargetX = enemyX(e);
            windupTargetY = enemyY(e);
          }
        }
      }
      // Viewport in world space (matches renderCombat's cull bounds), so scene data is
      // built only for what's on screen.
      const halfVW = anchorX / zoomCurrent.current;
      const halfVH = anchorY / zoomCurrent.current;
      const vMinX = camX - halfVW;
      const vMaxX = camX + halfVW;
      const vMinY = camY - halfVH;
      const vMaxY = camY + halfVH;

      // Breakables in a SINGLE pass: alive + on-screen only, no intermediate arrays — a
      // zone may hold hundreds, but the per-frame scene cost must stay bounded by the
      // view, not the map. The negative id (-(i+1)) still encodes the original index so
      // targeting (c.targetId) keeps resolving against the full breakables array.
      const sceneBreakables: CombatScene["breakables"] = [];
      for (let i = 0; i < breakables.length; i++) {
        const b = breakables[i]!;
        if (!b.alive) continue;
        if (
          b.box.x - b.box.w / 2 > vMaxX ||
          b.box.x + b.box.w / 2 < vMinX ||
          b.box.y - b.box.h / 2 > vMaxY ||
          b.box.y + b.box.h / 2 < vMinY
        )
          continue;
        sceneBreakables.push({
          x: b.box.x,
          y: b.box.y,
          w: b.box.w,
          h: b.box.h,
          hpFrac: b.hp / b.maxHp,
          flash: b.flash / HIT_FLASH_DURATION,
          kind: b.kind,
          // Occluding breakables (secret/destructible walls) get the "soft wall" look.
          occludes: b.occludes,
          // Fuse progress 0 → 1 (0 when not primed): drives the hot pre-blast glow.
          prime: b.fuse === null ? 0 : 1 - b.fuse / EXPLOSION_FUSE_DELAY,
          targeted: -(i + 1) === c.targetId,
          // A locked door carries its key colour so the renderer tints it; null = plain breakable.
          lock: b.lock ? b.lock.color : null,
        });
      }

      // Uncollected keys, on-screen only (same viewport cull as breakables).
      const sceneKeys: CombatScene["keys"] = [];
      for (const k of keys) {
        if (k.taken) continue;
        if (k.x > vMaxX + 32 || k.x < vMinX - 32 || k.y > vMaxY + 32 || k.y < vMinY - 32) continue;
        sceneKeys.push({ x: k.x, y: k.y, color: k.color });
      }

      // All enemy-derived render data — bodies, ranged/charge telegraphs, summon
      // rings — in ONE pass over the horde into reused buffers (was three full
      // passes that each allocated). Logic is unchanged: a ranged windup draws an
      // aim line to the player, else a committed charge draws its telegraph; the
      // summon ring is independent of either.
      const rs = renderScratch.current;
      rs.enemies.length = 0;
      rs.casts.length = 0;
      rs.summons.length = 0;
      for (const d of enemies) {
        const def = CREATURES[d.type];
        const ex = enemyX(d);
        const ey = enemyY(d);
        rs.enemies.push({
          id: d.id,
          x: ex,
          y: ey,
          hpFrac: d.combatant.hp / d.combatant.stats.maxHp,
          flash: d.flash / HIT_FLASH_DURATION,
          color: CREATURE_VISUALS[d.type].color,
          flying: d.flying,
        });
        if (def.attack && d.cycle && d.cycle.phase === "windup") {
          rs.casts.push({
            x: ex,
            y: ey,
            targetX: px,
            targetY: py,
            progress: 1 - d.cycle.remaining / def.attack.config.windup,
            color: CREATURE_VISUALS[d.type].projectileColor ?? CREATURE_VISUALS[d.type].color,
          });
        } else {
          const tele = brainTelegraph(d.brain);
          if (tele && tele.kind === "charge" && tele.dir !== undefined) {
            const len = tele.length ?? 360;
            rs.casts.push({
              x: ex,
              y: ey,
              targetX: ex + Math.cos(tele.dir) * len,
              targetY: ey + Math.sin(tele.dir) * len,
              progress: tele.progress,
              color: COLORS.chargeTell,
            });
          }
        }
        const summon = def.summon;
        if (summon && d.summonCycle && d.summonCycle.phase === "windup") {
          rs.summons.push({
            x: ex,
            y: ey,
            progress: 1 - d.summonCycle.remaining / summon.windup,
            color: CREATURE_VISUALS[d.type].telegraphColor ?? CREATURE_VISUALS[d.type].color,
          });
        }
      }
      // Player + enemy projectiles into one reused array (no [...a, ...b] spread).
      rs.projectiles.length = 0;
      for (const p of c.projectiles)
        rs.projectiles.push({ x: p.pos.x, y: p.pos.y, dirX: p.dir.x, dirY: p.dir.y, radius: p.radius, color: p.color });
      for (const p of c.enemyProjectiles)
        rs.projectiles.push({ x: p.pos.x, y: p.pos.y, dirX: p.dir.x, dirY: p.dir.y, radius: p.radius, color: p.color });

      combatPicture.value = recordCombatScene({
        camera: { x: camX, y: camY, zoom: zoomCurrent.current },
        anchor: { x: anchorX, y: anchorY },
        // Pixel HUD font (null until loaded → renderCombat uses its system-font fallback).
        fonts: { damage: damageFont, crit: critFont },
        floor: {
          chunks: floorChunks,
          chunkCols: ZONE.chunkCols,
          chunkRows: ZONE.chunkRows,
          chunkSize: ZONE.chunkSize,
        },
        player: {
          x: px,
          y: py,
          facing: s.facing,
          hpFrac: c.playerCombatant.hp / c.playerCombatant.stats.maxHp,
          hurt: c.iFrames / PLAYER_IFRAMES,
        },
        weapon: c.weapon,
        windup:
          c.cycle.phase === "windup"
            ? {
                progress: 1 - c.cycle.remaining / c.weapon.config.windup,
                facing: c.lockedFacing,
                targetX: windupTargetX,
                targetY: windupTargetY,
              }
            : null,
        targetId: c.targetId,
        enemies: rs.enemies,
        // Breakables: alive + on-screen only, built in the single pass above (a zone
        // may hold hundreds; off-screen ones are culled before any per-item work).
        breakables: sceneBreakables,
        keys: sceneKeys,
        enemyCasts: rs.casts,
        summonTelegraphs: rs.summons,
        projectiles: rs.projectiles,
        numbers: c.numbers.map((n) => ({
          x: n.x,
          y: n.y,
          text: n.text,
          crit: n.crit,
          hostile: n.hostile,
          fade: 1 - n.age / DAMAGE_NUMBER_LIFE,
        })),
        arcFlashes: c.arcFlashes.map((f) => ({
          x: f.x,
          y: f.y,
          facing: f.facing,
          fade: 1 - f.age / ARC_FLASH_DURATION,
        })),
        explosions: c.explosions.map((e) => ({
          x: e.x,
          y: e.y,
          radius: e.radius,
          progress: e.age / EXPLOSION_FX_DURATION,
          seed: e.seed,
        })),
        fog,
        time: s.time,
        lowHealthPhase: s.lowHpPhasePrev + (s.lowHpPhaseCurr - s.lowHpPhasePrev) * alpha,
      });

      // Drive the dash button's cooldown clock from the skill. While cooling,
      // re-record the wedge each frame for a smooth sweep; the moment it's ready,
      // push the cached ready face once — so an idle button never redraws (same
      // SkPicture ref each frame is a no-op for the <Picture>).
      const frac = dashCooldownFrac(dash);
      if (frac > 0) {
        dashOverlay.value = recordDashButton(frac);
        dashCooling.current = true;
      } else if (dashCooling.current) {
        dashOverlay.value = DASH_READY_PICTURE;
        dashCooling.current = false;
      }

      if (perfOn) {
        perf.current.renderMs += performance.now() - _t0;
        perf.current.frames += 1;
      }
    },
  });

  // The control deck pieces: the movement stick and the action cluster. The
  // default is right-handed — stick on the right, actions on the left; the
  // left-handed setting swaps them. The cluster aligns to whichever screen edge
  // it ends up against (left edge by default, right edge when left-handed).
  const stick = <Thumbstick size={stickSize} onChange={handleStick} />;
  const actionCluster = (
    <View style={[styles.actions, !settings.leftHanded && styles.actionsFlipped]}>
      <WeaponButton selected={weaponId} onCycle={cycleWeapon} />
      <DashButton overlay={dashOverlay} onPress={requestDash} />
    </View>
  );

  // The whole world is drawn into `combatPicture` each frame (camera baked in),
  // so the Canvas just blits the void backdrop and that one picture.
  return (
    <View style={styles.container}>
      <View style={[styles.playArea, { height: playHeight }]}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color={COLORS.void} />
          <Picture picture={combatPicture} />
        </Canvas>
        {/* Open the pause menu (a transparent overlay). The run stays mounted and
            frozen behind it, so Resume drops straight back in. */}
        <Pressable
          style={[styles.menuButton, { top: insets.top + 12 }]}
          onPress={() => navigation.navigate("Pause")}
          hitSlop={10}
        >
          <Text style={styles.menuButtonLabel}>Menu</Text>
        </Pressable>
        {/* Key inventory strip — top-right, clear of the menu button (top-left). */}
        <KeyHud inventory={keyHud} need={lockedNeed} style={{ top: insets.top + 12, right: 12 }} />
        {/* Locked-door callout — names the missing key's color, low-centre. */}
        <DoorNotice need={lockedNeed} style={{ bottom: 24 }} />
        {/* Frame profiler readout (JS-thread sim/record cost + raf fps), toggled by
            the Settings "Performance overlay" switch so it works in release too. */}
        {perfOn && perfText ? (
          <Text style={[styles.perfReadout, { top: insets.top + 44 }]}>{perfText}</Text>
        ) : null}
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 12 }]}>
        {settings.leftHanded ? (
          <>
            {stick}
            {actionCluster}
          </>
        ) : (
          <>
            {actionCluster}
            {stick}
          </>
        )}
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
  // Return-to-menu affordance, top-left of the play area (clear of the action
  // cluster's bottom-right home in either layout).
  menuButton: {
    position: "absolute",
    left: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(14, 17, 22, 0.55)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  menuButtonLabel: {
    fontFamily: UI.font,
    color: "rgba(255, 255, 255, 0.85)",
    fontSize: 15,
  },
  // Dev frame profiler: small mono readout pinned top-left under the Menu button.
  perfReadout: {
    position: "absolute",
    left: 12,
    color: "rgba(120, 255, 170, 0.9)",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  controls: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  // Bottom-right action stack: weapon swap on top, the dash roll below it (the
  // primary right-thumb action sits lowest/most reachable). A column keeps the
  // wide weapon chip from crowding the thumbstick on narrow phones.
  actions: {
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 12,
  },
  // Left-handed layout: the cluster now sits on the left, so align its chips to
  // that edge instead of the right.
  actionsFlipped: {
    alignItems: "flex-start",
  },
});
