/**
 * Store spend paths (bits-store.md § Persistence & API): Glory→Signet exchange
 * and Signet→entitlement unlock.
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
import { recordSignet } from "./signets";

export type IapCreditResult = "ok" | "duplicate";

export interface IapCreditInput {
  playerId: string;
  /** Pack size resolved server-side from SIGNET_PACKS — never client-supplied. */
  signets: number;
  platform: "apple" | "google" | "mock";
  /** The STORE's transaction id (Apple transactionId / Google orderId). */
  transactionId: string;
  /** For the ledger trail only — which pack this credit came from. */
  productId: string;
}

/**
 * Credit a validated IAP purchase. The idempotency key is
 * `iap:<platform>:<transactionId>` — deliberately NOT namespaced by player:
 * the ledger's global UNIQUE constraint then makes one store transaction
 * creditable exactly once EVER, so a receipt replayed from a second account
 * (shared receipt files, resold devices, forum-traded JWS blobs) lands as a
 * harmless `duplicate`, not a second credit.
 */
export const creditIapSignets = async (db: Db, input: IapCreditInput): Promise<IapCreditResult> => {
  const landed = await recordSignet(db, {
    playerId: input.playerId,
    amount: input.signets,
    source: `iap:${input.platform}:${input.productId}`,
    idempotencyKey: `iap:${input.platform}:${input.transactionId}`,
  });
  return landed ? "ok" : "duplicate";
};

export type ExchangeResult = "ok" | "duplicate" | "insufficient";

export interface ExchangeInput {
  playerId: string;
  /** Server-decided Glory price of one Signet — never client-supplied. */
  price: number;
  /** Client-minted uuid for the attempt: a retry of the same tap reuses the
   * key and lands as `duplicate` (success, nothing double-spent). */
  key: string;
}

/** Debit `price` Glory + credit 1 Signet, atomically. */
export const exchangeGloryForSignet = async (
  db: Db,
  input: ExchangeInput,
): Promise<ExchangeResult> => {
  const debitKey = `exchange:${input.playerId}:${input.key}:glory`;
  const creditKey = `exchange:${input.playerId}:${input.key}:signet`;
  const [debit] = await db.batch(
    [
      {
        sql: `INSERT OR IGNORE INTO glory_ledger (player_id, amount, source, idempotency_key)
              SELECT ?, ?, 'store:exchange', ?
              WHERE (SELECT COALESCE(SUM(amount), 0) FROM glory_ledger WHERE player_id = ?) >= ?`,
        args: [input.playerId, -input.price, debitKey, input.playerId, input.price],
      },
      {
        sql: `INSERT OR IGNORE INTO signet_ledger (player_id, amount, source, idempotency_key)
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
   * against the sim's signet-gated roster before calling; this layer only
   * guarantees the money math. */
  itemId: string;
}

/**
 * Spend 1 Signet for a permanent entitlement, atomically. The debit key is
 * deterministic (`unlock:<playerId>:<itemId>`) so a player can never pay for
 * the same item twice, no matter how the call is retried or raced; a
 * deed-granted item is refused before any Signet moves.
 */
export const unlockWithSignet = async (db: Db, input: UnlockInput): Promise<UnlockResult> => {
  const debitKey = `unlock:${input.playerId}:${input.itemId}`;
  const [debit] = await db.batch(
    [
      {
        sql: `INSERT OR IGNORE INTO signet_ledger (player_id, amount, source, idempotency_key)
              SELECT ?, -1, 'store:unlock', ?
              WHERE (SELECT COALESCE(SUM(amount), 0) FROM signet_ledger WHERE player_id = ?) >= 1
                AND NOT EXISTS (SELECT 1 FROM entitlements WHERE player_id = ? AND item_id = ?)`,
        args: [input.playerId, debitKey, input.playerId, input.playerId, input.itemId],
      },
      {
        sql: `INSERT OR IGNORE INTO entitlements (player_id, item_id, source)
              SELECT ?, ?, 'purchase:signet'
              WHERE EXISTS (SELECT 1 FROM signet_ledger WHERE idempotency_key = ?)`,
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
