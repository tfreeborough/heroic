import { useEffect, useRef } from "react";
import { advanceFixed, DEFAULT_STEP, type FixedStepConfig } from "@heroic/core";

export interface GameLoopHandlers {
  /** Called once per fixed simulation step. Advance gameplay + physics here. */
  onStep: (step: number) => void;
  /**
   * Called once per rendered frame with the interpolation factor in [0, 1).
   * Use it to position sprites between the last two simulated states so motion
   * stays smooth even when render fps ≠ simulation fps.
   */
  onRender?: (alpha: number) => void;
}

/**
 * A fixed-timestep game loop built on requestAnimationFrame. The simulation
 * runs on the JS thread (where Matter.js lives); the renderer reads the results.
 *
 * Handlers are read from a ref each frame, so you can pass fresh closures on
 * every render without restarting the loop.
 */
export const useGameLoop = (handlers: GameLoopHandlers, config: Partial<FixedStepConfig> = {}): void => {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const step = config.step ?? DEFAULT_STEP;
  const maxSteps = config.maxSteps ?? 5;

  useEffect(() => {
    let rafId = 0;
    let running = true;
    let last: number | null = null;
    let accumulator = 0;

    const frame = (now: number): void => {
      if (!running) return;
      if (last === null) last = now;
      const frameDelta = (now - last) / 1000;
      last = now;

      const result = advanceFixed(accumulator, frameDelta, { step, maxSteps });
      accumulator = result.accumulator;
      for (let i = 0; i < result.steps; i++) {
        handlersRef.current.onStep(step);
      }
      handlersRef.current.onRender?.(result.alpha);

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
  }, [step, maxSteps]);
};
