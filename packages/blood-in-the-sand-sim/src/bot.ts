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
import {
  cycleSeconds,
  hazardOf,
  incomingShell,
  meleeSpacing,
  runSpeed,
  strikeBand,
  strikeSpan,
  threatKind,
} from "./botThreats";
import { DASH_DISTANCE, DASH_IFRAMES, PLAYER_RADIUS, SANDS_ATTACKER_ID, TICK_DT, WEAPONS } from "./config";
import type { BotNav } from "./nav";
import { dashClear, navDirection, openDirection } from "./nav";
import type { DeployableSnapshot, PlayerSnapshot, ProjectileSnapshot, RoundSnapshot, ShellSnapshot } from "./protocol";

export * from "./botArchetypes";
export * from "./botDifficulty";
export * from "./botThreats";
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
  /** This swing's timing error, seconds (+ = early, − = late). */
  threatJitter: number;
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
  /** The bombard shell last rolled against (one roll per landing ring). */
  shellKey: number | null;
  shellApproved: boolean;
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
  /** The side a wall-aware retreat is circling toward (v4): -1 / 0 / +1. */
  retreatSign: number;
  /** The current mark (v4 team focus) — a sticky bonus stops flip-flopping. */
  focusId: number | null;
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
  threatJitter: 0,
  ditherTicks: 0,
  fleeTicks: 0,
  fleeSpent: false,
  shotKey: null,
  shotApproved: false,
  shellKey: null,
  shellApproved: false,
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
  retreatSign: 0,
  focusId: null,
});

/** Everything the brain reads about the match — the three snapshot arrays a
 * host passes each tick (players/deployables at the tier's staleness). */
export interface BotWorld {
  players: PlayerSnapshot[];
  deployables: DeployableSnapshot[];
  projectiles: ProjectileSnapshot[];
  /** Bombard shells in flight — the landing rings every client draws (v4:
   * the brain finally reads them). Optional for hand-built test worlds; a
   * SnapshotMsg carries it. */
  shells?: ShellSnapshot[];
  /** The round block of the same snapshot — the Closing Sands rides it
   * (bits-sand-circle.md). Optional: every real caller passes a whole
   * SnapshotMsg, which already satisfies it structurally; hand-built test
   * worlds may omit it. */
  round?: RoundSnapshot;
}

/** No blood on either side for this long → the bot loses patience. */
const STALL_TICKS = 240; // 8s at 30Hz
/** How far inside the Closing Sands' ring the feet start leaning centre-ward
 * (bits-sand-circle.md) — the human "edge is getting close" read. */
const SANDS_MARGIN = 70;
/** Venom-clock denial: with this little left on my poison clock I keep out of
 * the knife's walk-plus-dash lunge until the stacks drop. */
const VENOM_DENY = { clock: 2.2, band: { near: 200, far: 320 } } as const;
/** px past a dead zone's edge inside which an entry is finished on foot. */
const STAGE_COMMIT = 45;
/** px outside a hazard's reach where inward intent is stripped (covers a
 * few ticks of full-speed travel plus the stick's turn lag). */
const RIM_GUARD = 45;
/** Closing Sands radius under which a kiter has no room left — stop staging. */
const STAGE_RING = 420;
/** Attack cycles shorter than this can't be out-dodged with a 3s dash. */
const FAST_CYCLE = 0.6;
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

/** How far ahead a retreat looks for room, px, in probe steps. */
const ROOM_STEPS = [110, 220, 330, 440] as const;
/** Candidate swings off the straight-away line, radians (0 first = prefer it). */
const RETREAT_FAN = [0, 0.52, -0.52, 1.05, -1.05, 1.57, -1.57, 2.09, -2.09] as const;

/**
 * Where to back off TO (v4 — Tom, 2026-09-21: "I can slowly back it into a
 * corner and then it has nowhere to go"). Straight-away retreat lets the
 * chaser choose where the fight ends up: every back-pedal is a step toward
 * whatever wall is behind me, and a corner turns a kiter into a punchbag.
 * So a retreat reads the ROOM behind each candidate direction (walls,
 * rocks, the arena edge, and the Closing Sands' ring all count as the end
 * of the room) and, once the straight line runs short, curls toward the
 * open side — sticking with the side it picked, like the hazard detours,
 * so it circles out instead of dithering. With room to spare it is exactly
 * the old straight line. Mutates `memory` (the committed side).
 */
const retreatDirection = (
  memory: BotMemory,
  nav: BotNav,
  from: { x: number; y: number },
  away: { x: number; y: number },
  sands: { cx: number; cy: number; r: number } | null,
): { x: number; y: number } => {
  const room = (dir: { x: number; y: number }): number => {
    let clear = 0;
    for (const step of ROOM_STEPS) {
      if (!dashClear(nav, from, dir, step)) break;
      if (sands !== null && Math.hypot(from.x + dir.x * step - sands.cx, from.y + dir.y * step - sands.cy) > sands.r - 30) break;
      clear = step;
    }
    return clear;
  };
  const full = ROOM_STEPS[ROOM_STEPS.length - 1]!;
  if (room(away) >= full) {
    memory.retreatSign = 0;
    return away;
  }
  const base = Math.atan2(away.y, away.x);
  let best = away;
  let bestScore = -Infinity;
  let bestSign = 0;
  for (const rot of RETREAT_FAN) {
    const dir = { x: Math.cos(base + rot), y: Math.sin(base + rot) };
    const sign = Math.sign(rot);
    // Room first, then staying away from the threat, then the side I'm
    // already circling toward.
    const clear = room(dir);
    if (clear === 0) continue; // a dead end is not a retreat, however far from them it points
    const score = clear / full + 0.45 * Math.cos(rot) + (sign !== 0 && sign === memory.retreatSign ? 0.2 : 0);
    if (score > bestScore) {
      best = dir;
      bestScore = score;
      bestSign = sign;
    }
  }
  memory.retreatSign = bestSign;
  return best;
};

/** Is the mark just outside my reach, not swinging at me, with my own
 * weapon ready — so one hop puts the next swing on its back? */
const pursuitHop = (me: PlayerSnapshot, target: PlayerSnapshot, dist: number, targetHp: number): boolean => {
  const mine = strikeBand(me, target);
  if (mine === null || target.atk === "windup" || me.atk === "recovery") return false;
  if (dist <= mine.far + 10) return false;
  // One hop lands the next swing — or the mark is nearly dead and walking
  // away: never let a finish stroll off while a hop sits in the hand.
  return dist - DASH_DISTANCE < mine.far - 10 || (targetHp < 0.3 && dist < 320);
};

export interface BotThinkOptions {
  /** Pin an archetype instead of deriving from the loadout (dev tooling, tests). */
  archetype?: ArchetypeId;
  /** Execution-quality tier; callers feed staleness themselves (the
   * SnapshotHistory), this applies the in-brain dials. Default Skilled. */
  difficulty?: DifficultyId;
  /** Hunt alone — nearest body, no team score (the gauntlet's A/B control
   * for the v4 team-focus work; never set by a real host). */
  soloFocus?: boolean;
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
  const target = focusTarget(preset, me, players, tier.focusFire && opts?.soloFocus !== true, memory.focusId);
  if (!target) return IDLE;
  memory.focusId = target.id;

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

  // The Closing Sands, read off the same wire as everything else the brain
  // knows (bits-sand-circle.md). `sandsGap` is my rim's distance PAST the
  // safe ring (negative = safely inside); the steering term lives with the
  // other hazard shells below.
  const sands = world.round?.sands ?? null;
  const sandsGap = sands === null ? -Infinity : Math.hypot(sands.cx - me.x, sands.cy - me.y) + PLAYER_RADIUS - sands.r;
  const inBlood = sandsGap > 0;

  // M5 micro-pause: now and then, at EVERY tier, the feet just stop for a
  // beat — the human sizing-up-the-ground stutter. Distinct from low-tier
  // dither (longer, freezes the hands too, a mistake); this is texture.
  // Never under a telegraph, mid-flee, at grips — or standing in the blood
  // (nobody pauses to size up ground that is actively eating them).
  if (memory.pauseTicks > 0) {
    memory.pauseTicks -= 1;
  } else if (threat === null && !fleeing && !inBlood && dist > 240 && nextRand(memory) < HUMANIZE.pauseChance) {
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
  // v4 footwork (bot-brains-v4.md stage 2): an arc wielder plays the REACH
  // matchup before its archetype's band — hold my reach edge against a
  // shorter weapon, live inside a dead zone. A dead zone outranks even a
  // press or a dive (charging a trident means arriving inside its prongs);
  // the out-reach dance yields to both, like any band.
  let spacing = tier.footwork > 0 ? meleeSpacing(me, target) : null;
  // Venom-clock denial (Tom's fang trick, 2026-09-21: stab 3–4 times, leave,
  // re-apply right before the clock runs out — "essentially no counterplay").
  // There is one: all stacks share ONE clock that only a fresh stab renews,
  // so when mine is nearly out and the knife isn't already on me, I simply
  // refuse the re-application — keep out of its lunge for the last couple of
  // seconds and the whole investment falls off at once.
  // Only for a fighter that already owns the reach edge (gauntlet: a BLADE
  // backing off a fang just forfeits swings — it can't keep the knife out
  // anyway, so it slogs and chases instead).
  if (
    spacing !== null &&
    tier.footwork >= 0.7 &&
    me.poisonStacks > 0 &&
    me.poisonLeft < VENOM_DENY.clock &&
    target.weapon !== null &&
    WEAPONS[target.weapon].poison !== undefined &&
    dist > (strikeBand(target, me)?.far ?? 0) + 12
  ) {
    spacing = VENOM_DENY.band;
  }
  // Staging (gauntlet trace, blade vs a trident kiter): the way INTO a dead
  // zone is a timed hop through the poke. Ejected with the hop cooling — or
  // slowed by the last poke — a bot that loiters in the prong band eats a
  // poke a second, each one re-slowing it. So it backs OUT past the prongs,
  // waits for the hop, and goes again. With NO hop to wait for (spent, or
  // never drafted) walking in simply fails against a retreating spear — the
  // first poke's slow ends the chase (trace: lost from 86hp to a 4hp kiter)
  // — so it holds outside and lets the Closing Sands take their room away;
  // once the ring is tight there is nowhere left to kite to, and it goes.
  const prongs = spacing !== null && spacing.near === 0 ? strikeBand(target, me) : null;
  let staging = false;
  // Only from well out in the band: a hop that lands a stride short of the
  // dead zone must FINISH the entry on foot, not turn round and leave.
  if (prongs !== null && prongs.near > 0 && dist >= prongs.near + STAGE_COMMIT) {
    const hop = me.abilities.find((a) => a.id === "dash");
    const hopSoon = hop !== undefined && hop.charges > 0 && hop.cd <= 0.4;
    const cornered = world.round?.sands != null && world.round.sands.r < STAGE_RING;
    if ((!hopSoon || me.slowLeft > 0) && !cornered) {
      spacing = { near: prongs.far + 15, far: prongs.far + 45 };
      staging = true;
    }
  }
  const hugging = spacing !== null && spacing.near === 0;
  const band = spacing !== null && (hugging || staging || !(diving || pressing))
    ? spacing
    : diving || pressing
      ? null
      : resolveBand(preset, me.weapon);
  /** How much of the v3 band slop survives: footwork tightens a SPACING band
   * toward pixel-true (35px of reach edge can't wear ±12% and 25px of lag);
   * archetype bands keep their full human texture at every tier. */
  const slop = band !== null && band === spacing ? 1 - tier.footwork : 1;

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
    const fuzz = 1 + (memory.bandFuzz - 1) * slop;
    bandNear = band.near * fuzz;
    bandFar = band.far * fuzz;
    const h = 3 + (HUMANIZE.hysteresis - 3) * slop;
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
    spacing === null && // a spaced fighter is already where its weapon works

    ((target.atk === "recovery" && dist < 400) ||
      (tier.smartDodge && dashDown(target) && dist < 350));

  // Backing off never means backing into a corner (retreatDirection).
  const retreat =
    fleeing || memory.bandState === -1 ? retreatDirection(memory, nav, mePos, away, sands) : away;

  // Band-keeping — or the contact charge for band-less brains.
  if (fleeing) {
    add(retreat, 1.4);
  } else if (punishing) {
    add(toward, 1);
  } else if (band === null || memory.bandState === 1) {
    add(toward, preset.engage);
  } else if (memory.bandState === -1) {
    add(retreat, 1);
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
  // v4: the sharp tiers only get greedy when the kill is actually THERE — a
  // mark one good hit from dead. Impatience is no reason to eat a mine (the
  // trap-camper's whole trick was waiting out the 8s stall clock and letting
  // the bot press straight across the powder).
  const sharp = tier.footwork >= 0.7;
  const greedy = sharp ? diving && targetHp < 0.25 : diving || pressing;
  const hazardScale = greedy ? HUMANIZE.greedScale : 1;
  const axis = memory.headMag > 0.2 ? { x: memory.headX, y: memory.headY } : fleeing ? away : toward;
  // Greed drops the detour planning outright — a bot chasing a kill walks
  // the straight line and eats the ground; only the shell below still nudges.
  if (hazardScale < 1) memory.detourZoneId = null;
  // Keep or retire the running episode.
  let detour: DeployableSnapshot | undefined;
  if (hazardScale === 1 && memory.detourZoneId !== null) {
    detour = deployables.find((d) => d.id === memory.detourZoneId && hazardOf(d, me)?.detour === true);
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
      const hazard = hazardOf(d, me);
      if (hazard === null || !hazard.detour) continue;
      const radius = hazard.reach;
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
      const hazard = hazardOf(d, me);
      if (hazard === null) continue;
      const zd = Math.hypot(d.x - me.x, d.y - me.y) || 1;
      if (zd < hazard.reach) add({ x: (me.x - d.x) / zd, y: (me.y - d.y) / zd }, hazard.shove * hazardScale);
    }
  }
  // The Closing Sands: standing in the blood is never acceptable — a
  // dominant nav-routed pull toward the centre while outside the ring,
  // easing to a lean inside the warning band. Deliberately NOT damped by
  // greed: the tide's ramp out-damages any heal, so no kill is worth it.
  if (sands !== null && sandsGap > -SANDS_MARGIN) {
    const weight = inBlood ? 3.5 : 1.2 * ((sandsGap + SANDS_MARGIN) / SANDS_MARGIN);
    add(navDirection(nav, SANDS_ATTACKER_ID, mePos, { x: sands.cx, y: sands.cy }), weight);
  }

  // v4: hazards are a CONSTRAINT, not a weight. The blend above can settle
  // into an equilibrium INSIDE a trigger ring whenever the pull through the
  // zone is strong enough (gauntlet: a camper standing right behind their
  // mine — engage 1.0 straight across it vs the detour's soft 1.6 — put the
  // orbit 20px inside the powder on any low margin roll). So after blending,
  // strip whatever part of the intent still points INTO a zone I'm at the
  // lip of: the feet slide along the rim instead of through it.
  if (!greedy) {
    for (const d of deployables) {
      const hazard = hazardOf(d, me);
      if (hazard === null || !hazard.detour) continue;
      const zx = d.x - me.x;
      const zy = d.y - me.y;
      const zd = Math.hypot(zx, zy) || 1;
      if (zd > hazard.reach + RIM_GUARD || zd < hazard.reach) continue; // far off, or already in (the shell throws me out)
      const inward = (vx * zx + vy * zy) / zd;
      if (inward > 0) {
        vx -= (zx / zd) * inward;
        vy -= (zy / zd) * inward;
      }
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
    // …and one TIMING error per swing: how early or late this tier's hands
    // are on this particular blow (DifficultyPreset.timing).
    memory.threatJitter = (nextRand(memory) * 2 - 1) * tier.timing;
  }

  // The approved answer — v4's STRIKE PREDICTOR (bot-brains-v4.md stage 1).
  // The old rule was "a windup appeared → dash now", which (a) burned the
  // 0.2s of i-frames long before a 0.65s hammer landed, (b) emptied the dash
  // budget on the first stab of a fast cycle, and (c) could be baited for
  // free, since a windup whose lock breaks cancels with no recovery. Smart
  // tiers instead ask WHEN the blow lands and WHERE it is lethal at that
  // instant, then take the cheapest sufficient answer at the last
  // responsible moment: already clear → nothing; walk out of the band if
  // the clock allows; else a dash timed so the i-frames straddle the strike
  // (hopping INTO a dead zone when there is one). A feinted windup never
  // reaches the commit point. Dumb tiers keep the panic dash at windup start
  // — failing THAT way is honest.
  const reactApproved = threat !== null && memory.threatApproved;
  /** Seconds between what I see and my answer taking effect. */
  const lag = (tier.reactionTicks + 1) * TICK_DT;
  let dodgeNow = false;
  let sidestep = false;
  if (reactApproved) {
    const kind = threatKind(threat);
    const td = Math.hypot(me.x - threat.x, me.y - threat.y) || 1;
    const off = { x: (me.x - threat.x) / td, y: (me.y - threat.y) / td };
    const tStrike = Math.max(0, threat.atkLeft - lag);
    if (kind === "shot" && !tier.smartDodge) {
      dodgeNow = true; // the mistimed windup-start hop vs a shooter — honest
    } else if (kind === "shot") {
      // Hold the hop until the shot is about to loose, then go PERPENDICULAR
      // to the line: dodge by displacement (the aim locks at fire).
      if (threat.atkLeft <= 0.15) {
        dodgeNow = true;
        intent = openDirection(nav, mePos, { x: -off.y * memory.orbitSign, y: off.x * memory.orbitSign });
      }
    } else if (kind === "arc") {
      const lethal = strikeBand(threat, me)!;
      const needOut = lethal.far + 6 - td;
      const needIn = lethal.near > 0 ? td - (lethal.near - 6) : Infinity;
      // They chase (or back off) at full tilt for all I know — only my
      // speed EDGE is ground I can count on winning before the strike.
      const gain = Math.max(0, runSpeed(me, tier.speedFactor) - runSpeed(threat)) * tStrike;
      if (needOut <= 0 || needIn <= 0) {
        // Already clear of the band — the swing is a whiff. Spend nothing.
      } else if (needOut <= gain) {
        sidestep = true;
        intent = openDirection(nav, mePos, off);
      } else if (needIn <= gain) {
        sidestep = true;
        intent = openDirection(nav, mePos, { x: -off.x, y: -off.y });
      } else if (threat.weapon !== null && spacing === null && cycleSeconds(threat.weapon) < FAST_CYCLE) {
        // A flick faster than the dash can ever answer (the fang: 0.45s a
        // stab vs four hops a round) — i-framing one stab buys nothing.
        // Keep the charges for the chase and slog it out. (A SPACED fighter
        // still hops: for it the dash is the way back out to its reach edge.)
      } else if (
        threat.weapon !== null &&
        // Unclamped on purpose: a LATE hand (negative jitter) must still
        // fire — after the blow, wasted — not silently never press. The
        // stale windup I'm watching keeps counting down past the real strike.
        threat.atkLeft - lag <= Math.max(TICK_DT, (DASH_IFRAMES - strikeSpan(threat.weapon)) / 2) + memory.threatJitter
      ) {
        // The timed dash: i-frames straddle the strike (and a thrust's
        // travel). Into the dead zone if the hop reaches it; otherwise out
        // through the far edge if THAT is in reach; else wherever the feet
        // were going — the i-frames alone are the answer.
        dodgeNow = true;
        // A dead zone is where I want to live anyway, and the i-frames make
        // the direction free — always hop IN, even if one hop isn't enough.
        // Hopping OUT is only for a fighter whose game is the reach edge; a
        // contact brawler that hops away just hands over its own swing
        // (gauntlet: a blade retreat-dashing from a fang lost a slog it wins).
        if (lethal.near > 0) intent = openDirection(nav, mePos, { x: -off.x, y: -off.y });
        else if (spacing !== null && needOut <= DASH_DISTANCE) intent = openDirection(nav, mePos, off);
      }
    }
    // "shell"/"beam": nothing to answer at the windup — the shell's landing
    // ring is the telegraph, handled with the ground below.
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

  // Bombard shells (v4): a marked circle with a clock, sparing no one. EVERY
  // tier knows what the ring means (ignoring it reads as broken, not new);
  // the tier only decides how reliably and how late. Walk straight out;
  // if the feet can't make it, i-frame the landing.
  const shell = incomingShell(me, world.shells ?? []);
  if (shell === null) {
    memory.shellKey = null;
  } else {
    if (shell.id !== memory.shellKey) {
      memory.shellKey = shell.id;
      memory.shellApproved = nextRand(memory) < Math.max(0.35, tier.dodgeChance);
    }
    if (memory.shellApproved) {
      const tLand = Math.max(0, shell.landIn - lag);
      evading = true;
      intent = openDirection(nav, mePos, { x: shell.awayX, y: shell.awayY });
      if (shell.exitDist > runSpeed(me, tier.speedFactor) * tLand && tLand <= DASH_IFRAMES / 2) evadeDash = true;
    }
  }

  // The spacing retreat (v4 footwork): giving ground at my reach edge is a
  // reflex, not a stroll — M1's half-second reversal swing is exactly the
  // window a diver needs. The sharp tiers snap it.
  const footworkSnap =
    band !== null && band === spacing && memory.bandState === -1 && tier.footwork >= 0.7 && !evading && !dodgeNow && !sidestep;
  if (footworkSnap) intent = openDirection(nav, mePos, retreat);

  // Reactive overrides bypass the M1 smoothing — survival reflexes are fast
  // in humans too. Sync the heading so the recovery curves out of the dodge
  // line instead of teleporting back.
  if (snapped || dodgeNow || evading || sidestep || footworkSnap) {
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
        // Into a GUN's dead zone (the bombard) the hop is a plain gap-close;
        // into a trident's it is the predictor's timed hop, never this one.
        ((hugging && prongs === null && dist > band!.far + 15 && dist - DASH_DISTANCE <= band!.far + 10) ||
          // The pursuit hop (v4): a contact fighter whose mark is slipping
          // out of reach — hit-and-run is only free if nobody follows —
          // spends a hop to stay on it, provided the landing is in reach.
          // Any arc wielder that is ADVANCING, not just band-less brawlers
          // (trace: a duellist trailed a disengaging fang at 110–160px for
          // 2.5s, hop ready and unspent, eating venom and landing nothing).
          ((band === null || memory.bandState === 1) &&
            !staging &&
            tier.footwork >= 0.7 &&
            mayGapClose &&
            pursuitHop(me, target, dist, targetHp)) ||
          ((preset.gapCloseDash || pressing) && mayGapClose && dist > (band ? band.far + 120 : 220)) ||
          (band !== null && dist < band.near * 0.6))));

  if (memory.castHoldTicks > 0) memory.castHoldTicks -= 1;
  let pick = decideCasts(
    me,
    target,
    players,
    deployables,
    memory.castHoldTicks === 0,
    reactApproved,
    // Late commitment, graded: the sharp tiers wait for the last quarter
    // second; a big timing error is as good as pressing on sight.
    lag + 0.22 + tier.timing * 2,
  );
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
