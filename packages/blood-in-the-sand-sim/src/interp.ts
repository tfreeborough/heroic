/**
 * Client-side snapshot interpolation. The client NEVER simulates — it renders
 * the server's snapshots a fixed delay behind the newest one, lerping between
 * the bracketing pair. INTERP_DELAY_TICKS = 2 (66ms at 30Hz) rides out one
 * late/coalesced frame on LAN while staying far below "feels laggy".
 *
 * Pure and platform-free: arrival times are passed in (no Date.now in here),
 * so the whole thing is unit-testable with synthetic clocks.
 */
import { angleDiff } from "@heroic/core";
import type { ArenaEvent } from "./events";
import type {
  DeployableSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  RoundSnapshot,
  SnapshotMsg,
} from "./protocol";

export const INTERP_DELAY_TICKS = 2;

/** History depth. The interpolation delay only needs ~3 ticks; the rest is
 * slack for late frames. Was 64 (~2s "for debugging") — trimmed 2026-07-24
 * for the GC hunt: snapshots that live 2s all get promoted to Hermes's old
 * generation before dying, and a fat old-gen graveyard is what makes the
 * intermittent full collections (the 30ms frame spikes) expensive. 8 ≈ 267ms
 * at 30Hz — an order of magnitude past the delay window, an eighth of the
 * old-gen churn. */
const MAX_ENTRIES = 8;

export interface InterpolatedView {
  /** The (fractional) server tick this view renders. */
  tick: number;
  round: RoundSnapshot;
  players: PlayerSnapshot[];
  projectiles: ProjectileSnapshot[];
  /** Static once placed — no lerp, straight from the newer snapshot. */
  deployables: DeployableSnapshot[];
}

interface Entry {
  snap: SnapshotMsg;
  arrivalMs: number;
}

const lerpNum = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Shortest-path angle lerp — a raw lerp breaks at the ±π wrap. */
const lerpAngle = (a: number, b: number, t: number): number => a + angleDiff(b, a) * t;

/** Discrete fields come from the NEWER snapshot; only continuous ones lerp.
 * Writes into a pooled object — see the GC-diet note on SnapshotBuffer. */
const lerpPlayerInto = (
  dst: PlayerSnapshot,
  a: PlayerSnapshot,
  b: PlayerSnapshot,
  t: number,
): void => {
  Object.assign(dst, b);
  dst.x = lerpNum(a.x, b.x, t);
  dst.y = lerpNum(a.y, b.y, t);
  dst.facing = lerpAngle(a.facing, b.facing, t);
  dst.lockedFacing = lerpAngle(a.lockedFacing, b.lockedFacing, t);
};

/** Same rule as players: lerp by id; a shot new to the pair pops at its newer
 * position (≤ one tick of flight — invisible at our speeds). */
const lerpProjectileInto = (
  dst: ProjectileSnapshot,
  a: ProjectileSnapshot,
  b: ProjectileSnapshot,
  t: number,
): void => {
  Object.assign(dst, b);
  dst.x = lerpNum(a.x, b.x, t);
  dst.y = lerpNum(a.y, b.y, t);
  dst.angle = lerpAngle(a.angle, b.angle, t);
};

/** Linear id scan without a per-call closure (an .find() arrow per entity per
 * frame is real allocation at 60Hz). Snapshot rosters are ≤ ~10 long. */
const byId = <T extends { id: number }>(arr: readonly T[], id: number): T | undefined => {
  for (let i = 0; i < arr.length; i++) if (arr[i]!.id === id) return arr[i];
  return undefined;
};

export class SnapshotBuffer {
  private entries: Entry[] = [];
  private readonly msPerTick: number;

  // GC diet (2026-07-23): sample() runs every rendered frame AND every event
  // drain, and fresh per-call clones made it the client's biggest steady
  // allocator (~700 objects/s in a 4v4 — Hermes was collecting every couple
  // of frames). The SAME view object is returned from every call, its arrays
  // and entity objects mutated in place. CONTRACT: a sampled view is valid
  // only until the next sample() — every current caller reads it within the
  // frame; a new caller that keeps anything must copy it out.
  private readonly pooledPlayers: PlayerSnapshot[] = [];
  private readonly pooledProjectiles: ProjectileSnapshot[] = [];
  private readonly pooledView: InterpolatedView = {
    tick: 0,
    round: undefined as unknown as RoundSnapshot,
    players: [],
    projectiles: [],
    deployables: [],
  };

  constructor(tickRate: number) {
    this.msPerTick = 1000 / tickRate;
  }

  /**
   * Drop all history. Switching rooms restarts the tick counter — stale
   * entries would make push() drop every new snapshot as "old". Call on
   * each welcome.
   */
  reset(): void {
    this.entries.length = 0;
  }

  /**
   * Record a snapshot. Returns its events for the FX layer — each snapshot's
   * events are handed out exactly once (stale/duplicate ticks return none).
   */
  push(snap: SnapshotMsg, arrivalMs: number): ArenaEvent[] {
    const last = this.entries[this.entries.length - 1];
    if (last && snap.tick <= last.snap.tick) return [];
    this.entries.push({ snap, arrivalMs });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    return snap.events;
  }

  /**
   * The view to render at wall-clock `nowMs`: estimate the server's current
   * tick from the newest arrival, step back the interpolation delay, and lerp
   * the bracketing snapshots. Clamps when the buffer starves (render freezes
   * on the newest snapshot rather than extrapolating into nonsense).
   */
  sample(nowMs: number): InterpolatedView | null {
    const entries = this.entries;
    const newest = entries[entries.length - 1];
    if (!newest) return null;

    const estimatedServerTick = newest.snap.tick + (nowMs - newest.arrivalMs) / this.msPerTick;
    const oldest = entries[0]!;
    const target = Math.min(
      newest.snap.tick,
      Math.max(oldest.snap.tick, estimatedServerTick - INTERP_DELAY_TICKS),
    );

    // Find the bracketing pair (entries are strictly tick-ascending).
    let older = newest.snap;
    let newer = newest.snap;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (e.snap.tick <= target) {
        older = e.snap;
        newer = entries[i + 1]?.snap ?? e.snap;
        break;
      }
      newer = e.snap;
      older = e.snap; // still above target — keep walking back
    }

    const span = newer.tick - older.tick;
    const t = span > 0 ? (target - older.tick) / span : 0;

    const view = this.pooledView;
    view.players.length = newer.players.length;
    for (let i = 0; i < newer.players.length; i++) {
      const b = newer.players[i]!;
      const a = byId(older.players, b.id) ?? b;
      const dst = (this.pooledPlayers[i] ??= { ...b });
      lerpPlayerInto(dst, a, b, t);
      view.players[i] = dst;
    }
    view.projectiles.length = newer.projectiles.length;
    for (let i = 0; i < newer.projectiles.length; i++) {
      const b = newer.projectiles[i]!;
      const a = byId(older.projectiles, b.id) ?? b;
      const dst = (this.pooledProjectiles[i] ??= { ...b });
      lerpProjectileInto(dst, a, b, t);
      view.projectiles[i] = dst;
    }
    view.tick = target;
    view.round = newer.round;
    view.deployables = newer.deployables;
    return view;
  }
}
