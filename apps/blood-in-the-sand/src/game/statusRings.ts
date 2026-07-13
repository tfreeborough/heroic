/**
 * Status-ring pulse clocks. Each active status (slow, bleed) on each player
 * gets a pulsing ring; the pulse SPEEDS UP as the effect nears expiry, so the
 * ring itself tells you when it's about to drop.
 *
 * Phase is accumulated per frame (phase += 2π·freq·dt) rather than derived
 * from the wall clock, because frequency changes every frame as time runs
 * out — deriving sin(freq·t) directly would jump backwards through the wave
 * whenever freq rises. Client-only, from snapshot slowLeft/bleedLeft.
 */
import type { PlayerSnapshot } from "@heroic/blood-in-the-sand-sim";

export type StatusKind = "slow" | "bleed";

/** Pulse frequency (Hz) from seconds remaining: lazy far out, urgent late. */
const pulseFreq = (left: number): number => Math.min(5, 0.9 + 1.8 / Math.max(left, 0.35));

const timeLeft = (p: PlayerSnapshot, kind: StatusKind): number =>
  kind === "slow" ? p.slowLeft : p.bleedLeft;

export class StatusPulses {
  private readonly phases = new Map<string, number>();
  private lastMs: number | null = null;

  /** Advance every active status's phase; prune the expired. Once per frame. */
  update(players: readonly PlayerSnapshot[], nowMs: number): void {
    const dt = this.lastMs === null ? 0 : Math.min(0.1, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;

    const live = new Set<string>();
    for (const p of players) {
      if (!p.alive) continue;
      for (const kind of ["slow", "bleed"] as const) {
        const left = timeLeft(p, kind);
        if (left <= 0) continue;
        const key = `${p.id}:${kind}`;
        live.add(key);
        this.phases.set(key, (this.phases.get(key) ?? 0) + 2 * Math.PI * pulseFreq(left) * dt);
      }
    }
    for (const key of this.phases.keys()) if (!live.has(key)) this.phases.delete(key);
  }

  /** Current pulse strength for a ring, 0..1 (0 when the status isn't on). */
  strength(id: number, kind: StatusKind): number {
    const phase = this.phases.get(`${id}:${kind}`);
    return phase === undefined ? 0 : 0.5 + 0.5 * Math.sin(phase);
  }
}
