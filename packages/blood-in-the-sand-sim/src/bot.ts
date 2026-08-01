/**
 * The bot brain — one movement decision per tick, from snapshot data only
 * (a bot is just a client that thinks instead of touches). Lives in the sim
 * package so the server's headless bot script and the app's offline practice
 * mode share the exact same opponent; pure and platform-free like everything
 * else here.
 *
 * v2 (docs/design/bot-brains.md, steps 1–3): movement is a weighted blend of
 * micro-behaviours — engage / kite / strafe / anchor / disengage / avoid
 * hostile ground — with the weights coming from the bot's ARCHETYPE
 * (botArchetypes.ts, derived from its own loadout). Goals resolve through
 * the nav layer (nav.ts) so nothing can be baited into concave pockets, and
 * the whole drafted hand is live via the per-ability cast rules
 * (botCasts.ts). Dash decides here because it IS movement. The wall-unstick
 * shuffle survives only as a counted last-resort fallback behind nav.
 *
 * v3 humanization (docs/design/bot-humanization.md): the MOTOR layer gets
 * human texture at EVERY tier — stick inertia, committed hazard detours
 * with a personal margin (no more machine-perfect zone orbiting), greed
 * while diving, sloppy hysteretic band edges, micro-pauses. Texture, not
 * difficulty: mistakes stay tier-gated in DIFFICULTIES; reactive survival
 * moves (dodges, evasion, unstick) bypass the smoothing and stay sharp.
 */
import { ARCHETYPES, deriveArchetype, focusTarget, resolveBand, type ArchetypeId } from "./botArchetypes";
import { dashDown, decideCasts, incomingShot, rangedWeapon, windupThreat } from "./botCasts";
import { DEFAULT_DIFFICULTY, DIFFICULTIES, type DifficultyId } from "./botDifficulty";
import { DASH_DISTANCE, SANDSTORM, SANDTRAP, TREMOR } from "./config";
import type { BotNav } from "./nav";
import { dashClear, navDirection, openDirection } from "./nav";
import type { DeployableSnapshot, PlayerSnapshot, ProjectileSnapshot } from "./protocol";

export * from "./botArchetypes";
export * from "./botDifficulty";
export { decideCasts, nearestEnemy, threatRange, windupThreat } from "./botCasts";

/** The tick-to-tick state behind orbit flips and the wedge fallback. */
export interface BotMemory {
  lastX: number;
  lastY: number;
  stuckTicks: number;
  slideTicks: number;
  slideSign: number;
  /** Which way the strafe orbits; flips when the way is blocked. */
  orbitSign: number;
  /** Ticks left before the orbit may flip again (debounces wall jitter). */
  orbitHoldTicks: number;
  /** Times the last-resort unstick fired. Nav should make this ~never move —
   * a climbing count in a playtest is a bug report against nav, not tuning
   * (hosts may surface it in dev builds; the sim stays console-free). */
  wedgeCount: number;
  /** Cast pacing: ticks until the next PROACTIVE press may go out — one play
   * per beat, so a two-ability hand doesn't dump itself in a single moment.
   * Reactive answers (mirror/ironhide) ignore the hold; any press sets it. */
  castHoldTicks: number;
  /** Seeded per-bot RNG state (mulberry32) behind the difficulty rolls —
   * plain-number state so the memory stays a serialisable bag; the sim's own
   * rng stream is never touched (bot inputs are just inputs). */
  rngState: number;
  /** Anti-stall impatience: rounds have no clock, and two competent
   * equal-speed brains can orbit each other (or a pillar) forever. Track
   * ticks with NO hp change on either side of my duel; past the threshold
   * the bot "gets impatient" and presses in until something bleeds. */
  stallTicks: number;
  /** Ticks left in the current impatience press. */
  pressTicks: number;
  stallTargetId: number | null;
  stallMyHp: number;
  stallTargetHp: number;
  /** The attacker id of the telegraph episode last rolled against (null =
   * no live threat) — a dodge roll happens ONCE per swing, not per tick. */
  threatKey: number | null;
  /** Whether that roll passed: this swing gets its reactive answer or not. */
  threatApproved: boolean;
  /** Ticks left in a low-tier hesitation freeze (the dither dial). */
  ditherTicks: number;
  /** The flee budget (Tom, 2026-07-22 — cornered cowards are anti-fun):
   * ticks spent in the current low-hp retreat, and whether the allowance is
   * burned. A spent budget means FIGHT WOUNDED; it re-arms only by healing
   * back above the archetype's threshold (or the round reset's full hp). */
  fleeTicks: number;
  fleeSpent: boolean;
  /** The in-flight projectile last rolled against (per-shot episode, like
   * the windup's) and whether that roll passed. */
  shotKey: number | null;
  shotApproved: boolean;
  /** Serpentine state: which way the approach is currently cutting, and
   * ticks until the next irregular flip. */
  weaveSign: number;
  weaveTicks: number;
  /** Motor smoothing (bot-humanization.md M1): the heading the thumb is
   * actually holding (unit vector; 0,0 = never moved) and its magnitude. */
  headX: number;
  headY: number;
  headMag: number;
  /** Committed hazard detour (M2): the zone being skirted, the side picked,
   * the personal margin rolled for this episode, and the ticks left in the
   * late-notice flinch. One decision, held — like a person. */
  detourZoneId: number | null;
  detourSign: number;
  detourMargin: number;
  flinchTicks: number;
  /** Sloppy band-keeping (M4): the fuzz multiplier on band edges, its
   * re-roll countdown, and the hysteretic state (1 advance / 0 hold /
   * -1 back) — band flips need a real overshoot, not a pixel. */
  bandFuzz: number;
  bandFuzzTicks: number;
  bandState: number;
  /** Micro-pause ticks left (M5) — feet only, hands stay live. */
  pauseTicks: number;
}

export const createBotMemory = (seed = 0x2f6e2b1): BotMemory => ({
  lastX: 0,
  lastY: 0,
  stuckTicks: 0,
  slideTicks: 0,
  slideSign: 1,
  orbitSign: 1,
  orbitHoldTicks: 0,
  wedgeCount: 0,
  castHoldTicks: 0,
  rngState: seed | 0,
  stallTicks: 0,
  pressTicks: 0,
  stallTargetId: null,
  stallMyHp: 0,
  stallTargetHp: 0,
  threatKey: null,
  threatApproved: false,
  ditherTicks: 0,
  fleeTicks: 0,
  fleeSpent: false,
  shotKey: null,
  shotApproved: false,
  weaveSign: 1,
  weaveTicks: 0,
  headX: 0,
  headY: 0,
  headMag: 0,
  detourZoneId: null,
  detourSign: 1,
  detourMargin: 0,
  flinchTicks: 0,
  bandFuzz: 1,
  bandFuzzTicks: 0,
  bandState: 0,
  pauseTicks: 0,
});

/** Everything the brain reads about the match — the three snapshot arrays a
 * host passes each tick (players/deployables at the tier's staleness). */
export interface BotWorld {
  players: PlayerSnapshot[];
  deployables: DeployableSnapshot[];
  projectiles: ProjectileSnapshot[];
}

/** No blood on either side for this long → the bot loses patience. */
const STALL_TICKS = 240; // 8s at 30Hz
/** How long an impatience press lasts before re-evaluating. */
const PRESS_TICKS = 150; // 5s
/** A low-hp retreat may last this long, TOTAL, before the bot must fight
 * wounded (Tom, 2026-07-22: three cornered cowards waiting to be picked off
 * is the opposite of a fight). Healing re-arms it. */
const FLEE_BUDGET_TICKS = 105; // 3.5s

/** Motor-layer texture (docs/design/bot-humanization.md) — applied at EVERY
 * tier: these make the feet read as a thumb on a stick, not an optimizer.
 * Mistakes stay tier-gated in DIFFICULTIES; nothing here touches stats. */
const HUMANIZE = {
  /** M1: heading turn cap, rad per tick (≈7 rad/s at 30Hz — a thumb, not a
   * teleport), the stick-magnitude ease rates, and the speed floor while
   * swinging through a big reversal. */
  turnPerTick: 0.233,
  ramp: 0.15,
  release: 0.3,
  reversalFloor: 0.35,
  /** M2: px beyond a zone's radius where a detour commits; the personal
   * margin roll (radius + min + rng*range); the late-notice flinch length. */
  detourNotice: 110,
  detourMarginMin: 30,
  detourMarginRange: 70,
  flinchTicks: 9,
  /** M3: hazard damping while diving/pressing — tank the trap for the kill. */
  greedScale: 0.3,
  /** M4: ± band-edge fuzz, its re-roll cadence (ticks), and the px a band
   * boundary must be overshot before the advance/hold/back state flips. */
  bandFuzz: 0.12,
  bandFuzzMinTicks: 120,
  bandFuzzRangeTicks: 120,
  hysteresis: 25,
  /** M5: rare micro-pause odds/length (feet only), and the whim strafe flip. */
  pauseChance: 1 / 600,
  pauseMin: 5,
  pauseRange: 5,
  whimFlip: 0.006,
} as const;

/**
 * M1 stick inertia: turn the held heading toward the desired direction at a
 * human thumb rate and ease the magnitude — a big reversal swings through a
 * slowed middle instead of teleporting 180°. A bot that has never moved
 * snaps straight to the first intent (walking off the spawn line decisively
 * is human too); reactive overrides bypass this entirely (the caller snaps
 * the heading afterwards). Mutates `memory`.
 */
const smoothHeading = (memory: BotMemory, desired: { x: number; y: number }, desiredMag: number): void => {
  if (desiredMag <= 0) {
    memory.headMag = Math.max(0, memory.headMag - HUMANIZE.release);
    return;
  }
  if (memory.headX === 0 && memory.headY === 0) {
    memory.headX = desired.x;
    memory.headY = desired.y;
    memory.headMag = desiredMag;
    return;
  }
  const cur = Math.atan2(memory.headY, memory.headX);
  const want = Math.atan2(desired.y, desired.x);
  let diff = want - cur;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const a = cur + Math.max(-HUMANIZE.turnPerTick, Math.min(HUMANIZE.turnPerTick, diff));
  memory.headX = Math.cos(a);
  memory.headY = Math.sin(a);
  const swing = Math.abs(diff);
  const target = desiredMag * (swing > 0.6 ? Math.max(HUMANIZE.reversalFloor, 1 - (swing - 0.6) / 1.8) : 1);
  memory.headMag += Math.max(-HUMANIZE.ramp, Math.min(HUMANIZE.ramp, target - memory.headMag));
};

/** One mulberry32 step on the memory's rng state → [0, 1). */
const nextRand = (memory: BotMemory): number => {
  memory.rngState = (memory.rngState + 0x6d2b79f5) | 0;
  let t = memory.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export interface BotDecision {
  sx: number;
  sy: number;
  /** Slot-indexed cast flags, aligned with `me.abilities` — exactly the shape
   * the input message wants. */
  casts: boolean[];
}

const IDLE: BotDecision = { sx: 0, sy: 0, casts: [] };

/** Is the bot's dash drafted, off cooldown, and still budgeted? */
const dashReady = (me: PlayerSnapshot): boolean =>
  me.abilities.some((s) => s.id === "dash" && s.cd === 0 && s.charges > 0);

/**
 * Last-resort wedge escape, kept from v1 behind the nav layer: if position
 * stagnates while the bot intends to move, slide perpendicular for a bit.
 * With goals resolving through flow fields this should never fire — it
 * exists for the un-modelled cases (pinned by bodies, knocked into a seam)
 * and counts firings so hosts can flag a nav bug. Mutates `memory`; returns
 * the override direction while a slide is running.
 */
const unstick = (
  memory: BotMemory,
  me: PlayerSnapshot,
  intent: { x: number; y: number },
): { x: number; y: number } | null => {
  const moved = Math.hypot(me.x - memory.lastX, me.y - memory.lastY);
  const wantsToMove = Math.hypot(intent.x, intent.y) > 0.1;
  memory.stuckTicks = wantsToMove && moved < 1.5 ? memory.stuckTicks + 1 : 0;
  memory.lastX = me.x;
  memory.lastY = me.y;
  if (memory.stuckTicks > 12) {
    memory.slideTicks = 30;
    memory.slideSign = -memory.slideSign;
    memory.stuckTicks = 0;
    memory.wedgeCount += 1;
  }
  if (memory.slideTicks > 0) {
    memory.slideTicks -= 1;
    return { x: -intent.y * memory.slideSign, y: intent.x * memory.slideSign };
  }
  return null;
};

/** The strafe direction, orbit-flipping (debounced) when it runs against
 * geometry so an orbiting bot swings round the other way, never grinds.
 * Legs are irregular and occasionally flip on a whim (humanization M5) —
 * a metronome orbit is a machine tell. */
const strafeDir = (
  memory: BotMemory,
  nav: BotNav,
  mePos: { x: number; y: number },
  toward: { x: number; y: number },
): { x: number; y: number } => {
  if (memory.orbitHoldTicks > 0) {
    memory.orbitHoldTicks -= 1;
  } else if (nextRand(memory) < HUMANIZE.whimFlip) {
    memory.orbitSign = -memory.orbitSign;
    memory.orbitHoldTicks = 14 + Math.floor(nextRand(memory) * 16);
  }
  let dir = { x: -toward.y * memory.orbitSign, y: toward.x * memory.orbitSign };
  const slid = openDirection(nav, mePos, dir);
  if (slid !== dir && memory.orbitHoldTicks === 0) {
    memory.orbitSign = -memory.orbitSign;
    memory.orbitHoldTicks = 14 + Math.floor(nextRand(memory) * 16);
    dir = { x: -toward.y * memory.orbitSign, y: toward.x * memory.orbitSign };
  }
  return dir;
};

/** Hostile ground the feet should refuse: enemy quakes, enemy storms, and
 * enemy sandtraps that have finished arming (radius + a body's margin). */
const hostileZoneRadius = (d: DeployableSnapshot): number | null => {
  if (d.kind === "quake") return TREMOR.radius;
  if (d.kind === "sandstorm") return SANDSTORM.radius;
  if (d.kind === "sandtrap" && d.armLeft === 0) return SANDTRAP.triggerRadius;
  return null;
};

export interface BotThinkOptions {
  /** Pin an archetype instead of deriving from the loadout (dev tooling, tests). */
  archetype?: ArchetypeId;
  /** Execution-quality tier; callers feed staleness themselves (the
   * SnapshotHistory), this applies the in-brain dials. Default Skilled. */
  difficulty?: DifficultyId;
}

/**
 * Decide this tick's input. `me` missing/dead (benched) or no living enemy
 * means stand still. Mutates `memory`.
 *
 * The archetype derives from the bot's OWN loadout each tick (snapshot
 * weapon + slot ids) — no caller bookkeeping, and a re-armed bot re-derives
 * automatically.
 *
 * Difficulty (botDifficulty.ts): the caller passes a STALE world for
 * `players`/`deployables` (SnapshotHistory at the tier's reactionTicks —
 * keep `me` current: proprioception is instant, and a stale self-position
 * would re-open the wall-grinding this brain just got rid of). In here the
 * tier gates the reactive answer (one dodge roll per swing), the odds and
 * pace of proactive casts, and adds the low-tier movement wobble.
 *
 * Movement is a weighted vector blend, resolved wall-aware at the end:
 * band-keeping (kite/engage/hold) or contact charge, strafe while holding,
 * the disengage retreat, the anchor leash to teammates, the pull of an own
 * blood font when hurt, the trapper's drift back over its own mine, and the
 * push out of hostile zones. Dash: dodge a telegraph aimed at me first, then
 * the archetype's gap-closer or escape hop — never into a wall.
 */
export const botThink = (
  memory: BotMemory,
  me: PlayerSnapshot | undefined,
  world: BotWorld,
  nav: BotNav,
  opts?: BotThinkOptions,
): BotDecision => {
  if (!me || !me.alive) return IDLE;
  const { players, deployables, projectiles } = world;
  const tier = DIFFICULTIES[opts?.difficulty ?? DEFAULT_DIFFICULTY];

  // Dither: the overwhelmed-new-player hesitation — a low tier occasionally
  // just freezes for half a beat, feet and buttons both (a frozen bot eats
  // the hit; that's the point). Checked before anything else thinks.
  if (tier.dither > 0) {
    if (memory.ditherTicks > 0) {
      memory.ditherTicks -= 1;
      return { sx: 0, sy: 0, casts: me.abilities.map(() => false) };
    }
    if (nextRand(memory) < tier.dither / 30) {
      memory.ditherTicks = 12 + Math.floor(nextRand(memory) * 8); // 0.4–0.65s
    }
  }

  const archetype = opts?.archetype ?? deriveArchetype(me.weapon, me.abilities.map((s) => s.id));
  const preset = ARCHETYPES[archetype];
  const target = focusTarget(preset, me, players, tier.focusFire);
  if (!target) return IDLE;

  const mePos = { x: me.x, y: me.y };
  const dist = Math.hypot(target.x - me.x, target.y - me.y) || 1;
  /** Wall-aware direction toward the target — the nav layer's whole point. */
  const toward = navDirection(nav, target.id, mePos, { x: target.x, y: target.y });
  /** Straight-line retreat; openDirection turns it into a wall-slide at the end. */
  const away = { x: (me.x - target.x) / dist, y: (me.y - target.y) / dist };
  const targetHp = target.maxHp > 0 ? target.hp / target.maxHp : 1;
  const hp = me.maxHp > 0 ? me.hp / me.maxHp : 1;
  // Last stand (Tom, 2026-07-20): fleeing exists to regroup with teammates —
  // a lone survivor has nobody to regroup with, so retreat can only prolong
  // the round, never win it. The team's last body never flees (the archetype
  // still plays its band/dodge game; only run-away mode is off). In 1v1s
  // every bot is always its team's last, so bots there simply never flee.
  const lastStand = !players.some((p) => p.id !== me.id && p.team === me.team && p.alive);
  // …and even WITH teammates, retreat is a budget, not a lifestyle (Tom,
  // 2026-07-22): a few seconds to break away, pour a font, regroup — then
  // the bot fights wounded. Only actually healing re-arms the allowance,
  // so corner-cowering until picked off can't happen.
  let fleeing = !lastStand && hp < preset.disengageBelow;
  if (fleeing) {
    if (memory.fleeSpent) {
      fleeing = false;
    } else {
      memory.fleeTicks += 1;
      if (memory.fleeTicks > FLEE_BUDGET_TICKS) {
        memory.fleeSpent = true;
        fleeing = false;
      }
    }
  } else if (hp >= preset.disengageBelow) {
    memory.fleeTicks = 0;
    memory.fleeSpent = false;
  }

  // The live telegraph, read once — the dodge roll consumes it below, and
  // the micro-pause must never fire under a raised weapon.
  const threat = windupThreat(me, players);

  // M5 micro-pause: now and then, at EVERY tier, the feet just stop for a
  // beat — the human sizing-up-the-ground stutter. Distinct from low-tier
  // dither (longer, freezes the hands too, a mistake); this is texture.
  // Never under a telegraph, mid-flee, or at grips.
  if (memory.pauseTicks > 0) {
    memory.pauseTicks -= 1;
  } else if (threat === null && !fleeing && dist > 240 && nextRand(memory) < HUMANIZE.pauseChance) {
    memory.pauseTicks = HUMANIZE.pauseMin + Math.floor(nextRand(memory) * HUMANIZE.pauseRange);
    memory.stuckTicks = 0; // deliberate stillness is not a wedge
  }

  // Impatience: no hp change on either side of this duel for STALL_TICKS →
  // press in (band collapses to a charge, dash becomes a gap-closer) until
  // something bleeds. Rounds have no clock; the bot supplies the urgency a
  // human's boredom would. A fleeing bot never presses — its OPPONENT's
  // impatience is what ends that stand-off.
  if (target.id !== memory.stallTargetId || me.hp !== memory.stallMyHp || target.hp !== memory.stallTargetHp) {
    memory.stallTargetId = target.id;
    memory.stallMyHp = me.hp;
    memory.stallTargetHp = target.hp;
    memory.stallTicks = 0;
  } else if (memory.pressTicks === 0) {
    memory.stallTicks += 1;
    if (memory.stallTicks > STALL_TICKS) {
      memory.pressTicks = PRESS_TICKS;
      memory.stallTicks = 0;
    }
  }
  if (memory.pressTicks > 0) memory.pressTicks -= 1;
  const pressing = memory.pressTicks > 0 && !fleeing;

  /** The dive: a weak-enough mark collapses the band into a charge. */
  const diving = preset.diveBelow !== undefined && targetHp < preset.diveBelow;
  const band = diving || pressing ? null : resolveBand(preset, me.weapon);

  // M4 sloppy bands: the edges wear a personal fuzz (re-rolled every few
  // seconds) and the advance/hold/back state flips only on a real overshoot
  // — a human drifts in and out of range; a machine vibrates at the pixel.
  let bandNear = 0;
  let bandFar = 0;
  if (band !== null) {
    memory.bandFuzzTicks -= 1;
    if (memory.bandFuzzTicks <= 0) {
      memory.bandFuzz = 1 + (nextRand(memory) * 2 - 1) * HUMANIZE.bandFuzz;
      memory.bandFuzzTicks = HUMANIZE.bandFuzzMinTicks + Math.floor(nextRand(memory) * HUMANIZE.bandFuzzRangeTicks);
    }
    bandNear = band.near * memory.bandFuzz;
    bandFar = band.far * memory.bandFuzz;
    const h = HUMANIZE.hysteresis;
    if (dist > bandFar + h) memory.bandState = 1;
    else if (dist < bandNear - h) memory.bandState = -1;
    else if (memory.bandState === 1 && dist < bandFar - h) memory.bandState = 0;
    else if (memory.bandState === -1 && dist > bandNear + h) memory.bandState = 0;
  } else {
    memory.bandState = 0;
  }

  let vx = 0;
  let vy = 0;
  const add = (d: { x: number; y: number }, w: number): void => {
    vx += d.x * w;
    vy += d.y * w;
  };

  // The punish window: their swing's recovery — and, for the smart tiers,
  // their ESCAPE being down (dash cooldowns are public clocks; surging the
  // moment yours is spent is the doc's promised bait-and-punish).
  const punishing =
    preset.punishRecovery &&
    ((target.atk === "recovery" && dist < 400) ||
      (tier.smartDodge && dashDown(target) && dist < 350));

  // Band-keeping — or the contact charge for band-less brains.
  if (fleeing) {
    add(away, 1.4);
  } else if (punishing) {
    add(toward, 1);
  } else if (band === null || memory.bandState === 1) {
    add(toward, preset.engage);
  } else if (memory.bandState === -1) {
    add(away, 1);
  }
  // Strafe while holding position (banded brains in the band; contact brains
  // angle their approach with it).
  const holding = !fleeing && !punishing && (band === null || memory.bandState === 0);
  if (holding && preset.strafe > 0) add(strafeDir(memory, nav, mePos, toward), preset.strafe);

  // Weave: closing on a SHOOTER in a straight line means every arrow lands
  // (Tom's step-6 exploit — kite with a bow, watch them walk into it). High
  // tiers serpentine the approach instead: a lateral cut that flips on an
  // irregular beat, so the shot fired at where they are keeps landing where
  // they were. Applies whenever there's real ground to close — CONTACT
  // brains most of all (they're the exploit's usual victims) — never at
  // grips, and never for a banded brain already holding its range.
  const approaching = !fleeing && dist > 160 && (band === null || memory.bandState === 1);
  if (tier.weave > 0 && approaching && rangedWeapon(target)) {
    memory.weaveTicks -= 1;
    if (memory.weaveTicks <= 0) {
      memory.weaveSign = -memory.weaveSign;
      memory.weaveTicks = 10 + Math.floor(nextRand(memory) * 10); // 0.33–0.66s legs
    }
    add({ x: -toward.y * memory.weaveSign, y: toward.x * memory.weaveSign }, tier.weave);
  }

  // The anchor leash: drift back to the pack when it stretches.
  if (preset.anchorLeash > 0) {
    let mate: PlayerSnapshot | undefined;
    let mateDist = Infinity;
    for (const p of players) {
      if (p.id === me.id || p.team !== me.team || !p.alive) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d < mateDist) {
        mate = p;
        mateDist = d;
      }
    }
    if (mate && mateDist > preset.anchorLeash) {
      add(navDirection(nav, mate.id, mePos, { x: mate.x, y: mate.y }), 0.9);
    }
  }

  // Feet cooperate with hands: a hurt bot drifts to its own team's font…
  if (hp < 0.6) {
    for (const d of deployables) {
      if (d.kind !== "blood-font" || d.team !== me.team) continue;
      const fontDist = Math.hypot(d.x - me.x, d.y - me.y);
      if (fontDist > 40 && fontDist < 400) add(navDirection(nav, d.id, mePos, { x: d.x, y: d.y }), 0.7);
    }
  }
  // …and the trapper falls back over its own mine, so you cross it.
  if (archetype === "trapper" && (fleeing || holding)) {
    for (const d of deployables) {
      if (d.kind !== "sandtrap" || d.team !== me.team) continue;
      const mineDist = Math.hypot(d.x - me.x, d.y - me.y);
      if (mineDist > 240) add(navDirection(nav, d.id, mePos, { x: d.x, y: d.y }), 0.5);
    }
  }

  // Hostile ground (humanization M2/M3) — the old standing radial push made
  // the feet orbit a zone's exact edge like a machine. Instead: a COMMITTED
  // DETOUR episode (pick a side once, roll a personal margin, arc around and
  // stick with it), a late-notice flinch, and greed — a diving or pressing
  // bot damps its avoidance and tanks the trap for the kill, exactly the
  // trade a human makes.
  const hazardScale = diving || pressing ? HUMANIZE.greedScale : 1;
  const axis = memory.headMag > 0.2 ? { x: memory.headX, y: memory.headY } : fleeing ? away : toward;
  // Greed drops the detour planning outright — a bot chasing a kill walks
  // the straight line and eats the ground; only the shell below still nudges.
  if (hazardScale < 1) memory.detourZoneId = null;
  // Keep or retire the running episode.
  let detour: DeployableSnapshot | undefined;
  if (hazardScale === 1 && memory.detourZoneId !== null) {
    detour = deployables.find((d) => d.id === memory.detourZoneId && d.team !== me.team && hostileZoneRadius(d) !== null);
    if (detour) {
      const zd = Math.hypot(detour.x - me.x, detour.y - me.y) || 1;
      const behind = (detour.x - me.x) * axis.x + (detour.y - me.y) * axis.y < 0;
      if (zd > memory.detourMargin + 140 || behind) detour = undefined;
    }
    if (!detour) memory.detourZoneId = null;
  }
  // Or commit a new one: the first zone blocking the corridor ahead.
  if (!detour && hazardScale === 1) {
    for (const d of deployables) {
      if (d.team === me.team) continue;
      const radius = hostileZoneRadius(d);
      if (radius === null) continue;
      const zx = d.x - me.x;
      const zy = d.y - me.y;
      const zd = Math.hypot(zx, zy) || 1;
      if (zd > radius + HUMANIZE.detourNotice) continue;
      if ((zx * axis.x + zy * axis.y) / zd < 0.3) continue; // not in my way
      memory.detourZoneId = d.id;
      // Pass on the side the feet already favour; rng breaks a dead-centre tie.
      const side = zy * axis.x - zx * axis.y;
      memory.detourSign = Math.abs(side) < zd * 0.05 ? (nextRand(memory) < 0.5 ? 1 : -1) : side > 0 ? 1 : -1;
      memory.detourMargin = radius + HUMANIZE.detourMarginMin + nextRand(memory) * HUMANIZE.detourMarginRange;
      // Noticed it late (placed mid-stride — the tier's stale world makes
      // this happen naturally) → the "oh crap" swerve before the arc.
      if (zd < radius + 20) memory.flinchTicks = HUMANIZE.flinchTicks;
      detour = d;
      break;
    }
  }
  if (detour) {
    const zd = Math.hypot(detour.x - me.x, detour.y - me.y) || 1;
    const off = { x: (me.x - detour.x) / zd, y: (me.y - detour.y) / zd };
    if (memory.flinchTicks > 0) {
      memory.flinchTicks -= 1;
      add(off, 2.5);
    } else {
      // Arc along the committed side, correcting toward the personal margin.
      const tangent = { x: -off.y * memory.detourSign, y: off.x * memory.detourSign };
      const correct = Math.max(-0.6, Math.min(1.2, (memory.detourMargin - zd) / 60));
      const ax = tangent.x + off.x * correct;
      const ay = tangent.y + off.y * correct;
      const alen = Math.hypot(ax, ay) || 1;
      add({ x: ax / alen, y: ay / alen }, 1.6);
    }
  }
  // The emergency shell: LOITERING inside a zone is never acceptable — full
  // scale throws an idle bot out, and a pressing bot keeps a damped lean.
  // A DIVE is exempt entirely: the dive is the deliberate acceptance of the
  // ground (a rim-equilibrium here would just re-create the machine orbit
  // this pass exists to kill).
  if (!diving) {
    for (const d of deployables) {
      if (d.team === me.team) continue;
      const radius = hostileZoneRadius(d);
      if (radius === null) continue;
      const zd = Math.hypot(d.x - me.x, d.y - me.y) || 1;
      if (zd < radius) add({ x: (me.x - d.x) / zd, y: (me.y - d.y) / zd }, 3 * hazardScale);
    }
  }

  const mag = Math.hypot(vx, vy);
  let desired = mag > 0.05 ? { x: vx / mag, y: vy / mag } : { x: 0, y: 0 };
  // Low-tier wobble: a small per-tick wander on the intent, applied BEFORE
  // the wall resolve so noise never pushes through the probes.
  if (tier.wobble > 0 && mag > 0.05) {
    const a = Math.atan2(desired.y, desired.x) + (nextRand(memory) * 2 - 1) * tier.wobble;
    desired = { x: Math.cos(a), y: Math.sin(a) };
  }

  // M1 stick inertia: blend → smooth → wall-resolve. The heading turns at a
  // thumb rate and the magnitude eases (a pause releases it); the resolved
  // intent below is emitted at the heading's magnitude. Reactive overrides
  // further down snap straight past all of this.
  smoothHeading(memory, desired, mag > 0.05 && memory.pauseTicks === 0 ? 1 : 0);
  const heading = { x: memory.headX, y: memory.headY };
  let intent: { x: number; y: number };
  let snapped = false;
  if (memory.headMag > 0.05) {
    // A paused bot is standing still ON PURPOSE — don't let the wedge
    // counter read the stillness as being stuck.
    const slide = memory.pauseTicks === 0 ? unstick(memory, me, heading) : null;
    if (slide !== null) {
      intent = slide;
      snapped = true; // the unstick slide is a survival reflex — full stick
    } else {
      intent = openDirection(nav, mePos, heading);
    }
  } else {
    intent = { x: 0, y: 0 };
  }

  // One dodge roll per swing: a new telegraph episode (new attacker, or the
  // threat lapsing and returning) rolls against the tier's dodge odds; the
  // result stands for that whole swing — this tier either answers it or eats
  // it, and the NEXT swing rolls fresh. (`threat` was read above, before the
  // micro-pause gate.)
  if (threat === null) {
    memory.threatKey = null;
  } else if (threat.id !== memory.threatKey) {
    memory.threatKey = threat.id;
    memory.threatApproved = nextRand(memory) < tier.dodgeChance;
  }

  // The approved dodge. Against MELEE (any tier) dash immediately: i-frames
  // plus the hop both answer an arc. Against a PROJECTILE that timing is a
  // whiff — i-frames die long before the arrow arrives — so smartDodge tiers
  // hold the dash until the shot is about to loose, then hop PERPENDICULAR
  // to the shot line: dodge by displacement (the aim locks at fire). Dumb
  // tiers keep the mistimed windup-start dash; failing THAT way is honest.
  const reactApproved = threat !== null && memory.threatApproved;
  let dodgeNow = false;
  if (reactApproved) {
    if (rangedWeapon(threat) && tier.smartDodge) {
      if (threat.atkLeft <= 0.15) {
        dodgeNow = true;
        const td = Math.hypot(me.x - threat.x, me.y - threat.y) || 1;
        const off = { x: (me.x - threat.x) / td, y: (me.y - threat.y) / td };
        intent = openDirection(nav, mePos, {
          x: -off.y * memory.orbitSign,
          y: off.x * memory.orbitSign,
        });
      }
    } else {
      dodgeNow = true;
    }
  }

  // In-flight shot evasion (smart tiers): the windup model can't see a shot
  // already in the air — a staff orb curving back, a mirror-reflected arrow,
  // the second archer. Re-assessed every tick, so homers get RE-dodged as
  // they turn. Feet move off the flight line; the dash spends only when the
  // hit is imminent. One roll per shot, like the windup episode.
  let evadeDash = false;
  let evading = false;
  if (tier.smartDodge) {
    const shot = incomingShot(me, projectiles);
    if (shot === null) {
      memory.shotKey = null;
    } else {
      if (shot.id !== memory.shotKey) {
        memory.shotKey = shot.id;
        memory.shotApproved = nextRand(memory) < tier.dodgeChance;
      }
      if (memory.shotApproved) {
        evading = true;
        intent = openDirection(nav, mePos, { x: shot.awayX, y: shot.awayY });
        evadeDash = shot.eta < 0.22;
      }
    }
  }

  // Reactive overrides bypass the M1 smoothing — survival reflexes are fast
  // in humans too. Sync the heading so the recovery curves out of the dodge
  // line instead of teleporting back.
  if (snapped || dodgeNow || evading) {
    if (intent.x !== 0 || intent.y !== 0) {
      memory.headX = intent.x;
      memory.headY = intent.y;
    }
    memory.headMag = 1;
    memory.pauseTicks = 0;
    snapped = true;
  }

  // Dash economy: against a live shooter, the smart tiers keep a charge in
  // reserve for dodging — the LAST hop is never spent closing a gap.
  const rangedEnemyAlive = players.some((p) => p.team !== me.team && p.alive && rangedWeapon(p));
  const dashChargesLeft = me.abilities.find((s) => s.id === "dash")?.charges ?? 0;
  const mayGapClose = !tier.smartDodge || !rangedEnemyAlive || dashChargesLeft >= 2;

  // Dash: the (possibly held) dodge, else the archetype's distance play —
  // which yields entirely while a shot-evasion owns the feet (a distance
  // dash mid-evade would spend the charge along the escape line for nothing).
  const dash =
    dashReady(me) &&
    dashClear(nav, mePos, intent, DASH_DISTANCE) &&
    (dodgeNow ||
      evadeDash ||
      (!evading &&
        (((preset.gapCloseDash || pressing) && mayGapClose && dist > (band ? band.far + 120 : 220)) ||
          (band !== null && dist < band.near * 0.6))));

  if (memory.castHoldTicks > 0) memory.castHoldTicks -= 1;
  let pick = decideCasts(me, target, players, deployables, memory.castHoldTicks === 0, reactApproved);
  // The reactive picks ride the dodge roll; everything else is a paced play
  // gated by the tier's cast discipline — a failed roll retries a few ticks
  // later, so low tiers cast late and ragged rather than never.
  const reactivePick = pick === "mirror-guard" || pick === "ironhide";
  if (pick !== null && !reactivePick && nextRand(memory) >= tier.castChance) {
    pick = null;
    memory.castHoldTicks = Math.max(memory.castHoldTicks, 8);
  }
  if (pick !== null || dash) {
    memory.castHoldTicks = Math.max(memory.castHoldTicks, 24 + tier.castHoldExtra);
  }
  return {
    sx: intent.x * (snapped ? 1 : memory.headMag),
    sy: intent.y * (snapped ? 1 : memory.headMag),
    casts: me.abilities.map((s) => (s.id === "dash" ? dash : s.id === pick)),
  };
};
