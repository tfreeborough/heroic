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
import { evaluate, streakUpdates } from "@heroic/achievements";
import {
  ABILITIES,
  ACHIEVEMENT_BOARDS,
  ACHIEVEMENT_DEFS,
  COUNTERS,
  GATED_ABILITIES,
  GATED_WEAPONS,
  HEARTBEAT_SWEEP_MS,
  HEARTBEAT_TIMEOUT_MS,
  LOADOUT_ABILITY_COUNT,
  MatchStatsAccumulator,
  MAX_ROOMS,
  PROTOCOL_VERSION,
  RANKED_BRACKETS,
  TICK_DT,
  TICK_RATE,
  WEAPONS,
  canJoin,
  counterDeltas,
  undyingStreakUpdates,
  generateRoomCode,
  sanitizePasscode,
  sanitizeRoomName,
  sanitizeTeamSize,
  seatedPlayers,
  shouldCollect,
  weaponEntitlement,
  abilityEntitlement,
  type ClientMsg,
  type RoomListing,
  type ServerMsg,
  type Team,
} from "@heroic/blood-in-the-sand-sim";
import {
  PLACEMENT_MATCHES,
  achievementCounters,
  achievementUnlocks,
  applyMatchAchievements,
  entitlementsOf,
  findPlayerByToken,
  getRating,
  gloryEarned,
  recordRankedMatch,
  type AchievementAward,
  type Db,
  type RankedMatchResult,
} from "@heroic/blood-in-the-sand-persistence";
import { Room, type ClientData, type RankedSeatAccount, type Socket } from "./room";
import {
  ACCEPT_WINDOW_MS,
  ARM_DEADLINE_MS,
  BOT_ACCEPT_MAX_MS,
  BOT_ACCEPT_MIN_MS,
  MATCHER_INTERVAL_MS,
  PendingMatch,
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
  type BotBackfillConfig,
} from "./botBackfill";

const SWEEP_MS = 60_000;
const MAX_PLAYER_NAME = 16;
const MAX_ANNOUNCER_ID = 32;
/** Deed ids are short kebab slugs; anything longer than this is garbage. */
const MAX_TITLE_ID = 64;
/** Seat tokens are server-minted UUIDs (36 chars) — anything longer is
 * garbage, and clamping keeps a hostile join from carrying a payload. */
const MAX_SEAT_TOKEN = 64;
/** Disguised ranked bots occasionally wear a plausible low-tier title —
 * bare bots would become a backfill tell once titles are common (the same
 * principle as bots counting toward deeds). Curated LOW-tier ids only: a
 * bot flexing "The World Serpent" invites scrutiny, "The Sand snake" does
 * not. Ids are persistence-frozen content, safe to hand-write here. */
const BOT_TITLE_CHANCE = 0.3;
const BOT_TITLES = ["sworn-to-the-sand", "ranked-wins-5"] as const;
/** The brackets whose overdue queuers may draw bots (bits-ranked-bots.md) —
 * derived from the protocol table, per-bracket by design (a future bracket
 * decides for itself; 2v2 flipped ON 2026-08-31 for launch population). */
const BACKFILL_BRACKETS: readonly string[] = Object.entries(RANKED_BRACKETS)
  .filter(([, spec]) => spec.botBackfill)
  .map(([key]) => key);
/** DB settlement retries — the batch is idempotent, so retrying is free. */
const SETTLE_ATTEMPTS = 3;
const SETTLE_BACKOFF_MS = 1_000;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly queue = new RankedQueue(Object.keys(RANKED_BRACKETS));
  /** Pairings awaiting everyone's yes (bits-ranked.md § Queue roaming &
   * match accept) — between the queue and a room, in neither. */
  private readonly pending: PendingMatch[] = [];
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
        // Never trust the wire: the pick must be a real weapon id — and a
        // GATED one must be owned (bits-secret-items.md): ranked seats
        // verify against the entitlements loaded at queue time (silent
        // ignore, the titles posture); skirmish takes the client's word.
        if (id !== null && typeof msg.weapon === "string" && msg.weapon in WEAPONS) {
          const room = this.roomOf(ws);
          if (
            room?.ranked &&
            GATED_WEAPONS.has(msg.weapon) &&
            !room.ranked.accounts.get(id)?.items.includes(weaponEntitlement(msg.weapon))
          ) {
            return;
          }
          room?.setWeapon(id, msg.weapon, performance.now());
        }
        return;
      }
      case "setAbilities": {
        const id = ws.data.playerId;
        // Shape check here; the sim re-validates (distinct, known) regardless.
        // Gated abilities get the setWeapon treatment (none exist yet — the
        // gate is ready for the first one).
        if (
          id !== null &&
          Array.isArray(msg.abilities) &&
          msg.abilities.length <= LOADOUT_ABILITY_COUNT &&
          msg.abilities.every((a) => typeof a === "string" && a in ABILITIES)
        ) {
          const room = this.roomOf(ws);
          if (
            room?.ranked &&
            msg.abilities.some(
              (a) => GATED_ABILITIES.has(a) && !room.ranked!.accounts.get(id)?.items.includes(abilityEntitlement(a)),
            )
          ) {
            return;
          }
          room?.setAbilities(id, msg.abilities, performance.now());
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
        // Leaving while summoned IS declining — the others must not wait
        // out the window on someone who already walked.
        this.declinePending(ws);
        if (this.queue.removeSocket(ws)) this.send(ws, { t: "queueLeft" });
        return;
      }
      case "queueInfo":
        return this.send(ws, { t: "queueStatus", brackets: this.queueStatusFor(ws, performance.now()) });
      case "matchAccept":
        return this.onMatchAccept(ws);
      case "matchDecline":
        return this.declinePending(ws);
    }
  }

  close(ws: Socket): void {
    this.queue.removeSocket(ws); // a dead socket can't hold a place in line
    this.declinePending(ws); // …nor answer a summons: a drop mid-pending is a dodge
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
    room.seat(ws, playerName, sanitizeAnnouncer(msg.announcer), sanitizeTitle(msg.title), null, performance.now());
    console.log(
      `⚔ room ${code} "${room.meta.name}" (${teamSize}v${teamSize}) created by ${playerName}${room.meta.passcode ? " (locked)" : ""}`,
    );
  }

  private onJoin(ws: Socket, msg: Extract<ClientMsg, { t: "joinRoom" }>): void {
    if (!this.versionOk(ws, msg.v) || this.leaveFirst(ws)) return;
    const room = this.rooms.get((msg.code ?? "").trim().toUpperCase());
    if (!room) return this.send(ws, { t: "reject", reason: "no such room" });
    const seatToken = sanitizeSeatToken(msg.seatToken);
    // A ranked room admits exactly the matched pair. The ONE outside door is
    // the token-proven rejoin (bits-reconnect.md § seat tokens): the client
    // knows its code AND its seat token from the welcome. Everything else —
    // no token, a wrong token, no disconnected seat — collapses to the same
    // "no such room" a guessed code gets: a ranked room doesn't exist to
    // outsiders, and the reject must not become an oracle saying otherwise.
    if (room.ranked && !room.hasReclaimableSeat(seatToken)) {
      return this.send(ws, { t: "reject", reason: "no such room" });
    }

    const verdict = canJoin({
      freeSeatInLobby: room.ranked ? false : room.hasFreeSeatInLobby(),
      reclaimableSeat: room.hasReclaimableSeat(seatToken),
      passcode: room.meta.passcode,
      offeredPass: typeof msg.pass === "string" ? msg.pass.trim() : null,
    });
    if (verdict !== "ok") return this.send(ws, { t: "reject", reason: verdict });

    const playerName = sanitizeName(msg.playerName);
    const id = room.seat(ws, playerName, sanitizeAnnouncer(msg.announcer), sanitizeTitle(msg.title), seatToken, performance.now());
    if (id === null) return this.send(ws, { t: "reject", reason: "room full" });
    console.log(`⚔ ${playerName} joined room ${room.meta.code} as player ${id}`);
  }

  private onWatch(ws: Socket, code: string): void {
    if (this.leaveFirst(ws)) return;
    const room = this.rooms.get((code ?? "").trim().toUpperCase());
    // Ranked matches are never watchable: a watcher gets full-position
    // snapshots — live wallhack intel an accomplice could feed a seated
    // player mid-ladder-match. Same generic reject as a bad code, so the
    // refusal never confirms the room exists. (Skirmish/friend rooms stay
    // watchable — that's a feature, not an oversight.)
    if (!room || room.ranked) return this.send(ws, { t: "reject", reason: "no such room" });
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
    // A re-send (the client adding or dropping a bracket mid-wait) keeps the
    // wait already earned per bracket — snapshot before leaveFirst drops it.
    const earned = this.queue.waitsOf(ws);
    this.leaveFirst(ws);
    const name = sanitizeName(msg.playerName);
    const announcer = sanitizeAnnouncer(msg.announcer);
    const title = sanitizeTitle(msg.title);
    // Token verification + rating loads are async; the socket handler is not.
    // Everything after the awaits re-checks the socket's world before acting.
    void this.verifyAndEnqueue(ws, msg.token, name, announcer, title, brackets, earned).catch((err) => {
      console.error("queueJoin failed:", err);
      this.trySend(ws, { t: "reject", reason: "ranked is unreachable right now — try again" });
    });
  }

  private async verifyAndEnqueue(
    ws: Socket,
    token: string,
    name: string,
    announcer: string,
    title: string,
    brackets: string[],
    earned: Map<string, number>,
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
    // One live ranked seat per account: the queue itself dedupes by account,
    // but a SECOND socket on the same bearer token used to sail through here
    // while the first sat in a live room — N parallel bot-backfill matches
    // farmed from one account. Derived straight from the room registry (a
    // settle or close frees the account by construction — no side registry
    // to clean), so a finished match never locks anyone out.
    if (this.inLiveRankedMatch(accountId)) {
      return this.trySend(ws, { t: "reject", reason: "you're already in a live ranked match" });
    }
    // One entitlement read serves two verifications: the worn title (an
    // unowned claim is SILENTLY stripped, never a rejection — a cosmetic
    // must not cost a match) and the GATED-ITEM list carried to the seat
    // for pick validation (bits-secret-items.md — checked synchronously at
    // setWeapon/setAbilities time).
    const owned = await entitlementsOf(db, accountId);
    if (title !== "" && !owned.some((e) => e.itemId === `title:${title}`)) {
      title = "";
    }
    const items = owned
      .map((e) => e.itemId)
      .filter((i) => i.startsWith("weapon:") || i.startsWith("ability:"));
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
        title,
        items,
        rating: ratings.get(bracket)!,
        joinedMs: Math.min(now, earned.get(bracket) ?? now),
        ...(this.botBackfillOn() ? { botAtMs: botDeadline(now, this.botCfg, Math.random) } : {}),
      });
    }
    this.trySend(ws, { t: "queueStatus", brackets: this.queueStatusFor(ws, now) });
  }

  /** True while `accountId` holds a HUMAN seat in a ranked room whose match
   * is still live — i.e. unsettled: `settled` covers every exit (a normal
   * settle, a conclusive settle failure, and voidRanked's abandonment paths
   * all set it), and a closed room leaves the registry entirely. Rejoining
   * that match stays open the whole time — this only bars a fresh queue. */
  private inLiveRankedMatch(accountId: string): boolean {
    // A pending match is a live seat too — the same twin-socket farm would
    // otherwise slip in between the summons and the room.
    if (this.pending.some((p) => p.hasAccount(accountId))) return true;
    for (const room of this.rooms.values()) {
      if (!room.ranked || room.ranked.settled) continue;
      for (const account of room.ranked.accounts.values()) {
        if (!account.bot && account.accountId === accountId) return true;
      }
    }
    return false;
  }

  /** The slow beat: tend ranked-room lifecycles, run the matcher, refresh
   * every queued client's status. */
  private rankedBeat(): void {
    const now = performance.now();
    this.tendPending(now);
    this.tendRankedRooms(now);
    // Human pairing always wins the beat — backfill only takes what it left.
    // Neither builds a room yet: a pairing opens a PENDING match and the
    // room follows everyone's accept (bits-ranked.md § Queue roaming & match
    // accept).
    for (const match of this.queue.match(now)) this.openPending(match, now);
    if (this.botBackfillOn()) {
      // TODO(v2): population-aware trigger — skip backfill while the bracket's
      // queue size is ≥ N and let the wait ride instead.
      for (const { bracket, entries } of this.queue.takeOverdue(now, BACKFILL_BRACKETS)) {
        this.openBotPending(bracket, entries, now);
      }
    }
    for (const ws of this.queue.queuedSockets()) {
      this.trySend(ws, { t: "queueStatus", brackets: this.queueStatusFor(ws, now) });
    }
  }

  /** The displayed queue numbers: honest, unless backfill is on — then the
   * fuzz rides EVERY read of a BACKFILL bracket (queueStatus and queueInfo
   * agree by construction) so "1 in queue → match found" never appears
   * (bits-ranked-bots.md). A bracket with backfill off keeps honest counts
   * either way. */
  private queueStatusFor(ws: Socket | null, now: number): BracketStatus[] {
    const brackets = this.queue.statusFor(ws, now);
    if (!this.botBackfillOn()) return brackets;
    return brackets.map((b) =>
      BACKFILL_BRACKETS.includes(b.bracket) ? { ...b, size: fuzzedQueueSize(b.size, b.bracket, now) } : b,
    );
  }

  // ── the accept stage (bits-ranked.md § Queue roaming & match accept) ─────

  /** A pairing → a pending match: everyone is summoned, nobody is seated.
   * A socket that died between beats never gets summoned (nor blamed) — the
   * survivors go straight back in line, as the room builder always did. */
  private openPending(match: QueueMatch, now: number): void {
    const everyone = match.teams.flat();
    if (everyone.some((e) => e.ws.readyState !== 1)) {
      for (const e of everyone) {
        if (e.ws.readyState === 1) this.queue.enqueue(match.bracket, this.requeued(e));
      }
      return;
    }
    const p = new PendingMatch(match.bracket, match.teams, now + ACCEPT_WINDOW_MS);
    this.pending.push(p);
    this.summon(p);
  }

  /** An overdue group's bot match goes through the SAME stage: every human
   * sees the same summons, each bot "accepts" after its own jittered delay
   * (an instant N/N would be a tell), and the disguised room builds only on
   * every human's yes — a declined bot match burns no roster names. Humans
   * land on RANDOM sides (Tom, 2026-08-31): partner or opponent, the dice
   * decide — with bots filling the rest, the snake draft has nothing to
   * balance. A window-blocked group that needs no bots at all falls through
   * to the ordinary pending stage. */
  private openBotPending(bracket: string, group: QueueEntry[], now: number): void {
    const live = group.filter((e) => e.ws.readyState === 1);
    if (live.length === 0) return; // died between beats — already unqueued
    const teamSize = RANKED_BRACKETS[bracket as keyof typeof RANKED_BRACKETS].teamSize;
    const slots: Team[] = Array.from({ length: 2 * teamSize }, (_, i) => (i < teamSize ? 1 : 2));
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j]!, slots[i]!];
    }
    const teams: [QueueEntry[], QueueEntry[]] = [[], []];
    live.forEach((e, i) => teams[slots[i]! - 1]!.push(e));
    const botCount = 2 * teamSize - live.length;
    if (botCount === 0) return this.openPending({ bracket, teams }, now);
    const botAccepts = Array.from(
      { length: botCount },
      () => now + BOT_ACCEPT_MIN_MS + Math.random() * (BOT_ACCEPT_MAX_MS - BOT_ACCEPT_MIN_MS),
    );
    const p = new PendingMatch(bracket, teams, now + ACCEPT_WINDOW_MS, botAccepts);
    this.pending.push(p);
    this.summon(p);
  }

  private summon(p: PendingMatch): void {
    for (const e of p.humans) {
      this.trySend(e.ws, { t: "matchReady", bracket: p.bracket, players: p.players, acceptSec: ACCEPT_WINDOW_MS / 1000 });
    }
  }

  private pendingOf(ws: Socket): PendingMatch | undefined {
    return this.pending.find((p) => p.has(ws));
  }

  private onMatchAccept(ws: Socket): void {
    const p = this.pendingOf(ws);
    if (!p) return;
    const now = performance.now();
    if (!p.accept(p.entryOf(ws)!.accountId)) return; // a repeat tap
    this.announcePending(p, now);
    // The last yes builds the room NOW — never a beat late.
    if (p.everyoneIn(now)) this.goPending(p, now);
  }

  /** A decline / queueLeave / socket death / room hop while summoned: that
   * account is the dodger, the match is void at once. No-op if not summoned. */
  private declinePending(ws: Socket): void {
    const p = this.pendingOf(ws);
    if (!p) return;
    this.voidPending(p, new Set([p.entryOf(ws)!.accountId]), performance.now());
  }

  /** Accept progress to every human in the match — only when the count moved
   * (the bot's flip lands here too, off the beat). */
  private announcePending(p: PendingMatch, now: number): void {
    const accepted = p.acceptedCount(now);
    if (accepted === p.announced) return;
    p.announced = accepted;
    for (const e of p.humans) this.trySend(e.ws, { t: "matchPending", accepted, players: p.players });
  }

  /** One pass per beat: dead sockets and blown windows void (the culprits
   * eat the lockout); a bot's accept flips; a complete set goes to a room. */
  private tendPending(now: number): void {
    for (const p of [...this.pending]) {
      const dodgers = p.dodgers(now);
      if (dodgers.length > 0) {
        this.voidPending(p, new Set(dodgers.map((d) => d.accountId)), now);
        continue;
      }
      this.announcePending(p, now);
      if (p.everyoneIn(now)) this.goPending(p, now);
    }
  }

  /** Everyone said yes: the v19 flow from here — matchFound, seat, welcome. */
  private goPending(p: PendingMatch, now: number): void {
    this.pending.splice(this.pending.indexOf(p), 1);
    if (p.botAccepts.length > 0) this.createRankedBotRoom(p.bracket, p.teams, now);
    else this.createRankedRoom({ bracket: p.bracket, teams: p.teams }, now);
  }

  /** The pending match falls through: `dodgers` (account ids) are locked out
   * and told so; everyone else still connected goes straight back in line
   * with their earned wait — a dodge never costs the innocent their place. */
  private voidPending(p: PendingMatch, dodgers: ReadonlySet<string>, now: number): void {
    this.pending.splice(this.pending.indexOf(p), 1);
    const innocents: QueueEntry[] = [];
    for (const e of p.humans) {
      if (dodgers.has(e.accountId)) {
        this.queue.lockout(e.accountId, now);
        this.trySend(e.ws, { t: "matchCancelled", dodged: true, lockoutSec: this.queue.lockoutLeft(e.accountId, now) });
        console.log(`⚔ ranked ${p.bracket} summons void — ${e.name} didn't answer (lockout)`);
      } else if (e.ws.readyState === 1) {
        this.queue.enqueue(p.bracket, this.requeued(e));
        innocents.push(e);
      }
    }
    // Everyone is back in line before anyone reads the line's length.
    for (const e of innocents) {
      this.trySend(e.ws, { t: "matchCancelled", dodged: false });
      this.trySend(e.ws, { t: "queueStatus", brackets: this.queueStatusFor(e.ws, now) });
    }
  }

  private createRankedRoom(match: QueueMatch, now: number): void {
    const everyone = match.teams.flat();
    // A socket can die between beats — never build a room around a corpse;
    // the survivors go straight back in line.
    if (everyone.some((e) => e.ws.readyState !== 1)) {
      for (const e of everyone) {
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
    // The matcher dictated the sides (best + worst vs the middle two in a
    // 2v2) — seat each side onto its team; the sim never rolls for it.
    match.teams.forEach((side, i) => {
      const team = (i + 1) as Team;
      for (const entry of side) {
        this.trySend(entry.ws, { t: "matchFound", bracket: match.bracket, code });
        const id = room.seat(entry.ws, entry.name, entry.announcer, entry.title, null, now, team);
        if (id === null) continue; // 2×N seats, 2×N players — can't happen
        room.ranked!.accounts.set(id, {
          accountId: entry.accountId,
          name: entry.name,
          announcer: entry.announcer,
          title: entry.title,
          items: entry.items,
          rating: entry.rating,
          joinedMs: entry.joinedMs,
        });
      }
    });
    this.attachMatchStats(room);
    const sideLog = (side: QueueEntry[]) => side.map((e) => `${e.name} (${e.rating})`).join(" + ");
    console.log(`⚔ ranked ${match.bracket} room ${code}: ${sideLog(match.teams[0])} vs ${sideLog(match.teams[1])}`);
  }

  /** A backfill group whose bot deadline passed: a room where server bots
   * styled as players fill every seat the queue couldn't (bits-ranked-bots.md)
   * — a lone queuer may face (and partner) up to three. Mirrors
   * createRankedRoom; the `[bot]` markers below are the ONLY place the truth
   * is written — nothing on the wire carries it. */
  private createRankedBotRoom(bracket: string, teams: [QueueEntry[], QueueEntry[]], now: number): void {
    const humans = teams.flat();
    // A socket can die between beats — never build a room around a corpse;
    // the survivors go straight back in line.
    if (humans.some((e) => e.ws.readyState !== 1)) {
      for (const e of humans) {
        if (e.ws.readyState === 1) this.queue.enqueue(bracket, this.requeued(e));
      }
      return;
    }
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

    const sideLogs: [string[], string[]] = [[], []];
    for (let i = 0; i < 2; i++) {
      const team = (i + 1) as Team;
      for (const entry of teams[i]!) {
        this.trySend(entry.ws, { t: "matchFound", bracket, code });
        const id = room.seat(entry.ws, entry.name, entry.announcer, entry.title, null, now, team);
        if (id === null) {
          // A fresh room can't be full — belt-and-braces: never leak the room.
          this.closeRoom(room, "the match was called off");
          return;
        }
        room.ranked.accounts.set(id, {
          accountId: entry.accountId,
          name: entry.name,
          announcer: entry.announcer,
          title: entry.title,
          items: entry.items,
          rating: entry.rating,
          joinedMs: entry.joinedMs,
        });
        sideLogs[i]!.push(`${entry.name} (${entry.rating})`);
      }
    }

    // Every bot in the room anchors to the HUMANS' mean rating — the one
    // number that reads as "the lobby you landed in": difficulty band and
    // advertised-rating mirror alike. The identity book's last-faced
    // bookkeeping keys on the first human (its promise is pairwise-adjacent
    // distinctness; inUse keeps this room's names distinct regardless).
    const humanMean = humans.reduce((sum, e) => sum + e.rating, 0) / humans.length;
    const difficulty = difficultyForRating(humanMean);
    for (let i = 0; i < 2; i++) {
      const team = (i + 1) as Team;
      for (let seatNo = teams[i]!.length; seatNo < teamSize; seatNo++) {
        // Wall clock, not the beat's performance.now() — the roster rotation
        // is a time-of-day schedule.
        const { name: botName, rating: botRating } = this.identityBook.pick(
          humans[0]!.accountId,
          humanMean,
          this.botCfg.ratingJitter,
          Date.now(),
          Math.random,
        );
        // The disguise extends to titles: like its name and rating, off the
        // same dice as the rest of the bot's identity (achievements.md §
        // wearing titles).
        const botTitle = Math.random() < BOT_TITLE_CHANCE ? BOT_TITLES[Math.floor(Math.random() * BOT_TITLES.length)]! : "";
        const botSeat = room.seatRankedBot(botName, difficulty, botTitle, now, team);
        if (botSeat === null) {
          this.identityBook.release(botName);
          this.voidRanked(room, now, () => false); // nobody's fault — requeue the humans
          return;
        }
        // EVERY seat lands in the map so the settleRanked guard passes; the
        // bot flag keeps its subject out of the ladder and the ledger.
        room.ranked.accounts.set(botSeat, {
          accountId: botSubjectId(),
          name: botName,
          announcer: "default",
          title: botTitle,
          items: [], // bots own nothing gated, ever (bits-secret-items.md)
          rating: botRating,
          joinedMs: now,
          bot: true,
        });
        sideLogs[i]!.push(`${botName} (${botRating}) [bot:${difficulty}]`);
      }
    }
    this.attachMatchStats(room);
    console.log(`⚔ ranked ${bracket} room ${code}: ${sideLogs[0]!.join(" + ")} vs ${sideLogs[1]!.join(" + ")}`);
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
            title: account.title,
            items: account.items,
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

  /** Start achievement tallies for a freshly-seated ranked room
   * (achievements.md § award pipeline). Seats are fixed for the room's life
   * (a rejoin reclaims its seat id), so seeding here is safe. */
  private attachMatchStats(room: Room): void {
    room.matchStats = new MatchStatsAccumulator(
      seatedPlayers(room.sim.state).map((p) => ({ id: p.id, team: p.team })),
    );
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
      const winners = seated.filter((p) => p.team === winnerTeam);
      const losers = seated.filter((p) => p.team !== winnerTeam);
      const accountOf = (p: (typeof seated)[number]) => ctx.accounts.get(p.id);
      if (
        winners.length === 0 ||
        winners.length !== losers.length ||
        [...winners, ...losers].some((p) => accountOf(p) === undefined)
      ) {
        console.error(`[${room.meta.code}] ranked settle: seats/accounts missing — match ${ctx.matchId} unrecorded`);
        return;
      }
      const loadoutOf = (p: (typeof seated)[number]) => ({ weapon: p.weapon, abilities: p.abilities });
      // One writer for every mix of seats: a bot subject carries its
      // advertised rating (frozen at room creation) and the writer keeps it
      // out of the ladder and the ledger — its Elo weight and its fabricated
      // result side are handled downstream (bits-ranked-bots.md).
      const subjectOf = (p: (typeof seated)[number]) => {
        const account = accountOf(p)!;
        return {
          subjectId: account.accountId,
          loadout: loadoutOf(p),
          ...(account.bot ? { botRating: account.rating } : {}),
        };
      };
      const record = () =>
        recordRankedMatch(this.db!, {
          matchId: ctx.matchId,
          season: SEASON,
          bracket: ctx.bracket,
          winners: winners.map(subjectOf),
          losers: losers.map(subjectOf),
        });
      for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt++) {
        try {
          const result = await record();
          if (result) {
            // Result rows come back in the order the sides were listed —
            // zip them back onto seat ids for the wire.
            room.publish({
              t: "rankedResult",
              matchId: ctx.matchId,
              bracket: ctx.bracket,
              winnerTeam,
              results: [
                ...winners.map((p, i) => ({ playerId: p.id, ...sideResult(result.winners[i]!) })),
                ...losers.map((p, i) => ({ playerId: p.id, ...sideResult(result.losers[i]!) })),
              ],
            });
            const line = (p: (typeof seated)[number], r: (typeof result.winners)[number]) =>
              `${accountOf(p)!.name} ${r.before}→${r.after} (+${r.glory}g)`;
            console.log(
              `[${room.meta.code}] ranked settled: ${winners.map((p, i) => line(p, result.winners[i]!)).join(", ")} over ${losers.map((p, i) => line(p, result.losers[i]!)).join(", ")}`,
            );
            // Achievements ride the settle but never block it: the ratings
            // and rankedResult above are already committed and broadcast —
            // a deeds failure is logged, not fatal (achievements.md).
            await this.awardDeeds(room, winnerTeam, result);
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

  /**
   * The achievement pass (achievements.md § award pipeline), one human seat
   * at a time: read counters/unlocks/lifetime-Glory, apply this match's
   * deltas (streak semantics + the ledger-derived glory counter included),
   * evaluate, land everything in one idempotent batch keyed on the match id,
   * then tell THAT player — per-socket, never broadcast: a room-wide send
   * would leak secret-item unlocks to the opponent.
   */
  private async awardDeeds(room: Room, winnerTeam: Team, result: RankedMatchResult): Promise<void> {
    const ctx = room.ranked!;
    const stats = room.matchStats;
    const db = this.db;
    if (!stats || !db) return;
    const seated = seatedPlayers(room.sim.state);
    const summary = stats.summary({
      ranked: true,
      bracket: ctx.bracket,
      teamSize: room.sim.state.players.length / 2,
      winnerTeam,
      players: seated.map((p) => ({ id: p.id, team: p.team, weapon: p.weapon, bot: p.bot === true })),
    });
    for (const [seatId, account] of ctx.accounts) {
      if (account.bot) continue;
      try {
        const [counters, unlockRecords, earnedNow] = await Promise.all([
          achievementCounters(db, account.accountId),
          achievementUnlocks(db, account.accountId),
          gloryEarned(db, account.accountId),
        ]);
        const side =
          result.winners.find((r) => r.subjectId === account.accountId) ??
          result.losers.find((r) => r.subjectId === account.accountId);
        const won = result.winners.some((r) => r.subjectId === account.accountId);
        const matchGlory = side?.glory ?? 0;
        // The ledger already holds this match's ranked Glory (the settle
        // batch landed first) — "before" backs it out so the crossing rule
        // sees this match's earnings. Achievement Glory rewards land after
        // this evaluation and count from the NEXT match (accepted one-match
        // lag, achievements.md § content sketch).
        const before = { ...counters, [COUNTERS.gloryEarned]: Math.max(0, earnedNow - matchGlory) };
        const after: Record<string, number> = { ...before };
        for (const [counter, delta] of Object.entries(counterDeltas(summary, seatId))) {
          after[counter] = (after[counter] ?? 0) + delta;
        }
        Object.assign(after, streakUpdates(before, won));
        Object.assign(after, undyingStreakUpdates(before, summary, seatId));
        after[COUNTERS.gloryEarned] = earnedNow;
        const fired = evaluate({
          defs: ACHIEVEMENT_DEFS,
          boards: ACHIEVEMENT_BOARDS,
          summary,
          playerKey: seatId,
          before,
          after,
          unlocked: new Set(unlockRecords.map((u) => u.id)),
        });
        // Rewards stack (achievements.md § titles): Glory sums, and every
        // entitlement kind lands its own row — a title records the deed's
        // OWN id (`title:<id>`); clients render the string from the defs.
        const unlocks: AchievementAward[] = fired.map((def) => {
          const rewards = def.rewards ?? [];
          const gloryTotal = rewards.reduce((sum, r) => (r.kind === "glory" ? sum + r.amount : sum), 0);
          const entitlements = rewards.flatMap((r) =>
            r.kind === "entitlement" ? [r.itemId] : r.kind === "title" ? [`title:${def.id}`] : [],
          );
          return {
            id: def.id,
            ...(gloryTotal > 0 ? { glory: gloryTotal } : {}),
            ...(entitlements.length > 0 ? { entitlements } : {}),
          };
        });
        await applyMatchAchievements(db, {
          matchId: ctx.matchId,
          playerId: account.accountId,
          counters: after,
          unlocks,
        });
        if (fired.length > 0) {
          const ws = room.socketOf(seatId);
          if (ws) this.trySend(ws, { t: "deedUnlocks", matchId: ctx.matchId, unlocks: fired.map((d) => d.id) });
          console.log(`[${room.meta.code}] deeds for ${account.name}: ${fired.map((d) => d.id).join(", ")}`);
        }
      } catch (err) {
        // This match's tallies are lost for this player (the guard mark
        // never landed, but nothing re-runs it) — loud log, same posture as
        // a lost settle; unlocks re-fire naturally as counters keep growing.
        console.error(`[${room.meta.code}] deeds for ${account.name} failed:`, err);
      }
    }
  }

  /** A socket already in a room must leave it before creating/joining another
   * — and entering a room always leaves the queue (one place at a time). */
  private leaveFirst(ws: Socket): boolean {
    this.queue.removeSocket(ws);
    this.declinePending(ws); // hopping into a room while summoned is a dodge
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

/** A seat token is a server-minted UUID echoed back verbatim — anything else
 * on the wire (wrong type, empty, oversized) collapses to null, which never
 * reclaims a seat. Never truncate: a clipped token must not half-match. */
const sanitizeSeatToken = (token: unknown): string | null =>
  typeof token === "string" && token.length > 0 && token.length <= MAX_SEAT_TOKEN ? token : null;

/** The worn title is a DEED ID claim — clients resolve display text from
 * their own defs (an unknown id renders bare), so the wire only needs a
 * length-capped string. Ranked additionally verifies ownership in
 * verifyAndEnqueue; skirmish takes the word (achievements.md § wearing
 * titles). "" = bare. */
const sanitizeTitle = (title: unknown): string =>
  (typeof title === "string" ? title : "").trim().slice(0, MAX_TITLE_ID);
