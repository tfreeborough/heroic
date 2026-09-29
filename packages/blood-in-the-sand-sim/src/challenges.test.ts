/**
 * Challenges (bits-challenges.md): the sim dials an offline recipe leans on
 * — uneven rooms, the start-hp handicap, the per-room sands delay, seats
 * that respawn with a brain, a host-concluded round, the one-round match,
 * the locked (possibly empty) kit, and the ward's lifted flee budget — plus
 * the deeds board and the report adapter's counter fold.
 */
import { describe, expect, test } from "bun:test";
import type { ZoneFile } from "@heroic/core";
import { evaluate } from "@heroic/achievements";
import { killPlayer } from "./abilities";
import {
  ACHIEVEMENT_BOARDS,
  ACHIEVEMENT_DEFS,
  CHALLENGE_CLEAR_DEEDS,
  CHALLENGE_COUNTERS,
  challengeCountersAfter,
  challengeSummary,
} from "./achievements";
import { ARCHETYPES } from "./botArchetypes";
import {
  CHALLENGES,
  CHALLENGE_TIERS,
  challengeById,
  challengeTeamSize,
  createChallengeJudge,
  seatChallenge,
} from "./challenges";
import { DUMMY_RESPAWN_SECONDS, ENTRANCE_COUNTDOWN_SECONDS, LOBBY_COUNTDOWN_SECONDS, TICK_DT, TITANS_DRAUGHT } from "./config";
import { armingComplete, concludeRound } from "./round";
import { addPlayer, cloneSim, createSim, setPlayerAbilities, setPlayerWeapon, type ArenaSim } from "./sim";
import { createBotMemory } from "./bot";
import { createBotNav } from "./nav";
import { createOracle } from "./oracle";
import { seatedPlayers, sandsDelayOf, teamCounts } from "./state";
import { stepSim } from "./step";
import type { PlayerInput } from "./state";

const makeZone = (): ZoneFile => ({
  format: 1,
  id: "test-pit",
  name: "Test Pit",
  band: 1,
  size: { cols: 12, rows: 12 },
  tileSize: 64,
  chunkTiles: 12,
  tileset: "placeholder",
  layers: { floor: Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => 1)) },
  collision: { rects: [] },
  breakables: [],
  objects: [
    { id: "spawn-t1", kind: "playerSpawn", x: 128, y: 384, props: { team: 1 } },
    { id: "spawn-t2", kind: "playerSpawn", x: 640, y: 384, props: { team: 2 } },
  ],
});

const seconds = (s: number): number => Math.ceil(s / TICK_DT);

const run = (sim: ArenaSim, ticks: number) => {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...stepSim(sim, new Map(), TICK_DT));
  return events;
};

/** You alone on team 1 against `n` armed bots on team 2 — a `n`-a-side
 * room with the thin side's seats empty, force-started like the client. */
const makeUneven = (n: number, opts: { respawns?: boolean; hp?: number; kitLocked?: boolean } = {}): ArenaSim => {
  const sim = createSim(makeZone(), 0xc0ffee, n, false, true);
  const me = addPlayer(sim, "tom", 1)!;
  for (let i = 0; i < n; i++) {
    const bot = addPlayer(sim, `bot ${i}`, 2)!;
    setPlayerWeapon(sim, bot.id, "blade");
    setPlayerAbilities(sim, bot.id, ["dash", "tremor"]);
    if (opts.respawns) bot.respawns = true;
  }
  if (opts.kitLocked) {
    me.kitLocked = true;
    setPlayerWeapon(sim, me.id, "bow");
  } else {
    setPlayerWeapon(sim, me.id, "blade");
    setPlayerAbilities(sim, me.id, ["dash", "tremor"]);
  }
  if (opts.hp !== undefined) me.startHpFrac = opts.hp;
  sim.state.round.forced = true; // the partial-room launcher
  sim.state.winsToTake = 1;
  return sim;
};

const runToActive = (sim: ArenaSim): void => {
  run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + ENTRANCE_COUNTDOWN_SECONDS) + 4);
  expect(sim.state.round.phase).toBe("active");
};

describe("uneven rooms", () => {
  test("one against four arms, starts, and stands centred on its own anchor", () => {
    const sim = makeUneven(4);
    expect(teamCounts(sim.state)).toEqual([1, 4]);
    expect(armingComplete(sim)).toBe(true);
    runToActive(sim);
    const me = sim.state.players[0]!;
    // A lone fighter's line is one body wide: it stands ON the anchor, not
    // two slots to the left of it as a 4-wide line's slot 0 would.
    expect(me.mover.pos.x).toBeCloseTo(128, 0);
    expect(me.mover.pos.y).toBeCloseTo(384, 0);
    // The full side keeps its shoulder-to-shoulder line, centred.
    const foes = seatedPlayers(sim.state).filter((p) => p.team === 2);
    const meanY = foes.reduce((s, p) => s + p.mover.pos.y, 0) / foes.length;
    expect(meanY).toBeCloseTo(384, 0);
  });

  test("a locked kit with an empty hand counts as armed", () => {
    const sim = makeUneven(1, { kitLocked: true });
    expect(sim.state.players[0]!.abilities).toEqual([]);
    expect(armingComplete(sim)).toBe(true);
    runToActive(sim);
  });

  test("the start-hp handicap applies at every round start", () => {
    const sim = makeUneven(1, { hp: 0.5 });
    runToActive(sim);
    const me = sim.state.players[0]!;
    expect(me.combatant.hp).toBe(Math.round(me.combatant.stats.maxHp * 0.5));
    const foe = sim.state.players[1]!;
    expect(foe.combatant.hp).toBe(foe.combatant.stats.maxHp);
  });

  test("one round takes the match when the host says so", () => {
    const sim = makeUneven(1);
    runToActive(sim);
    const events: ReturnType<typeof stepSim> = [];
    killPlayer(sim.state.players[1]!, events);
    run(sim, 1);
    expect(sim.state.round.phase).toBe("roundEnd");
    expect(sim.state.round.wins).toEqual([1, 0]);
    const after = run(sim, seconds(3));
    expect(after.some((e) => e.type === "matchEnd" && e.winnerTeam === 1)).toBe(true);
  });
});

describe("the sands delay", () => {
  test("a room's own delay beats the config, and Infinity means never", () => {
    const sim = makeUneven(1);
    expect(sandsDelayOf(sim.state)).toBeGreaterThan(10);
    sim.state.sandsDelay = 1;
    runToActive(sim);
    run(sim, seconds(1.5));
    expect(sim.state.round.sands).not.toBeNull();

    const never = makeUneven(1);
    never.state.sandsDelay = Infinity;
    runToActive(never);
    run(never, seconds(60));
    expect(never.state.round.sands).toBeNull();
  });
});

describe("respawning seats (the horde)", () => {
  test("a dead respawner stands back up on its slot; its team is never wiped", () => {
    const sim = makeUneven(3, { respawns: true });
    runToActive(sim);
    const events: ReturnType<typeof stepSim> = [];
    for (const p of seatedPlayers(sim.state)) if (p.team === 2) killPlayer(p, events);
    run(sim, 1);
    // Three dead seats on a respawning team: the round goes on.
    expect(sim.state.round.phase).toBe("active");
    run(sim, seconds(DUMMY_RESPAWN_SECONDS) + 2);
    const foes = seatedPlayers(sim.state).filter((p) => p.team === 2);
    expect(foes.every((p) => p.alive)).toBe(true);
    expect(foes.every((p) => p.combatant.hp === p.combatant.stats.maxHp)).toBe(true);
  });

  test("the player's death still ends the round — as a loss", () => {
    const sim = makeUneven(3, { respawns: true });
    runToActive(sim);
    const events: ReturnType<typeof stepSim> = [];
    killPlayer(sim.state.players[0]!, events);
    run(sim, 1);
    expect(sim.state.round.phase).toBe("roundEnd");
    expect(sim.state.round.lastWinner).toBe(2);
  });

  test("the host concludes the round in the player's favour (the kill count)", () => {
    const sim = makeUneven(3, { respawns: true });
    runToActive(sim);
    const events: ReturnType<typeof stepSim> = [];
    concludeRound(sim, 1, events);
    expect(sim.state.round.phase).toBe("roundEnd");
    expect(sim.state.round.wins).toEqual([1, 0]);
    expect(events.some((e) => e.type === "roundEnd" && e.winnerTeam === 1)).toBe(true);
    // Idempotent outside "active".
    concludeRound(sim, 2, events);
    expect(sim.state.round.wins).toEqual([1, 0]);
  });
});

describe("seatChallenge + the judge (what the phone and the gauntlet share)", () => {
  test("the horde: four respawning foes, one-round match, no tide; 35 kills is the verdict", () => {
    const def = challengeById("the-horde")!;
    const sim = createSim(makeZone(), 0x40de, challengeTeamSize(def), false, true);
    const seated = seatChallenge(sim, def, "tom", () => 0.5, ["a", "b", "c", "d"]);
    expect(seated.me.id).toBe(0);
    expect(seated.me.cooldownScale).toBe(1); // casts are unlimited via the practice flag, cooldowns stay
    expect(seated.bots.length).toBe(4);
    expect(seated.bots.every((b) => b.player.respawns && b.player.team === 2 && b.player.weapon !== null)).toBe(true);
    expect(sim.state.winsToTake).toBe(1);
    expect(sim.state.sandsDelay).toBe(Infinity);
    expect(sim.state.respawnSeconds).toBe(def.respawnSeconds ?? null);
    expect(sim.state.round.forced).toBe(true);
    setPlayerWeapon(sim, 0, "blade");
    setPlayerAbilities(sim, 0, ["dash", "tremor"]);
    runToActive(sim);
    // The stream: let every seat arrive before the killing starts.
    const lastArrival = Math.max(...seated.bots.map((b) => b.player.spawnDelay));
    run(sim, seconds(lastArrival) + 2);
    expect(seated.bots.every((b) => b.player.alive)).toBe(true);
    const downFor = sim.state.respawnSeconds ?? DUMMY_RESPAWN_SECONDS;
    const judge = createChallengeJudge(def, seated.protectIds);
    // Thirty-four kills: the round goes on (the seats respawn); the thirty-fifth concludes it.
    let verdict = null;
    for (let k = 0; k < 35 && !verdict; k++) {
      const events: ReturnType<typeof stepSim> = [];
      const foe = seatedPlayers(sim.state).find((p) => p.team === 2 && p.alive)!;
      events.push({ type: "hit", attackerId: 0, targetId: foe.id, damage: 1, crit: false, lethal: true, x: 0, y: 0 });
      killPlayer(foe, events);
      verdict = judge.tick(sim, events);
      if (k < 34) {
        expect(verdict).toBeNull();
        run(sim, seconds(downFor) + 2); // let them stand back up
      }
    }
    expect(verdict).toEqual({ cleared: true, reason: "won", kills: 35 });
    expect(sim.state.round.phase).toBe("roundEnd");
  });

  test("tall order: a permanent titan, and healers holding dash and nothing else", () => {
    const def = challengeById("the-titan")!;
    const sim = createSim(makeZone(), 0x7174, challengeTeamSize(def), false, true);
    const seated = seatChallenge(sim, def, "tom", () => 0.5, ["a", "b", "c", "d"]);
    const [titan, ...medics] = seated.bots.map((b) => b.player);
    expect(titan!.abilities).toEqual(["titans-draught"]);
    expect(medics.every((m) => m.weapon === "lifeline" && m.abilities.join() === "dash" && m.kitLocked)).toBe(true);
    expect(medics.every((m) => m.healScale < 1 && m.combatant.stats.maxHp < 100)).toBe(true);
    setPlayerWeapon(sim, 0, "blade");
    setPlayerAbilities(sim, 0, ["dash", "tremor"]);
    runToActive(sim);
    run(sim, 2);
    const draught = () => titan!.slots.find((sl) => sl.id === "titans-draught")!.ability;
    expect(draught().phase).toBe("active");
    // Far past the 5s window — still open.
    run(sim, seconds(30));
    expect(draught().phase).toBe("active");
    // …and held past the client's 0.25s grow-in, so the giant is drawn giant.
    expect(TITANS_DRAUGHT.duration - draught().activeRemaining).toBeGreaterThanOrEqual(0.25);
  });

  test("glass foes arrive on a FULL bar of a smaller pool — never visibly pre-damaged", () => {
    const def = challengeById("the-horde")!;
    const sim = createSim(makeZone(), 0x91a55, challengeTeamSize(def), false, true);
    const seated = seatChallenge(sim, def, "tom", () => 0.5, ["a", "b", "c", "d"]);
    setPlayerWeapon(sim, 0, "blade");
    setPlayerAbilities(sim, 0, ["dash", "tremor"]);
    runToActive(sim);
    run(sim, seconds(Math.max(...seated.bots.map((b) => b.player.spawnDelay))) + 2);
    for (const { player } of seated.bots) {
      expect(player.combatant.stats.maxHp).toBe(20);
      expect(player.combatant.hp).toBe(20);
    }
    // Stands back up on the same full, smaller bar.
    const events: ReturnType<typeof stepSim> = [];
    killPlayer(seated.bots[0]!.player, events);
    run(sim, seconds(sim.state.respawnSeconds ?? DUMMY_RESPAWN_SECONDS) + 2);
    expect(seated.bots[0]!.player.combatant.hp).toBe(20);
    // You are untouched.
    expect(sim.state.players[0]!.combatant.stats.maxHp).toBe(100);
  });

  test("the rookie: its death is the loss, even with everyone else standing", () => {
    const def = challengeById("carry-the-rookie")!;
    const sim = createSim(makeZone(), 0xabc, challengeTeamSize(def), false, true);
    const seated = seatChallenge(sim, def, "tom", () => 0.25, ["a", "b", "c"]);
    expect(seated.protectIds.length).toBe(1);
    const rookie = sim.state.players[seated.protectIds[0]!]!;
    expect(rookie.team).toBe(1);
    expect(rookie.weapon).toBe("bow");
    setPlayerWeapon(sim, 0, "blade");
    setPlayerAbilities(sim, 0, ["dash", "tremor"]);
    runToActive(sim);
    const judge = createChallengeJudge(def, seated.protectIds);
    const events: ReturnType<typeof stepSim> = [];
    killPlayer(rookie, events);
    expect(judge.tick(sim, events)).toEqual({ cleared: false, reason: "ward", kills: 0 });
    expect(sim.state.round.lastWinner).toBe(2);
  });

  test("brain pins resolve to real ids: the rookie's hunters mark him, the giant marks you and never yields", () => {
    const rookieDef = challengeById("carry-the-rookie")!;
    const rookieSim = createSim(makeZone(), 0xabc, challengeTeamSize(rookieDef), false, true);
    const rookieSeats = seatChallenge(rookieSim, rookieDef, "tom", () => 0.25, ["a", "b", "c"]);
    const [ward, ...hunters] = rookieSeats.bots;
    expect(ward!.pins).toEqual({ archetype: "ward" });
    for (const h of hunters) expect(h.pins).toEqual({ markId: rookieSeats.protectIds[0] });

    const titanDef = challengeById("the-titan")!;
    const titanSim = createSim(makeZone(), 0x7174, challengeTeamSize(titanDef), false, true);
    const titanSeats = seatChallenge(titanSim, titanDef, "tom", () => 0.5, ["a", "b", "c", "d"]);
    expect(titanSeats.bots[0]!.pins).toEqual({ markId: titanSeats.me.id, relentless: true });
    expect(titanSeats.bots.slice(1).every((b) => Object.keys(b.pins).length === 0)).toBe(true);
  });

  test("blot out the sun: no bow is ever dealt a harpoon", () => {
    const def = challengeById("through-the-arrows")!;
    for (let seed = 0; seed < 40; seed++) {
      const sim = createSim(makeZone(), seed, challengeTeamSize(def), false, true);
      let r = seed / 40;
      const rng = () => (r = (r * 9301 + 49297) % 233280 / 233280);
      const seated = seatChallenge(sim, def, "tom", rng, ["a", "b", "c"]);
      for (const b of seated.bots) expect(b.player.abilities).not.toContain("harpoon");
    }
  });

  test("robin hood: a horde-lite of four respawning blades, each one arrow from dead", () => {
    const def = challengeById("bow-only")!;
    expect(def.win).toEqual({ kind: "kills", count: 10 });
    const sim = createSim(makeZone(), 0x40b, challengeTeamSize(def), false, true);
    const seated = seatChallenge(sim, def, "tom", () => 0.5, ["a", "b", "c", "d"]);
    expect(seated.bots.map((b) => b.player.spawnDelay)).toEqual([0, 2, 4, 6]);
    expect(sim.state.respawnSeconds).toBe(2);
    runToActive(sim);
    run(sim, seconds(7));
    for (const { player } of seated.bots) expect(player.combatant.stats.maxHp).toBe(10);
    // Down, then back up two seconds later on the same small bar.
    const events: ReturnType<typeof stepSim> = [];
    killPlayer(seated.bots[0]!.player, events);
    run(sim, seconds(2) + 2);
    expect(seated.bots[0]!.player.alive).toBe(true);
    expect(seated.bots[0]!.player.combatant.hp).toBe(10);
  });
});

describe("the cooldown scale (the horde)", () => {
  test("at 0, a cast is ready again the moment its active window closes; other seats keep theirs", () => {
    const sim = makeUneven(1);
    const me = sim.state.players[0]!;
    me.cooldownScale = 0;
    runToActive(sim);
    const press = (id: number) => {
      const inputs = new Map<number, PlayerInput>();
      inputs.set(id, { seq: 0, sx: 1, sy: 0, casts: [true, true] });
      return stepSim(sim, inputs, TICK_DT);
    };
    // Tremor (slot 1) is instantaneous: at scale 0 it fires every press.
    // Dash keeps its active window (the cooldown can't be shorter than it):
    // more than once in ten ticks, never every tick.
    let casts = 0;
    let dashes = 0;
    for (let i = 0; i < 10; i++) {
      const evs = press(0).filter((e) => e.type === "cast" && e.playerId === 0);
      casts += evs.filter((e) => e.type === "cast" && e.ability === "tremor").length;
      dashes += evs.filter((e) => e.type === "cast" && e.ability === "dash").length;
    }
    expect(casts).toBe(10);
    expect(dashes).toBeGreaterThan(1);
    expect(dashes).toBeLessThan(10);
    // The foe (scale 1) fires tremor once and then sits on its cooldown.
    let foeCasts = 0;
    for (let i = 0; i < 10; i++) foeCasts += press(1).filter((e) => e.type === "cast" && e.playerId === 1 && e.ability === "tremor").length;
    expect(foeCasts).toBe(1);
  });
});

describe("cloneSim (the oracle's fork)", () => {
  test("a clone evolves identically to the original and never touches it", () => {
    const sim = makeUneven(2);
    runToActive(sim);
    const fork = cloneSim(sim);
    const before = JSON.stringify(sim.state);
    const inputs = new Map<number, PlayerInput>([[0, { seq: 1, sx: 1, sy: 0.3, casts: [true, false] }]]);
    for (let i = 0; i < 40; i++) stepSim(fork, inputs, TICK_DT);
    expect(JSON.stringify(sim.state)).toBe(before); // untouched
    for (let i = 0; i < 40; i++) stepSim(sim, inputs, TICK_DT);
    expect(JSON.stringify(fork.state)).toBe(JSON.stringify(sim.state)); // identical futures
  });
});

describe("the oracle", () => {
  test("plans on clones — the live match is untouched, and the plan holds between replans", () => {
    const sim = makeUneven(2);
    runToActive(sim);
    const nav = createBotNav(sim.zone);
    const foes = seatedPlayers(sim.state)
      .filter((p) => p.team === 2)
      .map((p) => ({ id: p.id, memory: createBotMemory(p.id), difficulty: "skilled" as const }));
    const oracle = createOracle({ horizon: 10, replanEvery: 3, directions: 4, foeThinkEvery: 1 });
    const before = JSON.stringify(sim.state);
    const first = oracle.think(sim, 0, foes, nav);
    expect(JSON.stringify(sim.state)).toBe(before);
    expect(oracle.stats.replans).toBe(1);
    expect(oracle.stats.rollouts).toBe(3 + 4 * 2); // prior ×2, still, 4 dirs × cast/no-cast
    const second = oracle.think(sim, 0, foes, nav);
    expect([second.sx, second.sy]).toEqual([first.sx, first.sy]); // held
    expect(oracle.stats.replans).toBe(1);
    expect(foes.every((f) => JSON.stringify(f.memory) === JSON.stringify(createBotMemory(f.id)))).toBe(true); // foe brains untouched
  });
});

describe("the stream (spawnDelay) + respawn interval", () => {
  test("a delayed seat waits off the sand, counts as alive, and arrives on time; respawnSeconds is honoured", () => {
    const sim = makeUneven(3, { respawns: true });
    const foes = seatedPlayers(sim.state).filter((p) => p.team === 2);
    foes[1]!.spawnDelay = 3;
    foes[2]!.spawnDelay = 6;
    sim.state.respawnSeconds = 5;
    runToActive(sim);
    expect(foes[0]!.alive).toBe(true);
    expect(foes[1]!.alive).toBe(false);
    expect(foes[1]!.mover.pos.x).toBeLessThan(0); // parked off the sand, no corpse
    // Kill the only live foe: two are still coming, so the round goes on.
    const events: ReturnType<typeof stepSim> = [];
    killPlayer(foes[0]!, events);
    run(sim, 1);
    expect(sim.state.round.phase).toBe("active");
    run(sim, seconds(3) + 2);
    expect(foes[1]!.alive).toBe(true);
    expect(foes[1]!.mover.pos.x).toBeGreaterThan(0);
    expect(foes[0]!.alive).toBe(false); // 5s respawn, not the range's 2s
    run(sim, seconds(2) + 2);
    expect(foes[0]!.alive).toBe(true);
    run(sim, seconds(1));
    expect(foes[2]!.alive).toBe(true);
  });

  test("a one-life seat with a delay arrives once and never again", () => {
    const sim = makeUneven(2);
    const late = seatedPlayers(sim.state).find((p) => p.team === 2 && p.id === 2)!;
    late.spawnDelay = 2;
    runToActive(sim);
    expect(late.alive).toBe(false);
    run(sim, seconds(2) + 2);
    expect(late.alive).toBe(true);
    const events: ReturnType<typeof stepSim> = [];
    killPlayer(late, events);
    run(sim, seconds(5));
    expect(late.alive).toBe(false);
  });
});

describe("the ward", () => {
  test("is never derived from a kit and lifts the flee budget alone", () => {
    expect(ARCHETYPES.ward.fleeBudgetTicks).toBeNull();
    for (const [id, preset] of Object.entries(ARCHETYPES)) {
      if (id !== "ward") expect(preset.fleeBudgetTicks).toBeUndefined();
    }
    expect(ARCHETYPES.ward.disengageBelow).toBeGreaterThan(0.8);
    expect(ARCHETYPES.ward.anchorLeash).toBeGreaterThan(0);
    // …and runs from a close foe even on a full bar.
    expect(ARCHETYPES.ward.fleeWithin).toBeGreaterThan(0);
  });
});

describe("the catalogue", () => {
  test("every tier stocked, unique ids, valid shapes", () => {
    for (const tier of CHALLENGE_TIERS) expect(CHALLENGES.filter((c) => c.tier === tier).length).toBeGreaterThan(0);
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
    for (const c of CHALLENGES) {
      expect(challengeById(c.id)).toBe(c);
      expect(challengeTeamSize(c)).toBeGreaterThanOrEqual(1);
      if (c.you.locked) expect(c.you.weapon).toBeDefined();
      for (const s of c.seats) {
        if (s.protect) expect(s.team).toBe(1);
        if (s.respawns) expect(c.win.kind).not.toBe("lastStanding");
      }
    }
    expect(challengeTeamSize(challengeById("five-on-one")!)).toBe(5);
    expect(challengeTeamSize(challengeById("carry-the-rookie")!)).toBe(2);
  });
});

describe("the deeds board + report adapter", () => {
  const fire = (before: Record<string, number>, after: Record<string, number>, id: string, unlocked = new Set<string>()) =>
    evaluate({
      defs: ACHIEVEMENT_DEFS,
      boards: ACHIEVEMENT_BOARDS,
      summary: challengeSummary(id),
      playerKey: 0,
      before,
      after,
      unlocked,
    }).map((d) => d.id);

  test("a first clear pays its deed once, roots the board, and a second clear pays nothing", () => {
    const after = challengeCountersAfter({}, { id: "two-on-one", cleared: true, attempts: 3 });
    expect(after[CHALLENGE_COUNTERS.clears("two-on-one")]).toBe(1);
    expect(after[CHALLENGE_COUNTERS.attempts("two-on-one")]).toBe(3);
    expect(after[CHALLENGE_COUNTERS.cleared]).toBe(1);
    expect(after[CHALLENGE_COUNTERS.tierCleared("easy")]).toBe(1);
    expect(after[CHALLENGE_COUNTERS.attemptsTotal]).toBe(3);
    const fired = fire({}, after, "two-on-one");
    expect(fired).toContain("challenge-two-on-one");
    expect(fired).toContain("against-the-odds");
    // The deed's bounty IS the challenge's band.
    const deed = CHALLENGE_CLEAR_DEEDS.find((d) => d.id === "challenge-two-on-one")!;
    expect(deed.rewards).toEqual([{ kind: "glory", amount: 10 }]);
    // Second clear: counters move, nothing new fires.
    const again = challengeCountersAfter(after, { id: "two-on-one", cleared: true, attempts: 4 });
    expect(again[CHALLENGE_COUNTERS.clears("two-on-one")]).toBe(2);
    expect(fire(after, again, "two-on-one", new Set(fired))).toEqual([]);
  });

  test("attempts only ever climb; a loss report moves no clear", () => {
    const a = challengeCountersAfter({}, { id: "godlike", cleared: false, attempts: 40 });
    expect(a[CHALLENGE_COUNTERS.clears("godlike")]).toBeUndefined();
    expect(a[CHALLENGE_COUNTERS.attempts("godlike")]).toBe(40);
    const b = challengeCountersAfter(a, { id: "godlike", cleared: false, attempts: 12 });
    expect(b[CHALLENGE_COUNTERS.attempts("godlike")]).toBe(40);
    expect(fire({}, b, "godlike")).toEqual([]);
    // An unknown id is ignored, not stored.
    const c = challengeCountersAfter(b, { id: "not-a-thing", cleared: true, attempts: 1 });
    expect(c).toEqual(b);
  });

  test("a tier's last clear crowns the tier; the last clear of all crowns the capstone in the same ceremony", () => {
    let counters: Record<string, number> = {};
    const unlocked = new Set<string>();
    let fired: string[] = [];
    for (const c of CHALLENGES) {
      const before = counters;
      counters = challengeCountersAfter(counters, { id: c.id, cleared: true, attempts: 1 });
      fired = fire(before, counters, c.id, unlocked);
      for (const id of fired) unlocked.add(id);
    }
    expect(unlocked.has("challenge-tier-easy")).toBe(true);
    expect(unlocked.has("challenge-tier-deathwish")).toBe(true);
    // The last clear's ceremony carries the capstone with it.
    expect(fired).toContain("challenge-the-horde");
    expect(fired).toContain("challenge-all");
    expect(counters[CHALLENGE_COUNTERS.cleared]).toBe(CHALLENGES.length);
  });

  test("a ranked or skirmish summary never fires a challenge deed", () => {
    const after = challengeCountersAfter({}, { id: "two-on-one", cleared: true, attempts: 1 });
    const ranked = { ...challengeSummary("two-on-one"), ranked: true };
    delete (ranked as { challenge?: string }).challenge;
    const fired = evaluate({
      defs: ACHIEVEMENT_DEFS,
      boards: ACHIEVEMENT_BOARDS,
      summary: ranked,
      playerKey: 0,
      before: {},
      after,
      unlocked: new Set(),
    }).map((d) => d.id);
    expect(fired.some((id) => id.startsWith("challenge-") || id === "against-the-odds")).toBe(false);
  });
});
