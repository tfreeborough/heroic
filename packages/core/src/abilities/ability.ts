/**
 * The ability cycle: Ready → Active → Cooldown → Ready.
 *
 * A generic, pure state machine for cooldown-gated skills — the player's roster
 * (dash, and whatever follows), and any enemy ability built the same way. It
 * owns ONLY the lifecycle bookkeeping: is it usable, is it firing right now, how
 * long until it's ready again. It deliberately knows NOTHING about what a skill
 * *does* — committed movement, i-frames, a heal, a summon are the caller's job,
 * applied on the `activated` / `ended` events this emits.
 *
 * Mirrors stepAttackCycle in combat/attack.ts: a pure
 * step(state, config, dt, input) → { state, ...events }, with the caller owning
 * the state. See docs/design (player skills).
 */

export interface AbilityConfig {
  /**
   * Seconds the ability stays "active" after firing — its effect window (e.g. a
   * roll's committed movement). 0 makes it instantaneous: it fires and drops
   * straight to cooldown the same step (e.g. a blink or a heal).
   */
  activeDuration: number;
  /**
   * Seconds before it can fire again, measured FROM activation — so the active
   * window is spent inside the cooldown, not added on top. Expected to be ≥
   * `activeDuration`.
   */
  cooldown: number;
}

export type AbilityPhase = "ready" | "active" | "cooldown";

export interface AbilityState {
  phase: AbilityPhase;
  /** Seconds left in the active window. Meaningless unless phase is "active". */
  activeRemaining: number;
  /**
   * Seconds left until ready. Counts down through BOTH the active and cooldown
   * phases (cooldown is measured from activation), so `cooldownRemaining /
   * config.cooldown` is exactly the 1 → 0 fraction a cooldown UI clock wants.
   */
  cooldownRemaining: number;
}

export const ABILITY_READY: AbilityState = Object.freeze({
  phase: "ready",
  activeRemaining: 0,
  cooldownRemaining: 0,
});

export interface AbilityStep {
  state: AbilityState;
  /** True on the step it fired — apply the on-activate effects now. */
  activated: boolean;
  /** True on the step the active window closed — tear down active effects now. */
  ended: boolean;
}

/**
 * Advance the ability by one fixed step. Pure — the caller owns the state.
 *
 * `triggered` is the activation request (e.g. a button press) for THIS step. It
 * only fires from Ready, so requests during active/cooldown are simply ignored —
 * there's no buffering here (a caller that wants queueing can hold its own flag).
 */
export const stepAbility = (
  state: AbilityState,
  config: AbilityConfig,
  dt: number,
  triggered: boolean,
): AbilityStep => {
  switch (state.phase) {
    case "ready": {
      if (!triggered) return { state, activated: false, ended: false };
      // An instantaneous ability has no active window: fire and end at once.
      if (config.activeDuration <= 0) {
        return {
          state:
            config.cooldown > 0
              ? { phase: "cooldown", activeRemaining: 0, cooldownRemaining: config.cooldown }
              : ABILITY_READY,
          activated: true,
          ended: true,
        };
      }
      return {
        state: {
          phase: "active",
          activeRemaining: config.activeDuration,
          cooldownRemaining: config.cooldown,
        },
        activated: true,
        ended: false,
      };
    }
    case "active": {
      const activeRemaining = state.activeRemaining - dt;
      const cooldownRemaining = state.cooldownRemaining - dt;
      if (activeRemaining > 0) {
        return {
          state: { phase: "active", activeRemaining, cooldownRemaining },
          activated: false,
          ended: false,
        };
      }
      // The active window closed this step; fall through to cooldown (or ready
      // if the cooldown is already spent, e.g. cooldown === activeDuration).
      return {
        state:
          cooldownRemaining > 0
            ? { phase: "cooldown", activeRemaining: 0, cooldownRemaining }
            : ABILITY_READY,
        activated: false,
        ended: true,
      };
    }
    case "cooldown": {
      const cooldownRemaining = state.cooldownRemaining - dt;
      if (cooldownRemaining > 0) {
        return {
          state: { phase: "cooldown", activeRemaining: 0, cooldownRemaining },
          activated: false,
          ended: false,
        };
      }
      return { state: ABILITY_READY, activated: false, ended: false };
    }
  }
};
