import { beforeEach, describe, expect, test } from "bun:test";
import {
  createSoundScheduler,
  DEFAULT_THROTTLE_MS,
  initFootstepCadence,
  stepFootstepCadence,
  type SoundCatalogue,
  type SoundScheduler,
} from "./sound";
import type { Rng } from "../rng";

/** A fixed-sequence rng (wraps), like the spawner tests use, for deterministic clip picks. */
const seqRng = (vals: number[]): Rng => {
  let i = 0;
  return { next: () => vals[i++ % vals.length]! };
};
/** Always picks index 0 of a bank. */
const ZERO_RNG: Rng = { next: () => 0 };

const CATALOGUE: SoundCatalogue = {
  hitTaken: { clips: ["hit_a", "hit_b", "hit_c"], volume: 0.8 },
  creatureDeath: {
    // No base bank on purpose: every creature death is its own sound.
    variants: {
      goblin: { clips: ["goblin_die"], pitchVariance: 0.1 },
      dragon: { clips: ["dragon_die"], volume: 0.5, throttleMs: 500 },
    },
  },
  footstep: {
    clips: ["step_generic"], // fallback surface
    variants: { stone: { clips: ["step_stone_1", "step_stone_2"] } },
  },
};

describe("createSoundScheduler — resolution", () => {
  let now = 0;
  let sched: SoundScheduler;
  beforeEach(() => {
    now = 1000;
    sched = createSoundScheduler({ catalogue: CATALOGUE, now: () => now, rng: ZERO_RNG });
  });

  test("plays the base bank for an unqualified event", () => {
    expect(sched.play("hitTaken")).toEqual({ clip: "hit_a", volume: 0.8, pitchVariance: 0 });
  });

  test("returns null for an event absent from the catalogue", () => {
    expect(sched.play("levelUp")).toBeNull();
  });

  test("resolves a variant by qualifier and inherits its config", () => {
    expect(sched.play("creatureDeath", "goblin")).toEqual({
      clip: "goblin_die",
      volume: 1, // no volume on goblin variant or def → default 1
      pitchVariance: 0.1, // from the variant
    });
    now += 1000;
    expect(sched.play("creatureDeath", "dragon")).toEqual({
      clip: "dragon_die",
      volume: 0.5,
      pitchVariance: 0,
    });
  });

  test("an event with only variants stays silent for an unknown qualifier", () => {
    // creatureDeath has no base `clips`, so an unmapped kind has nothing to play.
    expect(sched.play("creatureDeath", "phoenix")).toBeNull();
  });

  test("falls back to the base bank when a qualifier has no variant", () => {
    // footstep has a `stone` variant but not `mud` → generic step.
    expect(sched.play("footstep", "mud")).toEqual({
      clip: "step_generic",
      volume: 1,
      pitchVariance: 0,
    });
  });

  test("overrides win over variant and def config", () => {
    expect(sched.play("creatureDeath", "goblin", { volume: 0.25, pitchVariance: 0 })).toEqual({
      clip: "goblin_die",
      volume: 0.25,
      pitchVariance: 0,
    });
  });
});

describe("createSoundScheduler — throttle", () => {
  test("suppresses a repeat of the same bank within the throttle window, allows it after", () => {
    let now = 0;
    const sched = createSoundScheduler({
      catalogue: CATALOGUE,
      now: () => now,
      rng: ZERO_RNG,
      defaultThrottleMs: 100,
    });
    expect(sched.play("hitTaken")).not.toBeNull();
    now += 50;
    expect(sched.play("hitTaken")).toBeNull(); // inside the window
    now += 50;
    expect(sched.play("hitTaken")).not.toBeNull(); // window elapsed (100ms)
  });

  test("throttling is per-bank: different sounds don't gate each other", () => {
    let now = 0;
    const sched = createSoundScheduler({
      catalogue: CATALOGUE,
      now: () => now,
      rng: ZERO_RNG,
      defaultThrottleMs: 100,
    });
    // A goblin and a dragon dying on the same frame both sound (different variants).
    expect(sched.play("creatureDeath", "goblin")).not.toBeNull();
    expect(sched.play("creatureDeath", "dragon")).not.toBeNull();
    // But a second goblin on the same frame is throttled.
    expect(sched.play("creatureDeath", "goblin")).toBeNull();
  });

  test("a bank's own throttleMs overrides the scheduler default", () => {
    let now = 0;
    const sched = createSoundScheduler({
      catalogue: CATALOGUE,
      now: () => now,
      rng: ZERO_RNG,
      defaultThrottleMs: 10,
    });
    expect(sched.play("creatureDeath", "dragon")).not.toBeNull();
    now += 100; // past the default 10ms but inside the dragon's 500ms
    expect(sched.play("creatureDeath", "dragon")).toBeNull();
    now += 400;
    expect(sched.play("creatureDeath", "dragon")).not.toBeNull();
  });

  test("default throttle floor is applied when nothing overrides it", () => {
    let now = 0;
    const sched = createSoundScheduler({ catalogue: CATALOGUE, now: () => now, rng: ZERO_RNG });
    expect(sched.play("hitTaken")).not.toBeNull();
    now += DEFAULT_THROTTLE_MS - 1;
    expect(sched.play("hitTaken")).toBeNull();
    now += 1;
    expect(sched.play("hitTaken")).not.toBeNull();
  });
});

describe("createSoundScheduler — variation", () => {
  test("nudges off an immediate repeat so the same clip doesn't play twice running", () => {
    let now = 0;
    // rng keeps returning index 0; the anti-repeat nudge should still vary the second play.
    const sched = createSoundScheduler({
      catalogue: CATALOGUE,
      now: () => now,
      rng: ZERO_RNG,
      defaultThrottleMs: 0,
    });
    const first = sched.play("hitTaken");
    const second = sched.play("hitTaken");
    expect(first!.clip).toBe("hit_a");
    expect(second!.clip).not.toBe("hit_a"); // nudged off the repeat
  });

  test("honours the rng's choice across a bank", () => {
    let now = 0;
    // 0 → hit_a, 0.5 → hit_b (of 3), 0.99 → hit_c.
    const sched = createSoundScheduler({
      catalogue: CATALOGUE,
      now: () => now,
      rng: seqRng([0, 0.5, 0.99]),
      defaultThrottleMs: 0,
    });
    expect(sched.play("hitTaken")!.clip).toBe("hit_a");
    expect(sched.play("hitTaken")!.clip).toBe("hit_b");
    expect(sched.play("hitTaken")!.clip).toBe("hit_c");
  });
});

describe("stepFootstepCadence", () => {
  test("fires once per stride's worth of distance", () => {
    const c = initFootstepCadence();
    const fires = [30, 30, 30, 30].map((d) => stepFootstepCadence(c, d, 100));
    // 30,60,90,120 → only the step that crosses 100 fires.
    expect(fires).toEqual([false, false, false, true]);
  });

  test("standing still never fires", () => {
    const c = initFootstepCadence();
    expect(stepFootstepCadence(c, 0, 100)).toBe(false);
    expect(stepFootstepCadence(c, 0, 100)).toBe(false);
  });

  test("a single oversized step (dash/teleport) yields at most one footfall", () => {
    const c = initFootstepCadence();
    expect(stepFootstepCadence(c, 1000, 100)).toBe(true);
    // The overshoot is swallowed rather than banking nine more footfalls.
    expect(stepFootstepCadence(c, 0, 100)).toBe(false);
    expect(c.accum).toBe(0);
  });
});
