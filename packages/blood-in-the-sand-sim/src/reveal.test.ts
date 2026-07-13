/**
 * The pick ceremony (pvp-pick-ceremony.md): lock-in → reveal → adjust window,
 * per-player LOCK IN (everyone locked ends the window early), and the
 * visibility rules that keep live picks team secrets on the wire.
 */
import { describe, expect, test } from "bun:test";
import type { ZoneFile } from "@heroic/core";
import { ABILITIES, LOADOUT_ABILITY_COUNT, TICK_DT, WEAPON_IDS, type AbilityId } from "./config";
import { startMatch } from "./round";
import {
  addPlayer,
  createSim,
  lockInPlayer,
  markDisconnected,
  setPlayerAbilities,
  setPlayerWeapon,
  type ArenaSim,
} from "./sim";
import { toRoomStatePlayers, toSnapshot } from "./snapshot";
import type { RoundPhase } from "./state";
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

/** Alice (blade, team 1) + Bob (UNPICKED, team 2), still in the lobby. */
const makeLobby = (): ArenaSim => {
  const sim = createSim(makeZone(), 0xb100d);
  addPlayer(sim, "alice");
  addPlayer(sim, "bob");
  setPlayerWeapon(sim, 0, "blade");
  return sim;
};

const run = (sim: ArenaSim, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepSim(sim, new Map(), TICK_DT);
};

const phaseOf = (sim: ArenaSim): RoundPhase => sim.state.round.phase;

describe("pick ceremony", () => {
  test("lock-in snapshots the reveal, auto-fills the unpicked, opens the window", () => {
    const sim = makeLobby();
    expect(startMatch(sim, [], { adjustSeconds: 15 })).toBe(true);

    expect(phaseOf(sim)).toBe("reveal");
    expect(sim.state.round.timer).toBe(15);
    const [alice, bob] = [sim.state.players[0]!, sim.state.players[1]!];
    expect(alice.revealedWeapon).toBe("blade");
    expect(bob.weapon).not.toBeNull(); // auto-filled at lock-in
    expect(WEAPON_IDS).toContain(bob.weapon!);
    expect(bob.revealedWeapon).toBe(bob.weapon);
    // The draft fills ability hands too (harmless until the match consumes them).
    expect(alice.abilities).toHaveLength(LOADOUT_ABILITY_COUNT);
    expect(bob.revealedAbilities).toEqual(bob.abilities);
  });

  test("repicking during the window works and never touches the reveal", () => {
    const sim = makeLobby();
    startMatch(sim, [], { adjustSeconds: 15 });

    expect(setPlayerWeapon(sim, 0, "bow")).toBe(true); // the bait pick
    expect(sim.state.players[0]!.weapon).toBe("bow");
    expect(sim.state.players[0]!.revealedWeapon).toBe("blade"); // the enemy still sees this
  });

  test("the window expiring starts the match with the CURRENT picks", () => {
    const sim = makeLobby();
    sim.state.round.wins = [2, 1]; // stale scoreboard from a previous match
    startMatch(sim, [], { adjustSeconds: 0.2 });
    setPlayerWeapon(sim, 0, "bow");

    run(sim, Math.ceil(0.2 / TICK_DT) + 2);
    expect(phaseOf(sim)).toBe("countdown");
    expect(sim.state.round.wins).toEqual([0, 0]); // fresh scoreboard at the exit
    expect(sim.state.round.roundNumber).toBe(1);
    expect(sim.state.players[0]!.weapon).toBe("bow"); // the repick is what fights
    expect(setPlayerWeapon(sim, 0, "staff")).toBe(false); // and now it's locked
  });

  test("everyone locked in ends the window early", () => {
    const sim = makeLobby();
    startMatch(sim, [], { adjustSeconds: 60 });

    expect(lockInPlayer(sim, 0)).toBe(true);
    run(sim, 1);
    expect(phaseOf(sim)).toBe("reveal"); // one lock doesn't end it

    expect(lockInPlayer(sim, 1)).toBe(true);
    run(sim, 1);
    expect(phaseOf(sim)).toBe("countdown"); // both locked → no waiting out the clock
  });

  test("locking in freezes your pick", () => {
    const sim = makeLobby();
    startMatch(sim, [], { adjustSeconds: 60 });

    lockInPlayer(sim, 0);
    expect(setPlayerWeapon(sim, 0, "hammer")).toBe(false); // a lock is a lock
    expect(sim.state.players[0]!.weapon).toBe("blade");
  });

  test("a disconnected player never blocks the early end", () => {
    const sim = makeLobby();
    startMatch(sim, [], { adjustSeconds: 60 });

    markDisconnected(sim, 1); // dropped mid-ceremony: body idles into the match
    lockInPlayer(sim, 0);
    run(sim, 1);
    expect(phaseOf(sim)).toBe("countdown");
  });

  test("locking in the lobby does nothing — only draft phases lock", () => {
    const sim = makeLobby();
    expect(lockInPlayer(sim, 0)).toBe(false);
  });

  test("no ceremony (the default) skips straight to countdown — practice/tests path", () => {
    const sim = makeLobby();
    expect(startMatch(sim, [])).toBe(true);
    expect(phaseOf(sim)).toBe("countdown");
    expect(sim.state.players[1]!.weapon).not.toBeNull(); // auto-fill still applies
  });

  test("roomState: live picks are team-visible only; reveal + locks are public", () => {
    const sim = makeLobby();

    // Lobby, pre-lock: the enemy sees ready/choosing flags, never the weapon.
    const [enemyView] = toRoomStatePlayers(sim.state, 2);
    expect(enemyView!.weapon).toBeNull();
    expect(enemyView!.picked).toBe(true);
    expect(enemyView!.revealed).toBeNull();
    expect(toRoomStatePlayers(sim.state, 1)[0]!.weapon).toBe("blade"); // own team sees it

    startMatch(sim, [], { adjustSeconds: 15 });
    setPlayerWeapon(sim, 0, "bow"); // hidden adjustment
    lockInPlayer(sim, 0);

    const aliceSeenByTeam2 = toRoomStatePlayers(sim.state, 2)[0]!;
    expect(aliceSeenByTeam2.weapon).toBeNull(); // the swap stays secret
    expect(aliceSeenByTeam2.revealed).toBe("blade"); // the lock-in pick is public
    expect(aliceSeenByTeam2.locked).toBe(true); // …and so is the lock check
    expect(toRoomStatePlayers(sim.state, 1)[0]!.weapon).toBe("bow"); // teammates see it live
    expect(toRoomStatePlayers(sim.state, 0)[0]!.weapon).toBeNull(); // watchers see neither team
  });

  test("snapshots scrub weapons until the match starts — one broadcast, no leak", () => {
    const sim = makeLobby();
    expect(toSnapshot(sim.state, []).players.every((p) => p.weapon === null)).toBe(true);

    startMatch(sim, [], { adjustSeconds: 0.1 });
    expect(toSnapshot(sim.state, []).players.every((p) => p.weapon === null)).toBe(true);

    run(sim, Math.ceil(0.1 / TICK_DT) + 2); // window expires → countdown
    expect(toSnapshot(sim.state, []).players[0]!.weapon).toBe("blade"); // public from here on
  });

  test("the return to lobby clears the stale reveal and locks", () => {
    const sim = makeLobby();
    startMatch(sim, [], { adjustSeconds: 60 });
    lockInPlayer(sim, 0);
    sim.state.round.phase = "matchEnd";
    sim.state.round.timer = TICK_DT / 2;

    run(sim, 2);
    expect(phaseOf(sim)).toBe("lobby");
    expect(sim.state.players[0]!.revealedWeapon).toBeNull();
    expect(sim.state.players[0]!.lockedIn).toBe(false);
    expect(sim.state.players[0]!.weapon).toBe("blade"); // picks themselves persist
  });
});

// The 4-beat draft (docs/design/pvp-abilities.md): a timed blind-pick phase in
// front of the reveal window, and ability loadouts riding both.
describe("timed pick phase + ability draft", () => {
  const HAND: AbilityId[] = ["dash", "harpoon", "sandstorm"];

  /** Lobby → the full draft: 30s blind pick, 20s counterpick. */
  const startDraft = (sim: ArenaSim) => startMatch(sim, [], { pickSeconds: 30, adjustSeconds: 20 });

  test("host start opens the blind pick, not the reveal", () => {
    const sim = makeLobby();
    expect(startDraft(sim)).toBe(true);
    expect(phaseOf(sim)).toBe("pick");
    expect(sim.state.round.timer).toBe(30);
    expect(sim.state.players[0]!.revealedWeapon).toBeNull(); // nothing revealed yet
  });

  test("ability picks: distinct known ids, capped at the hand size", () => {
    const sim = makeLobby();
    startDraft(sim);
    expect(setPlayerAbilities(sim, 0, HAND)).toBe(true);
    expect(sim.state.players[0]!.abilities).toEqual(HAND);
    expect(setPlayerAbilities(sim, 0, ["dash", "dash", "tremor"])).toBe(false); // dupes
    expect(setPlayerAbilities(sim, 0, ["dash", "blink" as AbilityId, "tremor"])).toBe(false); // unknown
    expect(setPlayerAbilities(sim, 0, ["dash", "harpoon", "tremor", "ironhide"])).toBe(false); // > hand
    expect(sim.state.players[0]!.abilities).toEqual(HAND); // rejects never mutate
  });

  test("lock-in needs a complete loadout; everyone locked ends the pick early", () => {
    const sim = makeLobby();
    startDraft(sim);
    expect(lockInPlayer(sim, 0)).toBe(false); // blade but no abilities yet
    setPlayerAbilities(sim, 0, HAND);
    expect(lockInPlayer(sim, 0)).toBe(true);

    setPlayerWeapon(sim, 1, "hammer");
    setPlayerAbilities(sim, 1, ["ironhide", "blood-font", "dash"]);
    expect(lockInPlayer(sim, 1)).toBe(true);

    run(sim, 1); // the machine notices all-locked on the next tick
    expect(phaseOf(sim)).toBe("reveal");
    expect(sim.state.round.timer).toBe(20);
    expect(sim.state.players[0]!.revealedAbilities).toEqual(HAND);
    expect(sim.state.players[0]!.lockedIn).toBe(false); // fresh locks for the counterpick
  });

  test("the pick clock expiring auto-fills weapon AND a full distinct hand", () => {
    const sim = makeLobby();
    startDraft(sim);
    sim.state.round.timer = TICK_DT / 2;

    run(sim, 2);
    expect(phaseOf(sim)).toBe("reveal");
    for (const p of [sim.state.players[0]!, sim.state.players[1]!]) {
      expect(p.weapon).not.toBeNull();
      expect(p.abilities).toHaveLength(LOADOUT_ABILITY_COUNT);
      expect(new Set(p.abilities).size).toBe(LOADOUT_ABILITY_COUNT);
      expect(p.abilities.every((a) => a in ABILITIES)).toBe(true);
      expect(p.revealedAbilities).toEqual(p.abilities);
    }
  });

  test("counterpick swaps stay hidden: live abilities are team secrets, the reveal is public", () => {
    const sim = makeLobby();
    startDraft(sim);
    setPlayerAbilities(sim, 0, HAND);
    sim.state.round.timer = TICK_DT / 2;
    run(sim, 2); // → reveal (counterpick window)

    const counter: AbilityId[] = ["dash", "mirror-guard", "sandstorm"];
    expect(setPlayerAbilities(sim, 0, counter)).toBe(true); // the hidden swap
    const seenByEnemy = toRoomStatePlayers(sim.state, 2)[0]!;
    expect(seenByEnemy.abilities).toBeNull(); // live hand stays secret
    expect(seenByEnemy.revealedAbilities).toEqual(HAND); // the phase-1 lock is what they saw
    expect(toRoomStatePlayers(sim.state, 1)[0]!.abilities).toEqual(counter); // teammates live
  });

  test("the return to lobby clears revealed abilities with the rest", () => {
    const sim = makeLobby();
    startDraft(sim);
    sim.state.round.timer = TICK_DT / 2;
    run(sim, 2);
    sim.state.round.phase = "matchEnd";
    sim.state.round.timer = TICK_DT / 2;

    run(sim, 2);
    expect(phaseOf(sim)).toBe("lobby");
    expect(sim.state.players[0]!.revealedAbilities).toBeNull();
    expect(sim.state.players[0]!.abilities.length).toBeGreaterThan(0); // the hand itself persists
  });
});
