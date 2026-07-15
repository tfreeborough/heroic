/**
 * The widened target space (docs/design/pvp-abilities.md, Straw Man's
 * integration wrinkle): auto-targeting used to pick from enemy *player* ids;
 * deployable ids join that space so a decoy is a first-class mark. This view
 * is what the targeting/attack code resolves an id through — a player or a
 * straw man, uniformly.
 */
import { distance } from "@heroic/core";
import type { Vec2 } from "@heroic/core";
import { PLAYER_RADIUS, SANDSTORM } from "../config";
import { isDeployableId, type ArenaState, type Team } from "../state";

/** What targeting/attacks need to know about a mark, whatever it is. */
export interface TargetView {
  id: number;
  team: Team;
  pos: Vec2;
  /** Hurtbox radius (a dummy stands in for a body, so it shares the size). */
  radius: number;
  alive: boolean;
}

/** Resolve a target id to a live view — a seated player or a straw man. */
export const targetView = (state: ArenaState, id: number | null): TargetView | null => {
  if (id === null) return null;
  if (isDeployableId(id)) {
    const d = state.deployables.find((x) => x.id === id);
    if (!d || d.kind !== "straw-man") return null;
    return { id: d.id, team: d.team, pos: d.pos, radius: PLAYER_RADIUS, alive: d.hp > 0 };
  }
  const p = state.players[id];
  return p ? { id: p.id, team: p.team, pos: p.mover.pos, radius: PLAYER_RADIUS, alive: p.alive } : null;
};

/** Inside ANY sandstorm (friend or foe — the cloud doesn't care): can't be
 * auto-targeted, and existing locks treat the mark as lost. Centre-based,
 * like every zone test. */
export const inSandstorm = (state: ArenaState, pos: Vec2): boolean =>
  state.deployables.some((d) => d.kind === "sandstorm" && distance(pos, d.pos) <= SANDSTORM.radius);
