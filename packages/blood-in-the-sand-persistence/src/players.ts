/**
 * Anonymous player identity (glory-economy.md): /register mints an id + a
 * secret token; the token is the only credential and is stored hashed, so a
 * leaked database can't impersonate players.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "./db";

export interface Registration {
  playerId: string;
  /** The bearer secret — returned exactly once; only its hash is stored. */
  token: string;
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export const registerPlayer = async (db: Db): Promise<Registration> => {
  const playerId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  await db.execute({
    sql: "INSERT INTO players (id, token_hash) VALUES (?, ?)",
    args: [playerId, hashToken(token)],
  });
  return { playerId, token };
};

/** Resolve a bearer token to its player id — null means unauthorized. */
export const findPlayerByToken = async (db: Db, token: string): Promise<string | null> => {
  const result = await db.execute({
    sql: "SELECT id FROM players WHERE token_hash = ?",
    args: [hashToken(token)],
  });
  const id = result.rows[0]?.["id"];
  return typeof id === "string" ? id : null;
};
