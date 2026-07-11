import { describe, expect, test } from "bun:test";
import { normalize, sub, type ZoneFile } from "@heroic/core";
import { COUNTDOWN_SECONDS, DASH_DISTANCE, MATCH_END_SECONDS, PLAYER_STATS, TICK_DT } from "./config";
import type { ArenaEvent } from "./events";
import { startMatch } from "./round";
import {
  addPlayer,
  createSim,
  markDisconnected,
  reconnectPlayer,
  removePlayer,
  restoreRng,
  setPlayerWeapon,
  type ArenaSim,
} from "./sim";
import { seatedPlayers, type PlayerInput } from "./state";
import { stepSim } from "./step";

// ── Fixture: a small square test zone (512×512) with an off-centre pillar ──
// Spawns face each other along y=256; the pillar (centre 256,128) is clear of
// that line, so it only matters when a test deliberately routes sight through it.
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
  collision: { rects: [{ x: 256, y: 128, w: 64, h: 64 }] },
  breakables: [],
  objects: [
    { id: "spawn-t1", kind: "playerSpawn", x: 96, y: 256, props: { team: 1 } },
    { id: "spawn-t2", kind: "playerSpawn", x: 416, y: 256, props: { team: 2 } },
  ],
});

/** Two players seated (both on the blade), still in the lobby. */
const makeSim = (seed = 0xb100d): ArenaSim => {
  const sim = createSim(makeZone(), seed);
  addPlayer(sim, "alice");
  addPlayer(sim, "bob");
  setPlayerWeapon(sim, 0, "blade");
  setPlayerWeapon(sim, 1, "blade");
  return sim;
};

/** Two players seated AND the host has pressed start (countdown running). */
const makeMatch = (seed = 0xb100d): ArenaSim => {
  const sim = makeSim(seed);
  expect(startMatch(sim, [])).toBe(true);
  return sim;
};

type InputsFor = (tick: number, sim: ArenaSim) => ReadonlyMap<number, PlayerInput>;

interface Stamped {
  tick: number;
  event: ArenaEvent;
}

const run = (sim: ArenaSim, ticks: number, inputsFor?: InputsFor): Stamped[] => {
  const out: Stamped[] = [];
  for (let i = 0; i < ticks; i++) {
    const tick = sim.state.tick;
    const events = stepSim(sim, inputsFor?.(tick, sim) ?? new Map(), TICK_DT);
    for (const event of events) out.push({ tick, event });
  }
  return out;
};

/** Stick input pushing `id` straight at their (only) enemy. */
const seek = (sim: ArenaSim, id: number, seq = 0): PlayerInput => {
  const me = sim.state.players[id]!;
  const enemy = seatedPlayers(sim.state).find((p) => p.team !== me.team)!;
  const dir = normalize(sub(enemy.mover.pos, me.mover.pos));
  return { seq, sx: dir.x, sy: dir.y, dash: false };
};

const COUNTDOWN_TICKS = Math.ceil(COUNTDOWN_SECONDS / TICK_DT);
const MATCH_END_TICKS = Math.ceil(MATCH_END_SECONDS / TICK_DT);

const ofType = <T extends ArenaEvent["type"]>(events: Stamped[], type: T) =>
  events.filter((e): e is Stamped & { event: Extract<ArenaEvent, { type: T }> } => e.event.type === type);

describe("lobby machine", () => {
  test("the lobby idles until the host starts — nothing is automatic", () => {
    const sim = createSim(makeZone(), 1);
    expect(startMatch(sim, [])).toBe(false); // empty room

    addPlayer(sim, "alice");
    run(sim, 30);
    expect(sim.state.round.phase).toBe("lobby");
    expect(startMatch(sim, [])).toBe(false); // one seat short

    addPlayer(sim, "bob");
    run(sim, 30);
    expect(sim.state.round.phase).toBe("lobby"); // full room STILL idles
    expect(startMatch(sim, [])).toBe(false); // nobody has picked a weapon

    setPlayerWeapon(sim, 0, "blade");
    expect(startMatch(sim, [])).toBe(false); // ONE unpicked player still blocks
    setPlayerWeapon(sim, 1, "hammer");

    const pre: ArenaEvent[] = [];
    expect(startMatch(sim, pre)).toBe(true);
    expect(pre.some((e) => e.type === "roundStart")).toBe(true);
    // +5: float residue in the repeated 1/30 subtraction can push the expiry a tick.
    const events = run(sim, COUNTDOWN_TICKS + 5);
    expect(ofType(events, "fightStart")).toHaveLength(1);
    expect(sim.state.round.phase).toBe("active");
    expect(sim.state.round.roundNumber).toBe(1);
  });

  test("startMatch refuses when a seated player is disconnected", () => {
    const sim = makeSim();
    markDisconnected(sim, 1);
    expect(startMatch(sim, [])).toBe(false);
    reconnectPlayer(sim, 1, "bob");
    expect(startMatch(sim, [])).toBe(true);
  });

  test("players are planted during the countdown", () => {
    const sim = makeMatch();
    run(sim, 10, (_, s) => new Map([[0, seek(s, 0)]]));
    const p0 = sim.state.players[0]!;
    expect(sim.state.round.phase).toBe("countdown");
    expect(p0.mover.pos.x).toBeCloseTo(96);
    expect(p0.mover.pos.y).toBeCloseTo(256);
  });

  test("seats: free in the lobby, locked mid-match", () => {
    const sim = makeSim();
    expect(removePlayer(sim, 1)).toBe(true); // lobby: seat frees
    expect(sim.state.players[1]).toBeNull();
    expect(addPlayer(sim, "carol")).not.toBeNull(); // and is claimable again
    expect(startMatch(sim, [])).toBe(false); // carol hasn't picked yet
    expect(setPlayerWeapon(sim, 1, "bow")).toBe(true);

    expect(startMatch(sim, [])).toBe(true);
    expect(removePlayer(sim, 1)).toBe(false); // mid-match: the roster is fixed
    expect(sim.state.players[1]).not.toBeNull();
    expect(addPlayer(sim, "dave")).toBeNull(); // and nobody new can squeeze in
    expect(setPlayerWeapon(sim, 1, "staff")).toBe(false); // picks lock with it
  });
});

describe("combat", () => {
  test("a seeking attacker kills a harmless defender and takes the round", () => {
    const sim = makeMatch();
    // Auto-targeting means bob swings back — pull his teeth (attack 0 ⇒ MIN_DAMAGE
    // chip) so the round outcome is fixed while both cycles still run.
    sim.state.players[1]!.combatant.stats = { ...PLAYER_STATS, attack: 0 };
    const all = run(sim, 900, (_, s) => new Map([[0, seek(s, 0)]]));
    // A long run rolls into round 2 (respawn → fight again) — assert on round 1 only.
    const firstRoundEnd = all.findIndex((e) => e.event.type === "roundEnd");
    expect(firstRoundEnd).toBeGreaterThan(-1);
    const events = all.slice(0, firstRoundEnd + 1);

    const hits = ofType(events, "hit").filter((h) => h.event.attackerId === 0);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.event.targetId).toBe(1);
      expect(h.event.damage).toBeGreaterThan(0);
    }
    const totalDamage = hits.reduce((sum, h) => sum + h.event.damage, 0);
    expect(totalDamage).toBeGreaterThanOrEqual(PLAYER_STATS.maxHp);
    expect(hits[hits.length - 1]!.event.lethal).toBe(true);

    expect(ofType(events, "death")).toHaveLength(1);
    const roundEnd = ofType(events, "roundEnd");
    expect(roundEnd).toHaveLength(1);
    expect(roundEnd[0]!.event.winnerTeam).toBe(1);
    expect(roundEnd[0]!.event.wins).toEqual([1, 0]);
  });

  test("dash i-frames negate a strike that would otherwise land", () => {
    // Twin sims, adjacent players, forced straight into the active phase.
    const setup = (): ArenaSim => {
      const sim = makeSim();
      sim.state.round.phase = "active";
      sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
      sim.state.players[1]!.mover.pos = { x: 260, y: 256 };
      return sim;
    };

    // Both auto-attack, so track only hits ON player 1 (the dodger).
    const hitsOnBob = (events: Stamped[]) =>
      ofType(events, "hit").filter((h) => h.event.targetId === 1);

    const control = setup();
    const controlHits = hitsOnBob(run(control, 30));
    expect(controlHits.length).toBeGreaterThan(0);
    const strikeTick = controlHits[0]!.tick;

    const dodged = setup();
    dodged.state.players[1]!.dash.invulnLeft = (strikeTick + 5) * TICK_DT; // covers the strike
    const events = run(dodged, strikeTick + 3);
    expect(hitsOnBob(events)).toHaveLength(0);
    expect(dodged.state.players[1]!.combatant.hp).toBe(PLAYER_STATS.maxHp);
  });

  test("dash fires, commits movement, and reports its event", () => {
    const sim = makeSim();
    sim.state.round.phase = "active";
    const p0 = sim.state.players[0]!;
    const startX = p0.mover.pos.x;

    // Dash pressed on the first tick, stick held east.
    const events = run(sim, 10, (tick) =>
      new Map([[0, { seq: tick, sx: 1, sy: 0, dash: tick === 0 }]]),
    );
    expect(ofType(events, "dash")).toHaveLength(1);
    expect(p0.dash.ability.phase).toBe("cooldown");
    // The committed movement covers most of DASH_DISTANCE ⇒ past accel range.
    expect(p0.mover.pos.x - startX).toBeGreaterThan(DASH_DISTANCE * 0.6);
  });

  test("the windup tracks a point-blank strafer — orbiting is not a free dodge", () => {
    const sim = makeSim();
    sim.state.round.phase = "active";
    sim.state.players[0]!.mover.pos = { x: 480, y: 700 };
    sim.state.players[1]!.mover.pos = { x: 520, y: 700 };

    // Bob strafes perpendicular to the line between them at full speed —
    // before windup-tracking this whiffed forever. Counterplay is dash/range.
    const events = run(sim, 60, (_, s) => {
      const strafe = seek(s, 1);
      return new Map([[1, { seq: 0, sx: -strafe.sy, sy: strafe.sx, dash: false }]]);
    });
    expect(ofType(events, "hit").filter((h) => h.event.targetId === 1).length).toBeGreaterThan(0);
  });

  test("teleporting the locked target out of engagement breaks the windup", () => {
    const sim = makeSim();
    sim.state.round.phase = "active";
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 260, y: 256 };

    run(sim, 2); // enough to enter windup
    const p0 = sim.state.players[0]!;
    expect(p0.attack.phase).toBe("windup");

    sim.state.players[1]!.mover.pos = { x: 470, y: 470 }; // far beyond engagement
    const events = run(sim, 30);
    expect(ofType(events, "hit")).toHaveLength(0);
    expect(p0.attack.phase).toBe("ready");
    expect(p0.lockedTargetId).toBeNull();
  });
});

describe("match flow", () => {
  test("first to three ends the match, returns to the lobby, and only the host restarts", () => {
    // One-hit kills to keep the test fast: give bob a 1-hp stat sheet (fresh
    // object — PLAYER_STATS is shared by reference and must stay pristine).
    // Stats must land BEFORE startMatch — the round reset reads maxHp.
    const sim = makeSim();
    sim.state.players[1]!.combatant.stats = { ...PLAYER_STATS, maxHp: 1 };
    expect(startMatch(sim, [])).toBe(true);

    const events = run(sim, 1200, (_, s) => new Map([[0, seek(s, 0)]]));

    const roundEnds = ofType(events, "roundEnd");
    expect(roundEnds.length).toBe(3);
    expect(roundEnds[2]!.event.wins).toEqual([3, 0]);
    const matchEnd = ofType(events, "matchEnd");
    expect(matchEnd).toHaveLength(1);
    expect(matchEnd[0]!.event.winnerTeam).toBe(1);

    // NO auto-rematch: past the matchEnd banner we land in the lobby, with the
    // scoreboard preserved for the "last match" display.
    const after = run(sim, MATCH_END_TICKS + 5);
    expect(ofType(after, "roundStart")).toHaveLength(0);
    expect(sim.state.round.phase).toBe("lobby");
    expect(sim.state.round.wins).toEqual([3, 0]);
    expect(sim.state.round.lastWinner).toBe(1);

    // Idles indefinitely until the host acts.
    run(sim, 120);
    expect(sim.state.round.phase).toBe("lobby");

    const pre: ArenaEvent[] = [];
    expect(startMatch(sim, pre)).toBe(true);
    expect(sim.state.round.wins).toEqual([0, 0]); // fresh scoreboard
    expect(sim.state.round.phase).toBe("countdown");
    expect(sim.state.round.roundNumber).toBe(1);
  });

  test("a mid-match disconnect never pauses the match; rejoining resumes the body", () => {
    const sim = makeMatch();
    // The idle body still auto-attacks — pull its teeth so alice farms cleanly.
    sim.state.players[1]!.combatant.stats = { ...PLAYER_STATS, attack: 0 };
    run(sim, COUNTDOWN_TICKS + 30, (_, s) => new Map([[0, seek(s, 0)]]));
    expect(sim.state.round.phase).toBe("active");

    // Bob drops. The machine keeps running and his body idles in place.
    markDisconnected(sim, 1);
    // Knockback stretches each kill (~1s per swing while chasing the ragdoll).
    const during = run(sim, 700, (_, s) => new Map([[0, seek(s, 0)]]));
    expect(["active", "roundEnd", "countdown"]).toContain(sim.state.round.phase);
    // Alice can kill the idle body and take rounds off it.
    expect(ofType(during, "roundEnd").length).toBeGreaterThan(0);
    expect(sim.state.round.wins[0]).toBeGreaterThan(0);

    // Bob comes back mid-match and regains control of the live character.
    reconnectPlayer(sim, 1, "bob-again");
    const p1 = sim.state.players[1]!;
    expect(p1.connected).toBe(true);
    expect(p1.name).toBe("bob-again");
    const xBefore = p1.mover.pos.x;
    run(sim, 15, (_, s) =>
      new Map([[1, { seq: 0, sx: p1.alive ? -1 : 0, sy: 0, dash: false }]]),
    );
    if (p1.alive && sim.state.round.phase === "active") {
      expect(p1.mover.pos.x).toBeLessThan(xBefore); // inputs move him again
    }
  });

  test("a seat still disconnected when the match ends is freed at the lobby", () => {
    const sim = makeSim();
    sim.state.players[1]!.combatant.stats = { ...PLAYER_STATS, attack: 0, maxHp: 1 };
    expect(startMatch(sim, [])).toBe(true);
    run(sim, COUNTDOWN_TICKS + 10, (_, s) => new Map([[0, seek(s, 0)]]));
    markDisconnected(sim, 1);

    // Alice farms the idle body to 3 wins; the match closes and we hit the lobby
    // (the seek input stops once the ghost seat is freed — no enemy left to aim at).
    run(sim, 2400, (_, s) =>
      s.state.players[1] && s.state.round.phase !== "lobby"
        ? new Map([[0, seek(s, 0)]])
        : new Map(),
    );
    expect(sim.state.round.phase).toBe("lobby");
    expect(sim.state.players[1]).toBeNull(); // ghost seat freed
    expect(sim.state.players[0]).not.toBeNull(); // alice keeps hers

    expect(addPlayer(sim, "carol")).not.toBeNull(); // seat is claimable again
  });
});

describe("determinism", () => {
  // A scripted duel with movement, strafing, dashing, and rng-driven combat.
  const script: InputsFor = (tick, s) => {
    const a = seek(s, 0, tick);
    const bSeek = seek(s, 1, tick);
    // Bob strafes (perpendicular to the seek line) and dashes periodically.
    const b: PlayerInput = { seq: tick, sx: -bSeek.sy, sy: bSeek.sx, dash: tick % 90 === 0 };
    return new Map([
      [0, a],
      [1, b],
    ]);
  };

  test("same seed + same inputs ⇒ identical states and events", () => {
    const s1 = makeMatch(42);
    const s2 = makeMatch(42);
    for (let i = 0; i < 600; i++) {
      const e1 = stepSim(s1, script(s1.state.tick, s1), TICK_DT);
      const e2 = stepSim(s2, script(s2.state.tick, s2), TICK_DT);
      expect(JSON.stringify(e1)).toBe(JSON.stringify(e2));
      if (i % 50 === 0) expect(JSON.stringify(s1.state)).toBe(JSON.stringify(s2.state));
    }
    expect(JSON.stringify(s1.state)).toBe(JSON.stringify(s2.state));
    expect(s1.state.rngDraws).toBeGreaterThan(0); // combat actually rolled dice
  });

  test("restoreRng(seed, rngDraws) resumes the exact stream", () => {
    const sim = makeMatch(7);
    run(sim, 700, (_, s) => new Map([[0, seek(s, 0)]]));
    expect(sim.state.rngDraws).toBeGreaterThan(0);

    const restored = restoreRng(sim.state.seed, sim.state.rngDraws);
    expect(sim.rng.next()).toBe(restored.next());
  });

  test("the state survives a JSON round-trip intact", () => {
    const sim = makeMatch();
    run(sim, 200, (_, s) => new Map([[0, seek(s, 0)]]));
    expect(JSON.parse(JSON.stringify(sim.state))).toEqual(sim.state);
  });
});
