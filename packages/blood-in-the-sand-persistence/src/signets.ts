/**
 * The Signet ledger (bits-store.md): the universal unlock voucher, structured
 * exactly like the Glory ledger — append-only rows, balance = SUM(amount).
 * Spend paths (exchange, unlock) live in store.ts, which guards balances
 * inside the write batch itself; this module is just the mirror of glory.ts.
 */
import type { Db } from "./db";

export const signetBalance = async (db: Db, playerId: string): Promise<number> => {
  const result = await db.execute({
    sql: "SELECT COALESCE(SUM(amount), 0) AS balance FROM signet_ledger WHERE player_id = ?",
    args: [playerId],
  });
  return Number(result.rows[0]?.["balance"] ?? 0);
};

export interface SignetEntry {
  playerId: string;
  /** Positive = credit, negative = debit. */
  amount: number;
  /** Open namespace — e.g. `store:exchange`, `iap:apple`, `dev-grant`. */
  source: string;
  /** Derived from the source event; the UNIQUE constraint makes retries
   * no-ops instead of double-credits. */
  idempotencyKey: string;
}

/** Returns false when the idempotency key was already spent (entry ignored). */
export const recordSignet = async (db: Db, entry: SignetEntry): Promise<boolean> => {
  const result = await db.execute({
    sql: `INSERT OR IGNORE INTO signet_ledger (player_id, amount, source, idempotency_key)
          VALUES (?, ?, ?, ?)`,
    args: [entry.playerId, entry.amount, entry.source, entry.idempotencyKey],
  });
  return result.rowsAffected > 0;
};
