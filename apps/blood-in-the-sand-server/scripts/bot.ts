/**
 * Headless test client — the server's integration test and the app's traffic
 * generator, now rooms-aware. Two of these play full matches, no phones:
 *
 *   bun scripts/bot.ts --name rex  --strategy seek --create          # makes a room, hosts it
 *   bun scripts/bot.ts --name fifi --strategy circle                 # joins the first open room
 *   bun scripts/bot.ts --name kilo --room KRVX --pass hunter2        # joins a specific room
 *
 * A hosting bot auto-presses START whenever the lobby is full, so bot matches
 * loop forever (bound with --matches N; 0 = run until killed).
 */
import {
  botThink,
  createBotMemory,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  TICK_RATE,
  WEAPON_IDS,
  type BotStrategy,
  type ClientMsg,
  type RoundPhase,
  type ServerMsg,
  type SnapshotMsg,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";

const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value ?? fallback;
};
const has = (flag: string): boolean => process.argv.includes(flag);

const name = arg("--name", `bot-${Math.floor(Math.random() * 1000)}`);
const strategy = arg("--strategy", "seek") as BotStrategy;
const host = arg("--host", "localhost");
const port = Number(arg("--port", String(DEFAULT_PORT)));
const matchLimit = Number(arg("--matches", "1"));
const create = has("--create");
/** Host a lobby but never press START — for testing the lobby screens. */
const noStart = has("--nostart");
const roomCode = arg("--room", "");
const pass = arg("--pass", "");
/** Lobby weapon pick; unset = random. Matches can't start until all pick. */
const weaponArg = arg("--weapon", "");
const weapon: WeaponId = (WEAPON_IDS as readonly string[]).includes(weaponArg)
  ? (weaponArg as WeaponId)
  : WEAPON_IDS[Math.floor(Math.random() * WEAPON_IDS.length)]!;

const log = (line: string): void => console.log(`[${name}] ${line}`);

let myId: number | null = null;
let iAmHost = false;
let connectedInRoom = 0;
let phase: RoundPhase = "lobby";
let latest: SnapshotMsg | null = null;
let seq = 0;
let matchesSeen = 0;
let lastStartSentMs = 0;

const ws = new WebSocket(`ws://${host}:${port}`);
const send = (msg: ClientMsg): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

ws.onopen = () => {
  if (create) send({ t: "createRoom", v: PROTOCOL_VERSION, playerName: name, roomName: `${name}'s room`, ...(pass ? { pass } : {}) });
  else if (roomCode) send({ t: "joinRoom", v: PROTOCOL_VERSION, code: roomCode, playerName: name, ...(pass ? { pass } : {}) });
  else send({ t: "listRooms" });
};

ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data)) as ServerMsg;
  switch (msg.t) {
    case "rooms": {
      const open = msg.rooms.find((r) => r.phase === "lobby" && r.players < r.capacity && !r.locked);
      if (open) {
        log(`joining ${open.code} "${open.name}"`);
        send({ t: "joinRoom", v: PROTOCOL_VERSION, code: open.code, playerName: name });
      } else {
        setTimeout(() => send({ t: "listRooms" }), 1000); // keep browsing
      }
      return;
    }
    case "welcome":
      myId = msg.playerId;
      iAmHost = msg.hostId === msg.playerId;
      log(`seated as player ${msg.playerId} (team ${msg.team}) in ${msg.roomCode} "${msg.roomName}"${iAmHost ? " — hosting" : ""}`);
      log(`picking the ${weapon}`);
      send({ t: "setWeapon", weapon });
      return;
    case "roomState":
      iAmHost = myId !== null && msg.hostId === myId;
      connectedInRoom = msg.players.filter((p) => p.connected).length;
      log(`room: ${msg.players.map((p) => `${p.name}${p.connected ? "" : " (gone)"}`).join(" vs ") || "empty"}`);
      return;
    case "watching":
    case "left":
      return;
    case "reject":
      log(`rejected: ${msg.reason}`);
      process.exit(1);
    case "snapshot": {
      latest = msg;
      const prevPhase = phase;
      phase = msg.round.phase;
      if (phase === "reveal" && prevPhase !== "reveal") playCeremony();
      for (const ev of msg.events) {
        if (ev.type === "fightStart") log("FIGHT!");
        else if (ev.type === "roundEnd") log(`round → team ${ev.winnerTeam} · ${ev.wins[0]}–${ev.wins[1]}`);
        else if (ev.type === "matchEnd") {
          log(`MATCH → team ${ev.winnerTeam}`);
          matchesSeen += 1;
          if (matchLimit > 0 && matchesSeen >= matchLimit) {
            log("done — exiting");
            process.exit(0);
          }
        }
      }
    }
  }
};

ws.onclose = () => {
  log("connection closed");
  process.exit(0);
};

/**
 * The pick ceremony, bot-style: half the time it bait-swaps its revealed
 * weapon (hidden from the enemy team — the human tester sees the swap land
 * only when the fight starts), then locks in. Locking matters: everyone
 * locked ends the adjust window early, so a solo tester + this bot exercises
 * the early-start path too.
 */
const playCeremony = (): void => {
  const swapDelay = 1500 + Math.random() * 4500;
  if (Math.random() < 0.5) {
    const others = WEAPON_IDS.filter((w) => w !== weapon);
    const to = others[Math.floor(Math.random() * others.length)]!;
    setTimeout(() => {
      log(`bait! secretly swapping to the ${to}`);
      send({ t: "setWeapon", weapon: to });
    }, swapDelay);
  }
  setTimeout(() => {
    log("locking in");
    send({ t: "lockIn" });
  }, swapDelay + 800 + Math.random() * 3200);
};

// The brain itself lives in the sim package (botThink) — shared with the
// app's offline practice mode. This script is just its WebSocket body.
const memory = createBotMemory();

/** One decision per tick, from the latest snapshot. */
const think = (): { sx: number; sy: number; dash: boolean } => {
  if (myId === null || latest === null) return { sx: 0, sy: 0, dash: false };
  const me = latest.players.find((p) => p.id === myId);
  const enemy = latest.players.find((p) => p.id !== myId && p.alive);
  return botThink(memory, strategy, me, enemy);
};

setInterval(() => {
  // Hosting bot: press START whenever the lobby is full (throttled).
  const now = Date.now();
  if (!noStart && iAmHost && phase === "lobby" && connectedInRoom >= 2 && now - lastStartSentMs > 2000) {
    lastStartSentMs = now;
    log("lobby full — starting the match");
    send({ t: "startMatch" });
  }
  const d = think();
  send({ t: "input", seq: seq++, sx: d.sx, sy: d.sy, dash: d.dash });
}, 1000 / TICK_RATE);
