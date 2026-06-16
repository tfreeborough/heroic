import { useEffect, useRef } from "react";
import { advanceFixed, DEFAULT_STEP, type FixedStepConfig } from "@heroic/core";

export interface GameLoopHandlers {
  /** Called once per fixed simulation step, with the step size (seconds) as `dt`. */
  onStep: (dt: number) => void;
  /**
   * Called once per rendered frame with the interpolation factor in [0, 1).
   * Use it to position sprites between the last two simulated states so motion
   * stays smooth even when render fps ≠ simulation fps.
   */
  onRender?: (alpha: number) => void;
}

export interface GameLoopConfig extends Partial<FixedStepConfig> {
  /**
   * Coarsest step (seconds) the loop falls back to under sustained overload —
   * the *slowest* sim rate. Defaults to 3× `step` (i.e. 20Hz when step is 1/60).
   * Set it equal to `step` to pin a fixed rate and disable adaptation.
   */
  maxStep?: number;
}

/**
 * A fixed-timestep game loop on requestAnimationFrame. The simulation runs on
 * the JS thread (where Matter.js + the crowd sim live); the renderer reads the
 * interpolated results, so render fps and sim rate are independent.
 *
 * **Adaptive rate.** At a fixed 60Hz, a frame that runs long (a big crowd, a GPU
 * stall) makes real time outrun the sim, so the loop runs extra catch-up steps —
 * up to `maxSteps`. Pinned at the cap every frame, that's a flat multiplier on
 * sim cost (the "spiral"), and the frame only gets slower. So the loop steps the
 * sim rate *down* through tiers (60 → 30 → 20Hz) when it keeps hitting the cap,
 * and back *up* once it's comfortably keeping up. Fewer sim loops per second
 * frees the JS thread for rendering, so the displayed frame rate stays high; the
 * renderer interpolates, so the coarser sim isn't visible — only its granularity
 * (and input latency) changes, which a mobile action game tolerates fine.
 *
 * Handlers are read from a ref each frame, so passing fresh closures every render
 * doesn't restart the loop.
 */
export const useGameLoop = (handlers: GameLoopHandlers, config: GameLoopConfig = {}): void => {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const baseStep = config.step ?? DEFAULT_STEP;
  const maxSteps = config.maxSteps ?? 5;
  const slowStep = config.maxStep ?? baseStep * 3;

  useEffect(() => {
    // Sim-rate tiers from finest (baseStep) to coarsest (slowStep): 60 → 30 → 20Hz.
    const tiers = [baseStep, baseStep * 2, baseStep * 3].filter((s) => s <= slowStep + 1e-9);
    if (tiers.length === 0) tiers.push(baseStep);

    let rafId = 0;
    let running = true;
    let last: number | null = null;
    let accumulator = 0;
    let tier = 0; // index into `tiers`; higher = coarser/slower sim
    let behind = 0; // consecutive frames pinned at the step cap
    let ahead = 0; // consecutive comfortable (≤1-step) frames

    const frame = (now: number): void => {
      if (!running) return;
      if (last === null) last = now;
      const frameDelta = (now - last) / 1000;
      last = now;

      const step = tiers[tier]!;
      const result = advanceFixed(accumulator, frameDelta, { step, maxSteps });
      accumulator = result.accumulator;
      for (let i = 0; i < result.steps; i++) handlersRef.current.onStep(step);
      handlersRef.current.onRender?.(result.alpha);

      // Adapt with strongly asymmetric hysteresis: drop a tier quickly when we
      // can't keep up (escape the spiral), but only climb back after a long run
      // of comfortable frames. Eager recovery makes the rate *hunt* — it keeps
      // retrying the finer rate, overloading, and dropping back, and that bounce
      // reads as stutter. Under sustained heavy load we want it to just settle.
      if (result.steps >= maxSteps) {
        behind += 1;
        ahead = 0;
      } else {
        ahead = result.steps <= 1 ? ahead + 1 : 0;
        behind = 0;
      }
      if (behind >= 2 && tier < tiers.length - 1) {
        tier += 1;
        behind = 0;
      } else if (ahead >= 240 && tier > 0) {
        tier -= 1;
        ahead = 0;
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
  }, [baseStep, slowStep, maxSteps]);
};
