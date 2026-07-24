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
  /**
   * Target render rate (frames/second, default 60). rAF fires at the
   * DISPLAY's refresh rate — 60/90/120Hz, and adaptive (LTPO) panels move
   * between them at runtime — and uncapped, the loop records and rasters
   * every one of those frames: double the work per second at 120Hz, and a
   * frame costing more than one 8.3ms slot slips to every 2nd/3rd vsync
   * (every 3rd on 120Hz = a hot phone pinned at 40fps — the OnePlus Nord 3
   * finding, 2026-07-23).
   *
   * The loop measures the live vsync interval and renders every Nth vsync,
   * N = ceil(panelHz / maxFps) — UNLESS that divisor lands well UNDER the
   * target (90Hz / 2 = 45), in which case it renders every vsync: a panel
   * offering only 90 or 45 should give the game 90, not 45 (2026-07-24: an
   * adaptive panel sitting at 90Hz turned the plain time-threshold cap into
   * a rock-steady 45fps). So: 60Hz → 60, 90Hz → 90, 120Hz → 60, 144Hz → 72.
   * Skipped vsyncs are dropped whole; the sim accumulator carries the time,
   * so sim rate is unaffected. Pass Infinity to render every vsync always.
   */
  maxFps?: number;
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
  const maxFps = config.maxFps ?? 60;

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

    // Vsync-aware pacing state (see maxFps doc): a ring of recent callback
    // intervals estimates the live panel rate (adaptive panels change it at
    // runtime); the divisor re-derives every RATE_EVERY callbacks. All
    // preallocated — this path runs at up to 120Hz and must not allocate.
    const RING = 20;
    const RATE_EVERY = 30;
    const deltas = new Float64Array(RING);
    const sorted = new Float64Array(RING);
    let deltaCount = 0; // total recorded (ring index = deltaCount % RING)
    let lastCb = -1;
    let sinceRate = 0;
    let skipFactor = 1;
    let sinceRender = 0; // renders when it reaches skipFactor

    const frame = (now: number): void => {
      if (!running) return;
      // Track the raw callback cadence — every vsync, skipped or not.
      if (lastCb >= 0) {
        const d = now - lastCb;
        // Ignore pauses/hiccups: a real vsync interval is 4–40ms (240–25Hz).
        if (d > 4 && d < 40) deltas[deltaCount++ % RING] = d;
      }
      lastCb = now;
      sinceRate += 1;
      if (sinceRate >= RATE_EVERY && deltaCount >= RING) {
        sinceRate = 0;
        // Median via insertion sort into the scratch buffer (20 entries).
        for (let i = 0; i < RING; i++) {
          const v = deltas[i]!;
          let j = i - 1;
          for (; j >= 0 && sorted[j]! > v; j--) sorted[j + 1] = sorted[j]!;
          sorted[j + 1] = v;
        }
        const hz = 1000 / sorted[RING >> 1]!;
        // Every Nth vsync to land at ≤ maxFps… unless that undershoots the
        // target badly (90Hz/2 = 45) — then take the panel rate instead.
        let n = Math.max(1, Math.ceil(hz / maxFps - 0.05));
        if (n > 1 && hz / n < maxFps * 0.9) n -= 1;
        skipFactor = n;
      }
      // Skip whole vsyncs between renders. `last` is deliberately NOT
      // updated on a skip — the next accepted frame's delta spans the
      // skipped vsyncs, so the sim loses no time.
      sinceRender += 1;
      if (sinceRender < skipFactor) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      sinceRender = 0;
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
