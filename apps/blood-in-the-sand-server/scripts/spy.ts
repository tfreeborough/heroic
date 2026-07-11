// Dev spectator: list rooms, watch the first one, print a snapshot per second.
import { PROTOCOL_VERSION, type ServerMsg } from "@heroic/blood-in-the-sand-sim";

const ws = new WebSocket(`ws://${process.env.ARENA_HOST ?? "localhost"}:${process.env.ARENA_PORT ?? 7777}`);
let n = 0;

ws.onopen = () => ws.send(JSON.stringify({ t: "listRooms" }));
ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data)) as ServerMsg & { v?: number };
  if (msg.t === "rooms") {
    if (msg.rooms.length === 0) {
      console.log("no rooms open");
      process.exit(0);
    }
    for (const r of msg.rooms) {
      console.log(`${r.code} "${r.name}" ${r.players}/${r.capacity}${r.locked ? " 🔒" : ""} ${r.phase}`);
    }
    ws.send(JSON.stringify({ t: "watchRoom", code: msg.rooms[0]!.code }));
    return;
  }
  if (msg.t === "watching") {
    console.log(`watching ${msg.roomCode} "${msg.roomName}" (protocol v${PROTOCOL_VERSION})`);
    return;
  }
  if (msg.t !== "snapshot") return;
  n += 1;
  if (n % 30 !== 1) return; // one per second
  const players = msg.players
    .map((p) => `p${p.id}[${p.name}] (${p.x.toFixed(0)},${p.y.toFixed(0)}) hp=${p.hp} seq=${p.lastSeq}${p.alive ? "" : " DEAD"}`)
    .join(" | ");
  console.log(`tick=${msg.tick} phase=${msg.round.phase} wins=${msg.round.wins} ${players}`);
  if (n > 300) process.exit(0);
};

setTimeout(() => process.exit(1), 30_000);
