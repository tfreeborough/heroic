/**
 * Store spend paths (bits-store.md § Persistence & API): Glory→Writ exchange
 * and Writ→entitlement unlock.
 *
 * Unlike the pre-check-then-batch idiom elsewhere (which leans on the game
 * server being the sole writer), these debits race a second writer process by
 * design — the API spends Glory while the game server credits it. So the
 * balance guard is INSIDE the debit statement (`INSERT … SELECT … WHERE
 * balance ≥ price`) and each batch is one transaction: the check and the
 * write can never be split by a concurrent commit. Follow-up statements key
 * off the debit's idempotency row (`WHERE EXISTS`), so a batch whose guard
 * fails writes nothing at all, and a retried batch is a no-op end to end.
 */
import type { Db } from "./db";

export type ExchangeResult = "ok" | "duplicate" | "insufficient";

export interface ExchangeInput {
  playerId: string;
  /** Server-decided Glory price of one Writ — never client-supplied. */
  price: number;
  /** Client-minted uuid for the attempt: a retry of the same tap reuses the
   * key and lands as `duplicate` (success, nothing double-spent). */
  key: string;
}

/** Debit `price` Glory + credit 1 Writ, atomically. */
export const exchangeGloryForWrit = async (
  db: Db,
  input: ExchangeInput,
): Promise<ExchangeResult> => {
  const debitKey = `exchange:${input.playerId}:${input.key}:glory`;
  const creditKey = `exchange:${input.playerId}:${input.key}:writ`;
  const [debit] = await db.batch(
    [
      {
        sql: `INSERT OR IGNORE INTO glory_ledger (player_id, amount, source, idempotency_key)
              SELECT ?, ?, 'store:exchange', ?
              WHERE (SELECT COALESCE(SUM(amount), 0) FROM glory_ledger WHERE player_id = ?) >= ?`,
        args: [input.playerId, -input.price, debitKey, input.playerId, input.price],
      },
      {
        sql: `INSERT OR IGNORE INTO writ_ledger (player_id, amount, source, idempotency_key)
              SELECT ?, 1, 'store:exchange', ?
              WHERE EXISTS (SELECT 1 FROM glory_ledger WHERE idempotency_key = ?)`,
        args: [input.playerId, creditKey, debitKey],
      },
    ],
    "write",
  );
  if ((debit?.rowsAffected ?? 0) > 0) return "ok";
  // Debit didn't land: either this attempt already went through (key spent)
  // or the balance guard refused it.
  const prior = await db.execute({
    sql: "SELECT 1 FROM glory_ledger WHERE idempotency_key = ?",
    args: [debitKey],
  });
  return prior.rows.length > 0 ? "duplicate" : "insufficient";
};

export type UnlockResult = "ok" | "already-owned" | "insufficient";

export interface UnlockInput {
  playerId: string;
  /** Entitlement id — `weapon:<id>` / `ability:<id>`. The API validates it
   * against the sim's writ-gated roster before calling; this layer only
   * guarantees the money math. */
  itemId: string;
}

/**
 * Spend 1 Writ for a permanent entitlement, atomically. The debit key is
 * deterministic (`unlock:<playerId>:<itemId>`) so a player can never pay for
 * the same item twice, no matter how the call is retried or raced; a
 * deed-granted item is refused before any Writ moves.
 */
export const unlockWithWrit = async (db: Db, input: UnlockInput): Promise<UnlockResult> => {
  const debitKey = `unlock:${input.playerId}:${input.itemId}`;
  const [debit] = await db.batch(
    [
      {
        sql: `INSERT OR IGNORE INTO writ_ledger (player_id, amount, source, idempotency_key)
              SELECT ?, -1, 'store:unlock', ?
              WHERE (SELECT COALESCE(SUM(amount), 0) FROM writ_ledger WHERE player_id = ?) >= 1
                AND NOT EXISTS (SELECT 1 FROM entitlements WHERE player_id = ? AND item_id = ?)`,
        args: [input.playerId, debitKey, input.playerId, input.playerId, input.itemId],
      },
      {
        sql: `INSERT OR IGNORE INTO entitlements (player_id, item_id, source)
              SELECT ?, ?, 'purchase:writ'
              WHERE EXISTS (SELECT 1 FROM writ_ledger WHERE idempotency_key = ?)`,
        args: [input.playerId, input.itemId, debitKey],
      },
    ],
    "write",
  );
  if ((debit?.rowsAffected ?? 0) > 0) return "ok";
  const owned = await db.execute({
    sql: "SELECT 1 FROM entitlements WHERE player_id = ? AND item_id = ?",
    args: [input.playerId, input.itemId],
  });
  return owned.rows.length > 0 ? "already-owned" : "insufficient";
};
