/**
 * Player feedback + bug reports (bits-feedback.md): append-only rows, one
 * per report, stamped with the device identity and the version the report
 * came from. The API validates shape and length before this runs; here the
 * caps are the last line (a row is forever, so nothing oversized lands).
 */
import type { Db } from "./db";

export const FEEDBACK_KINDS = ["bug", "idea", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_MESSAGE_MAX = 2000;
export const FEEDBACK_EMAIL_MAX = 200;
/** Caps for the free-text context stamps (name, platform, versions). */
export const FEEDBACK_STAMP_MAX = 80;

export interface FeedbackInput {
  playerId: string;
  kind: FeedbackKind;
  message: string;
  /** Where to reply — optional, never validated beyond length. */
  contactEmail?: string | null;
  /** The gladiator name at the time of the report. */
  playerName?: string | null;
  /** `ios` / `android` + the OS version string. */
  platform?: string | null;
  osVersion?: string | null;
  /** The two lines the Settings footer shows (runningVersion()). */
  appBinary?: string | null;
  appBundle?: string | null;
}

export interface FeedbackRecord {
  id: number;
  playerId: string;
  kind: FeedbackKind;
  message: string;
  contactEmail: string | null;
  playerName: string | null;
  platform: string | null;
  osVersion: string | null;
  appBinary: string | null;
  appBundle: string | null;
  /** Unix seconds. */
  createdAt: number;
}

const clip = (value: string | null | undefined, max: number): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, max) : null;
};

/** Store one report; returns its id. Throws on an empty message or an
 * unknown kind — callers validate first, this is the backstop. */
export const recordFeedback = async (db: Db, input: FeedbackInput): Promise<number> => {
  const message = input.message.trim().slice(0, FEEDBACK_MESSAGE_MAX);
  if (!message) throw new Error("feedback message is empty");
  if (!FEEDBACK_KINDS.includes(input.kind)) throw new Error(`unknown feedback kind: ${input.kind}`);
  const result = await db.execute({
    sql: `INSERT INTO feedback
            (player_id, kind, message, contact_email, player_name, platform, os_version, app_binary, app_bundle)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.playerId,
      input.kind,
      message,
      clip(input.contactEmail, FEEDBACK_EMAIL_MAX),
      clip(input.playerName, FEEDBACK_STAMP_MAX),
      clip(input.platform, FEEDBACK_STAMP_MAX),
      clip(input.osVersion, FEEDBACK_STAMP_MAX),
      clip(input.appBinary, FEEDBACK_STAMP_MAX),
      clip(input.appBundle, FEEDBACK_STAMP_MAX),
    ],
  });
  return Number(result.lastInsertRowid);
}

/**
 * Reports newest-first. `before` pages backwards (ids strictly below it);
 * `limit` caps the page (default 50, max 200).
 */
export const listFeedback = async (
  db: Db,
  opts: { before?: number; limit?: number } = {},
): Promise<FeedbackRecord[]> => {
  const limit = Math.min(200, Math.max(1, Math.trunc(opts.limit ?? 50)));
  const before = opts.before !== undefined && Number.isFinite(opts.before) ? Math.trunc(opts.before) : null;
  const result = await db.execute({
    sql: `SELECT id, player_id, kind, message, contact_email, player_name, platform, os_version,
                 app_binary, app_bundle, created_at
            FROM feedback
           WHERE (? IS NULL OR id < ?)
           ORDER BY id DESC
           LIMIT ?`,
    args: [before, before, limit],
  });
  return result.rows.map((row) => ({
    id: Number(row["id"]),
    playerId: String(row["player_id"]),
    kind: String(row["kind"]) as FeedbackKind,
    message: String(row["message"]),
    contactEmail: row["contact_email"] === null ? null : String(row["contact_email"]),
    playerName: row["player_name"] === null ? null : String(row["player_name"]),
    platform: row["platform"] === null ? null : String(row["platform"]),
    osVersion: row["os_version"] === null ? null : String(row["os_version"]),
    appBinary: row["app_binary"] === null ? null : String(row["app_binary"]),
    appBundle: row["app_bundle"] === null ? null : String(row["app_bundle"]),
    createdAt: Number(row["created_at"]),
  }));
};
