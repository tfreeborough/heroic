/**
 * Redeem codes (bits-redeem-codes.md): promo and tester codes that pay Glory
 * and/or Signets, once per code per player.
 *
 * The API guarantees the caller is a LINKED player (the anti-farm rule — an
 * anonymous install can never hold a redemption); this layer guarantees the
 * money math. Like store.ts, every guard lives INSIDE the write batch: the
 * redemption row's INSERT OR IGNORE carries the active / expiry / use-limit
 * checks, and the ledger credits key off that row having landed, so a
 * refused or retried redeem writes nothing and a race for the last slot has
 * exactly one winner.
 */
import type { Db } from "./db";

export const CODE_KINDS = ["promo", "tester"] as const;
export type CodeKind = (typeof CODE_KINDS)[number];

/** No 0/O, 1/I — codes get read off a phone screen. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GENERATED_LENGTH = 10;
const CODE_MAX = 32;

/** Upper-case, letters and digits only: `blood tide-2026` → `BLOODTIDE2026`. */
export const normaliseCode = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_MAX);

const generate = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_LENGTH));
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
};

export interface MintCodesInput {
  kind: CodeKind;
  glory: number;
  signets: number;
  note?: string | null;
  /** Unix seconds; required for promo codes. */
  expiresAt?: number | null;
  /** Use limit — how many different players may ever redeem it; required for
   * promo codes, forced to 1 for tester codes. */
  maxRedemptions?: number | null;
  /** A human-authored code (promo). Mutually exclusive with `count`. */
  display?: string;
  /** Generate this many codes (tester batches). Default 1 when no display. */
  count?: number;
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/**
 * Mint one or more codes; returns their display strings. Throws on a rule
 * violation (the API turns that into a 400) — this is an admin path, so loud
 * beats lenient. A human-authored code that already exists is a conflict,
 * not an overwrite: existing redemptions must never change meaning.
 */
export const mintCodes = async (db: Db, input: MintCodesInput): Promise<string[]> => {
  if (!CODE_KINDS.includes(input.kind)) throw new Error("invalid_kind");
  if (!isCount(input.glory) || !isCount(input.signets)) throw new Error("invalid_reward");
  if (input.glory === 0 && input.signets === 0) throw new Error("empty_reward");
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null && !(Number.isInteger(expiresAt) && expiresAt > 0)) throw new Error("invalid_expiry");
  let max = input.maxRedemptions ?? null;
  if (max !== null && !(Number.isInteger(max) && max >= 1)) throw new Error("invalid_limit");
  if (input.kind === "tester") max = 1;
  if (input.kind === "promo" && (max === null || expiresAt === null)) throw new Error("promo_needs_limits");

  const displays: string[] = [];
  if (input.display !== undefined) {
    if (input.count !== undefined && input.count !== 1) throw new Error("display_or_count");
    const display = input.display.trim().toUpperCase();
    if (normaliseCode(display).length < 4) throw new Error("code_too_short");
    displays.push(display);
  } else {
    const count = input.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error("invalid_count");
    for (let i = 0; i < count; i++) displays.push(generate());
  }

  const results = await db.batch(
    displays.map((display) => ({
      sql: `INSERT OR IGNORE INTO codes (code, display, kind, glory, signets, max_redemptions, expires_at, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [normaliseCode(display), display, input.kind, input.glory, input.signets, max, expiresAt, input.note ?? null],
    })),
    "write",
  );
  // A generated collision is ~impossible (10^15 space); an authored one is a
  // real conflict. Either way, never claim a code that didn't land.
  const landed = displays.filter((_, i) => (results[i]?.rowsAffected ?? 0) > 0);
  if (landed.length === 0) throw new Error("code_exists");
  return landed;
};

export interface RedeemCodeInput {
  playerId: string;
  /** The caller's Clerk link — the API has already refused unlinked
   * players; stored on the redemption for audit only. */
  clerkUserId: string;
  /** Raw, as typed — normalised here. */
  code: string;
}

export type RedeemCodeResult =
  | { result: "ok"; glory: number; signets: number }
  | { result: "invalid" | "already" | "expired" };

/**
 * Redeem: the redemption row lands only if the code is live, in date and
 * under its use limit; each currency credit lands only if the row did (and
 * the ledger key `code:<code>:<playerId>` makes a retry a no-op). One batch,
 * one transaction.
 */
export const redeemCode = async (db: Db, input: RedeemCodeInput): Promise<RedeemCodeResult> => {
  const code = normaliseCode(input.code);
  if (!code) return { result: "invalid" };
  const key = `code:${code}:${input.playerId}`;
  const credit = (ledger: "glory_ledger" | "signet_ledger", column: "glory" | "signets") => ({
    sql: `INSERT OR IGNORE INTO ${ledger} (player_id, amount, source, idempotency_key)
          SELECT ?, c.${column}, 'code:' || c.kind, ?
          FROM codes c
          WHERE c.code = ? AND c.${column} > 0
            AND EXISTS (SELECT 1 FROM code_redemptions WHERE code = c.code AND player_id = ?)`,
    args: [input.playerId, key, code, input.playerId],
  });
  const [redemption] = await db.batch(
    [
      {
        sql: `INSERT OR IGNORE INTO code_redemptions (code, player_id, clerk_user_id)
              SELECT c.code, ?, ?
              FROM codes c
              WHERE c.code = ? AND c.active = 1
                AND (c.expires_at IS NULL OR c.expires_at > unixepoch())
                AND (c.max_redemptions IS NULL
                     OR (SELECT COUNT(*) FROM code_redemptions r WHERE r.code = c.code) < c.max_redemptions)`,
        args: [input.playerId, input.clerkUserId, code],
      },
      credit("glory_ledger", "glory"),
      credit("signet_ledger", "signets"),
    ],
    "write",
  );
  const found = await db.execute({
    sql: `SELECT c.glory, c.signets, c.active,
                 EXISTS (SELECT 1 FROM code_redemptions WHERE code = c.code AND player_id = ?) AS mine
          FROM codes c WHERE c.code = ?`,
    args: [input.playerId, code],
  });
  const row = found.rows[0];
  if (!row || Number(row["active"]) !== 1) return { result: "invalid" };
  if ((redemption?.rowsAffected ?? 0) > 0) {
    return { result: "ok", glory: Number(row["glory"]), signets: Number(row["signets"]) };
  }
  // The row didn't land: either this player already holds one, or the code
  // is out of date / out of uses (one answer — the player can't tell and
  // shouldn't).
  return { result: Number(row["mine"]) === 1 ? "already" : "expired" };
};

export interface CodeRecord {
  code: string;
  display: string;
  kind: CodeKind;
  glory: number;
  signets: number;
  maxRedemptions: number | null;
  expiresAt: number | null;
  active: boolean;
  note: string | null;
  createdAt: number;
  redemptions: number;
}

/** Every code with its redemption count, newest first (the admin list). */
export const listCodes = async (db: Db): Promise<CodeRecord[]> => {
  const result = await db.execute(
    `SELECT c.*, (SELECT COUNT(*) FROM code_redemptions r WHERE r.code = c.code) AS redemptions
     FROM codes c ORDER BY c.created_at DESC, c.code`,
  );
  return result.rows.map((row) => ({
    code: String(row["code"]),
    display: String(row["display"]),
    kind: String(row["kind"]) as CodeKind,
    glory: Number(row["glory"]),
    signets: Number(row["signets"]),
    maxRedemptions: row["max_redemptions"] === null ? null : Number(row["max_redemptions"]),
    expiresAt: row["expires_at"] === null ? null : Number(row["expires_at"]),
    active: Number(row["active"]) === 1,
    note: row["note"] === null ? null : String(row["note"]),
    createdAt: Number(row["created_at"]),
    redemptions: Number(row["redemptions"]),
  }));
};

/** Switch a code off (a leaked promo) or back on. False = no such code. */
export const setCodeActive = async (db: Db, code: string, active: boolean): Promise<boolean> => {
  const result = await db.execute({
    sql: "UPDATE codes SET active = ? WHERE code = ?",
    args: [active ? 1 : 0, normaliseCode(code)],
  });
  return result.rowsAffected > 0;
};
