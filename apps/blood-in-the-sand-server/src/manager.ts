/**
 * The room registry + the one clock. Rooms live purely in this process's
 * memory (decided 2026-07-09 — a room is exactly as ephemeral as the match
 * inside it, so a DB would only persist pointers to vanished matches).
 *
 * One 30Hz interval steps every room off a single real-time accumulator; a
 * 60s sweep collects rooms that have sat empty past the grace window. The
 * decision logic (codes, join rules, GC policy) is pure in the sim package.
 */
import { randomUUID } from "node:crypto";
import type { Server } from "bun";
import { advanceFixed } from "@heroic/core";
import {
  ABILITIES,
  HEARTBEAT_SWEEP_MS,
  HEARTBEAT_TIMEOUT_MS,
  LOADOUT_ABILITY_COUNT,
  MAX_ROOMS,
  PROTOCOL_VERSION,
  RANKED_BRACKETS,
  TICK_DT,
  TICK_RATE,
  WEAPONS,
  canJoin,
  generateRoomCode,
  sanitizePasscode,
  sanitizeRoomName,
  sanitizeTeamSize,
  seatedPlayers,
  shouldCollect,
  type ClientMsg,
  type RoomListing,
  type ServerMsg,
  type Team,
} from "@heroic/blood-in-the-sand-sim";
import {
  PLACEMENT_MATCHES,
  findPlayerByToken,
  getRating,
  recordRankedBotMatch,
  recordRankedMatch,
  type Db,
} from "@heroic/blood-in-the-sand-persistence";
import { Room, type ClientData, type RankedSeatAccount, type Socket } from "./room";
import {
  ARM_DEADLINE_MS,
  MATCHER_INTERVAL_MS,
  RankedQueue,
  SEASON,
  type BracketStatus,
  type QueueEntry,
  type QueueMatch,
} from "./ranked";
import {
  BotIdentityBook,
  botBackfillConfigFromEnv,
  botDeadline,
  botSubjectId,
  difficultyForRating,
  fuzzedQueueSize,
  mirrorRating,
  type BotBackfillConfig,
} from "./botBackfill";

const SWEEP_MS = 60_000;
const MAX_PLAYER_NAME = 16;
const MAX_ANNOUNCER_ID = 32;
/** DB settlement retries — the batch is idempotent, so retrying is free. */
const SETTLE_ATTEMPTS = 3;
const SETTLE_BACKOFF_MS = 1_000;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly queue = new RankedQueue(Object.keys(RANKED_BRACKETS));
  private server: Server<ClientData> | null = null;
  private accumulator = 0;
  private lastMs = 0;

  /** `db` null = ranked is off (no creds / DB unreachable at boot): skirmish
   * runs untouched and queueJoin rejects honestly. Bot backfill
   * (bits-ranked-bots.md) rides ranked — no db, no bots; the config's kill
   * switch turns it (and the queue-size fuzz) off without a build. */
  constructor(
    private readonly db: Db | null = null,
    private readonly botCfg: BotBackfillConfig = botBackfillConfigFromEnv(),
    private readonly identityBook: BotIdentityBook = new BotIdentityBook(),
  ) {}

  private botBackfillOn(): boolean {
    return this.db !== null && this.botCfg.enabled;
  }

  start(server: Server<ClientData>): void {
    this.server = server;
    this.lastMs = performance.now();
    // ~30 firings/s, but each firing measures REAL elapsed time and runs the
    // accumulator — interval jitter never drifts the sim clocks.
    setInterval(() => this.tick(), 1000 / TICK_RATE);
    setInterval(() => this.sweep(), SWEEP_MS);
    setInterval(() => this.heartbeat(), HEARTBEAT_SWEEP_MS);
    setInterval(() => this.rankedBeat(), MATCHER_INTERVAL_MS);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  message(ws: Socket, raw: string | Buffer): void {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw)) as ClientMsg;
    } catch {
      return; // not our protocol — drop it
    }
    // Any message from a seated socket proves it's alive — refresh its
    // heartbeat before dispatching (input covers a match; ping covers the
    // quiet lobby). Unseated create/join traffic simply has no seat to stamp.
    if (ws.data.playerId !== null) this.roomOf(ws)?.markSeen(ws.data.playerId, performance.now());
    switch (msg.t) {
      case "createRoom":
        return this.onCreate(ws, msg);
      case "joinRoom":
        return this.onJoin(ws, msg);
      case "listRooms":
        return this.sendRooms(ws);
      case "watchRoom":
        return this.onWatch(ws, msg.code);
      case "leaveRoom": {
        const room = this.roomOf(ws);
        room?.dropSocket(ws, performance.now());
        this.send(ws, { t: "left" });
        // The host leaving no longer ends everyone's night (reversed v7): the
        // crown hands off and the room lives on. reconcileHost migrates (or
        // closes only if this was the last player) — for a non-host leaver it's
        // a no-op. The leaver is already detached, so a notice never reaches them.
        if (room) this.reconcileHost(room, performance.now());
        return;
      }
      case "setWeapon": {
        const id = ws.data.playerId;
        // Never trust the wire: the pick must be a real weapon id.
        if (id !== null && typeof msg.weapon === "string" && msg.weapon in WEAPONS) {
          this.roomOf(ws)?.setWeapon(id, msg.weapon, performance.now());
        }
        return;
      }
      case "setAbilities": {
        const id = ws.data.playerId;
        // Shape check here; the sim re-validates (distinct, known) regardless.
        if (
          id !== null &&
          Array.isArray(msg.abilities) &&
          msg.abilities.length <= LOADOUT_ABILITY_COUNT &&
          msg.abilities.every((a) => typeof a === "string" && a in ABILITIES)
        ) {
          this.roomOf(ws)?.setAbilities(id, msg.abilities, performance.now());
        }
        return;
      }
      case "forceStart": {
        const id = ws.data.playerId;
        if (id !== null) this.roomOf(ws)?.forceStart(id, performance.now());
        return;
      }
      case "cancelStart": {
        const id = ws.data.playerId;
        if (id !== null) this.roomOf(ws)?.cancelStart(id, performance.now());
        return;
      }
      case "switchTeam": {
        const id = ws.data.playerId;
        if (id !== null) this.roomOf(ws)?.switchTeam(id, performance.now());
        return;
      }
      case "ping":
        return; // liveness only — the seat was already stamped above
      case "input": {
        const id = ws.data.playerId;
        if (id !== null) this.roomOf(ws)?.input(id, msg);
        return;
      }
      case "queueJoin":
        return this.onQueueJoin(ws, msg);
      case "queueLeave": {
        if (this.queue.removeSocket(ws)) this.send(ws, { t: "queueLeft" });
        return;
      }
      case "queueInfo":
        return this.send(ws, { t: "queueStatus", brackets: this.queueStatusFor(ws, performance.now()) });
    }
  }

  close(ws: Socket): void {
    this.queue.removeSocket(ws); // a dead socket can't hold a place in line
    const room = this.roomOf(ws);
    room?.dropSocket(ws, performance.now());
    // A host who drops in the LOBBY frees their seat here → the crown hands off
    // to another player (or the room closes if they were the last one). A
    // mid-match host disconnect keeps the seat (disconnected, not freed) so the
    // match plays on; the crown still migrates to a connected teammate, and the
    // idle body's seat frees at match end.
    if (room) this.reconcileHost(room, performance.now());
  }

  /** Close a room and drop it from the registry — everyone still seated gets a
   * `roomClosed` kick with the reason. */
  private closeRoom(room: Room, reason: string): void {
    room.kickAll(reason);
    this.rooms.delete(room.meta.code);
    // Every close path releases a backfill bot's name back to the pool.
    if (room.ranked) {
      for (const account of room.ranked.accounts.values()) {
        if (account.bot) this.identityBook.release(account.name);
      }
    }
    console.log(`✝ room ${room.meta.code} "${room.meta.name}" closed — ${reason}`);
  }

  /** Keep every room's crown on a connected player, closing only the ones with
   * nobody left. Cheap to run after any departure and after each tick (it
   * catches the host who never returned from a mid-match disconnect, whose seat
   * frees only at match end). Iterates a snapshot — reconcileHost may delete. */
  private reconcileHosts(nowMs: number): void {
    for (const room of [...this.rooms.values()]) this.reconcileHost(room, nowMs);
  }

  /** Reconcile ONE room's host: migrate the crown (with a lobby notice) if its
   * holder is gone, or close the room if the last player left. */
  private reconcileHost(room: Room, nowMs: number): void {
    // Ranked rooms are hostless in behaviour — no crown to migrate, no
    // handoff notices. Their lifecycle (voids, post-match close) lives in
    // tendRankedRooms; the one shared rule is "deserted = dead". A deserted
    // UN-ENDED arming lobby is a dodge, not a mere close: whoever bailed
    // eats the lockout (load-bearing with a bot opponent — isDeserted
    // ignores bots, so one human leaving deserts the room instantly and
    // would otherwise dodge free every time; bits-ranked-bots.md).
    if (room.ranked) {
      if (room.isDeserted()) {
        if (!room.ranked.ended && room.sim.state.round.phase === "lobby") {
          this.voidRanked(room, nowMs, () => true);
        } else {
          this.closeRoom(room, "everyone left the room");
        }
      }
      return;
    }
    const result = room.reassignHost(nowMs);
    if (result === "empty") {
      // Nobody connected to hold the crown. Close only if the room is truly
      // deserted (lobby — all seats freed); a mid-match room whose players are
      // merely disconnected keeps its idling bodies for the rejoin window and
      // is left to the GC grace sweep instead.
      if (room.isDeserted()) this.closeRoom(room, "everyone left the room");
    } else if (result) {
      room.notice(`${result.from} left — ${result.to} is now the host.`);
    }
  }

  /** Free ghost seats: any socket gone silent past the heartbeat timeout (a
   * force-quit / lost-network client that never sent a close frame), then
   * reconcile crowns so a timed-out host hands off rather than freezing a full
   * room. */
  private heartbeat(): void {
    const now = performance.now();
    for (const room of this.rooms.values()) room.sweepStale(now, HEARTBEAT_TIMEOUT_MS);
    this.reconcileHosts(now);
  }

  private roomOf(ws: Socket): Room | undefined {
    return ws.data.roomCode === null ? undefined : this.rooms.get(ws.data.roomCode);
  }

  private onCreate(ws: Socket, msg: Extract<ClientMsg, { t: "createRoom" }>): void {
    if (!this.versionOk(ws, msg.v) || this.leaveFirst(ws)) return;
    // Ranked rooms don't spend the skirmish budget — their count is bounded
    // by the queue's population, not by players deciding to open rooms.
    if ([...this.rooms.values()].filter((r) => !r.ranked).length >= MAX_ROOMS) {
      return this.send(ws, { t: "reject", reason: "the server is at its room limit — try again soon" });
    }
    const playerName = sanitizeName(msg.playerName);
    const code = generateRoomCode(new Set(this.rooms.keys()), Math.random);
    const teamSize = sanitizeTeamSize(msg.teamSize);
    const room = new Room(
      this.server!,
      {
        code,
        name: sanitizeRoomName(msg.roomName, `${playerName}'s room`),
        passcode: sanitizePasscode(msg.pass),
        hostId: 0, // the creator takes seat 0 below
      },
      Date.now() >>> 0,
      teamSize,
      performance.now(),
    );
    this.rooms.set(code, room);
    room.seat(ws, playerName, sanitizeAnnouncer(msg.announcer), performance.now());
    console.log(
      `⚔ room ${code} "${room.meta.name}" (${teamSize}v${teamSize}) created by ${playerName}${room.meta.passcode ? " (locked)" : ""}`,
    );
  }

  private onJoin(ws: Socket, msg: Extract<ClientMsg, { t: "joinRoom" }>): void {
    if (!this.versionOk(ws, msg.v) || this.leaveFirst(ws)) return;
    const room = this.rooms.get((msg.code ?? "").trim().toUpperCase());
    if (!room) return this.send(ws, { t: "reject", reason: "no such room" });
    // A ranked room admits exactly the matched pair. The one outside door is
    // the rejoin: a disconnected seat may be reclaimed (the client knows its
    // code from the welcome), so "the rejoin window stands" holds for ranked.
    if (room.ranked && !room.hasDisconnectedSeat()) {
      return this.send(ws, { t: "reject", reason: "that match can't be joined" });
    }

    const verdict = canJoin({
      freeSeatInLobby: room.ranked ? false : room.hasFreeSeatInLobby(),
      disconnectedSeat: room.hasDisconnectedSeat(),
      passcode: room.meta.passcode,
      offeredPass: typeof msg.pass === "string" ? msg.pass.trim() : null,
    });
    if (verdict !== "ok") return this.send(ws, { t: "reject", reason: verdict });

    const playerName = sanitizeName(msg.playerName);
    const id = room.seat(ws, playerName, sanitizeAnnouncer(msg.announcer), performance.now());
    if (id === null) return this.send(ws, { t: "reject", reason: "room full" });
    console.log(`⚔ ${playerName} joined room ${room.meta.code} as player ${id}`);
  }

  private onWatch(ws: Socket, code: string): void {
    if (this.leaveFirst(ws)) return;
    const room = this.rooms.get((code ?? "").trim().toUpperCase());
    if (!room) return this.send(ws, { t: "reject", reason: "no such room" });
    room.watch(ws);
  }

  private sendRooms(ws: Socket): void {
    // Ranked rooms never appear in the browser — unlisted by design.
    const rooms: RoomListing[] = [...this.rooms.values()].filter((r) => !r.ranked).map((r) => r.listing());
    this.send(ws, { t: "rooms", rooms });
  }

  // ── ranked (bits-ranked.md) ──────────────────────────────────────────────

  private onQueueJoin(ws: Socket, msg: Extract<ClientMsg, { t: "queueJoin" }>): void {
    if (!this.versionOk(ws, msg.v)) return;
    if (!this.db) return this.send(ws, { t: "reject", reason: "ranked is unavailable on this server" });
    const brackets = Array.isArray(msg.brackets)
      ? [...new Set(msg.brackets.filter((b): b is string => typeof b === "string" && b in RANKED_BRACKETS))]
      : [];
    if (brackets.length === 0) return this.send(ws, { t: "reject", reason: "no such bracket" });
    if (typeof msg.token !== "string" || msg.token.length === 0 || msg.token.length > 128) {
      return this.send(ws, { t: "reject", reason: "ranked sign-in failed — restart the app" });
    }
    this.leaveFirst(ws);
    const name = sanitizeName(msg.playerName);
    const announcer = sanitizeAnnouncer(msg.announcer);
    // Token verification + rating loads are async; the socket handler is not.
    // Everything after the awaits re-checks the socket's world before acting.
    void this.verifyAndEnqueue(ws, msg.token, name, announcer, brackets).catch((err) => {
      console.error("queueJoin failed:", err);
      this.trySend(ws, { t: "reject", reason: "ranked is unreachable right now — try again" });
    });
  }

  private async verifyAndEnqueue(
    ws: Socket,
    token: string,
    name: string,
    announcer: string,
    brackets: string[],
  ): Promise<void> {
    const db = this.db!;
    // The verified identity sticks to the socket — re-queues skip the lookup.
    const accountId = ws.data.accountId ?? (await findPlayerByToken(db, token));
    if (!accountId) {
      return this.trySend(ws, { t: "reject", reason: "ranked sign-in failed — restart the app" });
    }
    ws.data.accountId = accountId;
    const lockLeft = this.queue.lockoutLeft(accountId, performance.now());
    if (lockLeft > 0) {
      return this.trySend(ws, { t: "reject", reason: `queue lockout — try again in ${lockLeft}s` });
    }
    const ratings = new Map<string, number>();
    for (const bracket of brackets) {
      ratings.set(bracket, (await getRating(db, accountId, SEASON, bracket)).rating);
    }
    // The awaits are behind us — only now touch the queue, and only if the
    // socket didn't close or wander into a room while we were away.
    if (ws.readyState !== 1 || ws.data.roomCode !== null) return;
    const now = performance.now();
    for (const bracket of brackets) {
      this.queue.enqueue(bracket, {
        ws,
        accountId,
        name,
        announcer,
        rating: ratings.get(bracket)!,
        joinedMs: now,
        ...(this.botBackfillOn() ? { botAtMs: botDeadline(now, this.botCfg, Math.random) } : {}),
      });
    }
    this.trySend(ws, { t: "queueStatus", brackets: this.queueStatusFor(ws, now) });
  }

  /** The slow beat: tend ranked-room lifecycles, run the matcher, refresh
   * every queued client's status. */
  private rankedBeat(): void {
    const now = performance.now();
    this.tendRankedRooms(now);
    // Human pairing always wins the beat — backfill only takes what it left.
    for (const match of this.queue.match(now)) this.createRankedRoom(match, now);
    if (this.botBackfillOn()) {
      // TODO(v2): population-aware trigger — skip backfill while the bracket's
      // queue size is ≥ N and let the wait ride instead.
      for (const { bracket, entry } of this.queue.takeOverdue(now, ["1v1"])) {
        this.createRankedBotRoom(bracket, entry, now);
      }
    }
    for (const ws of this.queue.queuedSockets()) {
      this.trySend(ws, { t: "queueStatus", brackets: this.queueStatusFor(ws, now) });
    }
  }

  /** The displayed queue numbers: honest, unless backfill is on — then the
   * fuzz rides EVERY read (queueStatus and queueInfo agree by construction)
   * so "1 in queue → match found" never appears (bits-ranked-bots.md). */
  private queueStatusFor(ws: Socket | null, now: number): BracketStatus[] {
    const brackets = this.queue.statusFor(ws, now);
    if (!this.botBackfillOn()) return brackets;
    return brackets.map((b) => ({ ...b, size: fuzzedQueueSize(b.size, b.bracket, now) }));
  }

  private createRankedRoom(match: QueueMatch, now: number): void {
    // A socket can die between beats — never build a room around a corpse;
    // the survivor goes straight back in line.
    if (match.a.ws.readyState !== 1 || match.b.ws.readyState !== 1) {
      for (const e of [match.a, match.b]) {
        if (e.ws.readyState === 1) this.queue.enqueue(match.bracket, this.requeued(e));
      }
      return;
    }
    const teamSize = RANKED_BRACKETS[match.bracket as keyof typeof RANKED_BRACKETS].teamSize;
    const code = generateRoomCode(new Set(this.rooms.keys()), Math.random);
    const room = new Room(
      this.server!,
      { code, name: `Ranked ${match.bracket}`, passcode: null, hostId: 0 },
      Date.now() >>> 0,
      teamSize,
      now,
    );
    room.ranked = { bracket: match.bracket, matchId: randomUUID(), accounts: new Map(), ended: false, settled: false };
    room.onRankedMatchEnd = (winnerTeam) => void this.settleRanked(room, winnerTeam);
    this.rooms.set(code, room);
    for (const entry of [match.a, match.b]) {
      this.trySend(entry.ws, { t: "matchFound", bracket: match.bracket, code });
      const id = room.seat(entry.ws, entry.name, entry.announcer, now);
      if (id === null) continue; // two seats, two players — can't happen
      room.ranked.accounts.set(id, {
        accountId: entry.accountId,
        name: entry.name,
        announcer: entry.announcer,
        rating: entry.rating,
        joinedMs: entry.joinedMs,
      });
    }
    console.log(
      `⚔ ranked ${match.bracket} room ${code}: ${match.a.name} (${match.a.rating}) vs ${match.b.name} (${match.b.rating})`,
    );
  }

  /** A queue entry whose bot deadline passed with no human to pair: a room
   * against a server bot styled as a player (bits-ranked-bots.md). Mirrors
   * createRankedRoom; the `[bot]` marker below is the ONLY place the truth
   * is written — nothing on the wire carries it. */
  private createRankedBotRoom(bracket: string, entry: QueueEntry, now: number): void {
    if (entry.ws.readyState !== 1) return; // died between beats — already unqueued
    const teamSize = RANKED_BRACKETS[bracket as keyof typeof RANKED_BRACKETS].teamSize;
    const code = generateRoomCode(new Set(this.rooms.keys()), Math.random);
    const room = new Room(
      this.server!,
      { code, name: `Ranked ${bracket}`, passcode: null, hostId: 0 },
      Date.now() >>> 0,
      teamSize,
      now,
    );
    room.ranked = { bracket, matchId: randomUUID(), accounts: new Map(), ended: false, settled: false };
    room.onRankedMatchEnd = (winnerTeam) => void this.settleRanked(room, winnerTeam);
    this.rooms.set(code, room);

    this.trySend(entry.ws, { t: "matchFound", bracket, code });
    const humanId = room.seat(entry.ws, entry.name, entry.announcer, now);
    if (humanId === null) {
      // A fresh room can't be full — belt-and-braces: never leak the room.
      this.closeRoom(room, "the match was called off");
      return;
    }
    room.ranked.accounts.set(humanId, {
      accountId: entry.accountId,
      name: entry.name,
      announcer: entry.announcer,
      rating: entry.rating,
      joinedMs: entry.joinedMs,
    });

    const botName = this.identityBook.pick(entry.accountId, Math.random);
    const difficulty = difficultyForRating(entry.rating);
    const botRating = mirrorRating(entry.rating, this.botCfg.ratingJitter, Math.random);
    const botSeat = room.seatRankedBot(botName, difficulty, now);
    if (botSeat === null) {
      this.identityBook.release(botName);
      this.voidRanked(room, now, () => false); // nobody's fault — requeue the human
      return;
    }
    // BOTH accounts land in the map so the settleRanked guard passes; the
    // bot entry's flag routes settlement to the one-sided writer.
    room.ranked.accounts.set(botSeat, {
      accountId: botSubjectId(),
      name: botName,
      announcer: "default",
      rating: botRating,
      joinedMs: now,
      bot: true,
    });
    console.log(
      `⚔ ranked ${bracket} room ${code}: ${entry.name} (${entry.rating}) vs ${botName} (${botRating}) [bot:${difficulty}]`,
    );
  }

  /** Ranked-room lifecycle, one pass per beat: close settled rooms whose sim
   * returned to lobby, and void arming rooms that lost a player or blew the
   * deadline. Mid-match rooms are left entirely alone — the arena's own laws
   * (idling bodies, rejoin, natural wipes) already cover them. */
  private tendRankedRooms(now: number): void {
    for (const room of [...this.rooms.values()]) {
      const ctx = room.ranked;
      if (!ctx) continue;
      const phase = room.sim.state.round.phase;
      if (ctx.ended) {
        // The room holds the matchEnd ceremony's final frame (it never steps
        // the sim back to lobby — bits-ranked-bots.md § match end); once the
        // hold is reached AND the settlement landed, its life is over. This
        // roomClosed is the authoritative "match over, leave" signal.
        if (room.ceremonyOver && ctx.settled) this.closeRoom(room, "match complete");
        continue;
      }
      if (phase !== "lobby") continue;
      const seated = seatedPlayers(room.sim.state);
      const someoneGone = seated.length < room.sim.state.players.length || seated.some((p) => !p.connected);
      if (someoneGone) {
        const present = new Set(seated.filter((p) => p.connected).map((p) => p.id));
        this.voidRanked(room, now, (seatId) => !present.has(seatId));
      } else if (now - room.createdAtMs > ARM_DEADLINE_MS) {
        const unarmed = new Set(room.unarmedSeatIds());
        this.voidRanked(room, now, (seatId) => unarmed.has(seatId));
      }
    }
  }

  /** Call an unstarted ranked match off: `dodged` picks the seats at fault
   * (they eat the queue lockout); everyone else still connected goes straight
   * back in line with their original wait — a void never costs the innocent
   * party their place. */
  private voidRanked(room: Room, now: number, dodged: (seatId: number) => boolean): void {
    const ctx = room.ranked!;
    ctx.ended = true; // no settle will ever run for this match id
    ctx.settled = true;
    const requeue: QueueEntry[] = [];
    for (const [seatId, account] of ctx.accounts) {
      // A backfill bot is never at fault and never rejoins a line — its name
      // frees on the close below.
      if (account.bot) continue;
      if (dodged(seatId)) {
        this.queue.lockout(account.accountId, now);
        console.log(`[${room.meta.code}] ranked void — ${account.name} dodged (lockout)`);
        continue;
      }
      const ws = room.socketOf(seatId);
      if (ws && ws.readyState === 1) {
        requeue.push(
          this.requeued({
            ws,
            accountId: account.accountId,
            name: account.name,
            announcer: account.announcer,
            rating: account.rating,
            joinedMs: account.joinedMs,
          }),
        );
      }
    }
    const bracket = ctx.bracket;
    this.closeRoom(room, "the match was called off"); // detaches every socket first…
    for (const entry of requeue) {
      this.queue.enqueue(bracket, entry); // …then the innocents rejoin the line
      this.trySend(entry.ws, { t: "queueStatus", brackets: this.queueStatusFor(entry.ws, now) });
    }
  }

  /** A re-queued entry keeps its earned wait (joinedMs) but rolls a FRESH bot
   * deadline — a void must never pop an instant bot (bits-ranked-bots.md). */
  private requeued(entry: QueueEntry): QueueEntry {
    if (!this.botBackfillOn()) {
      const { botAtMs: _stale, ...rest } = entry;
      return rest;
    }
    return { ...entry, botAtMs: botDeadline(performance.now(), this.botCfg, Math.random) };
  }

  /** The recorder (bits-ranked.md § result recording): Elo + history + Glory
   * land in one idempotent batch keyed on the match id, then the settlement
   * broadcasts into the room as `rankedResult` so the ceremony needs no API
   * poll. Retries are free; a conclusive failure is logged loudly and the
   * room is still allowed to close. */
  private async settleRanked(room: Room, winnerTeam: Team): Promise<void> {
    const ctx = room.ranked!;
    try {
      const seated = seatedPlayers(room.sim.state);
      const winner = seated.find((p) => p.team === winnerTeam);
      const loser = seated.find((p) => p.team !== winnerTeam);
      const winnerAccount = winner && ctx.accounts.get(winner.id);
      const loserAccount = loser && ctx.accounts.get(loser.id);
      if (!winner || !loser || !winnerAccount || !loserAccount) {
        console.error(`[${room.meta.code}] ranked settle: seats/accounts missing — match ${ctx.matchId} unrecorded`);
        return;
      }
      // A bot on either side routes to the one-sided writer: the human's Elo,
      // history, and Glory land; the bot's side of the result is fabricated
      // upstream (bits-ranked-bots.md) and never touches the ladder.
      const botSide = winnerAccount.bot ? "winner" : loserAccount.bot ? "loser" : null;
      const record = botSide
        ? () =>
            recordRankedBotMatch(this.db!, {
              matchId: ctx.matchId,
              season: SEASON,
              bracket: ctx.bracket,
              humanId: (botSide === "winner" ? loserAccount : winnerAccount).accountId,
              humanWon: botSide === "loser",
              botId: (botSide === "winner" ? winnerAccount : loserAccount).accountId,
              botRating: (botSide === "winner" ? winnerAccount : loserAccount).rating,
              humanLoadout:
                botSide === "winner"
                  ? { weapon: loser.weapon, abilities: loser.abilities }
                  : { weapon: winner.weapon, abilities: winner.abilities },
              botLoadout:
                botSide === "winner"
                  ? { weapon: winner.weapon, abilities: winner.abilities }
                  : { weapon: loser.weapon, abilities: loser.abilities },
            })
        : () =>
            recordRankedMatch(this.db!, {
              matchId: ctx.matchId,
              season: SEASON,
              bracket: ctx.bracket,
              winnerId: winnerAccount.accountId,
              loserId: loserAccount.accountId,
              winnerLoadout: { weapon: winner.weapon, abilities: winner.abilities },
              loserLoadout: { weapon: loser.weapon, abilities: loser.abilities },
            });
      for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt++) {
        try {
          const result = await record();
          if (result) {
            room.publish({
              t: "rankedResult",
              matchId: ctx.matchId,
              bracket: ctx.bracket,
              winnerTeam,
              results: [
                { playerId: winner.id, ...sideResult(result.winner) },
                { playerId: loser.id, ...sideResult(result.loser) },
              ],
            });
            console.log(
              `[${room.meta.code}] ranked settled: ${winnerAccount.name} ${result.winner.before}→${result.winner.after} (+${result.winner.glory}g), ${loserAccount.name} ${result.loser.before}→${result.loser.after} (+${result.loser.glory}g)`,
            );
          }
          return; // null = already settled (a replay) — nothing more to do
        } catch (err) {
          console.error(`[${room.meta.code}] ranked settle attempt ${attempt}/${SETTLE_ATTEMPTS} failed:`, err);
          if (attempt < SETTLE_ATTEMPTS) await Bun.sleep(SETTLE_BACKOFF_MS * attempt);
        }
      }
      console.error(`[${room.meta.code}] ranked match ${ctx.matchId} LOST to the ledger — every settle attempt failed`);
    } finally {
      ctx.settled = true; // the room may close either way
    }
  }

  /** A socket already in a room must leave it before creating/joining another
   * — and entering a room always leaves the queue (one place at a time). */
  private leaveFirst(ws: Socket): boolean {
    this.queue.removeSocket(ws);
    const room = this.roomOf(ws);
    room?.dropSocket(ws, performance.now());
    if (room) this.reconcileHost(room, performance.now()); // a host who hops hands off the room they left
    return false; // never blocks — just cleans up
  }

  private versionOk(ws: Socket, v: number): boolean {
    if (v === PROTOCOL_VERSION) return true;
    this.send(ws, {
      t: "reject",
      reason: `protocol mismatch (server v${PROTOCOL_VERSION}, you v${v}) — update the app`,
    });
    return false;
  }

  private tick(): void {
    const now = performance.now();
    const elapsed = (now - this.lastMs) / 1000;
    this.lastMs = now;
    const result = advanceFixed(this.accumulator, elapsed, { step: TICK_DT, maxSteps: 4 });
    this.accumulator = result.accumulator;
    if (result.steps === 0) return;
    for (const room of this.rooms.values()) room.step(result.steps, now);
    // Match end frees a never-returned host's idle seat — hand the crown off
    // (or close the room if that seat was the last one).
    this.reconcileHosts(now);
  }

  private sweep(): void {
    const now = performance.now();
    for (const [code, room] of this.rooms) {
      if (shouldCollect(room.connectedCount(), room.emptySinceMs, now)) {
        this.rooms.delete(code);
        console.log(`✝ room ${code} "${room.meta.name}" collected (empty)`);
      }
    }
  }

  private send(ws: Socket, msg: ServerMsg): void {
    ws.send(JSON.stringify(msg));
  }

  /** For sends after an await or on another socket's behalf — the target may
   * have died in the meantime, and that must never take the caller down. */
  private trySend(ws: Socket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // the close handler reaps the socket
    }
  }
}

/** One side of a settlement, shaped for the rankedResult wire rows. */
const sideResult = (side: {
  before: number;
  after: number;
  delta: number;
  tier: string;
  division: 1 | 2 | 3 | null;
  rankChange: "up" | "down" | null;
  glory: number;
  peak: number;
  newBest: boolean;
  matchesPlayed: number;
}) => ({
  before: side.before,
  after: side.after,
  delta: side.delta,
  tier: side.tier,
  division: side.division,
  rankChange: side.rankChange,
  glory: side.glory,
  peak: side.peak,
  newBest: side.newBest,
  // Still placing → the client shows "match N of 10" and hides the rating.
  placement:
    side.matchesPlayed <= PLACEMENT_MATCHES ? { number: side.matchesPlayed, of: PLACEMENT_MATCHES } : null,
});

const sanitizeName = (name: unknown): string =>
  ((typeof name === "string" ? name : "").trim().slice(0, MAX_PLAYER_NAME)) || "player";

/** The pack id is a free-form claim (the server doesn't know the pack roster,
 * and until the store exists there's nothing to entitle) — just keep the wire
 * honest: a length-capped string, anything else collapses to the default. */
const sanitizeAnnouncer = (pack: unknown): string =>
  ((typeof pack === "string" ? pack : "").trim().slice(0, MAX_ANNOUNCER_ID)) || "default";
