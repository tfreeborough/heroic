/**
 * The ability slot — where core's generic lifecycle meets the per-ability
 * effects (skills-architecture: stepAbility owns ready/active/cooldown; this
 * folder owns what each ability *does* on the events it emits). One call per
 * player per tick drives all three drafted slots.
 */
import { distance, segmentClear, stepAbility } from "@heroic/core";
import { ABILITIES, HARPOON } from "../config";
import type { ArenaEvent } from "../events";
import type { ArenaSim } from "../sim";
import { seatedPlayers, type ArenaPlayer, type PlayerInput } from "../state";
import { beginDash, dashVelocity, dashingSlot } from "./dash";
import { castDeployable } from "./deployables";
import { fireHarpoon } from "./harpoon";
import { inSandstorm, targetView, type TargetView } from "./targets";
import { castTremor } from "./tremor";

export * from "./dash";
export * from "./damage";
export * from "./deployables";
export * from "./harpoon";
export * from "./statuses";
export * from "./targets";
export * from "./tremor";

/**
 * Step every slot of one player's drafted hand: advance lifecycles from the
 * latched presses, fire activation/end effects, tick dash i-frames, and pin
 * the committed roll velocity (which overwrites locomotion wholesale — the
 * escape hop stays a real answer to being slowed).
 */
export const stepPlayerAbilities = (
  sim: ArenaSim,
  p: ArenaPlayer,
  input: PlayerInput,
  fighting: boolean,
  dt: number,
  events: ArenaEvent[],
  players: readonly ArenaPlayer[],
): void => {
  for (let i = 0; i < p.slots.length; i++) {
    const slot = p.slots[i]!;
    // Out of round-budget = the slot is spent until the next round reset
    // replenishes it. Gated presses never reach the lifecycle at all.
    const pressed = fighting && slot.chargesLeft > 0 && input.casts[i] === true;
    // No mark in chain range, no cast — Harpoon's rule: a gated press neither
    // fires nor burns the cooldown, the button simply does nothing.
    const mark = pressed && slot.id === "harpoon" ? harpoonMark(sim, p) : null;
    const triggered = pressed && (slot.id !== "harpoon" || mark !== null);

    const step = stepAbility(slot.ability, ABILITIES[slot.id], dt, triggered);
    slot.ability = step.state;

    if (step.activated) {
      slot.chargesLeft -= 1;
      events.push({ type: "cast", playerId: p.id, ability: slot.id });
      switch (slot.id) {
        case "dash": {
          const mag = Math.hypot(input.sx, input.sy);
          const dir =
            mag > 0.01
              ? { x: input.sx / mag, y: input.sy / mag }
              : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
          beginDash(slot, dir.x, dir.y);
          break;
        }
        case "tremor":
          castTremor(p, players, events);
          break;
        case "harpoon":
          slot.targetId = mark!.id; // latched; the chain lands when the windup ends
          break;
        case "sandtrap":
        case "straw-man":
        case "blood-font":
        case "sandstorm":
          castDeployable(sim.state, slot.id, p);
          break;
        // mirror-guard / ironhide / war-drums: the active phase IS the status.
        default:
          break;
      }
    }

    if (step.ended && slot.id === "harpoon") fireHarpoon(sim, p, slot, events);
    slot.invulnLeft = Math.max(0, slot.invulnLeft - dt);
  }

  const rolling = dashingSlot(p);
  if (rolling) p.mover.vel = dashVelocity(rolling);
};

/**
 * The harpoon's mark, resolved at press time. Chain range deliberately
 * exceeds every weapon's engagement radius (Tom, 2026-07-15), so the harpoon
 * does its OWN acquisition: the current auto-target if the chain reaches it,
 * else the nearest eligible enemy — player or straw man — inside chain range
 * with line of sight. Sandstorm rules apply both ways, as everywhere.
 */
const harpoonMark = (sim: ArenaSim, p: ArenaPlayer): TargetView | null => {
  const { state, zone } = sim;
  if (inSandstorm(state, p.mover.pos)) return null; // no aiming out of the cloud

  const inReach = (aim: TargetView): boolean =>
    distance(p.mover.pos, aim.pos) - aim.radius <= HARPOON.maxRange;
  const current = targetView(state, p.targetId);
  if (current && current.alive && inReach(current)) return current;

  let best: TargetView | null = null;
  let bestDist = Infinity;
  const consider = (aim: TargetView | null): void => {
    if (!aim || !aim.alive || aim.team === p.team) return;
    if (inSandstorm(state, aim.pos)) return;
    if (!segmentClear(p.mover.pos, aim.pos, zone.occluders)) return;
    const d = distance(p.mover.pos, aim.pos) - aim.radius;
    if (d > HARPOON.maxRange || d >= bestDist) return;
    best = aim;
    bestDist = d;
  };
  for (const e of seatedPlayers(state)) if (e.team !== p.team) consider(targetView(state, e.id));
  for (const d of state.deployables) {
    if (d.kind === "straw-man") consider(targetView(state, d.id));
  }
  return best;
};
