/**
 * Headless test client — the server's integration test and the app's traffic
 * generator, now rooms-aware. Two of these play full matches, no phones:
 *
 *   bun scripts/bot.ts --name rex  --strategy seek --create          # makes a room, hosts it
 *   bun scripts/bot.ts --name fifi --strategy circle                 # joins the first open room
 *   bun scripts/bot.ts --name kilo --room KRVX --pass hunter2        # joins a specific room
 *
 * Bots arm the moment they're seated (weapon + hand), so with everyone armed
 * the server's own arming countdown starts each match — nobody presses
 * anything (pvp-loadout-flow.md). Bound with --matches N; 0 = run until
 * killed. `--noarm` seats a bot that never picks — the straggler, for testing
 * the host's force-start from a phone.
 */
import {
  ABILITY_IDS,
  botThink,
  createBotMemory,
  nearestEnemy,
  DEFAULT_PORT,
  LOADOUT_ABILITY_COUNT,
  PROTOCOL_VERSION,
  TICK_RATE,
  WEAPON_IDS,
  type AbilityId,
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
/** With --create: the room's team size (1v1–4v4). */
const teamSize = Number(arg("--size", "1"));
/** Never arm — the straggler bot, for testing the host's force-start. */
const noArm = has("--noarm");
const roomCode = arg("--room", "");
const pass = arg("--pass", "");
/** Lobby weapon pick; unset = random. Matches can't start until all pick. */
const weaponArg = arg("--weapon", "");
const weapon: WeaponId = (WEAPON_IDS as readonly string[]).includes(weaponArg)
  ? (weaponArg as WeaponId)
  : WEAPON_IDS[Math.floor(Math.random() * WEAPON_IDS.length)]!;

/** The drafted hand: dash first (the only ability this brain casts — see
 * bot.ts's cheapest-v1 rule) plus random filler for the other slots. */
const abilities: AbilityId[] = ["dash"];
{
  const pool = ABILITY_IDS.filter((a) => a !== "dash");
  while (abilities.length < LOADOUT_ABILITY_COUNT) {
    abilities.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  }
}

const log = (line: string): void => console.log(`[${name}] ${line}`);

let myId: number | null = null;
let iAmHost = false;
let phase: RoundPhase = "lobby";
let latest: SnapshotMsg | null = null;
let seq = 0;
let matchesSeen = 0;

const ws = new WebSocket(`ws://${host}:${port}`);
const send = (msg: ClientMsg): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

ws.onopen = () => {
  if (create) send({ t: "createRoom", v: PROTOCOL_VERSION, playerName: name, roomName: `${name}'s room`, teamSize, ...(pass ? { pass } : {}) });
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
      if (noArm) {
        log("staying unarmed (--noarm) — force-start me");
      } else {
        // Bots arm instantly; the server's countdown does the rest.
        log(`arming: ${weapon} + [${abilities.join(", ")}]`);
        send({ t: "setWeapon", weapon });
        send({ t: "setAbilities", abilities });
      }
      return;
    case "roomState":
      iAmHost = myId !== null && msg.hostId === myId;
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
      // The lobby return disarms everyone (no auto-rematch by flow) — a bot
      // that wants another match re-arms, which restarts the countdown.
      if (phase === "lobby" && prevPhase === "matchEnd" && !noArm) {
        log("re-arming for the next match");
        send({ t: "setWeapon", weapon });
        send({ t: "setAbilities", abilities });
      }
      for (const ev of msg.events) {
        if (ev.type === "armingComplete") log("all armed — the countdown runs");
        else if (ev.type === "fightStart") log("FIGHT!");
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

// The brain itself lives in the sim package (botThink) — shared with the
// app's offline practice mode. This script is just its WebSocket body.
const memory = createBotMemory();

/** One decision per tick, from the latest snapshot. */
const think = (): { sx: number; sy: number; dash: boolean } => {
  if (myId === null || latest === null) return { sx: 0, sy: 0, dash: false };
  const me = latest.players.find((p) => p.id === myId);
  return botThink(memory, strategy, me, nearestEnemy(me, latest.players));
};

setInterval(() => {
  const d = think();
  // Dash sits in slot 0 by construction (the hand is sent dash-first).
  send({ t: "input", seq: seq++, sx: d.sx, sy: d.sy, casts: [d.dash, false, false] });
}, 1000 / TICK_RATE);
