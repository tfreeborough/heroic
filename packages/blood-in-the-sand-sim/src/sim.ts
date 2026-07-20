/**
 * ArenaSim — the runtime wrapper around the serialisable ArenaState: everything
 * derived-once or non-serialisable lives here (zone geometry, LOS occluders,
 * the spatial grid scratch, the live Rng). Rebuildable from (zoneFile, state)
 * alone, which is what makes snapshots/replays possible.
 */
import {
  angleTo,
  createRng,
  createSpatialGrid,
  loadZone,
  makeCombatant,
  rectEdges,
  type Aabb,
  type Rng,
  type SpatialGrid,
  type Vec2,
  type VisionSegment,
  type ZoneFile,
} from "@heroic/core";
import {
  ABILITIES,
  ABILITY_IDS,
  LOADOUT_ABILITY_COUNT,
  PLAYER_STATS,
  SPAWN_SPACING,
  WEAPONS,
  type AbilityId,
  type WeaponId,
} from "./config";
import {
  createAbilitySlots,
  createArenaState,
  createPlayer,
  seatedPlayers,
  teamCounts,
  teamSizeOf,
  type ArenaPlayer,
  type ArenaState,
  type Team,
} from "./state";

const GRID_CELL = 64;

export interface ArenaZone {
  id: string;
  size: Vec2;
  /** Every movement blocker (walls ∪ voids) → stepCrowd's walls. */
  collision: Aabb[];
  /** LOS occluders: the edges of sight-blocking walls only. */
  occluders: VisionSegment[];
  /** Team spawn points, indexed team − 1. */
  spawns: [Vec2, Vec2];
}

export interface ArenaSim {
  state: ArenaState;
  zone: ArenaZone;
  /** Scratch for stepCrowd's push-apart broadphase; rebuilt inside each step. */
  grid: SpatialGrid;
  /** Counting shim over createRng(state.seed) — every draw bumps state.rngDraws. */
  rng: Rng;
}

const countingRng = (inner: Rng, state: ArenaState): Rng => ({
  next() {
    state.rngDraws += 1;
    return inner.next();
  },
});

/** Rebuild the RNG stream at a known position — tests and (later) replays/restores. */
export const restoreRng = (seed: number, draws: number): Rng => {
  const rng = createRng(seed);
  for (let i = 0; i < draws; i++) rng.next();
  return rng;
};

export const deriveArenaZone = (file: ZoneFile): ArenaZone => {
  const zone = loadZone(file);
  const spawnOf = (team: Team): Vec2 => {
    const obj = zone.objects.find((o) => o.kind === "playerSpawn" && Number(o.props.team) === team);
    if (!obj) throw new Error(`zone ${zone.id}: no playerSpawn with props.team = ${team}`);
    return { x: obj.x, y: obj.y };
  };
  return {
    id: zone.id,
    size: zone.size,
    collision: zone.collision,
    // Sight-blockers: drawn walls plus occluding prop footprints (solid rocks —
    // hidden collision whose sprite is the visual; docs/design/tilesets.md).
    occluders: [...zone.walls, ...zone.propOccluders].flatMap((w) => rectEdges(w.x, w.y, w.w, w.h)),
    spawns: [spawnOf(1), spawnOf(2)],
  };
};

export const createSim = (zoneFile: ZoneFile, seed: number, teamSize: number = 1, training = false): ArenaSim => {
  const zone = deriveArenaZone(zoneFile);
  const state = createArenaState(seed, teamSize * 2, training);
  return {
    state,
    zone,
    grid: createSpatialGrid(zone.size.x, GRID_CELL, zone.size.y),
    rng: countingRng(restoreRng(seed, state.rngDraws), state),
  };
};

/** Spawn facing the arena centre — reads as "facing your opponent" on any map. */
export const spawnFacing = (sim: ArenaSim, spawn: Vec2): number =>
  angleTo(spawn, { x: sim.zone.size.x / 2, y: sim.zone.size.y / 2 });

/**
 * This player's slot within their team: same-team seated players with a lower
 * id come first. Stable mid-match (seats never move); lobby churn re-ranking
 * only reshuffles spawn slots, which is cosmetic.
 */
export const teamSlotOf = (state: ArenaState, player: ArenaPlayer): number =>
  seatedPlayers(state).filter((p) => p.team === player.team && p.id < player.id).length;

/**
 * Where teammate `slot` of `team` stands: a line formation centred on the
 * team's authored anchor, perpendicular to the anchor→arena-centre direction —
 * shoulder to shoulder, facing the enemy, on any map, with zero map edits.
 */
export const spawnSlotPos = (sim: ArenaSim, team: Team, slot: number): Vec2 => {
  const anchor = sim.zone.spawns[team - 1]!;
  const teamSize = teamSizeOf(sim.state);
  const perp = spawnFacing(sim, anchor) + Math.PI / 2;
  const offset = (slot - (teamSize - 1) / 2) * SPAWN_SPACING;
  return { x: anchor.x + Math.cos(perp) * offset, y: anchor.y + Math.sin(perp) * offset };
};

/**
 * Seat a new player in the first free seat (lobby only — mid-match the seats
 * are the match roster). Returns null when no seat is free or a match is on.
 * The team is RANDOM but balanced: join the smaller side, coin-flip a tie
 * (from the sim rng — the draw bumps rngDraws, so seed + join order is still
 * fully deterministic). With 2×N seats this can never overfill a side, and
 * the first two joiners always land on opposite teams. `forcedTeam` skips all
 * of that (no rng draw) — dev tooling that must control the line-up (training
 * mode seats the human on 1 and its dummies on 2).
 */
export const addPlayer = (sim: ArenaSim, name: string, forcedTeam?: Team): ArenaPlayer | null => {
  if (sim.state.round.phase !== "lobby") return null;
  const id = sim.state.players.indexOf(null);
  if (id === -1) return null;
  const [n1, n2] = teamCounts(sim.state);
  const team: Team = forcedTeam ?? (n1 < n2 ? 1 : n2 < n1 ? 2 : sim.rng.next() < 0.5 ? 1 : 2);
  // Lobby slot = "next on my side"; resetForRound re-derives slots by id order.
  const spawn = spawnSlotPos(sim, team, team === 1 ? n1 : n2);
  const player = createPlayer(id, name, team, spawn, spawnFacing(sim, spawn));
  sim.state.players[id] = player;
  // A join cancels a running arming countdown — the newcomer needs to arm
  // (pvp-loadout-flow.md); it restarts fresh once every seat is armed again.
  // It also voids a host force-start: the party changed under the override.
  sim.state.round.timer = 0;
  sim.state.round.forced = false;
  return player;
};

/**
 * Seat a target dummy (training mode — the dev menu's firing range): team 2,
 * armed on the spot so the arming gate treats it like any ready player. What
 * makes it a DUMMY is the flag: step.ts skips its targeting and attack cycle
 * (it never moves either — no one feeds it input), and the training pass
 * respawns it on its spawn slot after death. The loadout is cosmetic.
 */
export const addDummy = (sim: ArenaSim, name: string): ArenaPlayer | null => {
  const dummy = addPlayer(sim, name, 2);
  if (!dummy) return null;
  dummy.dummy = true;
  setPlayerWeapon(sim, dummy.id, "blade");
  setPlayerAbilities(sim, dummy.id, ABILITY_IDS.slice(0, LOADOUT_ABILITY_COUNT));
  return dummy;
};

/**
 * Seat a backfill bot (docs/design/bits-bot-backfill.md): the server fills a
 * host force-start's empty seats with these. Assignment runs the production
 * addPlayer path (random-balanced, deterministic), and the bot arrives
 * UNARMED — forceStartMatch's random-fill sweep drafts its weapon and hand
 * exactly the way it arms an AFK human. What makes it a bot is the flag: the
 * server thinks for the seat, rooms exclude it from human bookkeeping, and
 * every lobby return dismisses it.
 */
export const addBot = (sim: ArenaSim, name: string): ArenaPlayer | null => {
  const bot = addPlayer(sim, name);
  if (bot) bot.bot = true;
  return bot;
};

/**
 * Hop to the other team (lobby only): random-balanced join assignment can
 * split a couple who wanted to fight each other, so the lobby offers SWITCH
 * SIDE — gated on a free seat across the sand, which also makes it impossible
 * in any full room (including a bot-filled countdown). Loadouts survive the
 * hop (picks aren't team-dependent); the lobby body re-anchors to the new
 * side's spawn line. Like a join/leave, the party changed: any running arming
 * countdown cancels and a pending force-start is voided.
 */
export const switchTeam = (sim: ArenaSim, id: number): boolean => {
  const player = sim.state.players[id];
  if (!player || sim.state.round.phase !== "lobby") return false;
  const other: Team = player.team === 1 ? 2 : 1;
  const [n1, n2] = teamCounts(sim.state);
  const otherCount = other === 1 ? n1 : n2;
  if (otherCount >= teamSizeOf(sim.state)) return false;
  player.team = other;
  const spawn = spawnSlotPos(sim, other, otherCount);
  player.mover.pos.x = spawn.x;
  player.mover.pos.y = spawn.y;
  player.facing = spawnFacing(sim, spawn);
  sim.state.round.timer = 0;
  sim.state.round.forced = false;
  return true;
};

/**
 * A weapon pick (duplicates allowed — variety by choice, not by rule).
 * Rebuilds the combatant so the weapon's stat overlay lands. Lobby only —
 * picks REPLACE, never clear, so a player can never become un-armed (which is
 * what lets the arming countdown ignore edits).
 */
export const setPlayerWeapon = (sim: ArenaSim, id: number, weapon: WeaponId): boolean => {
  const player = sim.state.players[id];
  if (!player || sim.state.round.phase !== "lobby") return false;
  player.weapon = weapon;
  player.combatant = makeCombatant({ ...PLAYER_STATS, ...WEAPONS[weapon].stats });
  return true;
};

/**
 * The ability picks: up to LOADOUT_ABILITY_COUNT distinct ids, order = the
 * in-match button order. The client sends the whole list each change
 * (idempotent, no add/remove protocol). Same lobby-only gate as the weapon.
 */
export const setPlayerAbilities = (sim: ArenaSim, id: number, abilities: AbilityId[]): boolean => {
  const player = sim.state.players[id];
  if (!player || sim.state.round.phase !== "lobby") return false;
  if (!Array.isArray(abilities) || abilities.length > LOADOUT_ABILITY_COUNT) return false;
  if (abilities.some((a) => !(a in ABILITIES))) return false;
  if (new Set(abilities).size !== abilities.length) return false;
  player.abilities = [...abilities];
  // Keep the match runtimes in step with the picks — the round reset rebuilds
  // these anyway; syncing here means hand-forced states (tests) are castable.
  player.slots = createAbilitySlots(player.abilities);
  return true;
};

/** Free a seat (lobby only — mid-match a leaver becomes a disconnected body). */
export const removePlayer = (sim: ArenaSim, id: number): boolean => {
  if (sim.state.round.phase !== "lobby") return false;
  if (!sim.state.players[id]) return false;
  sim.state.players[id] = null;
  // A leaver cancels a running arming countdown, same as a join — the party
  // changed; the countdown restarts fresh if everyone left is still armed.
  // A pending host force-start is likewise voided.
  sim.state.round.timer = 0;
  sim.state.round.forced = false;
  return true;
};

/**
 * Mid-match disconnect: the match NEVER pauses (decided 2026-07-09). The body
 * idles in place (missing input = IDLE_INPUT), stays killable, and the seat is
 * reserved so a rejoin resumes control of the live character.
 */
export const markDisconnected = (sim: ArenaSim, id: number): void => {
  const player = sim.state.players[id];
  if (player) player.connected = false;
};

/** Claim a disconnected seat — the rejoiner takes over its live character. */
export const reconnectPlayer = (sim: ArenaSim, id: number, name: string): void => {
  const player = sim.state.players[id];
  if (!player) return;
  player.connected = true;
  player.name = name;
};
