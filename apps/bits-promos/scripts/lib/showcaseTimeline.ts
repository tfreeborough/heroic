/**
 * Shoot a showcase script HEADLESSLY and return its beat sheet: every cast,
 * shot, hit and death stamped in seconds since FIGHT. The sim is pure
 * TypeScript and a showcase seeds a fixed RNG, so this is the exact fight
 * the simulator records — which makes it both a tuning tool (dry-run.ts)
 * and the SOUND cue sheet for the silent screen recording (the template
 * lays the game's own SFX at these times).
 */
import {
  ARENA_00,
  TICK_DT,
  addPlayer,
  createSim,
  forceStartMatch,
  setPlayerAbilities,
  setPlayerWeapon,
  stepSim,
  toSnapshot,
  type AbilityId,
  type PlayerInput,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";
import { abilityScript, weaponScript } from "../../../blood-in-the-sand/src/net/showcaseScripts";

export type Cue =
  | { t: number; kind: "cast"; seat: number; ability: AbilityId }
  | { t: number; kind: "fire"; seat: number; weapon: WeaponId }
  | { t: number; kind: "hit"; seat: number; weapon: WeaponId; amount: number }
  | { t: number; kind: "death"; seat: number; byStar: boolean }
  | { t: number; kind: "roundEnd"; starWon: boolean };

export interface Timeline {
  kind: "weapon" | "ability";
  id: string;
  seats: { seat: number; team: number; weapon: WeaponId; abilities: AbilityId[]; hp: number }[];
  cues: Cue[];
  /** Seconds from FIGHT to the round resolving (or `seconds` if it didn't). */
  end: number;
  /** Position log every half second — for the dry-run's eyeballing. */
  trace: { t: number; pos: { seat: number; x: number; y: number }[]; shots: number }[];
}

/** Damage-over-time ticks (bleed 3, poison stacks) aren't "hits" to the ear. */
const DOT_MAX = 5;

export const simulateShowcase = (kind: "weapon" | "ability", id: string, seconds = 12): Timeline => {
  const script = kind === "weapon" ? weaponScript(id as WeaponId) : abilityScript(id as AbilityId);
  const sim = createSim(ARENA_00, 7, script.teamSize, false, true);
  const NAMES = ["Crixus", "Barca", "Ashur", "Varro"];
  const star = addPlayer(sim, "GLADIATOR", script.seats[0]!.team)!;
  setPlayerWeapon(sim, star.id, script.seats[0]!.weapon);
  setPlayerAbilities(sim, star.id, script.seats[0]!.abilities);
  for (let i = 1; i < script.seats.length; i++) {
    const p = addPlayer(sim, NAMES[(i - 1) % NAMES.length]!, script.seats[i]!.team)!;
    setPlayerWeapon(sim, p.id, script.seats[i]!.weapon);
    setPlayerAbilities(sim, p.id, script.seats[i]!.abilities);
  }
  // The lobby (practice.ts): force-start a partial room, clamp the ceremony.
  if (sim.state.players.filter((p) => p !== null).length < sim.state.players.length) forceStartMatch(sim);
  const idle = new Map<number, PlayerInput>();
  let guard = 0;
  while (sim.state.round.phase === "lobby" && guard++ < 600) {
    if (sim.state.round.timer > 1) sim.state.round.timer = 1;
    stepSim(sim, idle, TICK_DT);
  }
  // Stage (practice.ts stage()): the script's placements on the countdown.
  for (let sid = 0; sid < script.seats.length; sid++) {
    const p = sim.state.players[sid];
    if (!p) continue;
    const at = script.place(sid);
    p.mover.pos.x = at.x;
    p.mover.pos.y = at.y;
    p.mover.vel.x = 0;
    p.mover.vel.y = 0;
    if (at.facing !== undefined) p.facing = at.facing;
    else if (sid !== 0) p.facing = Math.atan2(star.mover.pos.y - at.y, star.mover.pos.x - at.x);
    p.lockedFacing = p.facing;
    if (at.hp !== undefined) p.combatant.hp = at.hp;
    p.moveFactor = at.moveFactor ?? 1;
  }
  while (sim.state.round.phase === "countdown" && guard++ < 1200) stepSim(sim, idle, TICK_DT);

  const seats = script.seats.map((s, i) => ({
    seat: i,
    team: s.team,
    weapon: s.weapon,
    abilities: s.abilities,
    hp: sim.state.players[i]?.combatant.hp ?? 0,
  }));
  const starTeam = script.seats[0]!.team;
  const weaponOf = (seat: number): WeaponId => script.seats[seat]?.weapon ?? "blade";

  let snap = toSnapshot(sim.state, []);
  const lastHp = new Map(snap.players.map((p) => [p.id, p.hp]));
  const seenShots = new Set(snap.projectiles.map((s) => s.id));
  const cues: Cue[] = [];
  const trace: Timeline["trace"] = [];
  const seq = new Map<number, number>();
  let t = 0;
  let tick = 0;
  while (t < seconds && sim.state.round.phase === "active") {
    const inputs = new Map<number, PlayerInput>();
    for (let sid = 0; sid < script.seats.length; sid++) {
      const me = snap.players.find((p) => p.id === sid);
      if (!me) continue;
      const line = script.input(sid, { t, me, players: snap.players, projectiles: snap.projectiles });
      const s = (seq.get(sid) ?? 0) + 1;
      seq.set(sid, s);
      const casts = line?.casts ?? [];
      const slot = casts.findIndex(Boolean);
      if (slot >= 0) {
        const ability = me.abilities[slot]?.id;
        if (ability) cues.push({ t, kind: "cast", seat: sid, ability });
      }
      inputs.set(sid, { seq: s, sx: line?.sx ?? 0, sy: line?.sy ?? 0, casts });
    }
    const events = stepSim(sim, inputs, TICK_DT);
    snap = toSnapshot(sim.state, events);
    t += TICK_DT;
    tick += 1;
    for (const shot of snap.projectiles) {
      if (seenShots.has(shot.id)) continue;
      seenShots.add(shot.id);
      // Attribution: the nearest player holding that weapon kind.
      let owner = 0;
      let best = Infinity;
      for (const p of snap.players) {
        if (p.weapon !== shot.kind) continue;
        const d = Math.hypot(p.x - shot.x, p.y - shot.y);
        if (d < best) {
          best = d;
          owner = p.id;
        }
      }
      cues.push({ t, kind: "fire", seat: owner, weapon: shot.kind });
    }
    for (const p of snap.players) {
      const prev = lastHp.get(p.id) ?? p.hp;
      if (p.hp < prev) {
        const amount = prev - p.hp;
        // The hitter: the nearest living enemy's weapon (a projectile's hit
        // sound is its weapon's too — hit_bow, hit_staff).
        let hitter = -1;
        let best = Infinity;
        for (const q of snap.players) {
          if (q.team === p.team) continue;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < best) {
            best = d;
            hitter = q.id;
          }
        }
        if (amount > DOT_MAX || !p.alive) {
          cues.push({ t, kind: "hit", seat: p.id, weapon: weaponOf(hitter), amount });
        }
        if (!p.alive) cues.push({ t, kind: "death", seat: p.id, byStar: p.team !== starTeam });
      }
      lastHp.set(p.id, p.hp);
    }
    if (tick % 15 === 0) {
      trace.push({ t, pos: snap.players.map((p) => ({ seat: p.id, x: p.x | 0, y: p.y | 0 })), shots: snap.projectiles.length });
    }
  }
  const starAlive = snap.players.find((p) => p.id === 0)?.alive ?? false;
  const ended = sim.state.round.phase !== "active";
  if (ended) cues.push({ t, kind: "roundEnd", starWon: starAlive });
  return { kind, id, seats, cues, end: t, trace };
};
