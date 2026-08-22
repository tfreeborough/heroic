/**
 * Anonymous player identity (glory-economy.md): /register mints an id + a
 * secret token; tokens are the only credential and are stored hashed, so a
 * leaked database can't impersonate players.
 *
 * Tokens are PER-DEVICE since A4 (bits-accounts.md, 2026-08-22): a player is
 * one row in `players`, but every device holding that player has its own row
 * in `player_tokens` — an account restore ADDS a credential instead of
 * rotating the only one, so signing in on the iPad never logs out the phone.
 * `players.token_hash` survives as a legacy column (schema-required, and the
 * backfill source for pre-A4 rows); `player_tokens` is the only table reads
 * consult.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "./db";

export interface Registration {
  playerId: string;
  /** The bearer secret — returned exactly once; only its hash is stored. */
  token: string;
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/**
 * How many device tokens one player keeps — newest wins, oldest pruned.
 * High enough that a real household of devices never collides with it; low
 * enough that a leaked restore loop can't grow the table without bound. A
 * pruned device sees a 401 and walks back in through restore.
 */
const MAX_DEVICE_TOKENS = 10;

export const registerPlayer = async (db: Db): Promise<Registration> => {
  const playerId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const hash = hashToken(token);
  await db.batch(
    [
      // The legacy column keeps its NOT NULL promise; player_tokens is the
      // authoritative store the resolver reads.
      { sql: "INSERT INTO players (id, token_hash) VALUES (?, ?)", args: [playerId, hash] },
      {
        sql: "INSERT INTO player_tokens (token_hash, player_id) VALUES (?, ?)",
        args: [hash, playerId],
      },
    ],
    "write",
  );
  return { playerId, token };
};

/**
 * Mint an ADDITIONAL bearer token for an existing player — the restore path
 * (bits-accounts.md § A4): the calling device gets its own credential and
 * every other device's keeps working. Beyond MAX_DEVICE_TOKENS the oldest
 * are pruned (that device re-restores on its next 401).
 */
export const mintPlayerToken = async (db: Db, playerId: string): Promise<string> => {
  const token = randomBytes(32).toString("base64url");
  await db.batch(
    [
      {
        sql: "INSERT INTO player_tokens (token_hash, player_id) VALUES (?, ?)",
        args: [hashToken(token), playerId],
      },
      {
        // `rowid` breaks created_at ties (several restores in one second —
        // the tests, or a household setting up); insertion order is exact.
        sql: `DELETE FROM player_tokens WHERE player_id = ? AND rowid NOT IN (
                SELECT rowid FROM player_tokens WHERE player_id = ?
                ORDER BY created_at DESC, rowid DESC LIMIT ?
              )`,
        args: [playerId, playerId, MAX_DEVICE_TOKENS],
      },
    ],
    "write",
  );
  return token;
};

/** Resolve a bearer token to its player id — null means unauthorized. */
export const findPlayerByToken = async (db: Db, token: string): Promise<string | null> => {
  const result = await db.execute({
    sql: "SELECT player_id FROM player_tokens WHERE token_hash = ?",
    args: [hashToken(token)],
  });
  const id = result.rows[0]?.["player_id"];
  return typeof id === "string" ? id : null;
};
