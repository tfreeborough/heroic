/**
 * Blood in the Sand — match server (rooms + host-driven lobbies).
 *
 *   bun run dev      (auto-restarts on change)
 *   bun run start
 *
 * Prints the LAN addresses for local play. Tip for long sessions on a Mac:
 * `caffeinate -i bun src/main.ts` stops macOS sleeping mid-match.
 */
import { networkInterfaces } from "node:os";
import { DEFAULT_PORT, PROTOCOL_VERSION } from "@heroic/blood-in-the-sand-sim";
import { RoomManager } from "./manager";
import type { ClientData } from "./room";

// PORT is what Render (and most PaaS) inject; ARENA_PORT is the local override.
const port = Number(process.env.PORT ?? process.env.ARENA_PORT ?? DEFAULT_PORT);
const manager = new RoomManager();

const server = Bun.serve<ClientData, never>({
  port,
  fetch(req, srv) {
    if (srv.upgrade(req, { data: { roomCode: null, playerId: null } })) return;
    return new Response(`Blood in the Sand server — protocol v${PROTOCOL_VERSION}, ${manager.roomCount()} room(s) open. Connect with the app.`);
  },
  websocket: {
    message: (ws, raw) => manager.message(ws, raw),
    close: (ws) => manager.close(ws),
  },
});

manager.start(server);

console.log("🩸 Blood in the Sand server up. Point the phones at:");
for (const list of Object.values(networkInterfaces())) {
  for (const iface of list ?? []) {
    if (iface.family === "IPv4" && !iface.internal) console.log(`   ${iface.address}  (port ${port})`);
  }
}
console.log(`   localhost  (port ${port}, simulators/bots)`);
