/**
 * Blood in the Sand — match server (rooms + host-driven lobbies).
 *
 *   bun run dev      (auto-restarts on change)
 *   bun run start
 *
 * Prints the LAN addresses for local play. Tip for long sessions on a Mac:
 * `caffeinate -i bun src/main.ts` stops macOS sleeping mid-match.
 */
import { mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { CLOSING_SANDS, configureSafeCircle, DEFAULT_PORT, PROTOCOL_VERSION } from "@heroic/blood-in-the-sand-sim";
import { createDb, ensureSchema, type Db } from "@heroic/blood-in-the-sand-persistence";
import { RoomManager } from "./manager";
import { botBackfillConfigFromEnv } from "./botBackfill";
import type { ClientData } from "./room";

// PORT is what Render (and most PaaS) inject; ARENA_PORT is the local override.
const port = Number(process.env.PORT ?? process.env.ARENA_PORT ?? DEFAULT_PORT);

// The shared database (glory-economy.md topology: services share Turso via
// the persistence package, never each other's HTTP). The local fallback is
// ONE file anchored to the REPO, not the cwd — a relative `file:` URL
// resolves against wherever the process was launched, which is exactly how
// the server and API ended up silently writing two different dev.dbs
// (2026-07-29). Unreachable DB ≠ dead server: skirmish runs untouched and
// ranked rejects honestly.
const localDbFile = resolve(import.meta.dir, "../../../db/dev.db");
let db: Db | null = null;
try {
  if (!process.env.TURSO_DATABASE_URL) mkdirSync(dirname(localDbFile), { recursive: true });
  db = createDb(process.env.TURSO_DATABASE_URL ?? `file:${localDbFile}`, process.env.TURSO_AUTH_TOKEN);
  await ensureSchema(db);
  console.log(`🗄  ranked db: ${process.env.TURSO_DATABASE_URL ?? localDbFile}`);
} catch (err) {
  console.error("⚠ persistence unavailable — ranked disabled:", err);
  db = null;
}
// The Closing Sands' env dials (bits-sand-circle.md § env tuning): tune the
// circle's timing for a test server, or kill it outright. Defaults ship.
const sandsNum = (name: string): number | undefined => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : undefined;
};
configureSafeCircle({
  ...(process.env.SANDS_ENABLED === "0" ? { enabled: false } : {}),
  ...(sandsNum("SANDS_DELAY_S") !== undefined ? { delaySeconds: sandsNum("SANDS_DELAY_S")! } : {}),
  ...(sandsNum("SANDS_CLOSE_S") !== undefined ? { closeSeconds: sandsNum("SANDS_CLOSE_S")! } : {}),
  ...(sandsNum("SANDS_FINAL_RADIUS") !== undefined ? { finalRadius: sandsNum("SANDS_FINAL_RADIUS")! } : {}),
});
console.log(
  CLOSING_SANDS.enabled
    ? `🌪  closing sands ON — rolls at ${CLOSING_SANDS.delaySeconds}s, closes over ${CLOSING_SANDS.closeSeconds}s to r${CLOSING_SANDS.finalRadius}`
    : "🌪  closing sands OFF (SANDS_ENABLED=0)",
);

const botCfg = botBackfillConfigFromEnv();
if (db) {
  console.log(
    botCfg.enabled
      ? `🤖 ranked bot backfill ON — wait ${botCfg.minWaitMs / 1000}–${botCfg.maxWaitMs / 1000}s, rating ±${botCfg.ratingJitter}`
      : "🤖 ranked bot backfill OFF (RANKED_BOT_BACKFILL)",
  );
}
const manager = new RoomManager(db, botCfg);

const server = Bun.serve<ClientData, never>({
  port,
  fetch(req, srv) {
    if (srv.upgrade(req, { data: { roomCode: null, playerId: null, accountId: null } })) return;
    return new Response(`Blood in the Sand server — protocol v${PROTOCOL_VERSION}, ${manager.roomCount()} room(s) open. Connect with the app.`);
  },
  websocket: {
    message: (ws, raw) => manager.message(ws, raw),
    close: (ws) => manager.close(ws),
  },
});

manager.start(server);

console.log(`🩸 Blood in the Sand server up${db ? " (ranked on)" : " (ranked OFF — no database)"}. Point the phones at:`);
for (const list of Object.values(networkInterfaces())) {
  for (const iface of list ?? []) {
    if (iface.family === "IPv4" && !iface.internal) console.log(`   ${iface.address}  (port ${port})`);
  }
}
console.log(`   localhost  (port ${port}, simulators/bots)`);
