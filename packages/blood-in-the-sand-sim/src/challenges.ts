/**
 * Challenges (docs/design/bits-challenges.md, Tom 2026-09-26): a growing
 * set of fixed-recipe offline fights against bots — no matchmaking, one-line
 * premises made for clips, first clears paying Glory through the deeds
 * pipeline. The RECIPES live here, in the sim package, because the deeds
 * board (achievements/defsChallenges.ts) and the API's report adapter both
 * read the ids; the RUNNER is the client's (apps/blood-in-the-sand
 * src/challenges/) — it seats the recipe on a PracticeClient and judges
 * the win condition off the event stream.
 *
 * Everything a recipe asks for is a sim dial that already exists: forced
 * seating (addPlayer's forcedTeam), per-seat kits, bot tiers, the start-hp
 * handicap (startHpFrac, yours), the max-hp scale (maxHpScale, a foe's —
 * a full bar on a smaller pool, so a bot never LOOKS nerfed), the sands delay (state.sandsDelay), respawning
 * seats (respawns — the dummy range's respawn pass, with a brain), and a
 * pinned archetype (botThink's opts.archetype — the rookie's `ward`).
 */
import { FREE_ABILITY_IDS, FREE_WEAPON_IDS, LOADOUT_ABILITY_COUNT, type AbilityId, type WeaponId } from "./config";
import type { BotPins } from "./bot";
import type { ArchetypeId } from "./botArchetypes";
import type { DifficultyId } from "./botDifficulty";
import type { BountyBand } from "./achievements/bounties";
import type { ArenaEvent } from "./events";
import { concludeRound } from "./round";
import { addPlayer, setPlayerAbilities, setPlayerWeapon, type ArenaSim } from "./sim";
import type { ArenaPlayer, Team } from "./state";

export type ChallengeTier = "easy" | "medium" | "hard" | "deathwish";

export const CHALLENGE_TIERS: readonly ChallengeTier[] = ["easy", "medium", "hard", "deathwish"];

/** A bot seat in the recipe. Team 1 is the player's side (an ally). */
export interface ChallengeSeat {
  team: Team;
  difficulty: DifficultyId;
  /** Fixed weapon; absent = the FREE roster at random. */
  weapon?: WeaponId;
  /** Fixed hand (partial hands are filled from the FREE roster, unless
   * `exactHand`). */
  abilities?: AbilityId[];
  /** `abilities` IS the whole hand — no FREE-roster top-up ("dash only"). */
  exactHand?: boolean;
  /** Hand abilities held open all round (the Titan's permanent draught). */
  permanent?: AbilityId[];
  /** Multiplier on the seat's Lifeline healing (1 = the shipped beam). */
  healScale?: number;
  /** Max-hp multiplier (1 = the normal 100). The seat still starts on a
   * full bar: Tom 2026-09-27, a bot spawning half-empty reads as us
   * hampering it for you; a smaller pool reads as the recipe. */
  maxHp?: number;
  /** Pin the brain instead of deriving it from the kit. */
  archetype?: ArchetypeId;
  /** The round is LOST the tick this seat dies (the escort). */
  protect?: boolean;
  /** Stands back up on its spawn slot after death (the wave mechanic). */
  respawns?: boolean;
  /** Seconds after the bell before this seat arrives (the stream). */
  spawnDelay?: number;
  /** A roster name; absent = the practice bot names. */
  name?: string;
  /** Picks its kit AFTER yours — re-armed at START with COUNTER_KITS[your
   * weapon] (Godlike, Tom 2026-09-27: no single kit may be the answer).
   * `weapon`/`abilities` are the placeholder it's seated with. */
  counter?: boolean;
  /** Pin the brain's mark: `ward` = the protected seat (the rookie's
   * hunters ignore you), `you` = the player. */
  hunt?: "ward" | "you";
  /** Never gives ground — no flee, no spacing dance (BotThinkOptions). */
  relentless?: boolean;
  /** Never drawn into the FREE-roster top-up (Blot out the sun: a harpoon
   * on a bow is a blade's instant death). */
  bannedAbilities?: AbilityId[];
}

export type ChallengeWin =
  /** Your team is the last one standing (the sim's own round-over rule). */
  | { kind: "lastStanding" }
  /** Your own killing blows reach `count` — respawned seats count again. */
  | { kind: "kills"; count: number }
  /** The round has been active for `seconds` with you still alive. */
  | { kind: "survive"; seconds: number };

export interface ChallengeDef {
  /** Stable forever once shipped — the deed and counter key. */
  id: string;
  tier: ChallengeTier;
  /** Tom's voice, plain (indie-voice rule). */
  name: string;
  /** One line — the share-card line. */
  premise: string;
  /** Registry arena id; null = any registered arena at random. */
  arena: string | null;
  /** The player's kit. `locked` fixes it (no wizard); a locked kit may hold
   * an empty hand ("nothing else"). `hp` is the start-of-round fraction;
   * `cooldownScale` multiplies your cooldowns (0 = back-to-back casts). No
   * recipe uses it today: casts are ALREADY unlimited in every challenge
   * (the practice flag never spends the charge budget — Tom's "unlimited
   * ability uses" 2026-09-26 turned out to be the shipped state), and a
   * zero scale made a defensive spell a permanent shield in the sims. */
  you: { locked: boolean; weapon?: WeaponId; abilities?: AbilityId[]; hp?: number; cooldownScale?: number };
  seats: readonly ChallengeSeat[];
  /** Active-round seconds before the Closing Sands roll; absent = the
   * shipped default; Infinity = the tide never comes. */
  sandsDelay?: number;
  /** Seconds a respawning seat stays down; absent = the range's 2s. */
  respawnSeconds?: number;
  win: ChallengeWin;
  /** First clear pays this band, once, through the deeds pipeline. */
  glory: BountyBand;
}

const foes = (n: number, difficulty: DifficultyId, extra: Partial<ChallengeSeat> = {}): ChallengeSeat[] =>
  Array.from({ length: n }, () => ({ team: 2 as Team, difficulty, ...extra }));

export const CHALLENGES: readonly ChallengeDef[] = [
  // ── easy: each teaches one thing ──
  {
    id: "two-on-one",
    tier: "easy",
    name: "Folie à deux",
    premise: "Win 2v1",
    arena: null,
    you: { locked: false },
    seats: foes(2, "experienced"),
    win: { kind: "lastStanding" },
    glory: 10,
  },
  {
    id: "bow-only",
    tier: "easy",
    name: "Robin Hood",
    premise: "get 10 kills with the bow and nothing else",
    arena: "arena-00",
    you: { locked: true, weapon: "bow", abilities: [] },
    // Tom 2026-09-28: a lone blade was a slog for a bow. A horde-lite now:
    // four blades on 10 max hp (one arrow, one body), arriving every two
    // seconds and back up two seconds after they drop — ten kills. (Ten
    // one-shot seats streaming in at 2s was the other cut: proxy 17%.)
    seats: foes(4, "skilled", { weapon: "blade", abilities: ["dash"], maxHp: 0.1, respawns: true }).map((s, i) => ({ ...s, spawnDelay: i * 2 })),
    respawnSeconds: 2,
    sandsDelay: Infinity,
    win: { kind: "kills", count: 10 },
    glory: 10,
  },
  {
    id: "half-a-heart",
    tier: "easy",
    name: "Half a heart",
    premise: "start on half health",
    arena: null,
    you: { locked: false, hp: 0.5 },
    seats: foes(1, "masterful"),
    win: { kind: "lastStanding" },
    glory: 10,
  },
  // ── medium ──
  {
    id: "three-on-one",
    tier: "medium",
    name: "Three's a crowd",
    premise: "Win 1v3",
    arena: null,
    you: { locked: false },
    seats: foes(3, "experienced"), // Tom 2026-09-28: Average was too easy
    win: { kind: "lastStanding" },
    glory: 25,
  },
  {
    id: "hammer-nothing-else",
    tier: "medium",
    name: "Bring down the hammer",
    premise: "win against your foe whilst wielding a solitary hammer",
    arena: "arena-00",
    you: { locked: true, weapon: "hammer", abilities: [] },
    seats: foes(1, "skilled", { weapon: "blade", abilities: ["dash"] }),
    win: { kind: "lastStanding" },
    glory: 25,
  },
  {
    id: "carry-the-rookie",
    tier: "medium",
    name: "Rookie's first day",
    premise: "keep the rookie alive at all costs and win.",
    arena: null,
    you: { locked: false },
    seats: [
      { team: 1, difficulty: "novice", weapon: "bow", archetype: "ward", protect: true, name: "The rookie" },
      // Tom 2026-09-28: hitting them pulled them off the rookie, so it was
      // just a 1v2. Now they hunt HIM whoever's hitting them, and he runs —
      // the fight is the peel.
      ...foes(2, "skilled", { hunt: "ward" }),
    ],
    win: { kind: "lastStanding" },
    glory: 25,
  },
  // ── hard: the marketing tier ──
  {
    id: "four-on-one",
    tier: "hard",
    name: "Four little heart-breakers",
    premise: "Win 1v4, you mad lad",
    arena: null,
    you: { locked: false },
    // Tom 2026-09-27: "a bit more winnable" — 50 max hp each, full bars
    // (autopilot proxy at 60: best kit 6% → 11%, blade/staff clearing
    // too; 70 barely moved it; then Tom took it to 50).
    seats: foes(4, "skilled", { maxHp: 0.5 }),
    win: { kind: "lastStanding" },
    glory: 50,
  },
  {
    id: "the-titan",
    tier: "hard",
    name: "Tall order",
    premise: "Beat a giant with three healers keeping him alive",
    arena: null,
    you: { locked: false },
    // Tom 2026-09-27: a hammer on a permanent Titan's Draught, and three
    // Lifelines pouring into him (the medic brain, botArchetypes.ts). The
    // healers do no damage, so the puzzle is getting to them past a giant
    // hammer; each carries a dash and nothing else. Tuned 09-27 (autopilot
    // proxy, 54 runs): as first specced 0%; healers at 30 max hp 2%; plus
    // heal ×0.35 → 7% (×0.5 4%, ×0.25 11%, no healing 50%) — beside the
    // 4v1's 6%. Tom 2026-09-28: ×0.35 let any kit just out-damage the
    // healing, which defeats the point — ×0.5, so the healers must go
    // first; and the giant is relentless (the hammer's reach-edge footwork
    // read as being scared off) and hunts you, always.
    seats: [
      {
        team: 2,
        difficulty: "skilled",
        weapon: "hammer",
        abilities: ["titans-draught"],
        exactHand: true,
        permanent: ["titans-draught"],
        hunt: "you",
        relentless: true,
      },
      ...foes(3, "skilled", { weapon: "lifeline", abilities: ["dash"], exactHand: true, maxHp: 0.3, healScale: 0.5 }),
    ],
    win: { kind: "lastStanding" },
    glory: 50,
  },
  {
    id: "through-the-arrows",
    tier: "hard",
    name: "Blot out the sun",
    premise: "Win with only a blade against 3 ranged opponents",
    arena: "desert-1",
    you: { locked: true, weapon: "blade", abilities: [] },
    // Tom 2026-09-28: never a harpoon — dragged into three bows is instant death.
    seats: foes(3, "experienced", { weapon: "bow", bannedAbilities: ["harpoon"] }),
    win: { kind: "lastStanding" },
    glory: 50,
  },
  {
    id: "the-tide-waits",
    tier: "hard",
    name: "A rising tide",
    premise: "Win with the blood tide triggering after 3 seconds",
    arena: null,
    you: { locked: false },
    // Tom 2026-09-28: at Skilled / 10s it was just the medium 1v3 again —
    // a tier up, and the tide from the third second.
    seats: foes(3, "adept", { weapon: "blade", abilities: ["dash"] }),
    sandsDelay: 3,
    win: { kind: "lastStanding" },
    glory: 50,
  },
  // ── deathwish: the summit ──
  {
    id: "five-on-one",
    tier: "deathwish",
    name: "Yahtzee",
    premise: "Win 1v5, how on earth?",
    arena: null,
    you: { locked: false },
    // Five at once is unwinnable at ANY tier (gauntlet 2026-09-26: 0% for
    // Godlike and the Oracle from Adept down to Novice — five bodies in
    // reach is five auto-attacks, skill be damned). The stream is the fix:
    // Skilled bots made of glass, one every five seconds at 50 max hp (Tom
    // 2026-09-27: 35/6s → 40/5s → 50/5s, matching the 1v4's 50). Proxy
    // 42% → 22% → 14% (staff).
    seats: foes(5, "skilled", { maxHp: 0.5 }).map((s, i) => ({ ...s, spawnDelay: i * 5 })),
    sandsDelay: 20,
    win: { kind: "lastStanding" },
    glory: 200,
  },
  {
    id: "godlike",
    tier: "deathwish",
    name: "Godlike",
    premise: "Win against a godlike bot that counters you",
    arena: null,
    you: { locked: false },
    // It reads your weapon and brings the answer (COUNTER_KITS). Blade +
    // Ironhide out-traded the old fixed blade + dash (Tom 2026-09-27; proxy
    // 77%); with the counter-pick and the Ironhide-aware brain every kit
    // sits at or under ~10% for the godlike proxy.
    seats: foes(1, "godlike", { weapon: "blade", abilities: ["dash", "harpoon"], exactHand: true, counter: true }),
    sandsDelay: 10,
    win: { kind: "lastStanding" },
    glory: 400,
  },
  {
    id: "the-horde",
    tier: "deathwish",
    name: "The horde",
    premise: "Get 35 kills without dying once",
    arena: null,
    you: { locked: false },
    // A horde is made of fodder, not duelists (gauntlet 2026-09-26: three
    // Skilled respawners killed the Godlike proxy before its FIRST kill,
    // and longer respawns changed nothing because the first kill never
    // landed). Novices made of glass, arriving in a stream, eight seconds
    // down between lives — twenty kills in ~100s of flawless kiting.
    // Godlike proxy 33% (ranged kits; melee 0%). Tom 2026-09-27: too soft —
    // four seats, five seconds down, thirty-five kills.
    seats: foes(4, "novice", { respawns: true, maxHp: 0.2 }).map((s, i) => ({ ...s, spawnDelay: i * 4 })),
    respawnSeconds: 5,
    sandsDelay: Infinity,
    win: { kind: "kills", count: 35 },
    glory: 200,
  },
];

export const CHALLENGE_IDS: readonly string[] = CHALLENGES.map((c) => c.id);

const BY_ID = new Map(CHALLENGES.map((c) => [c.id, c] as const));

export const challengeById = (id: string): ChallengeDef | undefined => BY_ID.get(id);

export const challengesOfTier = (tier: ChallengeTier): ChallengeDef[] => CHALLENGES.filter((c) => c.tier === tier);

/** The room shape a recipe needs: max side × 2 seats (empty seats on the
 * thin side never spawn — the host force-starts the partial room). */
export const challengeTeamSize = (def: ChallengeDef): number => {
  const mine = 1 + def.seats.filter((s) => s.team === 1).length;
  const theirs = def.seats.filter((s) => s.team === 2).length;
  return Math.max(mine, theirs);
};

// ── Seating + judging (shared by the client host and the headless gauntlet) ──

/** A fixed hand, filled to a full one from the FREE roster (a recipe that
 * says "dash" gets dash plus one random pick); absent = fully random. */
export const fillChallengeHand = (
  given: AbilityId[] | undefined,
  rng: () => number,
  banned: readonly AbilityId[] = [],
): AbilityId[] => {
  const hand = [...(given ?? [])];
  const pool = FREE_ABILITY_IDS.filter((a) => !hand.includes(a) && !banned.includes(a));
  while (hand.length < LOADOUT_ABILITY_COUNT && pool.length > 0) {
    hand.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  }
  return hand;
};

export interface SeatedChallengeBot {
  player: ArenaPlayer;
  spec: ChallengeSeat;
  /** Spread into every botThink call for this seat (archetype, mark,
   * relentless) — resolved here so every host reads the same ids. */
  pins: BotPins;
}

export interface SeatedChallenge {
  me: ArenaPlayer;
  bots: SeatedChallengeBot[];
  /** Seats whose death loses the round. */
  protectIds: number[];
}

/**
 * Seat a recipe on a fresh lobby sim (sized by challengeTeamSize): you on
 * team 1, every bot on its forced team, armed on arrival with its kit
 * (partial hands filled from `rng`), every dial written, the partial room
 * force-started. Your own kit is left to the wizard unless the recipe
 * locks it. The client host and the gauntlet both seat through here, so a
 * headless clear is the same match the phone would run.
 */
export const seatChallenge = (
  sim: ArenaSim,
  def: ChallengeDef,
  playerName: string,
  rng: () => number,
  names: readonly string[],
): SeatedChallenge => {
  const me = addPlayer(sim, playerName, 1)!;
  const you = def.you;
  if (you.hp !== undefined) me.startHpFrac = you.hp;
  if (you.cooldownScale !== undefined) me.cooldownScale = you.cooldownScale;
  if (you.locked) {
    me.kitLocked = true;
    if (you.weapon) setPlayerWeapon(sim, me.id, you.weapon);
    setPlayerAbilities(sim, me.id, you.abilities ?? []);
  }
  const bots: SeatedChallengeBot[] = [];
  const protectIds: number[] = [];
  def.seats.forEach((spec, i) => {
    const bot = addPlayer(sim, spec.name ?? names[i % names.length] ?? `bot ${i + 1}`, spec.team)!;
    if (spec.maxHp !== undefined) bot.maxHpScale = spec.maxHp;
    if (spec.respawns) bot.respawns = true;
    if (spec.spawnDelay !== undefined) bot.spawnDelay = spec.spawnDelay;
    if (spec.protect) protectIds.push(bot.id);
    setPlayerWeapon(sim, bot.id, spec.weapon ?? FREE_WEAPON_IDS[Math.floor(rng() * FREE_WEAPON_IDS.length)]!);
    setPlayerAbilities(
      sim,
      bot.id,
      spec.exactHand ? [...(spec.abilities ?? [])] : fillChallengeHand(spec.abilities, rng, spec.bannedAbilities),
    );
    if (spec.permanent) bot.permanentAbilities = [...spec.permanent];
    if (spec.healScale !== undefined) bot.healScale = spec.healScale;
    // A deliberately short hand is complete — the arming gate's locked-kit rule.
    if (spec.exactHand) bot.kitLocked = true;
    bots.push({ player: bot, spec, pins: {} });
  });
  // Marks resolve once the whole cast (the ward included) has its ids.
  for (const b of bots) {
    const { spec } = b;
    const markId = spec.hunt === "you" ? me.id : spec.hunt === "ward" ? protectIds[0] : undefined;
    b.pins = {
      ...(spec.archetype ? { archetype: spec.archetype } : {}),
      ...(markId !== undefined ? { markId } : {}),
      ...(spec.relentless ? { relentless: true } : {}),
    };
  }
  if (def.sandsDelay !== undefined) sim.state.sandsDelay = def.sandsDelay;
  if (def.respawnSeconds !== undefined) sim.state.respawnSeconds = def.respawnSeconds;
  sim.state.winsToTake = 1; // one round IS the attempt
  sim.state.round.forced = true; // the partial-room launcher (addPlayer cleared it per join)
  return { me, bots, protectIds };
};

/**
 * The Godlike counter-pick: YOUR weapon → the kit that beats it. Picked by
 * brute force (2026-09-27: godlike autopilot on every weapon × eight hands
 * vs 40 bot kits, blade/bow/staff/hammer/trident, on the Godlike recipe) —
 * the weapon decides it; your hand barely moves the answer. Player clear
 * rates in the comments are the proxy's mean over its hands (a ceiling, not
 * a human forecast). A new weapon must add a row (compile-enforced); a
 * paid pick here is fine — a recipe isn't a draft.
 */
export const COUNTER_KITS: Record<WeaponId, { weapon: WeaponId; abilities: AbilityId[] }> = {
  blade: { weapon: "trident", abilities: ["dash", "ironhide"] }, // 5% (was 77% vs blade + dash)
  fang: { weapon: "trident", abilities: ["dash", "ironhide"] }, // 9%
  hammer: { weapon: "trident", abilities: ["dash", "sandtrap"] }, // 8%
  trident: { weapon: "bow", abilities: ["dash", "harpoon"] }, // 4%
  bow: { weapon: "blade", abilities: ["dash", "straw-man"] }, // 7%
  staff: { weapon: "blade", abilities: ["dash", "harpoon"] }, // 8%
  scorpion: { weapon: "blade", abilities: ["dash", "harpoon"] }, // 1%
  bombard: { weapon: "blade", abilities: ["dash", "harpoon"] }, // 0%
  lifeline: { weapon: "blade", abilities: ["dash", "harpoon"] }, // 0%
};

/** Re-arm every `counter` seat against your CURRENT weapon — the host calls
 * this at START (the phone's begin(), the gauntlet after the kit lands).
 * Unarmed you (shouldn't happen past the arming gate) = nothing to read. */
export const armCounterPicks = (sim: ArenaSim, seated: SeatedChallenge): void => {
  const mine = sim.state.players[seated.me.id]?.weapon ?? null;
  if (mine === null) return;
  const kit = COUNTER_KITS[mine];
  for (const b of seated.bots) {
    if (!b.spec.counter) continue;
    setPlayerWeapon(sim, b.player.id, kit.weapon);
    setPlayerAbilities(sim, b.player.id, [...kit.abilities]);
  }
};

/** How a challenge round ended. `ward` = the protected seat died; `draw` =
 * everyone fell at once. */
export interface ChallengeVerdict {
  cleared: boolean;
  reason: "won" | "died" | "ward" | "draw";
  kills: number;
}

export interface ChallengeJudge {
  /** Your killing blows this round (the horde's count). */
  readonly kills: number;
  /** Feed the host's events for this tick, AFTER stepSim. May conclude the
   * round (into the same array). Returns the verdict on the tick the round
   * ends, else null. */
  tick(sim: ArenaSim, events: ArenaEvent[]): ChallengeVerdict | null;
}

/**
 * The challenge judge: reads a tick's events for the win condition and the
 * escort rule, and concludes the round itself when the sim's own wipe rule
 * isn't the verdict. Runs on the HOST's events (never a buffered copy), so
 * a server replay — same sim, same events — recounts it identically.
 */
export const createChallengeJudge = (def: ChallengeDef, protectIds: readonly number[], myId = 0): ChallengeJudge => {
  let kills = 0;
  let verdict: ChallengeVerdict | null = null;
  return {
    get kills() {
      return kills;
    },
    tick(sim, events) {
      const { state } = sim;
      let out: ChallengeVerdict | null = null;
      for (const e of events) {
        if (e.type === "fightStart") {
          kills = 0;
          verdict = null;
        } else if (e.type === "hit" && e.lethal && e.attackerId === myId) {
          const target = state.players[e.targetId];
          if (target && target.team !== 1) kills += 1;
        } else if (e.type === "death" && protectIds.includes(e.playerId) && state.round.phase === "active") {
          concludeRound(sim, 2, events); // its roundEnd lands later in this same loop
          verdict = { cleared: false, reason: "ward", kills };
        } else if (e.type === "roundEnd") {
          verdict ??=
            e.winnerTeam === 1
              ? { cleared: true, reason: "won", kills }
              : { cleared: false, reason: e.winnerTeam === 0 ? "draw" : "died", kills };
          out = verdict;
        }
      }
      if (out || state.round.phase !== "active") return out;
      const win = def.win;
      if (win.kind === "kills" && kills >= win.count) concludeRound(sim, 1, events);
      else if (win.kind === "survive" && state.round.elapsed >= win.seconds) concludeRound(sim, 1, events);
      const closed = events[events.length - 1];
      if (closed?.type === "roundEnd") {
        verdict = { cleared: closed.winnerTeam === 1, reason: closed.winnerTeam === 1 ? "won" : "died", kills };
        return verdict;
      }
      return null;
    },
  };
};
