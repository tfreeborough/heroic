/**
 * Practice mode — a full match against a bot, no server, no network. The sim
 * package is pure and already bundled in the app, so this "connection" steps
 * stepSim in-process, and each tick's snapshot goes through the same
 * SnapshotBuffer the renderer already samples. The bot is the shared
 * sim-package brain (botThink) — the same opponent the server's headless bot
 * script runs.
 *
 * Practice runs the SAME arming flow as real rooms (pvp-loadout-flow.md):
 * you arm through the wizard on RoomScreen, the bot arms itself moments after
 * sitting down, and the sim's own 10s arming countdown starts the match —
 * nobody presses START. After matchEnd the sim disarms everyone and returns
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
  addPlayer,
  ARENA_00,
  BOT_STRATEGIES,
  botThink,
  createBotMemory,
  createSim,
  forceStartMatch,
  LOADOUT_ABILITY_COUNT,
  makeClientConfig,
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

const BOT_NAMES = ["Crixus", "Barca", "Ashur", "Varro", "Oenomaus", "Gannicus"];

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
  welcome: WelcomeInfo | null;
  roomState: RoomStateInfo | null = null;
  /** Round phase from the newest tick — App routes lobby → RoomScreen (the
   * wizard), match phases → GameScreen. */
  phase: RoundPhase;

  onChange: (() => void) | null = null;
  onEvents: ((events: ArenaEvent[]) => void) | null = null;

  private readonly sim: ArenaSim;
  private readonly botMemory: BotMemory = createBotMemory();
  private readonly botStrategy: BotStrategy;
  /** ms after entering the lobby at which the bot arms itself — a beat, not a
   * wait, so the roster ticker visibly flips while you're mid-wizard. */
  private botArmAtMs: number;
  private lobbyEnteredMs: number;
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;
  private lastSnap: SnapshotMsg;
  private seq = 0;

  constructor(playerName: string) {
    // Practice needn't be replayable — wall-clock seeding is fine here.
    this.sim = createSim(ARENA_00, Date.now() >>> 0);
    this.botStrategy = BOT_STRATEGIES[Math.floor(Math.random() * BOT_STRATEGIES.length)]!;
    const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]!;

    addPlayer(this.sim, playerName);
    addPlayer(this.sim, botName);
    this.phase = this.sim.state.round.phase; // "lobby" — the wizard opens here
    this.lobbyEnteredMs = performance.now();
    this.botArmAtMs = 1200 + Math.random() * 1800;

    this.welcome = {
      playerId: 0,
      team: 1,
      roomCode: "BOT",
      roomName: `practice vs ${botName}`,
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
    this.botArmAtMs = 1200 + Math.random() * 1800;
    this.lobbyTimer = setInterval(() => this.lobbyTick(), 1000 / TICK_RATE);
  }

  /** One 30Hz lobby tick: arm the bot on its beat, let the arming countdown
   * run, and hand the clock to GameScreen the moment the countdown phase
   * begins. */
  private lobbyTick(): void {
    const bot = this.sim.state.players[1];
    if (bot && bot.weapon === null && performance.now() - this.lobbyEnteredMs >= this.botArmAtMs) {
      setPlayerWeapon(this.sim, 1, randomWeapon());
      setPlayerAbilities(this.sim, 1, randomHand());
      this.refreshRoomState();
      this.onChange?.();
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
    const bot = botThink(
      this.botMemory,
      this.botStrategy,
      this.lastSnap.players.find((p) => p.id === 1),
      this.lastSnap.players.find((p) => p.id === 0),
    );
    // The brain's dash flag lands on whichever slot holds dash in the bot's hand.
    const botCasts = (this.sim.state.players[1]?.slots ?? []).map((s) => bot.dash && s.id === "dash");
    this.step(
      new Map([
        [0, { seq: this.seq++, sx, sy, casts }],
        [1, { seq: 0, sx: bot.sx, sy: bot.sy, casts: botCasts }],
      ]),
    );
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
    this.roomState = { players: toRoomStatePlayers(this.sim.state, 1), hostId: 0 };
  }

  close(): void {
    if (this.lobbyTimer !== null) clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
    this.onChange = null;
    this.onEvents = null;
  }
}
