/**
 * Practice mode — a full match against a bot, no server, no network. The sim
 * package is pure and already bundled in the app, so this "connection" steps
 * stepSim in-process, and each tick's snapshot goes through the same
 * SnapshotBuffer the renderer already samples. The bot is the shared
 * sim-package brain (botThink) — the same opponent the server's headless bot
 * script runs.
 *
 * Practice runs the SAME 4-beat draft as real rooms (RoomScreen via the
 * LobbyClient interface): blind pick → reveal → counterpick → sand. The bot
 * plays every beat on its own clock — it drafts a loadout and locks during
 * the blind pick, and in the counterpick window it may bait-swap its revealed
 * weapon before locking again. Lock in on both beats and the draft fast-
 * forwards (all-locked ends a phase early). This is the no-second-player
 * test bed for the whole draft.
 *
 * Clock ownership: DURING the draft an internal 30Hz interval steps the sim
 * (RoomScreen sends no input); from the countdown on, GameScreen's 30Hz
 * sendInput IS the tick, exactly as before.
 */
import {
  ABILITY_IDS,
  addPlayer,
  ARENA_00,
  BOT_STRATEGIES,
  botThink,
  createBotMemory,
  createSim,
  LOADOUT_ABILITY_COUNT,
  lockInPlayer,
  makeClientConfig,
  PICK_PHASE_SECONDS,
  REVEAL_ADJUST_SECONDS,
  setPlayerAbilities,
  setPlayerWeapon,
  SnapshotBuffer,
  startMatch,
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

const randomHand = (): AbilityId[] => {
  const pool = [...ABILITY_IDS];
  const hand: AbilityId[] = [];
  for (let i = 0; i < LOADOUT_ABILITY_COUNT; i++) {
    hand.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  }
  return hand;
};

/** The bot's clock for one draft phase — everything in ms since the phase opened. */
interface BotDraftPlan {
  /** Blind pick: when the bot commits its loadout. */
  pickAtMs: number;
  /** Counterpick: when a bait weapon-swap lands (null = it stays honest). */
  swapAtMs: number | null;
  swapTo: WeaponId;
  lockAtMs: number;
}

const makePickPlan = (): BotDraftPlan => {
  const pickAtMs = 1500 + Math.random() * 3000;
  return {
    pickAtMs,
    swapAtMs: null,
    swapTo: randomWeapon(),
    lockAtMs: pickAtMs + 1200 + Math.random() * 3800,
  };
};

const makeRevealPlan = (revealed: WeaponId): BotDraftPlan => {
  const swapping = Math.random() < 0.5;
  const others = WEAPON_IDS.filter((w) => w !== revealed);
  const swapAtMs = 1500 + Math.random() * 4000;
  return {
    pickAtMs: 0,
    swapAtMs: swapping ? swapAtMs : null,
    swapTo: others[Math.floor(Math.random() * others.length)]!,
    lockAtMs: swapAtMs + 800 + Math.random() * 3200, // decide first, then commit
  };
};

export class PracticeClient implements LobbyClient {
  readonly buffer = new SnapshotBuffer(TICK_RATE);
  status: ConnectionStatus = "open";
  welcome: WelcomeInfo | null;
  roomState: RoomStateInfo | null = null;
  /** Round phase from the newest tick — App routes pick/reveal → RoomScreen,
   * match phases → GameScreen, and back to the menu on "lobby". */
  phase: RoundPhase;

  onChange: (() => void) | null = null;
  onEvents: ((events: ArenaEvent[]) => void) | null = null;

  private readonly sim: ArenaSim;
  private readonly botMemory: BotMemory = createBotMemory();
  private readonly botStrategy: BotStrategy;
  private botPlan: BotDraftPlan;
  private draftPhase: RoundPhase;
  private phaseStartMs: number;
  private draftTimer: ReturnType<typeof setInterval> | null = null;
  private lastSnap: SnapshotMsg;
  private seq = 0;

  constructor(playerName: string) {
    // Practice needn't be replayable — wall-clock seeding is fine here.
    this.sim = createSim(ARENA_00, Date.now() >>> 0);
    this.botStrategy = BOT_STRATEGIES[Math.floor(Math.random() * BOT_STRATEGIES.length)]!;
    const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]!;

    addPlayer(this.sim, playerName);
    addPlayer(this.sim, botName);
    const events: ArenaEvent[] = [];
    // The real draft, real timings — practice is the draft's test bed.
    startMatch(this.sim, events, {
      pickSeconds: PICK_PHASE_SECONDS,
      adjustSeconds: REVEAL_ADJUST_SECONDS,
    });
    this.phase = this.sim.state.round.phase;
    this.draftPhase = this.phase;
    this.phaseStartMs = performance.now();
    this.botPlan = makePickPlan();

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
    this.lastSnap = toSnapshot(this.sim.state, events);
    this.buffer.push(this.lastSnap, performance.now());

    // The draft owns the clock until the countdown starts.
    this.draftTimer = setInterval(() => this.draftTick(), 1000 / TICK_RATE);
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

  lockIn(): void {
    if (lockInPlayer(this.sim, 0)) {
      this.refreshRoomState();
      this.onChange?.(); // all-locked ends the phase on the next draft tick
    }
  }

  /** The draft starts itself in the constructor — nothing for the host button. */
  startMatch(): void {}

  /** One 30Hz draft tick: run the bot's phase plan, then advance the machine. */
  private draftTick(): void {
    const phase = this.sim.state.round.phase;
    if (phase !== this.draftPhase) {
      // A phase flipped since the last tick — restart the bot's clock.
      this.draftPhase = phase;
      this.phaseStartMs = performance.now();
      if (phase === "reveal") {
        const revealed = this.sim.state.players[1]?.revealedWeapon ?? randomWeapon();
        this.botPlan = makeRevealPlan(revealed);
      }
    }

    const elapsed = performance.now() - this.phaseStartMs;
    const plan = this.botPlan;
    const bot = this.sim.state.players[1];
    if (bot && !bot.lockedIn) {
      if (phase === "pick" && elapsed >= plan.pickAtMs && bot.weapon === null) {
        setPlayerWeapon(this.sim, 1, randomWeapon());
        setPlayerAbilities(this.sim, 1, randomHand());
        this.refreshRoomState(); // enemy rows only show the lock state — but keep truthful
        this.onChange?.();
      }
      if (phase === "reveal" && plan.swapAtMs !== null && elapsed >= plan.swapAtMs && bot.weapon !== plan.swapTo) {
        setPlayerWeapon(this.sim, 1, plan.swapTo); // the bait — hidden, like a human's
        this.refreshRoomState();
        this.onChange?.();
      }
      const ready = phase === "reveal" || bot.weapon !== null;
      if (ready && elapsed >= plan.lockAtMs) {
        lockInPlayer(this.sim, 1);
        this.refreshRoomState();
        this.onChange?.();
      }
    }

    this.step(new Map()); // nobody moves pre-countdown; the clock still runs
    const p = this.sim.state.round.phase;
    if (p !== "pick" && p !== "reveal" && this.draftTimer !== null) {
      clearInterval(this.draftTimer); // draft closed — GameScreen takes over
      this.draftTimer = null;
    }
  }

  /** GameScreen's fixed 30Hz input send IS the sim tick from the countdown on. */
  sendInput(sx: number, sy: number, dash: boolean): void {
    if (this.draftTimer !== null) return; // the draft still owns the clock
    const bot = botThink(
      this.botMemory,
      this.botStrategy,
      this.lastSnap.players.find((p) => p.id === 1),
      this.lastSnap.players.find((p) => p.id === 0),
    );
    this.step(
      new Map([
        [0, { seq: this.seq++, sx, sy, dash }],
        [1, { seq: 0, sx: bot.sx, sy: bot.sy, dash: bot.dash }],
      ]),
    );
  }

  private step(inputs: Map<number, { seq: number; sx: number; sy: number; dash: boolean }>): void {
    const events = stepSim(this.sim, inputs, TICK_DT);
    this.lastSnap = toSnapshot(this.sim.state, events);
    const drained = this.buffer.push(this.lastSnap, performance.now());
    if (drained.length > 0) this.onEvents?.(drained);
    if (this.lastSnap.round.phase !== this.phase) {
      this.phase = this.lastSnap.round.phase; // pick → reveal → countdown → … routes the UI
      this.refreshRoomState();
      this.onChange?.();
    }
  }

  private refreshRoomState(): void {
    this.roomState = { players: toRoomStatePlayers(this.sim.state, 1), hostId: 0 };
  }

  close(): void {
    if (this.draftTimer !== null) clearInterval(this.draftTimer);
    this.draftTimer = null;
    this.onChange = null;
    this.onEvents = null;
  }
}
