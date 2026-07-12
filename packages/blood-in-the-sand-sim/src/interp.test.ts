import { describe, expect, test } from "bun:test";
import type { ArenaEvent } from "./events";
import { INTERP_DELAY_TICKS, SnapshotBuffer } from "./interp";
import type { PlayerSnapshot, ProjectileSnapshot, SnapshotMsg } from "./protocol";

const TICK_RATE = 30;
const MS = 1000 / TICK_RATE;

const player = (id: number, over: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  id,
  team: (id + 1) as 1 | 2,
  name: `p${id}`,
  weapon: "blade",
  x: 0,
  y: 0,
  hp: 100,
  maxHp: 100,
  alive: true,
  facing: 0,
  atk: "ready",
  atkLeft: 0,
  lockedFacing: 0,
  dashing: false,
  slowed: false,
  dashCd: 0,
  lastSeq: 0,
  ...over,
});

const shot = (id: number, over: Partial<ProjectileSnapshot> = {}): ProjectileSnapshot => ({
  id,
  x: 0,
  y: 0,
  angle: 0,
  weapon: "bow",
  ...over,
});

const snap = (
  tick: number,
  players: PlayerSnapshot[],
  events: ArenaEvent[] = [],
  projectiles: ProjectileSnapshot[] = [],
): SnapshotMsg => ({
  t: "snapshot",
  tick,
  round: { phase: "active", timer: 0, roundNumber: 1, wins: [0, 0], lastWinner: 0 },
  players,
  projectiles,
  events,
});

/** A buffer fed ticks 0..n where player 0 walks +10px/tick along x. */
const walkBuffer = (n: number): SnapshotBuffer => {
  const buf = new SnapshotBuffer(TICK_RATE);
  for (let tick = 0; tick <= n; tick++) buf.push(snap(tick, [player(0, { x: tick * 10 })]), tick * MS);
  return buf;
};

describe("SnapshotBuffer", () => {
  test("sampling right at the newest arrival renders DELAY ticks behind", () => {
    const buf = walkBuffer(10);
    const view = buf.sample(10 * MS)!;
    expect(view.tick).toBeCloseTo(10 - INTERP_DELAY_TICKS);
    expect(view.players[0]!.x).toBeCloseTo((10 - INTERP_DELAY_TICKS) * 10);
  });

  test("mid-interval samples lerp positions between the bracketing pair", () => {
    const buf = walkBuffer(10);
    // Half a tick past the newest arrival → target 8.5 → midway between x=80 and x=90.
    const view = buf.sample(10 * MS + MS / 2)!;
    expect(view.players[0]!.x).toBeCloseTo(85);
  });

  test("facing lerps the short way across the ±π wrap", () => {
    const buf = new SnapshotBuffer(TICK_RATE);
    buf.push(snap(0, [player(0, { facing: Math.PI - 0.1 })]), 0);
    buf.push(snap(1, [player(0, { facing: -Math.PI + 0.1 })]), MS);
    buf.push(snap(2, [player(0, { facing: -Math.PI + 0.1 })]), 2 * MS);
    buf.push(snap(3, [player(0, { facing: -Math.PI + 0.1 })]), 3 * MS);
    // Target 0.5: midway between the first two. Short way crosses π, not 0.
    const view = buf.sample(2.5 * MS)!;
    expect(Math.abs(view.players[0]!.facing)).toBeGreaterThan(3); // ≈ ±π, not ≈ 0
  });

  test("buffer starvation clamps to the newest snapshot instead of extrapolating", () => {
    const buf = walkBuffer(5);
    const view = buf.sample(60_000)!; // nothing has arrived for a minute
    expect(view.tick).toBe(5);
    expect(view.players[0]!.x).toBe(50);
  });

  test("an empty buffer yields null; a single snapshot renders as-is", () => {
    const buf = new SnapshotBuffer(TICK_RATE);
    expect(buf.sample(0)).toBeNull();
    buf.push(snap(7, [player(0, { x: 42 })]), 0);
    expect(buf.sample(0)!.players[0]!.x).toBe(42);
  });

  test("events are drained exactly once, and stale ticks are dropped", () => {
    const buf = new SnapshotBuffer(TICK_RATE);
    const hit: ArenaEvent = { type: "death", playerId: 1 };
    expect(buf.push(snap(1, [player(0)], [hit]), 0)).toEqual([hit]);
    expect(buf.push(snap(1, [player(0)], [hit]), MS)).toEqual([]); // duplicate tick
    expect(buf.push(snap(0, [player(0)], [hit]), 2 * MS)).toEqual([]); // out of order
  });

  test("projectiles lerp by id; a shot new to the pair renders at its newer position", () => {
    const buf = new SnapshotBuffer(TICK_RATE);
    buf.push(snap(0, [player(0)], [], [shot(0, { x: 0 })]), 0);
    buf.push(snap(1, [player(0)], [], [shot(0, { x: 20 }), shot(1, { x: 100 })]), MS);
    buf.push(snap(2, [player(0)], [], [shot(0, { x: 40 }), shot(1, { x: 120 })]), 2 * MS);
    buf.push(snap(3, [player(0)], [], [shot(0, { x: 60 }), shot(1, { x: 140 })]), 3 * MS);
    const view = buf.sample(2.5 * MS)!; // target 0.5 → bracket (0, 1)
    expect(view.projectiles.find((p) => p.id === 0)!.x).toBeCloseTo(10); // lerped
    expect(view.projectiles.find((p) => p.id === 1)!.x).toBe(100); // pop-in at newer
  });

  test("discrete fields (hp, alive, phase) come from the newer snapshot", () => {
    const buf = new SnapshotBuffer(TICK_RATE);
    buf.push(snap(0, [player(0, { hp: 100 })]), 0);
    buf.push(snap(1, [player(0, { hp: 60, atk: "windup" })]), MS);
    buf.push(snap(2, [player(0, { hp: 60, atk: "windup" })]), 2 * MS);
    buf.push(snap(3, [player(0, { hp: 60, atk: "windup" })]), 3 * MS);
    const view = buf.sample(2.5 * MS)!; // target 0.5 → bracket (0, 1)
    expect(view.players[0]!.hp).toBe(60);
    expect(view.players[0]!.atk).toBe("windup");
  });
});
