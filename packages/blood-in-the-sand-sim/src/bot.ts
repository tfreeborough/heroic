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
 */
import { ARCHETYPES, deriveArchetype, focusTarget, resolveBand, type ArchetypeId } from "./botArchetypes";
import { decideCasts, rangedWeapon, windupThreat } from "./botCasts";
import { DEFAULT_DIFFICULTY, DIFFICULTIES, type DifficultyId } from "./botDifficulty";
import { DASH_DISTANCE, SANDSTORM, SANDTRAP, TREMOR } from "./config";
import type { BotNav } from "./nav";
import { dashClear, navDirection, openDirection } from "./nav";
import type { DeployableSnapshot, PlayerSnapshot } from "./protocol";

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
  /** Serpentine state: which way the approach is currently cutting, and
   * ticks until the next irregular flip. */
  weaveSign: number;
  weaveTicks: number;
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
  weaveSign: 1,
  weaveTicks: 0,
});

/** No blood on either side for this long → the bot loses patience. */
const STALL_TICKS = 240; // 8s at 30Hz
/** How long an impatience press lasts before re-evaluating. */
const PRESS_TICKS = 150; // 5s

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
 * geometry so an orbiting bot swings round the other way, never grinds. */
const strafeDir = (
  memory: BotMemory,
  nav: BotNav,
  mePos: { x: number; y: number },
  toward: { x: number; y: number },
): { x: number; y: number } => {
  if (memory.orbitHoldTicks > 0) memory.orbitHoldTicks -= 1;
  let dir = { x: -toward.y * memory.orbitSign, y: toward.x * memory.orbitSign };
  const slid = openDirection(nav, mePos, dir);
  if (slid !== dir && memory.orbitHoldTicks === 0) {
    memory.orbitSign = -memory.orbitSign;
    memory.orbitHoldTicks = 20;
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
  players: PlayerSnapshot[],
  deployables: DeployableSnapshot[],
  nav: BotNav,
  opts?: BotThinkOptions,
): BotDecision => {
  if (!me || !me.alive) return IDLE;
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
  const target = focusTarget(preset, me, players);
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
  const fleeing = !lastStand && hp < preset.disengageBelow;

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

  let vx = 0;
  let vy = 0;
  const add = (d: { x: number; y: number }, w: number): void => {
    vx += d.x * w;
    vy += d.y * w;
  };

  const punishing = preset.punishRecovery && target.atk === "recovery" && dist < 400;

  // Band-keeping — or the contact charge for band-less brains.
  if (fleeing) {
    add(away, 1.4);
  } else if (punishing) {
    add(toward, 1);
  } else if (band === null || dist > band.far) {
    add(toward, preset.engage);
  } else if (dist < band.near) {
    add(away, 1);
  }
  // Strafe while holding position (banded brains in the band; contact brains
  // angle their approach with it).
  const holding = !fleeing && !punishing && (band === null || (dist >= band.near && dist <= band.far));
  if (holding && preset.strafe > 0) add(strafeDir(memory, nav, mePos, toward), preset.strafe);

  // Weave: closing on a SHOOTER in a straight line means every arrow lands
  // (Tom's step-6 exploit — kite with a bow, watch them walk into it). High
  // tiers serpentine the approach instead: a lateral cut that flips on an
  // irregular beat, so the shot fired at where they are keeps landing where
  // they were. Applies whenever there's real ground to close — CONTACT
  // brains most of all (they're the exploit's usual victims) — never at
  // grips, and never for a banded brain already holding its range.
  const approaching = !fleeing && dist > 160 && (band === null || dist > band.far);
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

  // Refuse hostile ground.
  for (const d of deployables) {
    if (d.team === me.team) continue;
    const radius = hostileZoneRadius(d);
    if (radius === null) continue;
    const zoneDist = Math.hypot(d.x - me.x, d.y - me.y) || 1;
    if (zoneDist < radius + 40) {
      add({ x: (me.x - d.x) / zoneDist, y: (me.y - d.y) / zoneDist }, 1.5);
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
  let intent =
    mag > 0.05 ? (unstick(memory, me, desired) ?? openDirection(nav, mePos, desired)) : desired;

  // One dodge roll per swing: a new telegraph episode (new attacker, or the
  // threat lapsing and returning) rolls against the tier's dodge odds; the
  // result stands for that whole swing — this tier either answers it or eats
  // it, and the NEXT swing rolls fresh.
  const threat = windupThreat(me, players);
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

  // Dash: the (possibly held) dodge, else the archetype's distance play.
  const dash =
    dashReady(me) &&
    dashClear(nav, mePos, intent, DASH_DISTANCE) &&
    (dodgeNow ||
      ((preset.gapCloseDash || pressing) && dist > (band ? band.far + 120 : 220)) ||
      (band !== null && dist < band.near * 0.6));

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
    sx: intent.x,
    sy: intent.y,
    casts: me.abilities.map((s) => (s.id === "dash" ? dash : s.id === pick)),
  };
};
