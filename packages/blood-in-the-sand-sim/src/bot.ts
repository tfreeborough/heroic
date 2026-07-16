/**
 * The bot brain — one movement decision per tick, from snapshot data only
 * (a bot is just a client that thinks instead of touches). Lives in the sim
 * package so the server's headless bot script and the app's offline practice
 * mode share the exact same opponent; pure and platform-free like everything
 * else here.
 */
import type { PlayerSnapshot } from "./protocol";

export type BotStrategy = "seek" | "circle";
export const BOT_STRATEGIES: readonly BotStrategy[] = ["seek", "circle"];

/** The tick-to-tick state behind the wall-unstick shuffle. */
export interface BotMemory {
  lastX: number;
  lastY: number;
  stuckTicks: number;
  slideTicks: number;
  slideSign: number;
}

export const createBotMemory = (): BotMemory => ({
  lastX: 0,
  lastY: 0,
  stuckTicks: 0,
  slideTicks: 0,
  slideSign: 1,
});

export interface BotDecision {
  sx: number;
  sy: number;
  /** "Use the escape hop now" — the body maps this onto whichever slot holds
   * dash (the cheapest v1 brain only ever casts dash; see pvp-abilities.md). */
  dash: boolean;
}

const IDLE: BotDecision = { sx: 0, sy: 0, dash: false };

/**
 * Target selection for the single-duel brain below: the nearest living
 * opponent. Kept OUT of botThink (which stays a pure 1-target duellist) so
 * every caller — practice mode, the headless server bot — shares one rule.
 * Nearest-enemy means team bots dogpile rather than coordinate; good enough
 * for practice v1.
 */
export const nearestEnemy = (
  me: PlayerSnapshot | undefined,
  players: PlayerSnapshot[],
): PlayerSnapshot | undefined => {
  if (!me) return undefined;
  let best: PlayerSnapshot | undefined;
  let bestDist = Infinity;
  for (const p of players) {
    if (p.team === me.team || !p.alive) continue;
    const dist = Math.hypot(p.x - me.x, p.y - me.y);
    if (dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
};

/** Is the bot's dash drafted, off cooldown, and still budgeted? */
const dashReady = (me: PlayerSnapshot): boolean =>
  me.abilities.some((s) => s.id === "dash" && s.cd === 0 && s.charges > 0);

/**
 * Decide this tick's input. `me`/`enemy` come from the latest snapshot;
 * either missing (dead, benched) means stand still. Mutates `memory`.
 *
 * - seek: straight-line aggression, dash to close big gaps. Wall unstick:
 *   straight-line seek wedges on LOS pillars (no pathfinding), so when
 *   position stagnates it slides perpendicular for a bit to skirt around.
 * - circle: strafe around the enemy with a slight inward pull, dashing to
 *   dodge when the enemy's swing telegraph is up — exercises the i-frames.
 */
export const botThink = (
  memory: BotMemory,
  strategy: BotStrategy,
  me: PlayerSnapshot | undefined,
  enemy: PlayerSnapshot | undefined,
): BotDecision => {
  if (!me || !me.alive || !enemy || !enemy.alive) return IDLE;

  const dx = enemy.x - me.x;
  const dy = enemy.y - me.y;
  const dist = Math.hypot(dx, dy) || 1;
  const toward = { x: dx / dist, y: dy / dist };

  if (strategy === "seek") {
    memory.stuckTicks =
      Math.hypot(me.x - memory.lastX, me.y - memory.lastY) < 1.5 && dist > 60 ? memory.stuckTicks + 1 : 0;
    memory.lastX = me.x;
    memory.lastY = me.y;
    if (memory.stuckTicks > 12) {
      memory.slideTicks = 30;
      memory.slideSign = -memory.slideSign;
      memory.stuckTicks = 0;
    }
    if (memory.slideTicks > 0) {
      memory.slideTicks -= 1;
      return { sx: -toward.y * memory.slideSign, sy: toward.x * memory.slideSign, dash: false };
    }
    return { sx: toward.x, sy: toward.y, dash: dashReady(me) && dist > 220 };
  }

  // circle
  const strafe = { x: -toward.y, y: toward.x };
  const inward = dist > 140 ? 0.5 : 0;
  const sx = strafe.x + toward.x * inward;
  const sy = strafe.y + toward.y * inward;
  const mag = Math.hypot(sx, sy) || 1;
  const dodge = dashReady(me) && enemy.atk === "windup" && dist < 160;
  return { sx: sx / mag, sy: sy / mag, dash: dodge };
};
