/**
 * The Oracle (bits-challenges.md § autopilot, Tom 2026-09-26: "a level of
 * skill above Godlike using this simulation logic") — a brain that CHEATS
 * honestly. The sim is pure and deterministic, and an offline host owns
 * every opponent's brain, so instead of guessing what a move leads to it
 * clones the match, plays each candidate move forward for a second or so
 * against the real opponents thinking their real thoughts, scores where
 * that lands, and plays the best one. Godlike is perfect execution of a
 * duelist's heuristics; the Oracle is foresight. It is never a difficulty
 * tier — no player faces it — only the dev autopilot and the gauntlet run
 * it, to prove and record clears no thumb can land.
 *
 * Shape: every `replanEvery` ticks, candidates = the shared brain's own
 * Godlike choice, standing still, and the compass directions (with and
 * without pressing every ready ability); each is held constant through a
 * rollout of `horizon` ticks on a cloned sim (opponents driven by cloned
 * memories at their own tiers, reacting to the live world — no staleness,
 * so the model is a touch pessimistic). Score = a terminal (won/lost, the
 * sooner the better/worse) or a shaped position read: my health, kills
 * landed, foes' health, room to move, not flanked. Cost is the knob:
 * candidates × horizon × (1 + foes) brain-thinks per replan.
 */
import { botThink, createBotMemory, type BotMemory, type BotPins } from "./bot";
import type { BotNav } from "./nav";
import { DIFFICULTIES, type DifficultyId } from "./botDifficulty";
import { TICK_DT, WEAPONS } from "./config";
import type { ArenaEvent } from "./events";
import { toSnapshot } from "./snapshot";
import { cloneSim, clonePlain, type ArenaSim } from "./sim";
import type { PlayerInput } from "./state";
import { stepSim } from "./step";

export interface OracleFoe {
  id: number;
  memory: BotMemory;
  difficulty: DifficultyId;
  /** The seat's pinned brain dials (a challenge's archetype, mark, relentless). */
  pins?: BotPins;
}

export interface OracleOptions {
  /** Rollout length, ticks (30 = 1s). */
  horizon: number;
  /** Ticks between replans; the chosen move is held in between. */
  replanEvery: number;
  /** Compass directions to try (8 or 16). */
  directions: number;
  /** In rollouts, foes re-think every N ticks (1 = every tick, exact;
   * higher = cheaper, slightly staler foes). */
  foeThinkEvery: number;
  /** Score per killing blow inside the horizon. 400 duels well; a kill-
   * count recipe (the horde) wants far more, else foresight kites forever. */
  killWeight?: number;
}

/** Headless defaults — the gauntlet's budget. The phone uses OracleLite. */
export const ORACLE_FULL: OracleOptions = { horizon: 30, replanEvery: 5, directions: 8, foeThinkEvery: 1 };
/** A phone budget: ~a fifth of the thinking per real tick. */
export const ORACLE_LITE: OracleOptions = { horizon: 24, replanEvery: 10, directions: 8, foeThinkEvery: 2 };

interface Plan {
  sx: number;
  sy: number;
  castAll: boolean;
  /** Ticks left to hold it. */
  left: number;
}

/** Everything ready → press it (harmless on cooldown; the sim ignores it). */
const pressAll = (n: number, on: boolean): boolean[] => Array.from({ length: n }, () => on);

export interface Oracle {
  /** Decide this tick's input for `myId`. `sim` is the LIVE match (never
   * mutated here); `foes` are the live brains (cloned per rollout). */
  think(sim: ArenaSim, myId: number, foes: readonly OracleFoe[], nav: BotNav): PlayerInput;
  /** Diagnostics: rollouts run and sim ticks simulated so far. */
  readonly stats: { rollouts: number; ticks: number; replans: number };
}

export const createOracle = (opts: OracleOptions = ORACLE_FULL, seed = 0x0c1e): Oracle => {
  const myMemory = createBotMemory(seed);
  let plan: Plan | null = null;
  let seq = 0;
  const stats = { rollouts: 0, ticks: 0, replans: 0 };

  const score = (sim: ArenaSim, myId: number, kills: number, elapsed: number): number => {
    const { state } = sim;
    const me = state.players[myId];
    if (!me) return -1e6;
    const phase = state.round.phase;
    if (phase !== "active") {
      // The round closed inside the horizon: did we take it?
      const won = state.round.lastWinner === me.team;
      return won ? 1e5 - elapsed * 10 : -1e5 + elapsed * 10;
    }
    if (!me.alive) return -1e5 + elapsed * 10; // dying later beats dying now
    let s = (me.combatant.hp / me.combatant.stats.maxHp) * 1000 + kills * (opts.killWeight ?? 400);
    let foeHp = 0;
    let near = 0;
    let nearest = Infinity;
    const foes: { x: number; y: number }[] = [];
    for (const p of state.players) {
      if (!p || p.team === me.team || !p.alive) continue;
      foeHp += p.combatant.hp / p.combatant.stats.maxHp;
      const d = Math.hypot(p.mover.pos.x - me.mover.pos.x, p.mover.pos.y - me.mover.pos.y);
      if (d < nearest) nearest = d;
      if (d < 200) near += 1;
      foes.push(p.mover.pos);
    }
    s -= foeHp * 150;
    // Flanked: more than one body inside swinging range is how outnumbered
    // fights are lost — one at a time is the whole art.
    if (near > 1) s -= (near - 1) * 120;
    // Ranged kits want the gap; melee wants contact with exactly one.
    const ranged = me.weapon !== null && WEAPONS[me.weapon].projectile;
    if (ranged && Number.isFinite(nearest)) s += Math.min(nearest, 320) * 0.6;
    // Room: the arena edge and corners are where kiting dies.
    const { x, y } = me.mover.pos;
    const edge = Math.min(x, y, sim.zone.size.x - x, sim.zone.size.y - y);
    if (edge < 140) s -= (140 - edge) * 1.5;
    return s;
  };

  const rollout = (
    live: ArenaSim,
    myId: number,
    foes: readonly OracleFoe[],
    nav: BotNav,
    sx: number,
    sy: number,
    castAll: boolean,
  ): number => {
    const sim = cloneSim(live);
    const mems = foes.map((f) => ({ ...f, memory: clonePlain(f.memory) }));
    const inputs = new Map<number, PlayerInput>();
    const last = new Map<number, PlayerInput>();
    let kills = 0;
    stats.rollouts += 1;
    for (let h = 0; h < opts.horizon; h++) {
      const me = sim.state.players[myId];
      if (!me) break;
      inputs.clear();
      inputs.set(myId, { seq: 0, sx, sy, casts: pressAll(me.slots.length, castAll) });
      if (h % opts.foeThinkEvery === 0) {
        const snap = toSnapshot(sim.state, []);
        for (const f of mems) {
          const body = snap.players.find((p) => p.id === f.id);
          if (!body || !body.alive) continue;
          const tier = DIFFICULTIES[f.difficulty];
          const b = sim.state.players[f.id];
          if (b) b.moveFactor = tier.speedFactor;
          const d = botThink(f.memory, body, snap, nav, {
            difficulty: f.difficulty,
            ...f.pins,
          });
          last.set(f.id, { seq: 0, sx: d.sx, sy: d.sy, casts: d.casts });
        }
      }
      for (const [id, inp] of last) inputs.set(id, inp);
      const events: ArenaEvent[] = stepSim(sim, inputs, TICK_DT);
      stats.ticks += 1;
      for (const e of events) if (e.type === "hit" && e.lethal && e.attackerId === myId) kills += 1;
      if (sim.state.round.phase !== "active" || !sim.state.players[myId]?.alive) {
        return score(sim, myId, kills, h + 1);
      }
    }
    return score(sim, myId, kills, opts.horizon);
  };

  return {
    stats,
    think(sim, myId, foes, nav) {
      const me = sim.state.players[myId];
      if (!me || !me.alive || sim.state.round.phase !== "active") {
        plan = null;
        return { seq: seq++, sx: 0, sy: 0, casts: [] };
      }
      if (plan && plan.left > 0) {
        plan.left -= 1;
        return { seq: seq++, sx: plan.sx, sy: plan.sy, casts: pressAll(me.slots.length, plan.castAll) };
      }
      stats.replans += 1;
      // Candidates: the duelist's own choice first (a strong prior), then
      // the compass with and without casting, then standing still.
      const snap = toSnapshot(sim.state, []);
      const mine = snap.players.find((p) => p.id === myId);
      const prior = botThink(clonePlain(myMemory), mine, snap, nav, { difficulty: "godlike" });
      const priorCasts = prior.casts.some(Boolean);
      const cands: { sx: number; sy: number; castAll: boolean }[] = [
        { sx: prior.sx, sy: prior.sy, castAll: priorCasts },
        { sx: prior.sx, sy: prior.sy, castAll: !priorCasts },
        { sx: 0, sy: 0, castAll: false },
      ];
      for (let i = 0; i < opts.directions; i++) {
        const a = (i / opts.directions) * Math.PI * 2;
        cands.push({ sx: Math.cos(a), sy: Math.sin(a), castAll: true });
        cands.push({ sx: Math.cos(a), sy: Math.sin(a), castAll: false });
      }
      let best = cands[0]!;
      let bestScore = -Infinity;
      for (const c of cands) {
        const s = rollout(sim, myId, foes, nav, c.sx, c.sy, c.castAll);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      // Keep the duelist's memory walking so its prior stays sane.
      botThink(myMemory, mine, snap, nav, { difficulty: "godlike" });
      plan = { ...best, left: opts.replanEvery - 1 };
      return { seq: seq++, sx: best.sx, sy: best.sy, casts: pressAll(me.slots.length, best.castAll) };
    },
  };
};
