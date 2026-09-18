/**
 * One-off: pay the deed bounties players earned before bounties existed
 * (bits-deed-glory.md § rollout). Dry run by default — prints what is owed
 * and writes nothing; pass --apply to pay. Safe to run twice: it writes the
 * same ledger rows, under the same idempotency keys, as the live award.
 *
 *   bun run bounties:backfill              # local <repo>/db/dev.db, dry run
 *   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… bun run bounties:backfill --apply
 *
 * Run it AFTER the server carrying the bounties is deployed, so nothing
 * unlocks unpaid in the gap.
 */
import { resolve } from "node:path";
import { createDb, payOwedBounties } from "@heroic/blood-in-the-sand-persistence";
import { ACHIEVEMENT_DEFS, bountyOf } from "@heroic/blood-in-the-sand-sim";

const apply = process.argv.includes("--apply");
const url = process.env.TURSO_DATABASE_URL ?? `file:${resolve(import.meta.dir, "../../../db/dev.db")}`;
const db = createDb(url, process.env.TURSO_AUTH_TOKEN);

const bounties = Object.fromEntries(ACHIEVEMENT_DEFS.map((d) => [d.id, bountyOf(d)]));
const owed = await payOwedBounties(db, bounties, { apply });

console.log(`${apply ? "PAID" : "DRY RUN — would pay"} ${owed.glory} Glory across ${owed.payments} deeds to ${owed.players} players`);
console.log(`db: ${url.startsWith("file:") ? url : url.replace(/\/\/.*@/, "//")}`);
if (!apply && owed.payments > 0) console.log("re-run with --apply to pay");
