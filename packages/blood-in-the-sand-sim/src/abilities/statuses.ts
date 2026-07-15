/**
 * Self-status queries — the abilities whose entire effect is "while the slot's
 * active window is open, the rules bend around you" (Mirror Guard, Ironhide,
 * War Drums). No state of their own: core's AbilityState phase IS the status,
 * so there's nothing to apply or tear down, only questions to answer.
 */
import { distance } from "@heroic/core";
import { IRONHIDE, WAR_DRUMS } from "../config";
import { abilityActive, type ArenaPlayer } from "../state";

export const ironhideActive = (p: ArenaPlayer): boolean => abilityActive(p, "ironhide");

export const mirrorGuardActive = (p: ArenaPlayer): boolean => abilityActive(p, "mirror-guard");

/** Ironhide shrugs off slows, knockback, dash shoves and the harpoon's pull. */
export const knockbackImmune = ironhideActive;

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
  for (const drummer of players) {
    if (drummer.team !== p.team || !drummer.alive || !abilityActive(drummer, "war-drums")) continue;
    if (distance(p.mover.pos, drummer.mover.pos) <= WAR_DRUMS.radius) {
      factor *= WAR_DRUMS.speedFactor;
      break; // auras don't stack — one beat is one beat
    }
  }
  return factor;
};
