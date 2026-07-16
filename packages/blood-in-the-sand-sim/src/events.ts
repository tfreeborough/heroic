/**
 * Transient things that happened during a tick — anything a client couldn't
 * re-derive from two adjacent snapshots (a hit's damage roll, a death, an
 * ability firing). They ride inside snapshots; the client drains each exactly
 * once to spawn FX/audio. Countdown digits and attack telegraphs are NOT
 * events — they derive from snapshot fields (round.timer, attack phase +
 * lockedFacing).
 */
import type { AbilityId, WeaponId } from "./config";
import type { Team } from "./state";

export type ArenaEvent =
  | {
      type: "hit";
      attackerId: number;
      /** A player id — or a deployable id when a straw man soaks the blow. */
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
  /** A ranged weapon loosed a projectile — the release sound (bow twang / staff
   * whoosh), fired on every shot whether or not it ever connects. */
  | { type: "shoot"; ownerId: number; weapon: WeaponId; x: number; y: number }
  /** An ability slot fired — drives per-ability cast SFX/haptics. */
  | { type: "cast"; playerId: number; ability: AbilityId }
  /** The harpoon's chain snapped out — endpoints for the line flash (drawn
   * whether or not it stuck; a dash-dodged throw still whips through air). */
  | { type: "harpoon"; casterId: number; fromX: number; fromY: number; toX: number; toY: number }
  /** A sandtrap went off (its own sound, distinct from the cast). */
  | { type: "detonate"; x: number; y: number }
  /** A blood-font tick landed — the green number. */
  | { type: "heal"; targetId: number; amount: number; x: number; y: number }
  /** Every seat armed — the arming countdown just started (banner/SFX cue).
   * Cancels are NOT events: the client reads round.timer going back to 0. */
  | { type: "armingComplete" }
  | { type: "roundStart"; roundNumber: number }
  | { type: "fightStart" }
  | { type: "roundEnd"; winnerTeam: Team | 0; wins: [number, number] }
  | { type: "matchEnd"; winnerTeam: Team };
