/**
 * Practice mode — a full match against a bot, no server, no network. The sim
 * package is pure and already bundled in the app, so this "connection" steps
 * stepSim in-process: GameScreen's 30Hz sendInput IS the tick, and each tick's
 * snapshot goes through the same SnapshotBuffer the renderer already samples.
 * The bot is the shared sim-package brain (botThink) — the same opponent the
 * server's headless bot script runs.
 *
 * Works fully offline (the point: testing features without a second player),
 * and the whole flow reuses GameScreen untouched via the GameClient interface.
 */
import {
  addPlayer,
  ARENA_00,
  BOT_STRATEGIES,
  botThink,
  createBotMemory,
  createSim,
  makeClientConfig,
  setPlayerWeapon,
  SnapshotBuffer,
  startMatch,
  stepSim,
  TICK_DT,
  TICK_RATE,
  toRoomStatePlayers,
  toSnapshot,
  WEAPON_IDS,
  type ArenaEvent,
  type ArenaSim,
  type BotMemory,
  type BotStrategy,
  type RoundPhase,
  type SnapshotMsg,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";
import type { ConnectionStatus, GameClient, RoomStateInfo, WelcomeInfo } from "./connection";

const BOT_NAMES = ["Crixus", "Barca", "Ashur", "Varro", "Oenomaus", "Gannicus"];

export class PracticeClient implements GameClient {
  readonly buffer = new SnapshotBuffer(TICK_RATE);
  status: ConnectionStatus = "open";
  welcome: WelcomeInfo | null;
  roomState: RoomStateInfo | null;
  /** Round phase from the newest tick — App routes back to the menu on "lobby". */
  phase: RoundPhase;

  onChange: (() => void) | null = null;
  onEvents: ((events: ArenaEvent[]) => void) | null = null;

  private readonly sim: ArenaSim;
  private readonly weapon: WeaponId;
  private readonly botMemory: BotMemory = createBotMemory();
  private readonly botStrategy: BotStrategy;
  private lastSnap: SnapshotMsg;
  private seq = 0;

  constructor(playerName: string, weapon: WeaponId) {
    // Practice needn't be replayable — wall-clock seeding is fine here.
    this.sim = createSim(ARENA_00, Date.now() >>> 0);
    this.weapon = weapon;
    this.botStrategy = BOT_STRATEGIES[Math.floor(Math.random() * BOT_STRATEGIES.length)]!;
    const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]!;
    const botWeapon = WEAPON_IDS[Math.floor(Math.random() * WEAPON_IDS.length)]!;

    addPlayer(this.sim, playerName);
    addPlayer(this.sim, botName);
    setPlayerWeapon(this.sim, 0, weapon);
    setPlayerWeapon(this.sim, 1, botWeapon);
    const events: ArenaEvent[] = [];
    startMatch(this.sim, events);
    this.phase = this.sim.state.round.phase;

    this.welcome = {
      playerId: 0,
      team: 1,
      roomCode: "BOT",
      roomName: `practice vs ${botName}`,
      hostId: 0,
      zoneId: ARENA_00.id,
      config: makeClientConfig(),
    };
    this.roomState = { players: toRoomStatePlayers(this.sim.state), hostId: 0 };

    // Seed the buffer so the very first render has a view to sample.
    this.lastSnap = toSnapshot(this.sim.state, events);
    this.buffer.push(this.lastSnap, performance.now());
  }

  get myWeapon(): WeaponId | null {
    return this.weapon;
  }

  /** GameScreen's fixed 30Hz input send doubles as the sim tick. */
  sendInput(sx: number, sy: number, dash: boolean): void {
    const bot = botThink(
      this.botMemory,
      this.botStrategy,
      this.lastSnap.players.find((p) => p.id === 1),
      this.lastSnap.players.find((p) => p.id === 0),
    );
    const inputs = new Map([
      [0, { seq: this.seq++, sx, sy, dash }],
      [1, { seq: 0, sx: bot.sx, sy: bot.sy, dash: bot.dash }],
    ]);
    const events = stepSim(this.sim, inputs, TICK_DT);

    this.lastSnap = toSnapshot(this.sim.state, events);
    const drained = this.buffer.push(this.lastSnap, performance.now());
    if (drained.length > 0) this.onEvents?.(drained);
    if (this.lastSnap.round.phase !== this.phase) {
      this.phase = this.lastSnap.round.phase; // matchEnd → lobby routes home
      this.onChange?.();
    }
  }

  close(): void {
    this.onChange = null;
    this.onEvents = null;
  }
}
