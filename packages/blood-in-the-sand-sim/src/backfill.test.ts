/**
 * Bot backfill + team switching (bits-bot-backfill.md): a host force-start
 * fills empty seats with bots, anyone can veto the bot-filled countdown, the
 * lobby return dismisses the bots, and SWITCH SIDE hops a player across a
 * partial room. The server only orchestrates — every rule lives here.
 */
import { describe, expect, test } from "bun:test";
import type { ZoneFile } from "@heroic/core";
import { LOBBY_COUNTDOWN_SECONDS, TICK_DT, type AbilityId } from "./config";
import { cancelStart, forceStartMatch } from "./round";
import { addBot, addPlayer, createSim, setPlayerAbilities, setPlayerWeapon, switchTeam, type ArenaSim } from "./sim";
import { toRoomStatePlayers } from "./snapshot";
import { loadoutComplete, seatedPlayers, type RoundPhase } from "./state";
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

const arm = (sim: ArenaSim, id: number): void => {
  setPlayerWeapon(sim, id, "blade");
  setPlayerAbilities(sim, id, HAND);
};

/** A 2v2 with `humans` armed humans seated, the rest of the seats free. */
const makePartial2v2 = (humans: number): ArenaSim => {
  const sim = createSim(makeZone(), 0xb100d, 2);
  for (let i = 0; i < humans; i++) {
    addPlayer(sim, `p${i}`);
    arm(sim, i);
  }
  return sim;
};

/** The server's force-start orchestration, in miniature: fill, then force. */
const fillAndForce = (sim: ArenaSim): void => {
  let n = 0;
  while (sim.state.players.includes(null)) addBot(sim, `bot${n++}`);
  forceStartMatch(sim);
};

const run = (sim: ArenaSim, ticks: number) => {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...stepSim(sim, new Map(), TICK_DT));
  return events;
};

const seconds = (s: number): number => Math.ceil(s / TICK_DT);
const phaseOf = (sim: ArenaSim): RoundPhase => sim.state.round.phase;
const bots = (sim: ArenaSim) => seatedPlayers(sim.state).filter((p) => p.bot);

describe("bot backfill", () => {
  test("bots fill every seat, force-start arms them, the countdown runs", () => {
    const sim = makePartial2v2(2);
    fillAndForce(sim);
    expect(seatedPlayers(sim.state).length).toBe(4);
    expect(bots(sim).length).toBe(2);
    expect(seatedPlayers(sim.state).every(loadoutComplete)).toBe(true);
    expect(phaseOf(sim)).toBe("lobby"); // never instant
    run(sim, 2);
    expect(sim.state.round.timer).toBeGreaterThan(0);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS));
    expect(phaseOf(sim)).toBe("countdown");
  });

  test("balanced fill: a lone host gets an opponent, not a teammate", () => {
    const sim = createSim(makeZone(), 0xb100d, 1); // 1v1
    addPlayer(sim, "host");
    arm(sim, 0);
    fillAndForce(sim);
    const seated = seatedPlayers(sim.state);
    expect(seated.length).toBe(2);
    expect(seated.some((p) => p.team === 1)).toBe(true);
    expect(seated.some((p) => p.team === 2)).toBe(true);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + 1));
    expect(phaseOf(sim)).toBe("countdown");
  });

  test("the lobby return dismisses the bots and frees their seats", () => {
    const sim = makePartial2v2(2);
    fillAndForce(sim);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + 1));
    expect(phaseOf(sim)).toBe("countdown");
    // Fast-forward the whole match by fiat.
    sim.state.round.phase = "matchEnd";
    sim.state.round.timer = 0.05;
    run(sim, 3);
    expect(phaseOf(sim)).toBe("lobby");
    expect(bots(sim).length).toBe(0);
    expect(seatedPlayers(sim.state).length).toBe(2); // the humans, disarmed
    expect(sim.state.players.includes(null)).toBe(true); // seats open again
  });

  test("roomState flags bots for every viewer", () => {
    const sim = makePartial2v2(2);
    fillAndForce(sim);
    const rows = toRoomStatePlayers(sim.state, 1);
    expect(rows.filter((r) => r.bot).length).toBe(2);
    expect(rows.filter((r) => !r.bot).length).toBe(2);
  });
});

describe("cancelStart (the veto)", () => {
  test("anyone can cancel a bot-filled countdown; humans keep their loadouts", () => {
    const sim = makePartial2v2(2);
    fillAndForce(sim);
    run(sim, seconds(2)); // mid-countdown
    expect(sim.state.round.timer).toBeGreaterThan(0);
    expect(cancelStart(sim)).toBe(true);
    expect(sim.state.round.timer).toBe(0);
    expect(sim.state.round.forced).toBe(false);
    expect(bots(sim).length).toBe(0);
    expect(seatedPlayers(sim.state).every(loadoutComplete)).toBe(true); // picks intact
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + 2));
    expect(phaseOf(sim)).toBe("lobby"); // partial again — nothing counts
  });

  test("a full room of humans counting down has no cancel", () => {
    const sim = makePartial2v2(4); // full, everyone armed → counting
    run(sim, 2);
    expect(sim.state.round.timer).toBeGreaterThan(0);
    expect(cancelStart(sim)).toBe(false);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS));
    expect(phaseOf(sim)).toBe("countdown");
  });

  test("cancel is a lobby-countdown-only move", () => {
    const sim = makePartial2v2(2);
    expect(cancelStart(sim)).toBe(false); // no countdown running
    fillAndForce(sim);
    run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + 1));
    expect(phaseOf(sim)).toBe("countdown"); // the match is committed
    expect(cancelStart(sim)).toBe(false);
    expect(bots(sim).length).toBe(2);
  });
});

describe("switchTeam", () => {
  test("hops to the other side when it has a free seat, loadout intact", () => {
    const sim = makePartial2v2(2); // one per team
    const me = sim.state.players[0]!;
    const from = me.team;
    expect(switchTeam(sim, 0)).toBe(true);
    expect(me.team).not.toBe(from);
    expect(loadoutComplete(me)).toBe(true);
  });

  test("rejected when the other side is full, in-match, or the seat is empty", () => {
    const sim = makePartial2v2(2);
    switchTeam(sim, 0); // both now on one team; the OTHER side is empty
    const crowded = sim.state.players[1]!.team;
    // Fill the empty side to capacity, then a hop off the crowded side is fine
    // but a hop ONTO the full side is not.
    const a = addBot(sim, "a")!;
    const b = addBot(sim, "b")!;
    expect(a.team).not.toBe(crowded);
    expect(b.team).not.toBe(crowded);
    expect(switchTeam(sim, a.id)).toBe(false); // toward the full crowded side? no —
    // a's other side IS the crowded one, which is full at 2: rejected.
    expect(switchTeam(sim, 99)).toBe(false); // no such seat
    sim.state.round.phase = "active";
    expect(switchTeam(sim, 0)).toBe(false); // mid-match: seats are the roster
  });

  test("a hop cancels a running forced countdown — the party changed", () => {
    const sim = makePartial2v2(3); // 2v1, all armed
    forceStartMatch(sim); // old-style partial force (no fill) — still counts
    run(sim, 2);
    expect(sim.state.round.timer).toBeGreaterThan(0);
    // The crowded side has 2; only IT has a mover with somewhere to go (the
    // lone side is 1/2, so its seatmate-to-be hops INTO the free seat).
    const crowded = seatedPlayers(sim.state).find((p, _, all) => all.filter((q) => q.team === p.team).length === 2)!;
    expect(switchTeam(sim, crowded.id)).toBe(true);
    expect(sim.state.round.timer).toBe(0);
    expect(sim.state.round.forced).toBe(false);
  });
});
