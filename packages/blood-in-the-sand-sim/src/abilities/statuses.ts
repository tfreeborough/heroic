/**
 * Self-status queries — the abilities whose entire effect is "while the slot's
 * active window is open, the rules bend around you" (Mirror Guard, Ironhide,
 * War Drums). No state of their own: core's AbilityState phase IS the status,
 * so there's nothing to apply or tear down, only questions to answer.
 */
import { distance } from "@heroic/core";
import { IRONHIDE, PLAYER_RADIUS, TITANS_DRAUGHT, WAR_DRUMS } from "../config";
import { abilityActive, type ArenaPlayer } from "../state";

export const ironhideActive = (p: ArenaPlayer): boolean => abilityActive(p, "ironhide");

export const titansDraughtActive = (p: ArenaPlayer): boolean =>
  abilityActive(p, "titans-draught");

/** Outgoing WEAPON-damage multiplier (Titan's Draught). Fixed ability
 * numbers and dot riders never scale — the venom is the venom. */
export const damageFactorOf = (p: ArenaPlayer): number =>
  titansDraughtActive(p) ? TITANS_DRAUGHT.damageFactor : 1;

/** The player's CURRENT body/hurt radius — a drunk titan is bigger in
 * every check that can touch them: arc wedges, projectile paths, blast
 * and zone edges, crowd shoving. Self-balancing by design. */
export const radiusOf = (p: ArenaPlayer): number =>
  PLAYER_RADIUS * (titansDraughtActive(p) ? TITANS_DRAUGHT.sizeFactor : 1);

/** MELEE reach multiplier (Tom, 2026-08-11): a titan's arms grow with the
 * body — without this, the grown crowd radius shoves enemies further out
 * while reach stays fixed, and melee giants get WORSE at their own range.
 * Arc weapons only, applied to reach AND minReach (the whole band scales,
 * bands keep their character): a giant's bow is still the same bow, which
 * keeps ranged balance and the universal camera fit intact. */
export const reachFactorOf = (p: ArenaPlayer): number =>
  titansDraughtActive(p) ? TITANS_DRAUGHT.sizeFactor : 1;

export const mirrorGuardActive = (p: ArenaPlayer): boolean => abilityActive(p, "mirror-guard");

/** Entombed by a Shard of True Ice: total stasis — the frozen can't act,
 * and nothing lands on them (damage.ts turns every hit into an IMMUNE). */
export const frozenSolid = (p: ArenaPlayer): boolean => p.frozenLeft > 0;

/** Faded under an Elven Cloak: can't be auto-targeted (the sandstorm rule,
 * one body wide) — but unlike the storm, the wearer aims out freely. */
export const elvenCloakActive = (p: ArenaPlayer): boolean => abilityActive(p, "elven-cloak");

/** Ironhide shrugs off slows, knockback, dash shoves and the harpoon's pull.
 * A body frozen in true ice is a planted block — same immunity. */
export const knockbackImmune = (p: ArenaPlayer): boolean => ironhideActive(p) || frozenSolid(p);

/**
 * The player's max-speed multiplier this tick: Ironhide's self-slow overrides
 * the hammer's debuff (immune while iron), and any live War Drums aura on the
 * team — the drummer's own included — multiplies on top, re-checked per tick
 * (step out, lose it).
 */
export const speedFactorOf = (p: ArenaPlayer, players: readonly ArenaPlayer[]): number => {
  let factor = ironhideActive(p)
    ? IRONHIDE.selfSlowFactor
    : p.slowLeft > 0
      ? p.slowFactor
      : 1;
  // The host-set permanent multiplier (top bot tiers run hot) composes with
  // statuses — a slowed Godlike is still slowed, just from a higher base.
  factor *= p.moveFactor;
  for (const drummer of players) {
    if (drummer.team !== p.team || !drummer.alive || !abilityActive(drummer, "war-drums")) continue;
    if (distance(p.mover.pos, drummer.mover.pos) <= WAR_DRUMS.radius) {
      factor *= WAR_DRUMS.speedFactor;
      break; // auras don't stack — one beat is one beat
    }
  }
  return factor;
};
