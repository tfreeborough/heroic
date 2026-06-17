import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Canvas, Fill, Picture, type SkPicture } from "@shopify/react-native-skia";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  addBody,
  addVelocityPerSecond,
  angleTo,
  approachVelocity,
  ATTACK_CYCLE_READY,
  brainTelegraph,
  buildNavGrid,
  createBlockerBody,
  createFogGrid,
  createMoverBody,
  createPhysicsWorld,
  createMover,
  createRng,
  createSpatialGrid,
  distance,
  faceMovement,
  forEachNeighbor,
  getVelocityPerSecond,
  hitsInArc,
  makeCombatant,
  normalize,
  rebuildGrid,
  resolveAttack,
  segmentClear,
  selectTarget,
  setVelocityPerSecond,
  spawnVolley,
  stepAbility,
  stepAttackCycle,
  stepCrowd,
  stepPhysics,
  stepProjectile,
  STICK_ZERO,
  sub,
  tickBrain,
  useGameLoop,
  type AttackCycleState,
  type Brain,
  type Combatant,
  type HurtCircle,
  type Mover,
  type ProjectileState,
  type StickSample,
  type Vec2,
} from "@heroic/engine";
import {
  ARC_FLASH_DURATION,
  ARENA_SIZE,
  ARENA_TILES,
  CAMERA_FIT_MARGIN,
  CAMERA_FOLLOW_RATE,
  CAMERA_FRAME_PADDING,
  CAMERA_MIN_RADIUS,
  COLORS,
  CONTROLS_MIN_HEIGHT,
  CREATURES,
  CROWD_PUSH,
  DAMAGE_NUMBER_LIFE,
  DAMAGE_NUMBER_RISE,
  ENEMY_ACCEL,
  ENEMY_DECEL,
  ENEMY_GRID_CELL,
  ENEMY_RADIUS,
  ENGAGEMENT_MARGIN,
  FOG_CELL,
  HIT_FLASH_DURATION,
  LOS_RECHECK_STEPS,
  LOW_HP_PULSE_MAX_HZ,
  LOW_HP_PULSE_MIN_HZ,
  LOW_HP_THRESHOLD,
  MAX_REPATHS_PER_STEP,
  NAV_CELL,
  OCCLUDERS,
  PLAY_HEIGHT_RATIO,
  PLAYER_ACCEL,
  PLAYER_DECEL,
  PLAYER_IFRAMES,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  PLAYER_STATS,
  PILLARS,
  WALLS,
  type EnemyTypeId,
} from "./constants";
import { WEAPONS, type WeaponDef, type WeaponId } from "./weapons";
import { playStrikeHaptic } from "./haptics";
import { Thumbstick } from "./Thumbstick";
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
import { SpawnPicker } from "./SpawnPicker";
import { EMPTY_COMBAT_PICTURE, recordCombatScene } from "./renderCombat";

/** A hostile with a brain: chases/circles/kites per its type, soaks hits. */
interface Enemy {
  id: number;
  type: EnemyTypeId;
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

export const GameScreen = () => {
  const { width, height } = useWindowDimensions();
  // System-bar insets: the app draws edge-to-edge (Android default), so the
  // bottom navigation bar would otherwise overlap the control deck. We reserve
  // the bottom inset out of the play space (below) and pad the deck past it.
  const insets = useSafeAreaInsets();
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

  const { physics, player, weaponCombatants, rng } = useMemo(() => {
    const physics = createPhysicsWorld();
    const player = createMoverBody(ARENA_SIZE / 2, ARENA_SIZE / 2, PLAYER_RADIUS);
    addBody(physics, player);
    for (const w of WALLS) addBody(physics, createBlockerBody(w.x, w.y, w.w, w.h));
    for (const p of PILLARS) addBody(physics, createBlockerBody(p.x, p.y, p.w, p.h));

    // One attacker stat block per weapon, reused across strikes (resolveAttack
    // only reads the attacker's stats — hp is irrelevant on this side).
    const weaponCombatants = new Map<WeaponId, Combatant>(
      WEAPONS.map((w) => [w.id, makeCombatant(w.stats)]),
    );

    return { physics, player, weaponCombatants, rng: createRng(0xc0ffee) };
  }, []);

  // Enemies are spawned on demand from the test HUD (no auto-population, no
  // respawn): a mutable list the sim reads and mutates each step, plus a
  // monotonic id source. A ref, not state — the sim owns it; spawning never
  // needs a React render.
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
      mover,
      combatant: makeCombatant(def.stats),
      brain: def.makeBrain(id),
      // Assume visible until the first recheck; stagger timers by id so the
      // population's LOS checks spread evenly across steps rather than bunching.
      los: true,
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

  /** Spawn one of `type` at a random bearing a test-distance from the player. */
  const spawnEnemy = (type: EnemyTypeId) => {
    const angle = rng.next() * Math.PI * 2;
    const dist = 300 + rng.next() * 120;
    const margin = ENEMY_RADIUS + 8;
    const clamp = (v: number) => Math.max(margin, Math.min(ARENA_SIZE - margin, v));
    const x = clamp(player.position.x + Math.cos(angle) * dist);
    const y = clamp(player.position.y + Math.sin(angle) * dist);
    enemiesRef.current.push(makeEnemy(type, x, y));
  };

  const clearEnemies = () => {
    enemiesRef.current = [];
  };

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
    playerCombatant: makeCombatant(PLAYER_STATS),
    /** Post-hit invulnerability time left; any hit is ignored while > 0. */
    iFrames: 0,
  });

  // Dash skill runtime: the generic ability lifecycle plus the dash's own effect
  // state (locked direction, dodge i-frames). A ref — the sim owns it, no render.
  // The first of what will be a skill roster; each new skill gets a runtime here.
  const dashRuntime = useRef(createDashRuntime());

  const [weaponId, setWeaponId] = useState<WeaponId>(combat.current.weapon.id);
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
    prevX: ARENA_SIZE / 2,
    prevY: ARENA_SIZE / 2,
    currX: ARENA_SIZE / 2,
    currY: ARENA_SIZE / 2,
    facing: -Math.PI / 2, // face "up" until the first input
    // The camera is its own simulated object that chases the player rather
    // than pinning to them — moving lets the player drift off-centre and the
    // camera catch up, like a human operator (see CAMERA_FOLLOW_RATE).
    camPrevX: ARENA_SIZE / 2,
    camPrevY: ARENA_SIZE / 2,
    camCurrX: ARENA_SIZE / 2,
    camCurrY: ARENA_SIZE / 2,
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
  const fog = useMemo(() => createFogGrid(ARENA_SIZE, FOG_CELL), []);

  // Enemy navigation grid: built once from the interior pillars (inflated by the
  // enemy radius). The AI runtime routes brains around walls on this when their
  // sightline to the player is blocked.
  const navGrid = useMemo(() => buildNavGrid(ARENA_SIZE, NAV_CELL, PILLARS, ENEMY_RADIUS), []);

  // Spatial grid for enemy separation: every enemy is bucketed into it each step,
  // so separation only scans its 3×3 cell neighbourhood instead of the whole
  // swarm (the old O(n²) all-pairs scan). Created once; `neighborScratch` is the
  // reused per-query result buffer, so neighbour lookups allocate nothing.
  const enemyGrid = useMemo(() => createSpatialGrid(ARENA_SIZE, ENEMY_GRID_CELL), []);
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

  // Zoom is a plain number eased in JS (the picture recorder needs it per
  // frame); a swap sets the target and onRender glides toward it.
  const zoomTarget = useRef(zoomFor(combat.current.weapon));
  const zoomCurrent = useRef(zoomTarget.current);
  useEffect(() => {
    const weapon = WEAPONS.find((w) => w.id === weaponId) as WeaponDef;
    zoomTarget.current = zoomFor(weapon);
  }, [weaponId, width]);

  useGameLoop({
    onStep: (dt) => {
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

      // --- Enemy AI: each brain reads perception and yields a desired
      // velocity, shaped through the same acceleration-limited locomotion as
      // the player — so enemies inherit the weight/skid feel, and knockback
      // impulses decay through decel instead of physics damping. Positions
      // and facing are last step's resolved values; one step of lag is
      // imperceptible and keeps the order simple.
      const living = enemies;
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
      for (let i = 0; i < living.length; i++) {
        const e = living[i]!;
        selfIndex = i;
        neighbors.length = 0;
        forEachNeighbor(enemyGrid, e.mover.pos.x, e.mover.pos.y, collectNeighbor);
        // Refresh line-of-sight on a throttle (staggered per enemy): it's a ray
        // test against every occluder and only gates pathing, so a few frames of
        // lag is invisible. When a wall blocks the sightline, the runtime routes
        // around it via A* on navGrid instead of steering straight into it.
        if (e.losTimer <= 0) {
          e.los = segmentClear(e.mover.pos, player.position, OCCLUDERS);
          e.losTimer = LOS_RECHECK_STEPS;
        } else {
          e.losTimer -= 1;
        }
        const desired = tickBrain(
          e.brain,
          {
            selfPos: e.mover.pos,
            playerPos: player.position,
            playerFacing: s.facing,
            neighbors,
            hasLineOfSight: e.los,
            navGrid,
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

      // Matter now steps only the player (+ static walls) — ~10 bodies, trivial.
      stepPhysics(physics, dt);

      s.currX = player.position.x;
      s.currY = player.position.y;
      const playerPos = { x: s.currX, y: s.currY };

      // Enemies are integrated + collided in core, off matter.js (whose broadphase
      // is O(n²) for a pile — see docs/design/enemy-physics-and-crowds.md). Apply
      // velocities, push the crowd apart via the grid, resolve against the pillars
      // and the just-moved player, then clamp to the arena. This is the Phase 2 win.
      stepCrowd(
        enemies.map((e) => e.mover),
        dt,
        {
          grid: enemyGrid,
          walls: PILLARS,
          player: { pos: playerPos, radius: PLAYER_RADIUS },
          worldSize: ARENA_SIZE,
          pushStrength: CROWD_PUSH,
        },
      );

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

      // --- Enemy upkeep: just flash decay now (no respawn — the test HUD owns
      // population; the dead are removed outright).
      for (const d of enemies) d.flash = Math.max(0, d.flash - dt);
      const hurtCircles = (): HurtCircle[] =>
        enemies.map((d) => ({ id: d.id, pos: d.mover.pos, radius: ENEMY_RADIUS }));

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

      // --- Targeting: nearest hostile with hysteresis, inside the engagement
      // radius (which sits a margin beyond the weapon's attack range). Only
      // hostiles in line of sight are candidates — the player never locks onto,
      // faces, or auto-fires at something behind a wall (and a target that ducks
      // behind cover is dropped, mirroring how enemies lose their shot on you).
      const cfg = c.weapon.config;
      const engagement = cfg.reach + ENGAGEMENT_MARGIN;
      // Only enemies within engagement can ever be the target, so distance-gate
      // (cheap) *before* the line-of-sight ray test — otherwise we'd ray every
      // enemy in the arena every step just to discard the far ones.
      const targetCandidates: { id: number; pos: Vec2 }[] = [];
      for (const d of enemies) {
        if (distance(playerPos, d.mover.pos) > engagement) continue;
        if (!segmentClear(playerPos, d.mover.pos, OCCLUDERS)) continue;
        targetCandidates.push({ id: d.id, pos: d.mover.pos });
      }
      c.targetId = selectTarget(targetCandidates, playerPos, engagement, c.targetId);
      const target = enemies.find((d) => d.id === c.targetId) ?? null;

      // --- Attack cycle. Range gates on the target's edge; the windup lock
      // breaks if the locked target dies or leaves engagement.
      const locked = enemies.find((d) => d.id === c.lockedId) ?? null;
      const step = stepAttackCycle(c.cycle, cfg, dt, {
        targetInRange:
          target !== null &&
          distance(playerPos, target.mover.pos) - ENEMY_RADIUS <= cfg.reach,
        lockValid: locked !== null && distance(playerPos, locked.mover.pos) <= engagement,
      });
      c.cycle = step.state;
      if (step.windupStarted && target) {
        c.lockedId = target.id;
        c.lockedFacing = angleTo(playerPos, target.mover.pos);
      }
      if (step.lockBroken) c.lockedId = null;

      if (step.struck) {
        if (cfg.shape === "arc") {
          // Melee is facing-authoritative: cleave whatever is in the cone now,
          // locked target or not (see whiff rules in the movement doc).
          let landed = false;
          let crit = false;
          for (const id of hitsInArc(playerPos, c.lockedFacing, cfg.reach, cfg.arcWidth!, hurtCircles())) {
            const d = enemies.find((dd) => dd.id === id);
            if (!d) continue;
            const dir = normalize(sub(d.mover.pos, playerPos));
            crit = applyHit(d, dir, cfg.knockback ?? 0, weaponCombatants.get(c.weapon.id)!) || crit;
            landed = true;
          }
          // One pulse per swing however many it cleaves — haptics count
          // events, not victims. Whiffs are silent: the haptic *is* contact.
          if (landed) playStrikeHaptic(c.weapon.haptic, crit);
          c.arcFlashes.push({ x: s.currX, y: s.currY, facing: c.lockedFacing, age: 0 });
        } else if (locked) {
          // Ranged auto-aims at the target's position at the moment of Strike.
          // The volley's flight pattern (straight, pincer, ...) is weapon data.
          for (const p of spawnVolley(playerPos, locked.mover.pos, {
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
      let projectileCrit = false;
      for (let i = c.projectiles.length - 1; i >= 0; i--) {
        const p = c.projectiles[i]!;
        const from = { x: p.pos.x, y: p.pos.y };
        const result = stepProjectile(p, dt, hurtCircles());
        // A shot dies on a wall/pillar it crossed this step — so the hit it might
        // have landed on the far side doesn't count.
        const hitWall =
          !segmentClear(from, p.pos, OCCLUDERS) ||
          p.pos.x < 0 || p.pos.x > ARENA_SIZE || p.pos.y < 0 || p.pos.y > ARENA_SIZE;
        if (!hitWall) {
          for (const id of result.hits) {
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
        const engaged = inRange && segmentClear(e.mover.pos, playerPos, OCCLUDERS);
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
              color: def.attack.projectileColor,
              knockback: acfg.knockback ?? 0,
              attacker: e.attackCombatant,
            });
          }
        }
      }

      // --- Enemy projectiles: move, resolve against the player, expire on
      // range/walls. The player is the lone hurt circle here.
      const playerCircle: HurtCircle = { id: 0, pos: playerPos, radius: PLAYER_RADIUS };
      for (let i = c.enemyProjectiles.length - 1; i >= 0; i--) {
        const p = c.enemyProjectiles[i]!;
        const from = { x: p.pos.x, y: p.pos.y };
        const result = stepProjectile(p, dt, [playerCircle]);
        const hitWall =
          !segmentClear(from, p.pos, OCCLUDERS) ||
          p.pos.x < 0 || p.pos.x > ARENA_SIZE || p.pos.y < 0 || p.pos.y > ARENA_SIZE;
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
          const clamp = (v: number) => Math.max(margin, Math.min(ARENA_SIZE - margin, v));
          for (let k = 0; k < summon.count; k++) {
            const ang = rng.next() * Math.PI * 2;
            const r = rng.next() * summon.spawnRadius;
            const minion = makeEnemy(
              summon.minionType,
              clamp(e.mover.pos.x + Math.cos(ang) * r),
              clamp(e.mover.pos.y + Math.sin(ang) * r),
            );
            enemies.push(minion);
            e.minionIds.push(minion.id);
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
    },
    onRender: (alpha) => {
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

      const lockedEnemy =
        c.cycle.phase === "windup" ? enemies.find((d) => d.id === c.lockedId) : undefined;
      combatPicture.value = recordCombatScene({
        camera: { x: camX, y: camY, zoom: zoomCurrent.current },
        anchor: { x: anchorX, y: anchorY },
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
                targetX: lockedEnemy ? enemyX(lockedEnemy) : px,
                targetY: lockedEnemy ? enemyY(lockedEnemy) : py,
              }
            : null,
        targetId: c.targetId,
        enemies: enemies.map((d) => ({
          id: d.id,
          x: enemyX(d),
          y: enemyY(d),
          hpFrac: d.combatant.hp / d.combatant.stats.maxHp,
          flash: d.flash / HIT_FLASH_DURATION,
          color: CREATURES[d.type].color,
        })),
        enemyCasts: enemies.flatMap((d) => {
          const def = CREATURES[d.type];
          const ex = enemyX(d);
          const ey = enemyY(d);
          // Ranged wind-up: a line to the player.
          if (def.attack && d.cycle && d.cycle.phase === "windup") {
            return [
              {
                x: ex,
                y: ey,
                targetX: px,
                targetY: py,
                progress: 1 - d.cycle.remaining / def.attack.config.windup,
                color: def.attack.projectileColor,
              },
            ];
          }
          // Charge wind-up: the committed dash line (from the brain's telegraph).
          const tele = brainTelegraph(d.brain);
          if (tele && tele.kind === "charge" && tele.dir !== undefined) {
            const len = tele.length ?? 360;
            return [
              {
                x: ex,
                y: ey,
                targetX: ex + Math.cos(tele.dir) * len,
                targetY: ey + Math.sin(tele.dir) * len,
                progress: tele.progress,
                color: COLORS.chargeTell,
              },
            ];
          }
          return [];
        }),
        summonTelegraphs: enemies.flatMap((d) => {
          const summon = CREATURES[d.type].summon;
          if (!summon || !d.summonCycle || d.summonCycle.phase !== "windup") return [];
          return [
            {
              x: enemyX(d),
              y: enemyY(d),
              progress: 1 - d.summonCycle.remaining / summon.windup,
              color: summon.telegraphColor,
            },
          ];
        }),
        projectiles: [...c.projectiles, ...c.enemyProjectiles].map((p) => ({
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
          hostile: n.hostile,
          fade: 1 - n.age / DAMAGE_NUMBER_LIFE,
        })),
        arcFlashes: c.arcFlashes.map((f) => ({
          x: f.x,
          y: f.y,
          facing: f.facing,
          fade: 1 - f.age / ARC_FLASH_DURATION,
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
    },
  });

  // The whole world is drawn into `combatPicture` each frame (camera baked in),
  // so the Canvas just blits the void backdrop and that one picture.
  return (
    <View style={styles.container}>
      <View style={[styles.playArea, { height: playHeight }]}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color={COLORS.void} />
          <Picture picture={combatPicture} />
        </Canvas>
        <SpawnPicker onSpawn={spawnEnemy} onClear={clearEnemies} topInset={insets.top} />
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 12 }]}>
        <Thumbstick size={stickSize} onChange={(sample) => (stickRef.current = sample)} />
        <View style={styles.actions}>
          <WeaponButton selected={weaponId} onCycle={cycleWeapon} />
          <DashButton overlay={dashOverlay} onPress={requestDash} />
        </View>
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
  // Bottom-right action stack: weapon swap on top, the dash roll below it (the
  // primary right-thumb action sits lowest/most reachable). A column keeps the
  // wide weapon chip from crowding the thumbstick on narrow phones.
  actions: {
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 12,
  },
});
