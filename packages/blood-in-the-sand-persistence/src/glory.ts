/**
 * The Glory ledger (glory-economy.md): append-only rows, balance derived by
 * SUM. Credits are positive, debits negative; a debit writer is responsible
 * for checking the balance first (inside a transaction) when spending lands.
 */
import type { Db } from "./db";

export const gloryBalance = async (db: Db, playerId: string): Promise<number> => {
  const result = await db.execute({
    sql: "SELECT COALESCE(SUM(amount), 0) AS balance FROM glory_ledger WHERE player_id = ?",
    args: [playerId],
  });
  return Number(result.rows[0]?.["balance"] ?? 0);
};

export interface GloryEntry {
  playerId: string;
  /** Positive = credit, negative = debit. */
  amount: number;
  /** Open namespace — e.g. `match:<roomId>:<round>`, `app-review:<playerId>`. */
  source: string;
  /** Derived from the source event; the UNIQUE constraint makes retries
   * no-ops instead of double-credits. */
  idempotencyKey: string;
}

/** Returns false when the idempotency key was already spent (entry ignored). */
export const recordGlory = async (db: Db, entry: GloryEntry): Promise<boolean> => {
  const result = await db.execute({
    sql: `INSERT OR IGNORE INTO glory_ledger (player_id, amount, source, idempotency_key)
          VALUES (?, ?, ?, ?)`,
    args: [entry.playerId, entry.amount, entry.source, entry.idempotencyKey],
  });
  return result.rowsAffected > 0;
};
