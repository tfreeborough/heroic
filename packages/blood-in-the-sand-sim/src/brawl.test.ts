/**
 * Brawl — the free-for-all (docs/design/bits-brawl.md): six teams of one,
 * last one standing, first to 2 round wins. These suites pin the shape rules
 * (seat-pinned teams, no rng draws, the brawl anchor set, switchTeam refusal)
 * and the generalised round machine (last-team-standing close, argmax match
 * winner, the double-wipe replay).
 */
import { describe, expect, test } from "bun:test";
import type { ZoneFile } from "@heroic/core";
import { BRAWL_TEAM_COUNT, ROUND_END_SECONDS, WINS_TO_TAKE_MATCH_BRAWL } from "./config";
import type { ArenaEvent } from "./events";
import { checkRoundOver, forceStartMatch, resetForRound, tickRoundMachine } from "./round";
import { addPlayer, createSim, deriveArenaZone, switchTeam, type ArenaSim } from "./sim";
import { seatedPlayers, winsToTakeOf, type RoundPhase } from "./state";

/** A square test arena carrying BOTH anchor sets: the classic diagonal pair
 * and brawl's six-point ring (tagged `brawl`, its own 1..6 numbering). */
const makeZone = (): ZoneFile => ({
  format: 1,
  id: "test-arena",
  name: "Test Arena",
  band: 1,
  size: { cols: 16, rows: 16 },
  tileSize: 64,
  chunkTiles: 16,
  tileset: "placeholder",
  layers: { floor: Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 1)) },
  collision: { rects: [] },
  breakables: [],
  objects: [
    { id: "spawn-t1", kind: "playerSpawn", x: 128, y: 128, props: { team: 1 } },
    { id: "spawn-t2", kind: "playerSpawn", x: 896, y: 896, props: { team: 2 } },
    ...Array.from({ length: BRAWL_TEAM_COUNT }, (_, i) => {
      const a = (i / BRAWL_TEAM_COUNT) * Math.PI * 2;
      return {
        id: `spawn-m${i + 1}`,
        kind: "playerSpawn" as const,
        x: Math.round(512 + Math.cos(a) * 384),
        y: Math.round(512 + Math.sin(a) * 384),
        props: { team: i + 1, brawl: true },
      };
    }),
  ],
});

const makeBrawl = (seed = 7): ArenaSim => createSim(makeZone(), seed, 1, false, false, BRAWL_TEAM_COUNT);

const seatSix = (sim: ArenaSim): void => {
  for (let i = 0; i < BRAWL_TEAM_COUNT; i++) addPlayer(sim, `p${i}`);
};

describe("brawl anchor sets", () => {
  test("a brawl zone reads the six-point ring; classic still reads the pair", () => {
    const brawl = deriveArenaZone(makeZone(), BRAWL_TEAM_COUNT);
    expect(brawl.spawns).toHaveLength(6);
    const classic = deriveArenaZone(makeZone());
    expect(classic.spawns).toEqual([
      { x: 128, y: 128 },
      { x: 896, y: 896 },
    ]);
    // The two numbering spaces never bleed into each other.
    expect(brawl.spawns[0]).not.toEqual(classic.spawns[0]!);
  });

  test("a map without the brawl set refuses to open a brawl room", () => {
    const bare = makeZone();
    bare.objects = bare.objects.filter((o) => !o.props?.brawl);
    expect(() => deriveArenaZone(bare, BRAWL_TEAM_COUNT)).toThrow(/brawl playerSpawn/);
    expect(() => deriveArenaZone(bare)).not.toThrow();
  });
});

describe("brawl seating", () => {
  test("team = seat, everyone on their own anchor, zero rng draws", () => {
    const sim = makeBrawl();
    seatSix(sim);
    const players = seatedPlayers(sim.state);
    expect(players.map((p) => p.team)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const p of players) {
      expect(p.mover.pos).toEqual(sim.zone.spawns[p.team - 1]!);
    }
    // No balance coin-flips: brawl seating must never perturb the rng stream.
    expect(sim.state.rngDraws).toBe(0);
    expect(addPlayer(sim, "seventh")).toBeNull(); // room full
  });

  test("a re-taken seat keeps its pinned team", () => {
    const sim = makeBrawl();
    seatSix(sim);
    sim.state.players[3] = null; // seat 3 frees…
    const rejoiner = addPlayer(sim, "late");
    expect(rejoiner!.id).toBe(3); // …and the next joiner takes it
    expect(rejoiner!.team).toBe(4);
  });

  test("switch side is refused — every other team is full by construction", () => {
    const sim = makeBrawl();
    seatSix(sim);
    expect(switchTeam(sim, 0)).toBe(false);
  });

  test("six faction names, all distinct (indexing must never break)", () => {
    const sim = makeBrawl(0xd15ea5e);
    expect(sim.state.teamNames).toHaveLength(6);
    expect(new Set(sim.state.teamNames).size).toBe(6);
  });
});

describe("brawl rounds — last one standing", () => {
  const activeRound = (sim: ArenaSim): void => {
    seatSix(sim);
    resetForRound(sim, []);
    sim.state.round.phase = "active";
  };

  test("the round holds while two remain and closes on the last kill", () => {
    const sim = makeBrawl();
    const phase = (): RoundPhase => sim.state.round.phase;
    activeRound(sim);
    const players = seatedPlayers(sim.state);
    for (const p of players.slice(0, 4)) p.alive = false;
    checkRoundOver(sim, []);
    expect(phase()).toBe("active"); // two still stand — fight on
    players[4]!.alive = false;
    checkRoundOver(sim, []);
    expect(phase()).toBe("roundEnd");
    expect(sim.state.round.lastWinner).toBe(6);
    expect(sim.state.round.wins).toEqual([0, 0, 0, 0, 0, 1]);
  });

  test("everyone wiped on the same tick: nobody scores, the round replays", () => {
    const sim = makeBrawl();
    activeRound(sim);
    for (const p of seatedPlayers(sim.state)) p.alive = false;
    checkRoundOver(sim, []);
    expect(sim.state.round.phase).toBe("roundEnd");
    expect(sim.state.round.lastWinner).toBe(0);
    expect(sim.state.round.wins).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test("first to 2 takes the match, argmax over the six-way tally", () => {
    const sim = makeBrawl();
    const phase = (): RoundPhase => sim.state.round.phase;
    activeRound(sim);
    expect(winsToTakeOf(sim.state)).toBe(WINS_TO_TAKE_MATCH_BRAWL);
    sim.state.round.phase = "roundEnd";
    sim.state.round.timer = ROUND_END_SECONDS;
    sim.state.round.wins = [1, 0, 2, 0, 1, 0];
    const events: ArenaEvent[] = [];
    tickRoundMachine(sim, ROUND_END_SECONDS + 0.01, events);
    expect(phase()).toBe("matchEnd");
    expect(events).toContainEqual({ type: "matchEnd", winnerTeam: 3 });
  });

  test("one win each is no match yet — the next round arms instead", () => {
    const sim = makeBrawl();
    const phase = (): RoundPhase => sim.state.round.phase;
    activeRound(sim);
    sim.state.round.phase = "roundEnd";
    sim.state.round.timer = ROUND_END_SECONDS;
    sim.state.round.wins = [1, 1, 1, 1, 1, 1];
    tickRoundMachine(sim, ROUND_END_SECONDS + 0.01, []);
    expect(phase()).toBe("countdown");
  });
});

describe("brawl force-start", () => {
  test("two seated fighters is a startable brawl (they always oppose)", () => {
    const sim = makeBrawl();
    addPlayer(sim, "a");
    addPlayer(sim, "b");
    expect(forceStartMatch(sim)).toBe(true);
    expect(sim.state.round.forced).toBe(true);
  });

  test("one lone fighter is not", () => {
    const sim = makeBrawl();
    addPlayer(sim, "a");
    expect(forceStartMatch(sim)).toBe(false);
  });
});
