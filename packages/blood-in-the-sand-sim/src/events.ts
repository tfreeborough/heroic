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
      /** Present on poison ticks (the Fang's stacking dot) — tinted green. */
      poison?: true;
      /** The victim was frozen in true ice: nothing landed (damage is 0) —
       * the client floats "IMMUNE" instead of a number. */
      immune?: true;
      x: number;
      y: number;
    }
  | { type: "death"; playerId: number }
  /** A ranged weapon loosed a projectile — the release sound (bow twang / staff
   * whoosh), fired on every shot whether or not it ever connects. */
  | { type: "shoot"; ownerId: number; weapon: WeaponId; x: number; y: number }
  /** An ability slot fired — drives per-ability cast SFX/haptics. A THROWN
   * cast (the sinkhole) also carries its landing point: the client's lob
   * FX needs it ON the event, because events are drained on snapshot
   * ARRIVAL while the rendered view lags the interp delay — a same-tick
   * deployable isn't in the sampled view yet (the harpoon's precedent). */
  | { type: "cast"; playerId: number; ability: AbilityId; tx?: number; ty?: number }
  /** The harpoon's chain snapped out — endpoints for the line flash (drawn
   * whether or not it stuck; a dash-dodged throw still whips through air). */
  | { type: "harpoon"; casterId: number; fromX: number; fromY: number; toX: number; toY: number }
  /** A sandtrap went off (its own sound, distinct from the cast). */
  | { type: "detonate"; x: number; y: number }
  /** A blood-font tick landed — the green number. `casterId` = the font's
   * owner (Wave 2, achievements.md: healing credits its SOURCE — a font
   * healing three allies is the caster's healing done). */
  | { type: "heal"; targetId: number; casterId: number; amount: number; x: number; y: number }
  /** Mirror Guard turned a shot around (Wave 2) — the reflector's stat, and
   * a hook for a future parry flash/sting. Shipped clients ignore unknown
   * event types (if/else drain), so this is additive like `deedUnlocks`. */
  | { type: "reflect"; playerId: number; attackerId: number; x: number; y: number }
  /** A Shard of True Ice landed — the victim is entombed for `duration`
   * seconds (already diminished). The encasement itself renders off the
   * snapshot's `frozenLeft`; this is the impact flash/SFX moment. */
  | { type: "freeze"; playerId: number; duration: number; x: number; y: number }
  /** A Magic Mirror activated — the telegraph is opening over both bodies.
   * The held swirl renders off the caster's snapshot (`mirrorTargetId` +
   * the slot's active window); this event is the "it begins" sting. */
  | { type: "mirror"; casterId: number; targetId: number; delay: number }
  /** The mirror's swap RESOLVED — both bodies exchanged places (coordinates
   * are post-swap, for the arrival flashes; a fizzled swap emits nothing). */
  | { type: "mirror-swap"; casterId: number; targetId: number; cx: number; cy: number; tx: number; ty: number }
  /** An Elven Cloak dropped (expiry) — the re-materialise shimmer. The
   * cloak's opening shimmer rides the ordinary cast event. */
  | { type: "decloak"; playerId: number; x: number; y: number }
  /** Every seat armed — the arming countdown just started (banner/SFX cue).
   * Cancels are NOT events: the client reads round.timer going back to 0. */
  | { type: "armingComplete" }
  | { type: "roundStart"; roundNumber: number }
  | { type: "fightStart" }
  /** `standing` (Wave 2): the survivors' HP fractions at the close — feats
   * like "win the decider under 10%" sample it; dead players are absent. */
  | { type: "roundEnd"; winnerTeam: Team | 0; wins: [number, number]; standing: { id: number; hpFrac: number }[] }
  | { type: "matchEnd"; winnerTeam: Team };
