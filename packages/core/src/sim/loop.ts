/**
 * Fixed-timestep accumulator — the heart of a stable real-time game loop.
 *
 * Rendering happens as fast as the device allows, but the *simulation* must
 * advance in fixed slices so physics and gameplay stay deterministic regardless
 * of frame rate. Feed real frame time in; get back a whole number of steps to
 * run plus an interpolation `alpha` in [0, 1) for smoothing the render between
 * the last two simulated states.
 *
 * This function is pure: the renderer/engine package owns the actual clock.
 */
export interface FixedStepConfig {
  /** Simulation step size in seconds (e.g. 1/60). */
  step: number;
  /** Cap on steps per frame to avoid the "spiral of death" after a stall. */
  maxSteps?: number;
}

export interface FixedStepResult {
  /** How many fixed steps to run this frame. */
  steps: number;
  /** Leftover time carried into the next frame. */
  accumulator: number;
  /** Render interpolation factor in [0, 1). */
  alpha: number;
}

export const DEFAULT_STEP = 1 / 60;

export const advanceFixed = (
  accumulator: number,
  frameDelta: number,
  config: FixedStepConfig,
): FixedStepResult => {
  const step = config.step;
  const maxSteps = config.maxSteps ?? 5;
  // Clamp pathological deltas (tab backgrounded, debugger paused, etc.).
  let acc = accumulator + Math.min(Math.max(frameDelta, 0), step * maxSteps);
  let steps = 0;
  while (acc >= step && steps < maxSteps) {
    acc -= step;
    steps += 1;
  }
  return { steps, accumulator: acc, alpha: acc / step };
};
