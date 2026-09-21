/**
 * Exploit gauntlet (docs/design/bot-brains-v4.md): godlike bots vs scripted
 * "trickster" policies — tiny programs that do the one dumb-but-effective
 * thing a human who has figured the brain out would do. Headless and
 * deterministic; the whole table runs in seconds.
 *
 *   bun packages/blood-in-the-sand-sim/src/botGauntlet.ts [matchesPerSetup=12] [labelFilter]
 *   TIER=inhuman …   run the bots at another tier
 *   DET=1 …          also log the bot's state at every sandtrap detonation
 *
 * Tricksters read the world HUMAN_LAG ticks stale (a person's reaction
 * time), get no speed bonus, and mostly never press a button — if a script
 * this simple beats Godlike, a person certainly can. Every new weapon or
 * trick Tom finds earns a row here; bot.test.ts gates a slim subset.
 */
import {
  ARENAS,
  DIFFICULTIES,
  SnapshotHistory,
  TICK_DT,
  WEAPONS,
  addBot,
  botThink,
  createBotMemory,
  createBotNav,
  createSim,
  forceStartMatch,
  setPlayerAbilities,
  setPlayerWeapon,
  stepSim,
  toSnapshot,
  type AbilityId,
  type ArenaEvent,
  type BotMemory,
  type DifficultyId,
  type PlayerInput,
  type PlayerSnapshot,
  type SnapshotMsg,
  type WeaponId,
} from "./index";

type Mem = Record<string, number>;
type Out = { sx: number; sy: number; casts: boolean[] };
/** `snap` is the human-stale world; `me` is current (proprioception). */
export type Policy = (me: PlayerSnapshot, snap: SnapshotMsg, mem: Mem) => Out;

const unit = (x: number, y: number) => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};
const ready = (me: PlayerSnapshot, id: AbilityId) =>
  me.abilities.findIndex((s) => s.id === id && s.cd === 0 && s.charges > 0 && s.active === 0);
const press = (me: PlayerSnapshot, id: AbilityId | null): boolean[] =>
  me.abilities.map((_s, i) => id !== null && i === ready(me, id));
const foes = (me: PlayerSnapshot, snap: SnapshotMsg) => snap.players.filter((p) => p.team !== me.team && p.alive);
const nearestFoe = (me: PlayerSnapshot, snap: SnapshotMsg): PlayerSnapshot | undefined => {
  let best: PlayerSnapshot | undefined;
  for (const p of foes(me, snap)) {
    if (!best || Math.hypot(p.x - me.x, p.y - me.y) < Math.hypot(best.x - me.x, best.y - me.y)) best = p;
  }
  return best;
};
/** arena-00 is 1600×1600. */
const CENTRE = 800;
const IDLE = (me: PlayerSnapshot): Out => ({ sx: 0, sy: 0, casts: press(me, null) });

/** Walk straight at the nearest bot, never press anything. The dumbest human. */
const chaser: Policy = (me, snap) => {
  const foe = nearestFoe(me, snap);
  if (!foe) return IDLE(me);
  const d = unit(foe.x - me.x, foe.y - me.y);
  return { sx: d.x, sy: d.y, casts: press(me, null) };
};

/** Tom's trick #2: "the blade beats the hammer in a straight slog, so I just
 * dive in immediately and the bot takes the bait" — dash to close, Ironhide
 * through the first telegraph, then stand in its face and out-cycle it. */
const diver: Policy = (me, snap) => {
  const foe = nearestFoe(me, snap);
  if (!foe) return IDLE(me);
  const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
  const d = unit(foe.x - me.x, foe.y - me.y);
  let cast: AbilityId | null = null;
  if (dist > 130 && dist < 260) cast = "dash";
  else if (foe.atk === "windup" && dist < 170) cast = "ironhide";
  return { sx: d.x, sy: d.y, casts: press(me, cast) };
};

/** Tom's trick #3 (2026-09-21, after v4): "I can slowly back it into a
 * corner and then it has nowhere to go." Keep myself on the CENTRE side of
 * the bot and amble at it — its reach-edge back-pedal does the herding for
 * me — then, once it's boxed into a corner, dive like trick #2. */
const herder: Policy = (me, snap, mem) => {
  const foe = nearestFoe(me, snap);
  if (!foe) return IDLE(me);
  const edge = (v: number) => Math.min(v, CENTRE * 2 - v);
  const cornered = edge(foe.x) < 260 && edge(foe.y) < 260;
  if (cornered) mem.dive = 45; // commit for a beat even if it squirms out
  if ((mem.dive ?? 0) > 0) {
    mem.dive! -= 1;
    return diver(me, snap, mem);
  }
  const out = unit(foe.x - CENTRE, foe.y - CENTRE);
  // Stand ~130px centre-side of it and walk it outward, unhurried.
  const g = unit(foe.x - out.x * 130 - me.x + out.x * 60, foe.y - out.y * 130 - me.y + out.y * 60);
  return { sx: g.x * 0.55, sy: g.y * 0.55, casts: press(me, null) };
};

/** Tom's trick #1 (fang): go in, stab 3–4 times, disengage while the venom
 * works, then re-apply right before the clock runs out. */
const venomHitAndRun: Policy = (me, snap, mem) => {
  const foe = nearestFoe(me, snap);
  if (!foe) return IDLE(me);
  const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
  const to = unit(foe.x - me.x, foe.y - me.y);
  // In until stacked, out until the clock is nearly done, then back in.
  if (mem.out === 1 && (foe.poisonLeft < 1.4 || foe.poisonStacks === 0)) mem.out = 0;
  if (mem.out !== 1 && foe.poisonStacks >= 4 && foe.poisonLeft > 4) mem.out = 1;
  if (mem.out === 1) {
    const c = unit(CENTRE - me.x, CENTRE - me.y);
    const v = unit(-to.x + c.x * 0.4, -to.y + c.y * 0.4);
    return { sx: dist < 320 ? v.x : 0, sy: dist < 320 ? v.y : 0, casts: press(me, dist < 140 ? "dash" : null) };
  }
  return { sx: to.x, sy: to.y, casts: press(me, dist > 110 && dist < 230 ? "dash" : null) };
};

/** Hold just inside my own acquisition edge, back off when closed on, strafe. */
const kiter: Policy = (me, snap, mem) => {
  const foe = nearestFoe(me, snap);
  if (!foe) return IDLE(me);
  const want = WEAPONS[me.weapon!].engagementRadius * 0.85;
  const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
  const to = unit(foe.x - me.x, foe.y - me.y);
  mem.t = (mem.t ?? 0) + 1;
  if (mem.t % 90 === 0) mem.sign = -(mem.sign ?? 1);
  const sign = mem.sign ?? 1;
  let vx = -to.y * sign * 0.6;
  let vy = to.x * sign * 0.6;
  if (dist < want - 20) { vx -= to.x; vy -= to.y; }
  else if (dist > want + 20) { vx += to.x; vy += to.y; }
  // lean to the centre so we don't pin ourselves on the wall
  const c = unit(CENTRE - me.x, CENTRE - me.y);
  vx += c.x * 0.35; vy += c.y * 0.35;
  const d = unit(vx, vy);
  return { sx: d.x, sy: d.y, casts: press(me, dist < want * 0.5 ? "dash" : null) };
};

/** Plant a sandtrap, stand behind it (mine between me and the bot), wait. */
const trapCamper: Policy = (me, snap) => {
  const foe = nearestFoe(me, snap);
  if (!foe) return IDLE(me);
  const mine = snap.deployables.find((d) => d.kind === "sandtrap" && d.team === me.team);
  const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
  if (!mine) {
    const away = unit(me.x - foe.x, me.y - foe.y);
    return { sx: dist < 380 ? away.x : 0, sy: dist < 380 ? away.y : 0, casts: press(me, dist > 380 ? "sandtrap" : null) };
  }
  const axis = unit(mine.x - foe.x, mine.y - foe.y);
  const gx = mine.x + axis.x * 170;
  const gy = mine.y + axis.y * 170;
  const gd = Math.hypot(gx - me.x, gy - me.y);
  const g = unit(gx - me.x, gy - me.y);
  return { sx: gd > 15 ? g.x : 0, sy: gd > 15 ? g.y : 0, casts: press(me, null) };
};

/** 2v2: both humans call the SAME target (lowest seat id alive) and walk it
 * down together — the most basic teamwork there is. */
const focusPair: Policy = (me, snap) => {
  const mark = foes(me, snap).sort((a, b) => a.id - b.id)[0];
  if (!mark) return IDLE(me);
  const dist = Math.hypot(mark.x - me.x, mark.y - me.y);
  if (me.weapon !== null && WEAPONS[me.weapon].projectile) {
    // the shooter of the pair holds range on the called mark
    const want = WEAPONS[me.weapon].engagementRadius * 0.85;
    const to = unit(mark.x - me.x, mark.y - me.y);
    const s = dist < want - 20 ? -1 : dist > want + 20 ? 1 : 0;
    return { sx: to.x * s, sy: to.y * s, casts: press(me, null) };
  }
  const d = unit(mark.x - me.x, mark.y - me.y);
  return { sx: d.x, sy: d.y, casts: press(me, dist > 130 && dist < 260 ? "dash" : null) };
};

interface Seat {
  weapon: WeaponId;
  hand: AbilityId[];
  /** "bot" = the brain under test; "solo-bot" = the same brain at the same
   * tier with team focus OFF (the 2v2 A/B control); otherwise a trickster. */
  brain: "bot" | "solo-bot" | Policy;
}
interface Setup {
  label: string;
  bots: Seat[];
  foes: Seat[];
}
const bot = (weapon: WeaponId, ...hand: AbilityId[]): Seat => ({ weapon, hand, brain: "bot" });
const solo = (weapon: WeaponId, ...hand: AbilityId[]): Seat => ({ weapon, hand, brain: "solo-bot" });
const human = (brain: Policy, weapon: WeaponId, ...hand: AbilityId[]): Seat => ({ weapon, hand, brain });

const HUMAN_LAG = 7; // ticks (~230ms)
const TIER = (process.env.TIER ?? "godlike") as DifficultyId;

export const runMatch = (setup: Setup, seed: number, tier: DifficultyId = TIER) => {
  const size = Math.max(setup.bots.length, setup.foes.length);
  const sim = createSim(ARENAS["arena-00"]!, seed, size);
  const nav = createBotNav(sim.zone);
  const seats: { id: number; seat: Seat; mem: BotMemory; pol: Mem; isBot: boolean }[] = [];
  const seatAll = (list: Seat[], team: 1 | 2, isBot: boolean) => {
    for (const seat of list) {
      const p = addBot(sim, isBot ? "BOT" : "FOE", team)!;
      setPlayerWeapon(sim, p.id, seat.weapon);
      setPlayerAbilities(sim, p.id, seat.hand);
      if (isBot || seat.brain === "solo-bot") p.moveFactor = DIFFICULTIES[tier].speedFactor;
      seats.push({ id: p.id, seat, mem: createBotMemory(seed * 7 + p.id * 31 + 1), pol: {}, isBot });
    }
  };
  seatAll(setup.bots, 1, true);
  seatAll(setup.foes, 2, false);
  forceStartMatch(sim);

  const botIds = new Set(seats.filter((s) => s.isBot).map((s) => s.id));
  const history = new SnapshotHistory();
  const inputs = new Map<number, PlayerInput>();
  const stats = { botDmgTaken: 0, foeDmgTaken: 0, botDashes: 0, detonations: 0, ticks: 0, sameTargetTicks: 0, teamTicks: 0, corneredTicks: 0, activeTicks: 0 };
  let seq = 0;
  let winner = 0;
  let wins: number[] = [0, 0];

  for (let t = 0; t < 30 * 60 * 12; t++) {
    const events: ArenaEvent[] = stepSim(sim, inputs, TICK_DT);
    stats.ticks++;
    for (const e of events) {
      if (e.type === "hit") {
        if (botIds.has(e.targetId)) stats.botDmgTaken += e.damage;
        else stats.foeDmgTaken += e.damage;
      }
      if (e.type === "cast" && botIds.has(e.playerId) && e.ability === "dash") stats.botDashes++;
      if (e.type === "detonate") {
        stats.detonations++;
        if (process.env.DET) {
          const m = seats.find((s) => s.isBot)!.mem;
          console.log(`  detonate t=${(t / 30).toFixed(1)}s pressing=${m.pressTicks > 0} detourZone=${m.detourZoneId}`);
        }
      }
      if (e.type === "roundEnd") {
        wins = e.wins;
        if ((globalThis as { TRACE?: boolean }).TRACE) console.log(`ROUND END t=${(t / 30).toFixed(1)}s wins=${e.wins} standing=${JSON.stringify(e.standing)}`);
      }
      if (e.type === "matchEnd") winner = e.winnerTeam;
    }
    if (winner) break;
    const snap = toSnapshot(sim.state, events);
    history.push(snap);
    if (sim.state.round.phase !== "active") { inputs.clear(); continue; }
    seq++;
    // Cornered read: a living bot boxed within 220px of two arena edges.
    stats.activeTicks++;
    if (snap.players.some((p) => botIds.has(p.id) && p.alive && Math.min(p.x, CENTRE * 2 - p.x) < 220 && Math.min(p.y, CENTRE * 2 - p.y) < 220)) stats.corneredTicks++;
    // Coordination read (2v2+): are the living bots swinging at the same body?
    const liveBots = sim.state.players.filter((p) => p && botIds.has(p.id) && p.alive);
    if (liveBots.length >= 2 && foes(snap.players.find((p) => botIds.has(p.id))!, snap).length >= 2) {
      stats.teamTicks++;
      // The BRAIN's mark (memory.focusId), not the weapon's auto-target.
      const marks = seats.filter((x) => x.isBot && liveBots.some((p) => p!.id === x.id)).map((x) => x.mem.focusId);
      if (new Set(marks).size === 1) stats.sameTargetTicks++;
    }
    if ((globalThis as { TRACE?: boolean }).TRACE && t % 6 === 0 && t > 30 * Number(process.env.FROM ?? 0) && t < 30 * Number(process.env.TO ?? 40)) {
      const b = snap.players.find((p) => botIds.has(p.id))!;
      const f = snap.players.find((p) => !botIds.has(p.id))!;
      const m = seats.find((x) => x.isBot)!.mem;
      console.log(`${(t / 30).toFixed(1)}s d=${Math.hypot(b.x - f.x, b.y - f.y).toFixed(0)} botHp=${b.hp} foeHp=${f.hp} bot(${b.atk} slow=${b.slowLeft.toFixed(1)} dashCd=${b.abilities[0]?.cd.toFixed(1)}/${b.abilities[0]?.charges} band=${m.bandState}) foe(${f.atk} dashCd=${f.abilities[0]?.cd.toFixed(1)}/${f.abilities[0]?.charges}) botXY=${b.x.toFixed(0)},${b.y.toFixed(0)}`);
    }
    for (const s of seats) {
      const me = snap.players.find((p) => p.id === s.id);
      if (!me || !me.alive) { inputs.delete(s.id); continue; }
      if (s.seat.brain === "bot") {
        const world = history.stale(DIFFICULTIES[tier].reactionTicks) ?? snap;
        const d = botThink(s.mem, me, world, nav, { difficulty: tier });
        inputs.set(s.id, { seq, sx: d.sx, sy: d.sy, casts: d.casts });
      } else if (s.seat.brain === "solo-bot") {
        const world = history.stale(DIFFICULTIES[tier].reactionTicks) ?? snap;
        const d = botThink(s.mem, me, world, nav, { difficulty: tier, soloFocus: true });
        inputs.set(s.id, { seq, sx: d.sx, sy: d.sy, casts: d.casts });
      } else {
        const o = s.seat.brain(me, history.stale(HUMAN_LAG) ?? snap, s.pol);
        inputs.set(s.id, { seq, sx: o.sx, sy: o.sy, casts: o.casts });
      }
    }
  }
  return { winner: winner === 1 ? "bot" : winner === 2 ? "foe" : "none", wins, stats };
};

const DI: AbilityId[] = ["dash", "ironhide"];
export const SETUPS: Setup[] = [
  // ── Sanity: godlike vs the dumbest possible human ────────────────────────
  { label: "blade  vs CHASER blade", bots: [bot("blade", ...DI)], foes: [human(chaser, "blade", ...DI)] },
  { label: "blade  vs CHASER hammer", bots: [bot("blade", ...DI)], foes: [human(chaser, "hammer", ...DI)] },
  { label: "hammer vs CHASER hammer", bots: [bot("hammer", ...DI)], foes: [human(chaser, "hammer", ...DI)] },
  { label: "bow    vs CHASER blade", bots: [bot("bow", "dash", "mirror-guard")], foes: [human(chaser, "blade", ...DI)] },
  { label: "bow    vs CHASER hammer", bots: [bot("bow", "dash", "mirror-guard")], foes: [human(chaser, "hammer", ...DI)] },
  // ── Tom's tricks (2026-09-21) ────────────────────────────────────────────
  { label: "TOM hammer vs DIVER blade", bots: [bot("hammer", ...DI)], foes: [human(diver, "blade", ...DI)] },
  { label: "TOM hammer(jugg: ironhide/shout) vs DIVER blade", bots: [bot("hammer", "ironhide", "warding-shout")], foes: [human(diver, "blade", ...DI)] },
  { label: "TOM hammer vs HERDER blade (corner it, then dive)", bots: [bot("hammer", ...DI)], foes: [human(herder, "blade", ...DI)] },
  { label: "TOM hammer(jugg) vs HERDER blade", bots: [bot("hammer", "ironhide", "warding-shout")], foes: [human(herder, "blade", ...DI)] },
  { label: "TOM bow    vs HERDER blade", bots: [bot("bow", "dash", "mirror-guard")], foes: [human(herder, "blade", ...DI)] },
  { label: "TOM hammer vs VENOM hit-and-run fang", bots: [bot("hammer", ...DI)], foes: [human(venomHitAndRun, "fang", ...DI)] },
  { label: "TOM blade  vs VENOM hit-and-run fang", bots: [bot("blade", ...DI)], foes: [human(venomHitAndRun, "fang", ...DI)] },
  { label: "TOM bow    vs VENOM hit-and-run fang", bots: [bot("bow", "dash", "mirror-guard")], foes: [human(venomHitAndRun, "fang", ...DI)] },
  { label: "TOM staff  vs VENOM hit-and-run fang", bots: [bot("staff", "dash", "straw-man")], foes: [human(venomHitAndRun, "fang", ...DI)] },
  // ── New content the bots never draft but must FIGHT ──────────────────────
  { label: "blade  vs CHASER fang", bots: [bot("blade", ...DI)], foes: [human(chaser, "fang", ...DI)] },
  { label: "hammer vs CHASER fang", bots: [bot("hammer", ...DI)], foes: [human(chaser, "fang", ...DI)] },
  { label: "blade  vs KITER trident", bots: [bot("blade", ...DI)], foes: [human(kiter, "trident", ...DI)] },
  { label: "hammer vs KITER trident", bots: [bot("hammer", ...DI)], foes: [human(kiter, "trident", ...DI)] },
  { label: "blade  vs KITER bombard", bots: [bot("blade", ...DI)], foes: [human(kiter, "bombard", ...DI)] },
  { label: "bow    vs KITER bombard", bots: [bot("bow", "dash", "mirror-guard")], foes: [human(kiter, "bombard", ...DI)] },
  { label: "staff  vs KITER bombard", bots: [bot("staff", "dash", "straw-man")], foes: [human(kiter, "bombard", ...DI)] },
  { label: "blade  vs KITER scorpion", bots: [bot("blade", ...DI)], foes: [human(kiter, "scorpion", ...DI)] },
  { label: "blade  vs KITER bow", bots: [bot("blade", ...DI)], foes: [human(kiter, "bow", ...DI)] },
  { label: "hammer(no dash) vs KITER bow", bots: [bot("hammer", "ironhide", "warding-shout")], foes: [human(kiter, "bow", ...DI)] },
  // ── Ground tricks ────────────────────────────────────────────────────────
  { label: "blade  vs TRAP-CAMPER bow", bots: [bot("blade", ...DI)], foes: [human(trapCamper, "bow", "sandtrap", "dash")] },
  { label: "hammer vs TRAP-CAMPER staff", bots: [bot("hammer", ...DI)], foes: [human(trapCamper, "staff", "sandtrap", "dash")] },
  // ── 2v2: do they work together? ──────────────────────────────────────────
  { label: "2v2 blade+bow      vs FOCUS-PAIR blade+blade", bots: [bot("blade", ...DI), bot("bow", "dash", "mirror-guard")], foes: [human(focusPair, "blade", ...DI), human(focusPair, "blade", ...DI)] },
  { label: "2v2 hammer+staff   vs FOCUS-PAIR blade+bow", bots: [bot("hammer", ...DI), bot("staff", "dash", "blood-font")], foes: [human(focusPair, "blade", ...DI), human(focusPair, "bow", ...DI)] },
  { label: "2v2 blade+blade    vs FOCUS-PAIR hammer+fang", bots: [bot("blade", ...DI), bot("blade", "dash", "war-drums")], foes: [human(focusPair, "hammer", ...DI), human(focusPair, "fang", ...DI)] },
  { label: "2v2 bow+hammer(bodyguard) vs FOCUS-PAIR blade+blade", bots: [bot("bow", "dash", "mirror-guard"), bot("hammer", "warding-shout", "blood-font")], foes: [human(focusPair, "blade", ...DI), human(focusPair, "blade", ...DI)] },
  // A/B: the same brains, same tier, mirrored kits — team focus vs hunting alone.
  { label: "2v2 A/B TEAM vs SOLO blade+bow mirror", bots: [bot("blade", ...DI), bot("bow", "dash", "mirror-guard")], foes: [solo("blade", ...DI), solo("bow", "dash", "mirror-guard")] },
  { label: "2v2 A/B TEAM vs SOLO hammer+staff mirror", bots: [bot("hammer", ...DI), bot("staff", "dash", "straw-man")], foes: [solo("hammer", ...DI), solo("staff", "dash", "straw-man")] },
  { label: "2v2 A/B TEAM vs SOLO blade+blade mirror", bots: [bot("blade", ...DI), bot("blade", ...DI)], foes: [solo("blade", ...DI), solo("blade", ...DI)] },
];

if (import.meta.main) {
  const N = Number(process.argv[2] ?? 12);
  const only = process.argv[3];
  let lost = 0;
  for (const s of SETUPS) {
    if (only && !s.label.includes(only)) continue;
    let botW = 0, foeW = 0, none = 0, rB = 0, rF = 0;
    const agg = { botDmgTaken: 0, foeDmgTaken: 0, botDashes: 0, detonations: 0, ticks: 0, sameTargetTicks: 0, teamTicks: 0, corneredTicks: 0, activeTicks: 0 };
    for (let i = 0; i < N; i++) {
      const r = runMatch(s, 1000 + i * 17);
      if (r.winner === "bot") botW++; else if (r.winner === "foe") foeW++; else none++;
      rB += r.wins[0] ?? 0;
      rF += r.wins[1] ?? 0;
      for (const k of Object.keys(agg) as (keyof typeof agg)[]) agg[k] += r.stats[k];
    }
    // A/B rows are brain-vs-brain mirrors (50% is the null) — not tricksters.
    if (!s.foes.some((f) => f.brain === "solo-bot")) lost += foeW;
    const coord = agg.teamTicks ? ` | same-target ${((agg.sameTargetTicks / agg.teamTicks) * 100).toFixed(0)}%` : "";
    const flag = foeW > botW ? "✗" : foeW > 0 ? "~" : "✓";
    console.log(
      `${flag} ${s.label.padEnd(54)} | matches ${botW}-${foeW}${none ? ` (+${none} unfinished)` : ""} | rounds ${rB}-${rF} | dmg took ${agg.botDmgTaken} / dealt ${agg.foeDmgTaken} | dashes ${agg.botDashes} | mines ${agg.detonations} | ${(agg.ticks / 30 / N).toFixed(0)}s | cornered ${((agg.corneredTicks / Math.max(1, agg.activeTicks)) * 100).toFixed(0)}%${coord}`,
    );
  }
  console.log(`\n${TIER}: ${lost} matches lost to tricksters`);
}
