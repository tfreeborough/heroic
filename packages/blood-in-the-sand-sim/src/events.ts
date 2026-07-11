/**
 * Transient things that happened during a tick — anything a client couldn't
 * re-derive from two adjacent snapshots (a hit's damage roll, a death, a dash
 * firing). They ride inside snapshots; the client drains each exactly once to
 * spawn FX/audio. Countdown digits and attack telegraphs are NOT events — they
 * derive from snapshot fields (round.timer, attack phase + lockedFacing).
 */
import type { Team } from "./state";

export type ArenaEvent =
  | {
      type: "hit";
      attackerId: number;
      targetId: number;
      damage: number;
      crit: boolean;
      lethal: boolean;
      /** Present on bleed ticks — the client tints these red and skips the ring. */
      bleed?: true;
      x: number;
      y: number;
    }
  | { type: "death"; playerId: number }
  | { type: "dash"; playerId: number }
  | { type: "roundStart"; roundNumber: number }
  | { type: "fightStart" }
  | { type: "roundEnd"; winnerTeam: Team | 0; wins: [number, number] }
  | { type: "matchEnd"; winnerTeam: Team };
