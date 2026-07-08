/**
 * Blood in the Sand — LAN match server.
 *
 *   bun run dev      (auto-restarts on change)
 *   bun run start
 *
 * Prints the LAN addresses to type into the phones. Tip for long sessions:
 * `caffeinate -i bun src/main.ts` stops macOS sleeping mid-match.
 */
import { networkInterfaces } from "node:os";
import { DEFAULT_PORT } from "@heroic/blood-in-the-sand-sim";
import { Room, type ClientData } from "./room";

// PORT is what Render (and most PaaS) inject; ARENA_PORT is the local override.
const port = Number(process.env.PORT ?? process.env.ARENA_PORT ?? DEFAULT_PORT);
const room = new Room();

const server = Bun.serve<ClientData, never>({
  port,
  fetch(req, srv) {
    if (srv.upgrade(req, { data: { playerId: null } })) return;
    return new Response("Blood in the Sand server — connect with the app.");
  },
  websocket: {
    open: (ws) => room.open(ws),
    message: (ws, raw) => room.message(ws, raw),
    close: (ws) => room.close(ws),
  },
});

room.start(server);

console.log("🩸 Blood in the Sand server up. Point the phones at:");
for (const list of Object.values(networkInterfaces())) {
  for (const iface of list ?? []) {
    if (iface.family === "IPv4" && !iface.internal) console.log(`   ${iface.address}  (port ${port})`);
  }
}
console.log(`   localhost  (port ${port}, simulators/bots)`);
