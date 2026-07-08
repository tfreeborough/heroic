/**
 * Headless test client — the server's integration test and the app's traffic
 * generator. Two of these against a dev server play a full match, no phones:
 *
 *   bun scripts/bot.ts --name rex  --strategy seek
 *   bun scripts/bot.ts --name fifi --strategy circle
 *
 * Options: --host localhost · --port 7777 · --matches 1 (exit after N matchEnds; 0 = run forever)
 */
import {
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  TICK_RATE,
  type ClientMsg,
  type PlayerSnapshot,
  type ServerMsg,
  type SnapshotMsg,
} from "@heroic/blood-in-the-sand-sim";

const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value ?? fallback;
};

const name = arg("--name", `bot-${Math.floor(Math.random() * 1000)}`);
const strategy = arg("--strategy", "seek") as "seek" | "circle";
const host = arg("--host", "localhost");
const port = Number(arg("--port", String(DEFAULT_PORT)));
const matchLimit = Number(arg("--matches", "1"));

const log = (line: string): void => console.log(`[${name}] ${line}`);

let myId: number | null = null;
let latest: SnapshotMsg | null = null;
let seq = 0;
let matchesSeen = 0;

const ws = new WebSocket(`ws://${host}:${port}`);
const send = (msg: ClientMsg): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

ws.onopen = () => send({ t: "hello", v: PROTOCOL_VERSION, name });

ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data)) as ServerMsg;
  switch (msg.t) {
    case "welcome":
      myId = msg.playerId;
      log(`seated as player ${msg.playerId} (team ${msg.team}) on ${msg.zoneId}`);
      return;
    case "reject":
      log(`rejected: ${msg.reason}`);
      process.exit(1);
    case "lobby":
      log(`lobby: ${msg.players.map((p) => `${p.name}${p.connected ? "" : " (gone)"}`).join(" vs ")}`);
      return;
    case "snapshot":
      latest = msg;
      for (const ev of msg.events) {
        if (ev.type === "fightStart") log("FIGHT!");
        else if (ev.type === "hit") log(`hit: p${ev.attackerId} → p${ev.targetId} for ${ev.damage}${ev.crit ? " CRIT" : ""}${ev.lethal ? " (lethal)" : ""}`);
        else if (ev.type === "death") log(`death: p${ev.playerId}`);
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
};

ws.onclose = () => {
  log("connection closed");
  process.exit(0);
};

// Wall unstick: straight-line seek wedges on the LOS pillar (no pathfinding).
// When position stagnates, slide perpendicular for a bit to skirt the obstacle.
let lastX = 0;
let lastY = 0;
let stuckTicks = 0;
let slideTicks = 0;
let slideSign = 1;

/** One decision per tick, from the latest snapshot. */
const think = (): { sx: number; sy: number; dash: boolean } => {
  if (myId === null || latest === null) return { sx: 0, sy: 0, dash: false };
  const me = latest.players.find((p) => p.id === myId);
  const enemy = latest.players.find((p) => p.id !== myId && p.alive);
  if (!me || !me.alive || !enemy) return { sx: 0, sy: 0, dash: false };

  const dx = enemy.x - me.x;
  const dy = enemy.y - me.y;
  const dist = Math.hypot(dx, dy) || 1;
  const toward = { x: dx / dist, y: dy / dist };

  if (strategy === "seek") {
    stuckTicks = Math.hypot(me.x - lastX, me.y - lastY) < 1.5 && dist > 60 ? stuckTicks + 1 : 0;
    lastX = me.x;
    lastY = me.y;
    if (stuckTicks > 12) {
      slideTicks = 30;
      slideSign = -slideSign;
      stuckTicks = 0;
    }
    if (slideTicks > 0) {
      slideTicks -= 1;
      return { sx: -toward.y * slideSign, sy: toward.x * slideSign, dash: false };
    }
    // Straight-line aggression; dash to close a big gap when it's ready.
    return { sx: toward.x, sy: toward.y, dash: me.dashCd === 0 && dist > 220 };
  }
  // circle: strafe around the enemy with a slight inward pull, and dash to
  // dodge when the enemy's swing telegraph is up — exercises the i-frames.
  const strafe = { x: -toward.y, y: toward.x };
  const inward = dist > 140 ? 0.5 : 0;
  const sx = strafe.x + toward.x * inward;
  const sy = strafe.y + toward.y * inward;
  const mag = Math.hypot(sx, sy) || 1;
  const dodge = me.dashCd === 0 && enemy.atk === "windup" && dist < 160;
  return { sx: sx / mag, sy: sy / mag, dash: dodge };
};

setInterval(() => {
  const d = think();
  send({ t: "input", seq: seq++, sx: d.sx, sy: d.sy, dash: d.dash });
}, 1000 / TICK_RATE);
