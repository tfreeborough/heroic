/**
 * The ability slot — where core's generic lifecycle meets the per-ability
 * effects (skills-architecture: stepAbility owns ready/active/cooldown; this
 * folder owns what each ability *does* on the events it emits). One call per
 * player per tick drives all three drafted slots.
 */
import { distance, segmentClear, stepAbility } from "@heroic/core";
import { ABILITIES, HARPOON, PLAYER_RADIUS, SINKHOLE, TAR_PIT } from "../config";
import type { ArenaEvent } from "../events";
import type { ArenaSim } from "../sim";
import { seatedPlayers, type ArenaPlayer, type PlayerInput } from "../state";
import { beginDash, dashVelocity, dashingSlot } from "./dash";
import { applyTaunt, castDeployable } from "./deployables";
import { fireHarpoon } from "./harpoon";
import { inSandstorm, targetView, type TargetView } from "./targets";
import { castWardingShout } from "./wardingShout";

export * from "./dash";
export * from "./damage";
export * from "./deployables";
export * from "./harpoon";
export * from "./statuses";
export * from "./targets";
export * from "./wardingShout";

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
      // Practice never spends the budget — cooldown is the only gate there,
      // so a slot can be drilled all match (chargesLeft stays at full).
      if (!sim.state.practice) slot.chargesLeft -= 1;
      // Kept by reference: a thrown cast (sinkhole below) stamps its
      // landing point onto this event for the client's lob FX.
      const castEvent: Extract<ArenaEvent, { type: "cast" }> = {
        type: "cast",
        playerId: p.id,
        ability: slot.id,
      };
      events.push(castEvent);
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
        case "warding-shout":
          castWardingShout(p, players);
          break;
        case "harpoon":
          slot.targetId = mark!.id; // latched; the chain lands when the windup ends
          break;
        // Tremor spawns the quake ZONE — its id keeps the tremor name; the
        // placed thing is a deployable like the font (kind ≠ ability id).
        case "tremor":
          castDeployable(sim.state, "quake", p);
          break;
        // The decoy taunts on the drop: nearby enemies force-lock onto it,
        // a windup already in flight included (pvp-abilities.md § Straw Man).
        case "straw-man":
          applyTaunt(castDeployable(sim.state, "straw-man", p), players);
          break;
        case "sandtrap":
        case "blood-font":
        case "sandstorm":
          castDeployable(sim.state, slot.id, p);
          break;
        // The sinkhole is THROWN along the facing (aimable, so whiffable —
        // the Warding Shout rule), clamped inside the sand so a wall-facing
        // throw plants at the rim instead of vanishing into the crowd.
        case "sinkhole": {
          const w = sim.zone.size.x;
          const h = sim.zone.size.y;
          const at = {
            x: Math.min(
              Math.max(p.mover.pos.x + Math.cos(p.facing) * SINKHOLE.throwDistance, PLAYER_RADIUS),
              w - PLAYER_RADIUS,
            ),
            y: Math.min(
              Math.max(p.mover.pos.y + Math.sin(p.facing) * SINKHOLE.throwDistance, PLAYER_RADIUS),
              h - PLAYER_RADIUS,
            ),
          };
          castDeployable(sim.state, "sinkhole", p, at);
          castEvent.tx = at.x;
          castEvent.ty = at.y;
          break;
        }
        // The tar trail opens its laying window: first blob at the feet,
        // the rest drop by DISTANCE TRAVELLED below while the window runs.
        case "tar-pit":
          castDeployable(sim.state, "tar", p);
          slot.dropX = p.mover.pos.x;
          slot.dropY = p.mover.pos.y;
          break;
        // mirror-guard / ironhide / war-drums: the active phase IS the status.
        default:
          break;
      }
    }

    // The tar trail lays while its window is open: a fresh blob every
    // TAR_PIT.spacing px of travel — where it goes is where you went (the
    // roster's only movement-expressed ability; standing still lays just
    // the one blob under you).
    if (slot.id === "tar-pit" && slot.ability.phase === "active") {
      const dx = p.mover.pos.x - slot.dropX;
      const dy = p.mover.pos.y - slot.dropY;
      if (dx * dx + dy * dy >= TAR_PIT.spacing * TAR_PIT.spacing) {
        castDeployable(sim.state, "tar", p);
        slot.dropX = p.mover.pos.x;
        slot.dropY = p.mover.pos.y;
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
