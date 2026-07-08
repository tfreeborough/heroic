import { describe, expect, test } from "bun:test";
import { normalize, sub, type ZoneFile } from "@heroic/core";
import { COUNTDOWN_SECONDS, PLAYER_STATS, TICK_DT } from "./config";
import type { ArenaEvent } from "./events";
import { addPlayer, createSim, markDisconnected, reconnectPlayer, restoreRng, type ArenaSim } from "./sim";
import { IDLE_INPUT, type PlayerInput } from "./state";
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

const makeSim = (seed = 0xb100d): ArenaSim => {
  const sim = createSim(makeZone(), seed);
  addPlayer(sim, "alice");
  addPlayer(sim, "bob");
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
  const enemy = sim.state.players.find((p) => p.team !== me.team)!;
  const dir = normalize(sub(enemy.mover.pos, me.mover.pos));
  return { seq, sx: dir.x, sy: dir.y, dash: false };
};

const COUNTDOWN_TICKS = Math.ceil(COUNTDOWN_SECONDS / TICK_DT);

const ofType = <T extends ArenaEvent["type"]>(events: Stamped[], type: T) =>
  events.filter((e): e is Stamped & { event: Extract<ArenaEvent, { type: T }> } => e.event.type === type);

describe("round machine", () => {
  test("waiting → countdown → active once both players are in", () => {
    const sim = createSim(makeZone(), 1);
    run(sim, 5);
    expect(sim.state.round.phase).toBe("waiting"); // nobody joined yet

    addPlayer(sim, "alice");
    run(sim, 5);
    expect(sim.state.round.phase).toBe("waiting"); // still one short

    addPlayer(sim, "bob");
    // +5: float residue in the repeated 1/30 subtraction can push the expiry a tick.
    const events = run(sim, COUNTDOWN_TICKS + 5);
    expect(ofType(events, "roundStart")).toHaveLength(1);
    expect(ofType(events, "fightStart")).toHaveLength(1);
    expect(sim.state.round.phase).toBe("active");
    expect(sim.state.round.roundNumber).toBe(1);
  });

  test("players are planted during the countdown", () => {
    const sim = makeSim();
    run(sim, 10, (_, s) => new Map([[0, seek(s, 0)]]));
    const p0 = sim.state.players[0]!;
    expect(sim.state.round.phase).toBe("countdown");
    expect(p0.mover.pos.x).toBeCloseTo(96);
    expect(p0.mover.pos.y).toBeCloseTo(256);
  });
});

describe("combat", () => {
  test("a seeking attacker kills a harmless defender and takes the round", () => {
    const sim = makeSim();
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
    // 0.2s of committed movement at dash speed ⇒ well past normal accel range.
    expect(p0.mover.pos.x - startX).toBeGreaterThan(120);
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

describe("rounds and match", () => {
  test("first to three wins ends the match, then a rematch resets the board", () => {
    const sim = makeSim();
    // One-hit kills to keep the test fast: give bob a 1-hp stat sheet (fresh
    // object — PLAYER_STATS is shared by reference and must stay pristine).
    sim.state.players[1]!.combatant.stats = { ...PLAYER_STATS, maxHp: 1 };

    const events = run(sim, 2200, (_, s) => new Map([[0, seek(s, 0)]]));

    const roundEnds = ofType(events, "roundEnd");
    expect(roundEnds.length).toBeGreaterThanOrEqual(3);
    expect(roundEnds[2]!.event.wins).toEqual([3, 0]);

    // The 1-hp stat sheet persists into the rematch, so a long run can produce
    // a second matchEnd — assert on the first.
    const matchEnd = ofType(events, "matchEnd");
    expect(matchEnd.length).toBeGreaterThanOrEqual(1);
    expect(matchEnd[0]!.event.winnerTeam).toBe(1);

    // The rematch: a roundStart with the scoreboard wiped and round number 1.
    const rematchStart = ofType(events, "roundStart").find((e) => e.tick > matchEnd[0]!.tick);
    expect(rematchStart).toBeDefined();
    expect(rematchStart!.event.roundNumber).toBe(1);
    expect(sim.state.round.wins[1]).toBe(0);
  });

  test("disconnect freezes to waiting with wins preserved; reconnect resumes", () => {
    const sim = makeSim();
    run(sim, COUNTDOWN_TICKS + 30, (_, s) => new Map([[0, seek(s, 0)]]));
    expect(sim.state.round.phase).toBe("active");
    sim.state.round.wins = [1, 0]; // pretend a round was already taken

    markDisconnected(sim, 1);
    run(sim, 60);
    expect(sim.state.round.phase).toBe("waiting");
    expect(sim.state.round.wins).toEqual([1, 0]);

    reconnectPlayer(sim, 1, "bob-again");
    const events = run(sim, 2);
    expect(ofType(events, "roundStart")).toHaveLength(1);
    expect(sim.state.round.phase).toBe("countdown");
    expect(sim.state.players[1]!.name).toBe("bob-again");
    expect(sim.state.players[1]!.combatant.hp).toBe(PLAYER_STATS.maxHp);
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
    const s1 = makeSim(42);
    const s2 = makeSim(42);
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
    const sim = makeSim(7);
    run(sim, 700, (_, s) => new Map([[0, seek(s, 0)]]));
    expect(sim.state.rngDraws).toBeGreaterThan(0);

    const restored = restoreRng(sim.state.seed, sim.state.rngDraws);
    expect(sim.rng.next()).toBe(restored.next());
  });

  test("the state survives a JSON round-trip intact", () => {
    const sim = makeSim();
    run(sim, 200, (_, s) => new Map([[0, seek(s, 0)]]));
    expect(JSON.parse(JSON.stringify(sim.state))).toEqual(sim.state);
  });
});
