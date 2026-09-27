import { ARENAS, ARENA_ROTATION, CHALLENGES, DIFFICULTIES, SnapshotHistory, TICK_DT, botThink, createBotMemory, createBotNav, createChallengeJudge, createSim, challengeTeamSize, seatChallenge, setPlayerAbilities, setPlayerWeapon, stepSim, toSnapshot, type PlayerInput, type ChallengeDef, type ChallengeSeat } from "./index";
const base = CHALLENGES.find((c) => c.id === "the-titan")!;
const titan = base.seats[0]!; const medic = base.seats[1]!;
const plainHammer: ChallengeSeat = { team: 2, difficulty: "skilled", weapon: "hammer", abilities: [], exactHand: true };
const t = (difficulty: ChallengeSeat["difficulty"]): ChallengeSeat => ({ ...titan, difficulty });
const m = (extra: Partial<ChallengeSeat>): ChallengeSeat => ({ ...medic, ...extra });
const noDash = m({ abilities: [] });
const glass = m({ maxHp: 0.5 });
const glassNoDash = m({ abilities: [], maxHp: 0.5 });
const h = (scale: number, hp = 0.3): ChallengeSeat[] => [titan, ...[1, 2, 3].map(() => ({ ...medic, healScale: scale, maxHp: hp }))];
const variants: Record<string, ChallengeSeat[]> = {
  "heal x0.5, healers 30hp": h(0.5),
  "heal x0.35, healers 30hp": h(0.35),
  "heal x0.25, healers 30hp": h(0.25),
  "heal x0.5, healers 100hp": h(0.5, 1),
  "heal x0 (sanity: no healing)": h(0),
};
const kits = [["blade", ["dash", "ironhide"]], ["bow", ["dash", "mirror-guard"]], ["staff", ["dash", "sandstorm"]]] as const;
const SEEDS = Number(process.env.SEEDS ?? 6);
for (const [label, seats] of Object.entries(variants)) {
  const def: ChallengeDef = { ...base, seats };
  let wins = 0, n = 0, kills = 0;
  for (const [w, hand] of kits) for (const arena of ARENA_ROTATION) for (let seed = 1; seed <= SEEDS; seed++) {
    const sim = createSim(ARENAS[arena]!, seed, challengeTeamSize(def), false, true);
    let r = seed; const rng = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    const seated = seatChallenge(sim, def, "ME", rng, ["a", "b", "c", "d"]);
    setPlayerWeapon(sim, 0, w); setPlayerAbilities(sim, 0, [...hand]);
    const nav = createBotNav(sim.zone); const judge = createChallengeJudge(def, seated.protectIds);
    const mems = new Map<number, ReturnType<typeof createBotMemory>>();
    for (const p of sim.state.players) if (p) mems.set(p.id, createBotMemory(seed * 31 + p.id * 7));
    const hist = new SnapshotHistory(); const inputs = new Map<number, PlayerInput>();
    let seq = 0; let verdict = null;
    for (let t = 0; t < 30 * 60 * 4 && !verdict; t++) {
      const ev = stepSim(sim, inputs, TICK_DT); verdict = judge.tick(sim, ev);
      const snap = toSnapshot(sim.state, ev); hist.push(snap);
      if (sim.state.round.phase !== "active") { inputs.clear(); continue; }
      seq++;
      for (const [id, mem] of mems) {
        const me = snap.players.find((p) => p.id === id); if (!me || !me.alive) { inputs.delete(id); continue; }
        const tierId = id === 0 ? "godlike" : "skilled";
        sim.state.players[id]!.moveFactor = DIFFICULTIES[tierId].speedFactor;
        let world = hist.stale(DIFFICULTIES[tierId].reactionTicks) ?? snap;
        // HUNT=1: my brain can't see the titan while a healer lives — the "kill the medics first" plan.
        if (id === 0 && process.env.HUNT && world.players.some((p) => p.team === 2 && p.alive && p.weapon === "lifeline")) {
          world = { ...world, players: world.players.filter((p) => !(p.team === 2 && p.weapon === "hammer")) };
        }
        const d = botThink(mem, me, world, nav, { difficulty: tierId });
        inputs.set(id, { seq, sx: d.sx, sy: d.sy, casts: d.casts });
      }
    }
    n++; if (verdict?.cleared) wins++; kills += verdict?.kills ?? judge.kills;
  }
  console.log(`${label.padEnd(28)} clear ${Math.round((100 * wins) / n)}% (${wins}/${n})  mean kills ${(kills / n).toFixed(1)}`);
}
