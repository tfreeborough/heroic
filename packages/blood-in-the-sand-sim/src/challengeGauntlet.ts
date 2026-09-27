/**
 * The challenge gauntlet (bits-challenges.md, Tom 2026-09-26: "some of these
 * are so hard I don't even know how to beat them" — run simulations to see
 * if they're even possible): every recipe, headless, seated EXACTLY as the
 * phone seats it (seatChallenge), judged by the same judge, with the shared
 * bot brain on YOUR seat at a chosen tier — the autopilot the dev menu
 * offers. Own-kit recipes try a few candidate kits. Prints clear rates.
 *
 *   bun run challenges:sim                 # godlike autopilot, 12 seeds
 *   TIER=masterful SEEDS=30 bun run challenges:sim
 *   ONLY=the-horde bun run challenges:sim
 *   COOLDOWN=0 ONLY=five-on-one bun run challenges:sim   # what-if: your cooldown scale overridden
 *   FOE_TIER=average ONLY=five-on-one bun run challenges:sim   # what-if: every enemy seat at this tier
 */
import { createRng } from "@heroic/core";
import {
  ARENAS,
  ARENA_ROTATION,
  CHALLENGES,
  DIFFICULTIES,
  SnapshotHistory,
  TICK_DT,
  armCounterPicks,
  botThink,
  createBotMemory,
  createBotNav,
  createChallengeJudge,
  createOracle,
  createSim,
  ORACLE_FULL,
  ORACLE_LITE,
  challengeTeamSize,
  seatChallenge,
  setPlayerAbilities,
  setPlayerMaxHpScale,
  setPlayerWeapon,
  stepSim,
  toSnapshot,
  type AbilityId,
  type ChallengeDef,
  type DifficultyId,
  type PlayerInput,
  type WeaponId,
} from "./index";

/** A bot tier, or "oracle" / "oracle-lite" — the planner (oracle.ts). */
const TIER_ENV = process.env.TIER ?? "godlike";
const ORACLE = TIER_ENV === "oracle" ? ORACLE_FULL : TIER_ENV === "oracle-lite" ? ORACLE_LITE : null;
const TIER = (ORACLE ? "godlike" : TIER_ENV) as DifficultyId;
const SEEDS = Number(process.env.SEEDS ?? 12);
const ONLY = process.env.ONLY ?? null;
const MAX_MINUTES = 6;
/** What-if: every ENEMY seat plays this tier instead of the recipe's (allies keep theirs). */
const FOE_TIER = (process.env.FOE_TIER ?? null) as DifficultyId | null;
/** What-if: every enemy seat holds this hand (comma-separated ability ids) — a nerf by kit. */
const FOE_HAND = process.env.FOE_HAND ? (process.env.FOE_HAND.split(",") as AbilityId[]) : null;
/** What-if: every enemy seat holds this weapon. */
const FOE_WEAPON = (process.env.FOE_WEAPON ?? null) as WeaponId | null;
/** What-if: only the first N enemy seats ever arrive (the rest wait forever). */
const FOE_MAX = process.env.FOE_MAX !== undefined ? Number(process.env.FOE_MAX) : null;
/** What-if: every enemy seat starts (and respawns) at this hp fraction — fodder. */
const FOE_HP = process.env.FOE_HP !== undefined ? Number(process.env.FOE_HP) : null;
/** What-if: enemy seat i arrives i × STAGGER seconds after the bell (the stream). */
const STAGGER = process.env.STAGGER !== undefined ? Number(process.env.STAGGER) : null;
/** What-if: respawning seats stay down this long (the range's 2s otherwise). */
const RESPAWN = process.env.RESPAWN !== undefined ? Number(process.env.RESPAWN) : null;
/** What-if: YOUR move speed multiplier (a "you're faster than them" handicap). */
const MOVE = process.env.MOVE !== undefined ? Number(process.env.MOVE) : null;
/** What-if: override YOUR cooldown scale for every recipe (0 = no cooldowns). */
const COOLDOWN = process.env.COOLDOWN !== undefined ? Number(process.env.COOLDOWN) : null;

/** Candidate kits for own-kit recipes — the autopilot has no wizard. */
const KITS: { label: string; weapon: WeaponId; hand: AbilityId[] }[] = [
  { label: "blade dash+ironhide", weapon: "blade", hand: ["dash", "ironhide"] },
  { label: "bow dash+mirror", weapon: "bow", hand: ["dash", "mirror-guard"] },
  { label: "hammer dash+ironhide", weapon: "hammer", hand: ["dash", "ironhide"] },
  { label: "staff dash+sandstorm", weapon: "staff", hand: ["dash", "sandstorm"] },
];

const NAMES = ["Crixus", "Barca", "Ashur", "Varro", "Oenomaus", "Gannicus"];

interface Run {
  cleared: boolean;
  reason: string;
  seconds: number;
  kills: number;
}

const runOne = (def: ChallengeDef, seed: number, kit: { weapon: WeaponId; hand: AbilityId[] } | null, arenaId: string): Run => {
  const rng = createRng(seed ^ 0x5eed);
  const sim = createSim(ARENAS[arenaId]!, seed, challengeTeamSize(def), false, true);
  const seated = seatChallenge(sim, def, "AUTOPILOT", () => rng.next(), NAMES);
  if (!def.you.locked && kit) {
    setPlayerWeapon(sim, seated.me.id, kit.weapon);
    setPlayerAbilities(sim, seated.me.id, kit.hand);
  }
  armCounterPicks(sim, seated); // the phone does this at START
  if (COOLDOWN !== null && Number.isFinite(COOLDOWN)) seated.me.cooldownScale = COOLDOWN;
  const myMove = MOVE !== null && Number.isFinite(MOVE) ? MOVE : 1;
  for (const b of seated.bots) {
    if (b.player.team === 1) continue;
    if (FOE_WEAPON) setPlayerWeapon(sim, b.player.id, FOE_WEAPON);
    if (FOE_HP !== null && Number.isFinite(FOE_HP)) setPlayerMaxHpScale(sim, b.player.id, FOE_HP);
    if (FOE_HAND) setPlayerAbilities(sim, b.player.id, FOE_HAND);
  }
  if (FOE_MAX !== null && Number.isFinite(FOE_MAX)) {
    let i = 0;
    for (const b of seated.bots) if (b.player.team !== 1 && i++ >= FOE_MAX) b.player.spawnDelay = 1e9;
  }
  if (STAGGER !== null && Number.isFinite(STAGGER)) {
    let i = 0;
    for (const b of seated.bots) if (b.player.team !== 1) b.player.spawnDelay = STAGGER * i++;
  }
  if (RESPAWN !== null && Number.isFinite(RESPAWN)) sim.state.respawnSeconds = RESPAWN;
  const nav = createBotNav(sim.zone);
  const judge = createChallengeJudge(def, seated.protectIds);
  const brains = new Map<number, { mem: ReturnType<typeof createBotMemory>; tier: DifficultyId; archetype?: string }>();
  const oracle = ORACLE ? createOracle({ ...ORACLE, ...(def.win.kind === "kills" ? { killWeight: 1500 } : {}) }, seed) : null;
  if (!oracle) brains.set(seated.me.id, { mem: createBotMemory(seed * 3 + 1), tier: TIER });
  const tierOf = (b: (typeof seated.bots)[number]): DifficultyId => (FOE_TIER && b.player.team !== 1 ? FOE_TIER : b.spec.difficulty);
  for (const b of seated.bots) {
    brains.set(b.player.id, { mem: createBotMemory(seed * 7 + b.player.id * 31), tier: tierOf(b), archetype: b.spec.archetype });
  }
  const oracleFoes = seated.bots
    .filter((b) => b.player.team !== 1)
    .map((b) => ({ id: b.player.id, memory: brains.get(b.player.id)!.mem, difficulty: tierOf(b), archetype: b.spec.archetype as never }));
  const history = new SnapshotHistory();
  const inputs = new Map<number, PlayerInput>();
  let seq = 0;
  let activeTicks = 0;
  for (let t = 0; t < 30 * 60 * MAX_MINUTES; t++) {
    const events = stepSim(sim, inputs, TICK_DT);
    const verdict = judge.tick(sim, events);
    if (verdict) return { cleared: verdict.cleared, reason: verdict.reason, seconds: activeTicks / 30, kills: verdict.kills };
    const snap = toSnapshot(sim.state, events);
    history.push(snap);
    if (sim.state.round.phase !== "active") {
      inputs.clear();
      continue;
    }
    activeTicks++;
    seq++;
    if (oracle) {
      const d = oracle.think(sim, seated.me.id, oracleFoes, nav);
      inputs.set(seated.me.id, { seq, sx: d.sx, sy: d.sy, casts: d.casts });
    }
    if (myMove !== 1) {
      const body = sim.state.players[seated.me.id];
      if (body) body.moveFactor = myMove; // after the brain loop below would be too late for its own write — it only writes tiers' bodies
    }
    for (const [id, brain] of brains) {
      const me = snap.players.find((p) => p.id === id);
      if (!me || !me.alive) {
        inputs.delete(id);
        continue;
      }
      const tier = DIFFICULTIES[brain.tier];
      const body = sim.state.players[id];
      if (body) body.moveFactor = id === seated.me.id && myMove !== 1 ? myMove : tier.speedFactor;
      const world = history.stale(tier.reactionTicks) ?? snap;
      const d = botThink(brain.mem, me, world, nav, {
        difficulty: brain.tier,
        ...(brain.archetype ? { archetype: brain.archetype as never } : {}),
      });
      inputs.set(id, { seq, sx: d.sx, sy: d.sy, casts: d.casts });
    }
  }
  return { cleared: false, reason: "timeout", seconds: activeTicks / 30, kills: judge.kills };
};

const pct = (n: number, d: number): string => `${Math.round((100 * n) / d)}%`;

console.log(`challenge gauntlet — autopilot ${TIER_ENV}, ${SEEDS} seeds per kit/arena${COOLDOWN !== null ? ` · your cooldown scale ${COOLDOWN}` : ""}${FOE_TIER ? ` · enemies at ${FOE_TIER}` : ""}${MOVE !== null ? ` · your speed ×${MOVE}` : ""}${STAGGER !== null ? ` · enemies arrive every ${STAGGER}s` : ""}${FOE_HAND ? ` · enemy hand ${FOE_HAND.join("+")}` : ""}${FOE_HP !== null ? ` · enemy hp ×${FOE_HP}` : ""}${FOE_MAX !== null ? ` · only ${FOE_MAX} enemies` : ""}${FOE_WEAPON ? ` · enemy weapon ${FOE_WEAPON}` : ""}${RESPAWN !== null ? ` · respawn ${RESPAWN}s` : ""}\n`);
for (const def of CHALLENGES) {
  if (ONLY && def.id !== ONLY) continue;
  const arenas = def.arena ? [def.arena] : [...ARENA_ROTATION];
  const kits = def.you.locked ? [null] : KITS;
  const lines: string[] = [];
  let best = { label: "", rate: -1 };
  for (const kit of kits) {
    const runs: Run[] = [];
    for (const arenaId of arenas) for (let s = 1; s <= SEEDS; s++) runs.push(runOne(def, s * 1013 + arenas.indexOf(arenaId), kit, arenaId));
    const clears = runs.filter((r) => r.cleared);
    const reasons = runs.filter((r) => !r.cleared).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.reason]: (acc[r.reason] ?? 0) + 1 }), {});
    const meanT = clears.length ? (clears.reduce((a, r) => a + r.seconds, 0) / clears.length).toFixed(0) : "–";
    const extra = ` · mean kills ${(runs.reduce((a, r) => a + r.kills, 0) / runs.length).toFixed(1)}`;
    const label = kit ? kit.label : "locked kit";
    lines.push(`    ${label.padEnd(22)} clear ${pct(clears.length, runs.length).padStart(4)}  (${clears.length}/${runs.length})  mean clear ${meanT}s${extra}  losses ${JSON.stringify(reasons)}`);
    const rate = clears.length / runs.length;
    if (rate > best.rate) best = { label, rate };
  }
  console.log(`${def.id.padEnd(22)} [${def.tier}]  best ${pct(Math.round(best.rate * 100), 100).padStart(4)} with ${best.label}`);
  for (const l of lines) console.log(l);
}
