/**
 * One-off: grant the items deeds pay to players who earned the deed BEFORE
 * it paid them (bits-cosmetics.md § F4 — Gravedigger now pays the Snuffed
 * finisher; the live award only fires at unlock time). Dry run by default —
 * prints what is owed and writes nothing; pass --apply to grant. Safe to run
 * twice: it writes the same entitlement rows, under the same source, as the
 * live award, and only ever adds what's missing.
 *
 *   bun run entitlements:backfill              # local <repo>/db/dev.db, dry run
 *   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… bun run entitlements:backfill --apply
 *
 * Run it AFTER the server carrying the new reward is deployed, so nothing
 * unlocks ungranted in the gap.
 */
import { resolve } from "node:path";
import { createDb, grantOwedEntitlements } from "@heroic/blood-in-the-sand-persistence";
import { ACHIEVEMENT_DEFS } from "@heroic/blood-in-the-sand-sim";

const apply = process.argv.includes("--apply");
const url = process.env.TURSO_DATABASE_URL ?? `file:${resolve(import.meta.dir, "../../../db/dev.db")}`;
const db = createDb(url, process.env.TURSO_AUTH_TOKEN);

// ITEM rewards only (`entitlement` kind — finishers, and the secret arms).
// Titles are left alone: nothing about them changed, and this stays a
// narrow tool for "a deed started paying an item".
const rewards = Object.fromEntries(
  ACHIEVEMENT_DEFS.map((d) => [d.id, (d.rewards ?? []).flatMap((r) => (r.kind === "entitlement" ? [r.itemId] : []))]),
);
const owed = await grantOwedEntitlements(db, rewards, { apply });

console.log(`${apply ? "GRANTED" : "DRY RUN — would grant"} ${owed.grants} entitlements to ${owed.players} players`);
console.log(`db: ${url.startsWith("file:") ? url : url.replace(/\/\/.*@/, "//")}`);
if (!apply && owed.grants > 0) console.log("re-run with --apply to grant");
