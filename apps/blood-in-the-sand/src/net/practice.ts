/**
 * Practice mode — a full match against bots, no server, no network. The sim
 * package is pure and already bundled in the app, so this "connection" steps
 * stepSim in-process, and each tick's snapshot goes through the same
 * SnapshotBuffer the renderer already samples. The bots are the shared
 * sim-package brain (botThink) — the same opponent the server's headless bot
 * script runs. At the chosen team size, bots fill BOTH teams (you get bot
 * allies): the human takes seat 0, and team assignment runs the exact
 * production addPlayer path — random-balanced, so you can land RED or BLUE.
 *
 * Practice runs the SAME arming flow as real rooms (pvp-loadout-flow.md):
 * you arm through the wizard on RoomScreen, each bot arms itself moments
 * after sitting down, and the sim's own 5s arming countdown starts the match
 * — nobody presses START. After matchEnd the sim disarms everyone and returns
 * to the lobby, so the wizard reopens (run-it-back is one tap) — the offline
 * loop matches the online one exactly. This is the no-second-player test bed
 * for the whole flow.
 *
 * Clock ownership: WHILE the phase is "lobby" an internal 30Hz interval steps
 * the sim (the wizard sends no input — the arming countdown needs a clock);
 * from the countdown on, GameScreen's 30Hz sendInput IS the tick, exactly as
 * before. The lobby interval re-arms itself on the return from a match.
 */
import {
  ABILITY_IDS,
  addDummy,
  addPlayer,
  ARENA_00,
  BOT_STRATEGIES,
  botThink,
  createBotMemory,
  createSim,
  forceStartMatch,
  LOADOUT_ABILITY_COUNT,
  makeClientConfig,
  nearestEnemy,
  setPlayerAbilities,
  setPlayerWeapon,
  SnapshotBuffer,
  stepSim,
  TICK_DT,
  TICK_RATE,
  toRoomStatePlayers,
  toSnapshot,
  WEAPON_IDS,
  type AbilityId,
  type ArenaEvent,
  type ArenaSim,
  type BotMemory,
  type BotStrategy,
  type RoundPhase,
  type SnapshotMsg,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";
import type { ConnectionStatus, LobbyClient, RoomStateInfo, WelcomeInfo } from "./connection";

const BOT_NAMES = ["Crixus", "Barca", "Ashur", "Varro", "Oenomaus", "Gannicus", "Spartacus", "Agron", "Duro"];

/** What practice puts across the sand: live bots, or the dev menu's firing
 * range — a line of inert target dummies that respawn as they fall. */
export type PracticeMode = "bot" | "dummies";

const DUMMY_NAMES = ["Dummy I", "Dummy II", "Dummy III", "Dummy IV", "Dummy V"];

/** Dev nicety: the range clamps the 5s arming ceremony to a quick beat. */
const RANGE_ARM_SECONDS = 2;

/** Per-bot brain state — one entry per bot seat (every id except the human's 0). */
interface BotSeat {
  memory: BotMemory;
  strategy: BotStrategy;
  /** ms after entering the lobby at which this bot arms itself — staggered
   * beats, so the roster ticker flips one by one while you're mid-wizard. */
  armAtMs: number;
}

const randomArmBeat = (): number => 1200 + Math.random() * 1800;

const randomWeapon = (): WeaponId => WEAPON_IDS[Math.floor(Math.random() * WEAPON_IDS.length)]!;

/** The bot's hand always leads with dash — the only ability its brain casts
 * (cheapest v1, per pvp-abilities.md); the other slots are random dressing. */
const randomHand = (): AbilityId[] => {
  const pool = ABILITY_IDS.filter((a) => a !== "dash");
  const hand: AbilityId[] = ["dash"];
  while (hand.length < LOADOUT_ABILITY_COUNT) {
    hand.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  }
  return hand;
};

export class PracticeClient implements LobbyClient {
  readonly buffer = new SnapshotBuffer(TICK_RATE);
  status: ConnectionStatus = "open";
  /** Offline, single-player-hosted — the crown never moves, so no notices. */
  readonly notice = null;
  welcome: WelcomeInfo | null;
  roomState: RoomStateInfo | null = null;
  /** Round phase from the newest tick — App routes lobby → RoomScreen (the
   * wizard), match phases → GameScreen. */
  phase: RoundPhase;

  onChange: (() => void) | null = null;
  onEvents: ((events: ArenaEvent[]) => void) | null = null;

  /** Bots or the firing range — App routes a range LEAVE to the title screen
   * (the range has no front-door screen of its own). */
  readonly mode: PracticeMode;

  private readonly sim: ArenaSim;
  /** Brain state per bot seat, keyed by player id (every id except 0). */
  private readonly bots = new Map<number, BotSeat>();
  private lobbyEnteredMs: number;
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;
  private lastSnap: SnapshotMsg;
  private seq = 0;

  constructor(playerName: string, teamSize: number = 1, mode: PracticeMode = "bot") {
    this.mode = mode;
    // Practice needn't be replayable — wall-clock seeding is fine here.
    this.sim = createSim(ARENA_00, Date.now() >>> 0, teamSize, mode === "dummies");

    // The human takes seat 0. In bot mode, bots fill every other seat, BOTH
    // teams — assignment is the production addPlayer path (random-balanced),
    // so you can land RED or BLUE, exactly like a real room. On the range the
    // line-up is fixed instead: you on team 1, armed-on-arrival dummies
    // filling team 2 (an empty `bots` map — nothing thinks, nothing arms).
    const me =
      mode === "dummies" ? addPlayer(this.sim, playerName, 1)! : addPlayer(this.sim, playerName)!;
    if (mode === "dummies") {
      for (let i = 0; i < teamSize * 2 - 1; i++) {
        addDummy(this.sim, DUMMY_NAMES[i % DUMMY_NAMES.length]!);
      }
    } else {
      const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
      for (let i = 0; i < teamSize * 2 - 1; i++) {
        const bot = addPlayer(this.sim, names[i % names.length]!)!;
        this.bots.set(bot.id, {
          memory: createBotMemory(),
          strategy: BOT_STRATEGIES[Math.floor(Math.random() * BOT_STRATEGIES.length)]!,
          armAtMs: randomArmBeat(),
        });
      }
    }
    this.phase = this.sim.state.round.phase; // "lobby" — the wizard opens here
    this.lobbyEnteredMs = performance.now();

    this.welcome = {
      playerId: me.id,
      team: me.team,
      teamSize,
      roomCode: "BOT",
      roomName:
        mode === "dummies"
          ? "target practice"
          : teamSize === 1
            ? `practice vs ${this.sim.state.players[1]!.name}`
            : `practice ${teamSize}v${teamSize}`,
      hostId: 0,
      zoneId: ARENA_00.id,
      config: makeClientConfig(),
    };
    this.refreshRoomState();

    // Seed the buffer so the very first render has a view to sample.
    this.lastSnap = toSnapshot(this.sim.state, []);
    this.buffer.push(this.lastSnap, performance.now());

    // The lobby owns the clock until the countdown starts.
    this.startLobbyClock();
  }

  get myWeapon(): WeaponId | null {
    return this.sim.state.players[0]?.weapon ?? null;
  }

  get myAbilities(): AbilityId[] {
    return [...(this.sim.state.players[0]?.abilities ?? [])];
  }

  get hostId(): number {
    return 0;
  }

  get isHost(): boolean {
    return true;
  }

  setWeapon(weapon: WeaponId): void {
    if (setPlayerWeapon(this.sim, 0, weapon)) {
      this.refreshRoomState();
      this.onChange?.();
    }
  }

  setAbilities(abilities: AbilityId[]): void {
    if (setPlayerAbilities(this.sim, 0, abilities)) {
      this.refreshRoomState();
      this.onChange?.();
    }
  }

  /** The host backstop, offline flavour — fills the bot if it hasn't armed
   * yet (it will have; this exists for interface parity and paranoia). */
  forceStart(): void {
    if (forceStartMatch(this.sim)) {
      this.refreshRoomState();
      this.onChange?.();
    }
  }

  private startLobbyClock(): void {
    if (this.lobbyTimer !== null) return;
    this.lobbyEnteredMs = performance.now();
    for (const bot of this.bots.values()) bot.armAtMs = randomArmBeat();
    this.lobbyTimer = setInterval(() => this.lobbyTick(), 1000 / TICK_RATE);
  }

  /** One 30Hz lobby tick: arm each bot on its beat, let the arming countdown
   * run, and hand the clock to GameScreen the moment the countdown phase
   * begins. */
  private lobbyTick(): void {
    const sinceMs = performance.now() - this.lobbyEnteredMs;
    let armed = false;
    for (const [id, seat] of this.bots) {
      const bot = this.sim.state.players[id];
      if (bot && bot.weapon === null && sinceMs >= seat.armAtMs) {
        setPlayerWeapon(this.sim, id, randomWeapon());
        setPlayerAbilities(this.sim, id, randomHand());
        armed = true;
      }
    }
    if (armed) {
      this.refreshRoomState();
      this.onChange?.();
    }

    // The range skips the arming ceremony: the dummies armed on arrival, so
    // the moment YOU arm, the countdown would sit at the full 5s — clamp it
    // to a beat. In-process dev shortcut, offline only; real rooms never do this.
    const { round } = this.sim.state;
    if (this.mode === "dummies" && round.phase === "lobby" && round.timer > RANGE_ARM_SECONDS) {
      round.timer = RANGE_ARM_SECONDS;
    }

    this.step(new Map()); // nobody moves pre-countdown; the clock still runs
    if (this.sim.state.round.phase !== "lobby" && this.lobbyTimer !== null) {
      clearInterval(this.lobbyTimer); // armed & counted down — GameScreen takes over
      this.lobbyTimer = null;
    }
  }

  /** GameScreen's fixed 30Hz input send IS the sim tick from the countdown on. */
  sendInput(sx: number, sy: number, casts: boolean[]): void {
    if (this.lobbyTimer !== null) return; // the lobby still owns the clock
    const inputs = new Map<number, { seq: number; sx: number; sy: number; casts: boolean[] }>();
    inputs.set(0, { seq: this.seq++, sx, sy, casts });
    for (const [id, seat] of this.bots) {
      const snap = this.lastSnap.players.find((p) => p.id === id);
      const decision = botThink(seat.memory, seat.strategy, snap, nearestEnemy(snap, this.lastSnap.players));
      // The brain's dash flag lands on whichever slot holds dash in this bot's hand.
      const botCasts = (this.sim.state.players[id]?.slots ?? []).map((s) => decision.dash && s.id === "dash");
      inputs.set(id, { seq: 0, sx: decision.sx, sy: decision.sy, casts: botCasts });
    }
    this.step(inputs);
  }

  private step(inputs: Map<number, { seq: number; sx: number; sy: number; casts: boolean[] }>): void {
    const events = stepSim(this.sim, inputs, TICK_DT);
    this.lastSnap = toSnapshot(this.sim.state, events);
    const drained = this.buffer.push(this.lastSnap, performance.now());
    if (drained.length > 0) this.onEvents?.(drained);
    if (this.lastSnap.round.phase !== this.phase) {
      this.phase = this.lastSnap.round.phase; // lobby → countdown → … routes the UI
      this.refreshRoomState();
      this.onChange?.();
      // Back in the lobby after a match: everyone is disarmed — the wizard
      // reopens and this clock resumes so the next arming countdown can run.
      if (this.phase === "lobby") this.startLobbyClock();
    }
  }

  private refreshRoomState(): void {
    this.roomState = { players: toRoomStatePlayers(this.sim.state, this.welcome!.team), hostId: 0 };
  }

  close(): void {
    if (this.lobbyTimer !== null) clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
    this.onChange = null;
    this.onEvents = null;
  }
}
