/**
 * The arming flow (pvp-loadout-flow.md): the sim starts the match ITSELF once
 * every seat is armed (10s countdown, joins/leaves cancel it), the host's
 * force-start fills stragglers, and live picks stay team secrets on the wire —
 * with no reveal, ever.
 */
import { describe, expect, test } from "bun:test";
import type { ZoneFile } from "@heroic/core";
import { LOADOUT_ABILITY_COUNT, LOBBY_COUNTDOWN_SECONDS, TICK_DT, type AbilityId } from "./config";
import { armingComplete, forceStartMatch } from "./round";
import { addPlayer, createSim, removePlayer, setPlayerAbilities, setPlayerWeapon, type ArenaSim } from "./sim";
import { toRoomStatePlayers, toSnapshot } from "./snapshot";
import { loadoutComplete, type RoundPhase } from "./state";
import { stepSim } from "./step";

const makeZone = (): ZoneFile => ({
  format: 1,
  id: "test-arena",
  name: "Test Arena",
  band: 1,
  size: { cols: 8, rows: 8 },
  tileSize: 64,
  chunkTiles: 8,
  tileset: "placeholder",
  layers: { floor: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 1)) },
  collision: { rects: [] },
  breakables: [],
  objects: [
    { id: "spawn-t1", kind: "playerSpawn", x: 96, y: 256, props: { team: 1 } },
    { id: "spawn-t2", kind: "playerSpawn", x: 416, y: 256, props: { team: 2 } },
  ],
});

const HAND: AbilityId[] = ["dash", "tremor"];

/** Alice (armed, team 1) + Bob (UNARMED, team 2), in the lobby. */
const makeLobby = (): ArenaSim => {
  const sim = createSim(makeZone(), 0xb100d);
  addPlayer(sim, "alice");
  addPlayer(sim, "bob");
  setPlayerWeapon(sim, 0, "blade");
  setPlayerAbilities(sim, 0, HAND);
  return sim;
};

const armBob = (sim: ArenaSim): void => {
  setPlayerWeapon(sim, 1, "hammer");
  setPlayerAbilities(sim, 1, ["ironhide", "harpoon"]);
};

const run = (sim: ArenaSim, ticks: number) => {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...stepSim(sim, new Map(), TICK_DT));
  return events;
};

const seconds = (s: number): number => Math.ceil(s / TICK_DT);
const phaseOf = (sim: ArenaSim): RoundPhase => sim.state.round.phase;

describe("the arming countdown", () => {
  test("nothing counts while a seat is unarmed", () => {
    const sim = makeLobby();
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + 5));
    expect(phaseOf(sim)).toBe("lobby");
    expect(sim.state.round.timer).toBe(0);
  });

  test("all armed → countdown → the match starts itself", () => {
    const sim = makeLobby();
    armBob(sim);
    expect(armingComplete(sim)).toBe(true);
    const events = run(sim, 2);
    expect(events.some((e) => e.type === "armingComplete")).toBe(true);
    expect(sim.state.round.timer).toBeGreaterThan(0);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS));
    expect(phaseOf(sim)).toBe("countdown");
  });

  test("a mid-countdown leave cancels; re-arming restarts fresh at 10", () => {
    const sim = makeLobby();
    armBob(sim);
    run(sim, seconds(5)); // halfway down
    expect(sim.state.round.timer).toBeLessThan(LOBBY_COUNTDOWN_SECONDS - 4);
    removePlayer(sim, 1);
    expect(sim.state.round.timer).toBe(0);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + 2));
    expect(phaseOf(sim)).toBe("lobby"); // one armed player is not a party

    addPlayer(sim, "bob-again");
    armBob(sim);
    run(sim, 2);
    expect(sim.state.round.timer).toBeGreaterThan(LOBBY_COUNTDOWN_SECONDS - 1);
  });

  test("a mid-countdown join cancels until the newcomer arms", () => {
    const sim = createSim(makeZone(), 0xb100d);
    addPlayer(sim, "alice");
    setPlayerWeapon(sim, 0, "blade");
    setPlayerAbilities(sim, 0, HAND);
    run(sim, seconds(2));
    expect(sim.state.round.timer).toBe(0); // alone: no countdown

    addPlayer(sim, "bob");
    run(sim, seconds(2));
    expect(sim.state.round.timer).toBe(0); // bob unarmed

    armBob(sim);
    run(sim, 2);
    expect(sim.state.round.timer).toBeGreaterThan(0);
  });

  test("picks during the countdown never cancel it (replace, not clear)", () => {
    const sim = makeLobby();
    armBob(sim);
    run(sim, seconds(3));
    const before = sim.state.round.timer;
    setPlayerWeapon(sim, 0, "bow"); // last-second swap
    setPlayerAbilities(sim, 0, ["dash", "sandtrap"]);
    run(sim, 2);
    expect(sim.state.round.timer).toBeLessThan(before); // still counting
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS));
    expect(phaseOf(sim)).toBe("countdown");
    expect(sim.state.players[0]!.weapon).toBe("bow");
  });
});

describe("force-start", () => {
  test("fills the straggler deterministically, then the SAME countdown runs", () => {
    const sim = makeLobby(); // bob is unarmed
    expect(forceStartMatch(sim)).toBe(true);
    const bob = sim.state.players[1]!;
    expect(loadoutComplete(bob)).toBe(true);
    expect(bob.abilities.length).toBe(LOADOUT_ABILITY_COUNT);
    expect(new Set(bob.abilities).size).toBe(LOADOUT_ABILITY_COUNT);
    expect(phaseOf(sim)).toBe("lobby"); // never instant
    run(sim, 2);
    expect(sim.state.round.timer).toBeGreaterThan(0);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS));
    expect(phaseOf(sim)).toBe("countdown");
  });

  test("rejected when everyone is already armed or the lobby is short", () => {
    const sim = makeLobby();
    armBob(sim);
    expect(forceStartMatch(sim)).toBe(false); // already counting
    const solo = createSim(makeZone(), 1);
    addPlayer(solo, "alone");
    expect(forceStartMatch(solo)).toBe(false);
  });
});

describe("team sizes (the full-room gate)", () => {
  const WEAPONS_BY_SEAT = ["blade", "hammer", "bow", "staff"] as const;
  const HANDS_BY_SEAT: AbilityId[][] = [
    ["dash", "tremor"],
    ["ironhide", "harpoon"],
    ["dash", "sandtrap"],
    ["war-drums", "blood-font"],
  ];
  const arm = (sim: ArenaSim, id: number): void => {
    setPlayerWeapon(sim, id, WEAPONS_BY_SEAT[id % 4]!);
    setPlayerAbilities(sim, id, HANDS_BY_SEAT[id % 4]!);
  };

  /** A 2v2 lobby with `count` seated players, everyone armed. */
  const make2v2 = (count: number): ArenaSim => {
    const sim = createSim(makeZone(), 0xb100d, 2);
    for (let i = 0; i < count; i++) {
      addPlayer(sim, `p${i}`);
      arm(sim, i);
    }
    return sim;
  };

  test("an armed-but-partial room never counts down", () => {
    const sim = make2v2(3);
    expect(armingComplete(sim)).toBe(false);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + 5));
    expect(phaseOf(sim)).toBe("lobby");
    expect(sim.state.round.timer).toBe(0);

    addPlayer(sim, "p3"); // the last seat fills…
    arm(sim, 3); // …and arms
    run(sim, 2);
    expect(sim.state.round.timer).toBeGreaterThan(0);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS));
    expect(phaseOf(sim)).toBe("countdown");
  });

  test("force-start launches a partial room through the same countdown", () => {
    const sim = make2v2(3);
    expect(forceStartMatch(sim)).toBe(true);
    expect(sim.state.round.forced).toBe(true);
    expect(phaseOf(sim)).toBe("lobby"); // never instant
    run(sim, 2);
    expect(sim.state.round.timer).toBeGreaterThan(0);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS));
    expect(phaseOf(sim)).toBe("countdown");
    expect(sim.state.round.forced).toBe(false); // spent at match start
  });

  test("a join mid-forced-countdown voids the override", () => {
    const sim = make2v2(3);
    forceStartMatch(sim);
    run(sim, seconds(3)); // mid-countdown
    expect(sim.state.round.timer).toBeGreaterThan(0);
    addPlayer(sim, "late"); // the party changed — override stale
    expect(sim.state.round.forced).toBe(false);
    expect(sim.state.round.timer).toBe(0);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + 2));
    expect(phaseOf(sim)).toBe("lobby"); // the newcomer still has to arm
  });

  test("force-start is rejected when every body is on one team", () => {
    const sim = make2v2(4); // full: always 2 per team
    // Countdown is running (full + armed); strip team 2 entirely.
    for (const p of [...sim.state.players]) {
      if (p && p.team === 2) removePlayer(sim, p.id);
    }
    expect(forceStartMatch(sim)).toBe(false); // an instant walkover is no match
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + 2));
    expect(phaseOf(sim)).toBe("lobby");
  });
});

describe("visibility (no reveal, ever)", () => {
  test("roomState hides enemy picks and exposes only armed", () => {
    const sim = makeLobby();
    armBob(sim);
    const seenByTeam1 = toRoomStatePlayers(sim.state, 1);
    const bobRow = seenByTeam1.find((p) => p.id === 1)!;
    expect(bobRow.weapon).toBeNull();
    expect(bobRow.abilities).toBeNull();
    expect(bobRow.armed).toBe(true);
    const aliceRow = seenByTeam1.find((p) => p.id === 0)!;
    expect(aliceRow.weapon).toBe("blade");
    expect(aliceRow.abilities).toEqual(HAND);
    // Watchers get the neutral view: flags only.
    const neutral = toRoomStatePlayers(sim.state, 0);
    expect(neutral.every((p) => p.weapon === null && p.abilities === null)).toBe(true);
  });

  test("snapshots scrub loadouts in the lobby (countdown included), carry them in-match", () => {
    const sim = makeLobby();
    armBob(sim);
    run(sim, seconds(2)); // mid arming-countdown, phase still "lobby"
    const lobbySnap = toSnapshot(sim.state, []);
    expect(lobbySnap.round.phase).toBe("lobby");
    expect(lobbySnap.players.every((p) => p.weapon === null && p.abilities.length === 0)).toBe(true);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS));
    const matchSnap = toSnapshot(sim.state, []);
    expect(matchSnap.round.phase).toBe("countdown");
    expect(matchSnap.players.every((p) => p.weapon !== null && p.abilities.length > 0)).toBe(true);
  });

  test("the lobby return disarms everyone — no instant auto-rematch", () => {
    const sim = makeLobby();
    armBob(sim);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + 2));
    expect(phaseOf(sim)).toBe("countdown");
    // Fast-forward a whole match: team 1 wins 3 rounds by fiat.
    sim.state.round.phase = "matchEnd";
    sim.state.round.timer = 0.05;
    run(sim, 3);
    expect(phaseOf(sim)).toBe("lobby");
    expect(sim.state.players[0]!.weapon).toBeNull();
    expect(sim.state.players[0]!.abilities).toEqual([]);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + 2));
    expect(phaseOf(sim)).toBe("lobby"); // still waiting for a deliberate re-arm
  });
});
