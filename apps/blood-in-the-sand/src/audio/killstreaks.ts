/**
 * First Blood + Unreal-style multi-kill announcements, derived CLIENT-SIDE from
 * the lethal-hit event stream. Attribution rides on `hit.attackerId`, so every
 * kill source — weapon, projectile, sandtrap, tremor, harpoon, even a lethal
 * bleed tick (`tick.sourceId`) — counts and is credited to the right player.
 *
 * Purely presentational, like blood + haptics: no sim or determinism impact.
 * Every client runs its own tracker over the same events, so all clients
 * announce the same thing — that's how "everyone in the match hears it" falls
 * out for free (no networked announcement).
 *
 * Multi-kill = one attacker landing kills in a CONTINUOUS chain: each within
 * {@link STREAK_WINDOW_MS} of the last, and the chain breaks the instant that
 * attacker dies (Unreal's "continuous chain"). First Blood is the match's first
 * kill — this tracker lives as long as the match (GameScreen remounts per match,
 * so a fresh instance = a fresh match).
 */

export type MultiKillTier = "double" | "multi" | "mega" | "ultra" | "monster";

export interface KillAnnouncement {
  /** True on the first kill of the match. */
  firstBlood: boolean;
  /** The multi-kill tier reached, or null for a lone kill (chain of 1). */
  tier: MultiKillTier | null;
}

/** Max gap between two kills for the chain to keep escalating — measured from the
 * LAST kill, so it's a rolling window (each kill resets the clock). */
export const STREAK_WINDOW_MS = 4500;

const tierFor = (count: number): MultiKillTier | null =>
  count >= 6
    ? "monster"
    : count === 5
      ? "ultra"
      : count === 4
        ? "mega"
        : count === 3
          ? "multi"
          : count === 2
            ? "double"
            : null;

export class KillStreaks {
  private firstBloodDone = false;
  /** attacker id → running chain (kill count + wall-clock of the last kill). */
  private chains = new Map<number, { count: number; lastMs: number }>();

  /**
   * Register a lethal player-on-player kill and get what to announce (or null:
   * a lone non-first kill, or a self-kill). Call exactly once per kill — on the
   * lethal `hit` event, which is the only place the attacker is known.
   */
  registerKill(attackerId: number, victimId: number, nowMs: number): KillAnnouncement | null {
    // The victim's own chain ends when they die (continuous-chain rule). For a
    // self-kill (your own sandtrap) this also resets the attacker's chain.
    this.chains.delete(victimId);
    if (attackerId === victimId) return null; // a suicide never announces

    const prev = this.chains.get(attackerId);
    const count = prev && nowMs - prev.lastMs <= STREAK_WINDOW_MS ? prev.count + 1 : 1;
    this.chains.set(attackerId, { count, lastMs: nowMs });

    const firstBlood = !this.firstBloodDone;
    this.firstBloodDone = true;

    const tier = tierFor(count);
    // The very first kill of the match is a chain of 1 → tier null, firstBlood
    // true (the two are mutually exclusive in practice).
    return firstBlood || tier !== null ? { firstBlood, tier } : null;
  }
}
