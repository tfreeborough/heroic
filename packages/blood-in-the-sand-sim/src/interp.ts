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
import type { PlayerSnapshot, RoundSnapshot, SnapshotMsg } from "./protocol";

export const INTERP_DELAY_TICKS = 2;

/** Keep ~2s of history — plenty for the delay window plus debugging. */
const MAX_ENTRIES = 64;

export interface InterpolatedView {
  /** The (fractional) server tick this view renders. */
  tick: number;
  round: RoundSnapshot;
  players: PlayerSnapshot[];
}

interface Entry {
  snap: SnapshotMsg;
  arrivalMs: number;
}

const lerpNum = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Shortest-path angle lerp — a raw lerp breaks at the ±π wrap. */
const lerpAngle = (a: number, b: number, t: number): number => a + angleDiff(b, a) * t;

const lerpPlayer = (a: PlayerSnapshot, b: PlayerSnapshot, t: number): PlayerSnapshot => ({
  // Discrete fields come from the NEWER snapshot; only continuous ones lerp.
  ...b,
  x: lerpNum(a.x, b.x, t),
  y: lerpNum(a.y, b.y, t),
  facing: lerpAngle(a.facing, b.facing, t),
  lockedFacing: lerpAngle(a.lockedFacing, b.lockedFacing, t),
});

export class SnapshotBuffer {
  private entries: Entry[] = [];
  private readonly msPerTick: number;

  constructor(tickRate: number) {
    this.msPerTick = 1000 / tickRate;
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

    const players = newer.players.map((b) => {
      const a = older.players.find((p) => p.id === b.id) ?? b;
      return lerpPlayer(a, b, t);
    });

    return { tick: target, round: newer.round, players };
  }
}
