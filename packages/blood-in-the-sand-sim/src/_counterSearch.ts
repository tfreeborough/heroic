// Scratch (Godlike counter-pick, 2026-09-27): every player kit × every
// candidate bot kit on the Godlike recipe, godlike autopilot vs the godlike
// bot. Prints one JSON line per matchup: the PLAYER's clear rate.
//   SHARD=0 SHARDS=8 SEEDS=3 bun src/_counterSearch.ts > out.jsonl
import { ARENAS, ARENA_ROTATION, CHALLENGES, DIFFICULTIES, FREE_ABILITY_IDS, FREE_WEAPON_IDS, SnapshotHistory, TICK_DT, WEAPON_IDS, botThink, createBotMemory, createBotNav, createChallengeJudge, createSim, challengeTeamSize, seatChallenge, setPlayerAbilities, setPlayerWeapon, stepSim, toSnapshot, type AbilityId, type PlayerInput, type WeaponId } from "./index";

const def = CHALLENGES.find((c) => c.id === "godlike")!;
const SEEDS = Number(process.env.SEEDS ?? 3);
const SHARD = Number(process.env.SHARD ?? 0);
const SHARDS = Number(process.env.SHARDS ?? 1);
const PLAYER_WEAPONS = (process.env.PW?.split(",") ?? WEAPON_IDS) as WeaponId[];
const PLAYER_HANDS: AbilityId[][] = process.env.PH
  ? process.env.PH.split(";").map((h) => h.split(",") as AbilityId[])
  : [["dash", "ironhide"], ["dash", "mirror-guard"], ["dash", "sandstorm"], ["dash", "harpoon"], ["ironhide", "warding-shout"], ["dash", "blood-font"]];
const BOT_WEAPONS = (process.env.BW?.split(",") ?? FREE_WEAPON_IDS) as WeaponId[];
const BOT_HANDS: AbilityId[][] = process.env.BH
  ? process.env.BH.split(";").map((h) => h.split(",") as AbilityId[])
  : FREE_ABILITY_IDS.filter((a) => a !== "dash").map((a) => ["dash", a]);

const duel = (pw: WeaponId, ph: AbilityId[], bw: WeaponId, bh: AbilityId[], arena: string, seed: number): boolean => {
  const sim = createSim(ARENAS[arena]!, seed, challengeTeamSize(def), false, true);
  let r = seed;
  const rng = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const seated = seatChallenge(sim, def, "ME", rng, ["a"]);
  setPlayerWeapon(sim, 0, pw);
  setPlayerAbilities(sim, 0, ph);
  const bot = seated.bots[0]!.player;
  setPlayerWeapon(sim, bot.id, bw);
  setPlayerAbilities(sim, bot.id, bh);
  const nav = createBotNav(sim.zone);
  const judge = createChallengeJudge(def, seated.protectIds);
  const mems = new Map([[0, createBotMemory(seed * 3 + 1)], [bot.id, createBotMemory(seed * 7 + bot.id * 31)]]);
  const hist = new SnapshotHistory();
  const inputs = new Map<number, PlayerInput>();
  const tier = DIFFICULTIES.godlike;
  let seq = 0;
  for (let t = 0; t < 30 * 60 * 3; t++) {
    const ev = stepSim(sim, inputs, TICK_DT);
    const v = judge.tick(sim, ev);
    if (v) return v.cleared;
    const snap = toSnapshot(sim.state, ev);
    hist.push(snap);
    if (sim.state.round.phase !== "active") {
      inputs.clear();
      continue;
    }
    seq++;
    for (const [id, mem] of mems) {
      const me = snap.players.find((p) => p.id === id);
      if (!me || !me.alive) continue;
      sim.state.players[id]!.moveFactor = tier.speedFactor;
      const d = botThink(mem, me, hist.stale(tier.reactionTicks) ?? snap, nav, { difficulty: "godlike" });
      inputs.set(id, { seq, sx: d.sx, sy: d.sy, casts: d.casts });
    }
  }
  return false;
};

let i = 0;
for (const pw of PLAYER_WEAPONS)
  for (const ph of PLAYER_HANDS)
    for (const bw of BOT_WEAPONS)
      for (const bh of BOT_HANDS) {
        if (i++ % SHARDS !== SHARD) continue;
        let wins = 0;
        let n = 0;
        for (const arena of ARENA_ROTATION) for (let s = 1; s <= SEEDS; s++, n++) if (duel(pw, ph, bw, bh, arena, s * 1013 + n)) wins++;
        console.log(JSON.stringify({ pw, ph: ph.join("+"), bw, bh: bh.join("+"), rate: wins / n, n }));
      }
