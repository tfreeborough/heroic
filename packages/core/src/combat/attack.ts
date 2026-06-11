/**
 * Attack configs and the attack cycle (see docs/design/combat.md and
 * docs/design/player-movement-and-targeting.md).
 *
 * An attack is data: two orthogonal tags (`shape` × `school`) plus timing and
 * range. Player and enemy attacks draw from the same config set — there is no
 * separate enemy attack system. Damage numbers are NOT in the config; they're
 * pulled from school + stats at resolve time.
 */
import type { FlightId } from "./flight";

/** What geometry the hit uses: a melee cone or a travelling projectile. */
export type AttackShape = "arc" | "projectile";

/** Where the numbers come from: physical reads strength/agility, magic reads intellect. */
export type AttackSchool = "physical" | "magic";

export interface AttackConfig {
  shape: AttackShape;
  school: AttackSchool;
  /** Range in px, measured to the target's *edge* — the universal range knob. */
  reach: number;
  /** Arc only: full cone width in radians (the cleave window). */
  arcWidth?: number;
  /** Projectile only: travel speed in px/s. */
  projectileSpeed?: number;
  /** Projectile only: how many extra hostiles it passes through. */
  pierce?: number;
  /** Projectile only: shots per strike. Default 1. */
  projectileCount?: number;
  /** Projectile only: named movement pattern from the flight bank (flight.ts). */
  flight?: FlightId;
  /** Pincer flight: how far off the aim line the outer arms start, radians. */
  curveAngle?: number;
  /** Seconds of committed wind-up before the hit resolves (the telegraph). */
  windup: number;
  /** Seconds of cooldown after the strike before the next cycle can begin. */
  recovery: number;
  /** Impulse applied to victims on hit, px/s. */
  knockback?: number;
  /** Magic only. Not yet enforced — no mana pool exists in the prototype. */
  manaCost?: number;
}

/**
 * The attack cycle: Ready → Windup → Strike → Recovery → Ready.
 * Strike is the instant the windup completes, not a phase with duration.
 */
export type AttackPhase = "ready" | "windup" | "recovery";

export interface AttackCycleState {
  phase: AttackPhase;
  /** Seconds left in the current phase. Meaningless while ready. */
  remaining: number;
}

export const ATTACK_CYCLE_READY: AttackCycleState = Object.freeze({
  phase: "ready",
  remaining: 0,
});

export interface AttackCycleInputs {
  /** A selected hostile is inside attack range — gates Ready → Windup. */
  targetInRange: boolean;
  /**
   * During Windup only: the locked target is still alive and inside the
   * engagement radius. Going false aborts the windup (the lock-break rule —
   * never keep swinging at a corpse or empty space).
   */
  lockValid: boolean;
}

export interface AttackCycleStep {
  state: AttackCycleState;
  /** True on the step a new Windup begins — select + facing-lock the target now. */
  windupStarted: boolean;
  /** True on the step the Windup completes — resolve the hit now. */
  struck: boolean;
  /** True when a Windup was aborted by a lock break. */
  lockBroken: boolean;
}

/**
 * Advance the cycle by one fixed step. Pure — callers own the state.
 *
 * Leftover time from a completing windup carries into recovery so the attack
 * cadence stays exact across step boundaries; recovery's leftover is dropped
 * (the next windup can begin on the very next step anyway).
 */
export const stepAttackCycle = (
  state: AttackCycleState,
  config: Pick<AttackConfig, "windup" | "recovery">,
  dt: number,
  inputs: AttackCycleInputs,
): AttackCycleStep => {
  const idle: Omit<AttackCycleStep, "state"> = {
    windupStarted: false,
    struck: false,
    lockBroken: false,
  };

  switch (state.phase) {
    case "ready": {
      if (!inputs.targetInRange) return { ...idle, state };
      return {
        ...idle,
        state: { phase: "windup", remaining: config.windup },
        windupStarted: true,
      };
    }
    case "windup": {
      if (!inputs.lockValid) {
        return { ...idle, state: ATTACK_CYCLE_READY, lockBroken: true };
      }
      const remaining = state.remaining - dt;
      if (remaining > 0) return { ...idle, state: { phase: "windup", remaining } };
      return {
        ...idle,
        state: { phase: "recovery", remaining: config.recovery + remaining },
        struck: true,
      };
    }
    case "recovery": {
      const remaining = state.remaining - dt;
      if (remaining > 0) return { ...idle, state: { phase: "recovery", remaining } };
      return { ...idle, state: ATTACK_CYCLE_READY };
    }
  }
};
