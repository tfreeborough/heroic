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
  dash: boolean;
}

const IDLE: BotDecision = { sx: 0, sy: 0, dash: false };

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
    return { sx: toward.x, sy: toward.y, dash: me.dashCd === 0 && dist > 220 };
  }

  // circle
  const strafe = { x: -toward.y, y: toward.x };
  const inward = dist > 140 ? 0.5 : 0;
  const sx = strafe.x + toward.x * inward;
  const sy = strafe.y + toward.y * inward;
  const mag = Math.hypot(sx, sy) || 1;
  const dodge = me.dashCd === 0 && enemy.atk === "windup" && dist < 160;
  return { sx: sx / mag, sy: sy / mag, dash: dodge };
};
