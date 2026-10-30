/**
 * One player, in full (hq-v2.md § Stage 1): the reads the HQ player window
 * stacks, the players table behind it, the cross-table activity feed, and
 * HQ's two per-player writes (a grant with a note, and the note itself).
 * Read-only except the last two; every read takes the clock where "today"
 * matters. Bots (`bot:` ids) are never players here.
 */
import type { Db } from "./db";

const DAY_S = 86_400;
const BOT_PREFIX = "bot:%";

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const opt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const optNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ── the card ───────────────────────────────────────────────────────────────

export interface PlayerCard {
  id: string;
  /** The name they last joined a room with; null before the stamp landed. */
  name: string | null;
  note: string | null;
  clerkUserId: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  devices: number;
  glory: number;
  signets: number;
  /** Lifetime seats in the match log (all online modes, from the day the
   * table landed) and in the ranked history (complete). */
  loggedMatches: number;
  rankedMatches: number;
  /** IAP pack purchases, as `iap:<platform>:<sku>` sources. */
  purchases: string[];
  /** Distinct days seen, from player_days. */
  daysActive: number;
  /** The last feedback row's stamps — the only place platform and app
   * version are ever recorded. */
  lastFeedback: { at: number; name: string | null; email: string | null; platform: string | null; osVersion: string | null; appBinary: string | null; appBundle: string | null } | null;
}

export const playerCard = async (db: Db, playerId: string): Promise<PlayerCard | null> => {
  const [p, purchases, fb] = await Promise.all([
    db.execute({
      sql: `SELECT id, name, note, clerk_user_id, created_at, last_seen_at,
              (SELECT COUNT(*) FROM player_tokens WHERE player_id = p.id) AS devices,
              (SELECT COALESCE(SUM(amount), 0) FROM glory_ledger WHERE player_id = p.id) AS glory,
              (SELECT COALESCE(SUM(amount), 0) FROM signet_ledger WHERE player_id = p.id) AS signets,
              (SELECT COUNT(*) FROM match_players WHERE player_id = p.id) AS logged,
              (SELECT COUNT(*) FROM ranked_match_players WHERE subject_id = p.id) AS ranked,
              (SELECT COUNT(*) FROM player_days WHERE player_id = p.id) AS days
            FROM players p WHERE id = ?`,
      args: [playerId],
    }),
    db.execute({ sql: `SELECT source FROM signet_ledger WHERE player_id = ? AND source LIKE 'iap:%' ORDER BY id`, args: [playerId] }),
    db.execute({
      sql: `SELECT created_at, player_name, contact_email, platform, os_version, app_binary, app_bundle
            FROM feedback WHERE player_id = ? ORDER BY id DESC LIMIT 1`,
      args: [playerId],
    }),
  ]);
  const row = p.rows[0];
  if (!row) return null;
  const f = fb.rows[0];
  return {
    id: str(row["id"]),
    name: opt(row["name"]),
    note: opt(row["note"]),
    clerkUserId: opt(row["clerk_user_id"]),
    createdAt: num(row["created_at"]),
    lastSeenAt: optNum(row["last_seen_at"]),
    devices: num(row["devices"]),
    glory: num(row["glory"]),
    signets: num(row["signets"]),
    loggedMatches: num(row["logged"]),
    rankedMatches: num(row["ranked"]),
    purchases: purchases.rows.map((r) => str(r["source"])),
    daysActive: num(row["days"]),
    lastFeedback: f
      ? {
          at: num(f["created_at"]),
          name: opt(f["player_name"]),
          email: opt(f["contact_email"]),
          platform: opt(f["platform"]),
          osVersion: opt(f["os_version"]),
          appBinary: opt(f["app_binary"]),
          appBundle: opt(f["app_bundle"]),
        }
      : null,
  };
};

/** id → last-known name for a set of players (links everywhere). */
export const namesOf = async (db: Db, ids: readonly string[]): Promise<Map<string, string>> => {
  const unique = [...new Set(ids)].filter((id) => id && !id.startsWith("bot:"));
  if (unique.length === 0) return new Map();
  const r = await db.execute({
    sql: `SELECT id, name FROM players WHERE name IS NOT NULL AND id IN (${unique.map(() => "?").join(",")})`,
    args: unique,
  });
  return new Map(r.rows.map((row) => [str(row["id"]), str(row["name"])]));
};

// ── matches ────────────────────────────────────────────────────────────────

export interface PlayerMatchRow {
  matchId: string;
  at: number;
  mode: string;
  bracket: string | null;
  arena: string | null;
  team: number;
  won: boolean;
  weapon: string | null;
  abilities: string[];
  /** Null for ranked rows older than the match log. */
  kills: number | null;
  deaths: number | null;
  damageDealt: number | null;
  damageTaken: number | null;
  rttMs: number | null;
  /** Ranked only. */
  ratingBefore: number | null;
  ratingAfter: number | null;
  durationS: number | null;
  rounds: number | null;
  humans: number | null;
  bots: number | null;
  /** The other human seats, from the match log (bots never appear). */
  others: { playerId: string; team: number; won: boolean }[];
}

const parseAbilities = (v: unknown): string[] => {
  if (v === null || v === undefined) return [];
  try {
    const parsed = JSON.parse(String(v)) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

/**
 * A player's online matches, newest first: the match log (every mode, with
 * what the seat did) merged with the ranked history (rating deltas, and
 * matches older than the log). One row per match id.
 */
export const playerMatches = async (db: Db, playerId: string, limit = 50): Promise<PlayerMatchRow[]> => {
  const [logged, ranked] = await Promise.all([
    db.execute({
      sql: `SELECT m.id, m.created_at, m.mode, m.bracket, m.arena, m.duration_s, m.rounds, m.humans, m.bots,
                   p.team, p.won, p.weapon, p.abilities, p.kills, p.deaths, p.damage_dealt, p.damage_taken, p.rtt_ms
            FROM match_players p JOIN match_log m ON m.id = p.match_id
            WHERE p.player_id = ? ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`,
      args: [playerId, limit],
    }),
    db.execute({
      sql: `SELECT m.id, m.created_at, m.bracket, p.team, p.won, p.loadout, p.rating_before, p.rating_after, p.rtt_ms
            FROM ranked_match_players p JOIN ranked_matches m ON m.id = p.match_id
            WHERE p.subject_id = ? ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`,
      args: [playerId, limit],
    }),
  ]);
  const rows = new Map<string, PlayerMatchRow>();
  for (const r of logged.rows) {
    rows.set(str(r["id"]), {
      matchId: str(r["id"]),
      at: num(r["created_at"]),
      mode: str(r["mode"]),
      bracket: opt(r["bracket"]),
      arena: opt(r["arena"]),
      team: num(r["team"]),
      won: num(r["won"]) === 1,
      weapon: opt(r["weapon"]),
      abilities: parseAbilities(r["abilities"]),
      kills: num(r["kills"]),
      deaths: num(r["deaths"]),
      damageDealt: num(r["damage_dealt"]),
      damageTaken: num(r["damage_taken"]),
      rttMs: optNum(r["rtt_ms"]),
      ratingBefore: null,
      ratingAfter: null,
      durationS: optNum(r["duration_s"]),
      rounds: num(r["rounds"]),
      humans: num(r["humans"]),
      bots: num(r["bots"]),
      others: [],
    });
  }
  for (const r of ranked.rows) {
    const id = str(r["id"]);
    const have = rows.get(id);
    if (have) {
      have.ratingBefore = num(r["rating_before"]);
      have.ratingAfter = num(r["rating_after"]);
      if (have.rttMs === null) have.rttMs = optNum(r["rtt_ms"]);
      continue;
    }
    let weapon: string | null = null;
    let abilities: string[] = [];
    if (r["loadout"] !== null && r["loadout"] !== undefined) {
      try {
        const l = JSON.parse(String(r["loadout"])) as { weapon?: unknown; abilities?: unknown };
        weapon = typeof l.weapon === "string" ? l.weapon : null;
        abilities = Array.isArray(l.abilities) ? l.abilities.map(String) : [];
      } catch {
        // an unreadable loadout is just an unknown one
      }
    }
    rows.set(id, {
      matchId: id,
      at: num(r["created_at"]),
      mode: "ranked",
      bracket: opt(r["bracket"]),
      arena: null,
      team: num(r["team"]),
      won: num(r["won"]) === 1,
      weapon,
      abilities,
      kills: null,
      deaths: null,
      damageDealt: null,
      damageTaken: null,
      rttMs: optNum(r["rtt_ms"]),
      ratingBefore: num(r["rating_before"]),
      ratingAfter: num(r["rating_after"]),
      durationS: null,
      rounds: null,
      humans: null,
      bots: null,
      others: [],
    });
  }
  const list = [...rows.values()].sort((a, b) => b.at - a.at).slice(0, limit);
  if (list.length > 0) {
    const ids = list.map((m) => m.matchId);
    const others = await db.execute({
      sql: `SELECT match_id, player_id, team, won FROM match_players
            WHERE player_id != ? AND match_id IN (${ids.map(() => "?").join(",")})`,
      args: [playerId, ...ids],
    });
    const byMatch = new Map(list.map((m) => [m.matchId, m]));
    for (const r of others.rows) {
      byMatch.get(str(r["match_id"]))?.others.push({ playerId: str(r["player_id"]), team: num(r["team"]), won: num(r["won"]) === 1 });
    }
    // Older ranked rows have no log seats — the ranked participant table
    // still says who else was there.
    const bare = list.filter((m) => m.mode === "ranked" && m.others.length === 0).map((m) => m.matchId);
    if (bare.length > 0) {
      const r2 = await db.execute({
        sql: `SELECT match_id, subject_id, team, won FROM ranked_match_players
              WHERE subject_id != ? AND subject_id NOT LIKE ? AND match_id IN (${bare.map(() => "?").join(",")})`,
        args: [playerId, BOT_PREFIX, ...bare],
      });
      for (const r of r2.rows) {
        byMatch.get(str(r["match_id"]))?.others.push({ playerId: str(r["subject_id"]), team: num(r["team"]), won: num(r["won"]) === 1 });
      }
    }
  }
  return list;
};

// ── wallet ─────────────────────────────────────────────────────────────────

export interface WalletRow {
  ledger: "glory" | "signet";
  amount: number;
  source: string;
  key: string;
  at: number;
}

/** Both ledgers as one strip, newest first. */
export const playerWallet = async (db: Db, playerId: string, limit = 100): Promise<WalletRow[]> => {
  const r = await db.execute({
    sql: `SELECT * FROM (
            SELECT 'glory' AS ledger, amount, source, idempotency_key, created_at, id FROM glory_ledger WHERE player_id = ?
            UNION ALL
            SELECT 'signet' AS ledger, amount, source, idempotency_key, created_at, id FROM signet_ledger WHERE player_id = ?
          ) ORDER BY created_at DESC, id DESC LIMIT ?`,
    args: [playerId, playerId, limit],
  });
  return r.rows.map((row) => ({
    ledger: str(row["ledger"]) as "glory" | "signet",
    amount: num(row["amount"]),
    source: str(row["source"]),
    key: str(row["idempotency_key"]),
    at: num(row["created_at"]),
  }));
};

// ── codes ──────────────────────────────────────────────────────────────────

export interface RedemptionRow {
  code: string;
  display: string;
  kind: string;
  glory: number;
  signets: number;
  at: number;
}

export const playerCodes = async (db: Db, playerId: string): Promise<RedemptionRow[]> => {
  const r = await db.execute({
    sql: `SELECT r.code, c.display, c.kind, c.glory, c.signets, r.created_at
          FROM code_redemptions r JOIN codes c ON c.code = r.code
          WHERE r.player_id = ? ORDER BY r.created_at DESC`,
    args: [playerId],
  });
  return r.rows.map((row) => ({
    code: str(row["code"]),
    display: str(row["display"]),
    kind: str(row["kind"]),
    glory: num(row["glory"]),
    signets: num(row["signets"]),
    at: num(row["created_at"]),
  }));
};

/** The UTC days this player opened the app, newest first. */
export const playerDays = async (db: Db, playerId: string, limit = 60): Promise<string[]> => {
  const r = await db.execute({ sql: `SELECT day FROM player_days WHERE player_id = ? ORDER BY day DESC LIMIT ?`, args: [playerId, limit] });
  return r.rows.map((row) => str(row["day"]));
};

// ── the players table ──────────────────────────────────────────────────────

export const PLAYER_SORTS = ["seen", "joined", "matches", "rating", "glory", "signets", "spent", "deeds"] as const;
export type PlayerSort = (typeof PLAYER_SORTS)[number];
export const PLAYER_FILTERS = ["all", "active", "new", "paid", "linked", "ranked"] as const;
export type PlayerFilter = (typeof PLAYER_FILTERS)[number];

export interface PlayerTableRow {
  id: string;
  name: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  linked: boolean;
  /** Logged seats + ranked matches older than the log (one count per match). */
  matches: number;
  rating: number | null;
  glory: number;
  signets: number;
  purchases: number;
  deeds: number;
}

export interface PlayersQuery {
  /** Id prefix, name fragment, or feedback email fragment. */
  q?: string;
  sort?: PlayerSort;
  filter?: PlayerFilter;
  limit?: number;
}

const SORT_SQL: Record<PlayerSort, string> = {
  seen: "p.last_seen_at DESC NULLS LAST, p.created_at DESC",
  joined: "p.created_at DESC",
  matches: "matches DESC, p.last_seen_at DESC",
  rating: "rating DESC NULLS LAST",
  glory: "glory DESC",
  signets: "signets DESC",
  spent: "purchases DESC, p.last_seen_at DESC",
  deeds: "deeds DESC",
};

export const playersTable = async (db: Db, query: PlayersQuery, nowS: number): Promise<PlayerTableRow[]> => {
  const sort = query.sort && PLAYER_SORTS.includes(query.sort) ? query.sort : "seen";
  const filter = query.filter && PLAYER_FILTERS.includes(query.filter) ? query.filter : "all";
  const limit = Math.min(500, Math.max(1, Math.trunc(query.limit ?? 100)));
  const q = (query.q ?? "").trim();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q) {
    where.push(`(p.id LIKE ? OR p.name LIKE ? OR EXISTS (SELECT 1 FROM feedback f WHERE f.player_id = p.id AND (f.contact_email LIKE ? OR f.player_name LIKE ?)))`);
    args.push(`${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (filter === "active") {
    where.push("p.last_seen_at >= ?");
    args.push(nowS - 7 * DAY_S);
  } else if (filter === "new") {
    where.push("p.created_at >= ?");
    args.push(nowS - 7 * DAY_S);
  } else if (filter === "paid") {
    where.push("EXISTS (SELECT 1 FROM signet_ledger s WHERE s.player_id = p.id AND s.source LIKE 'iap:%')");
  } else if (filter === "linked") {
    where.push("p.clerk_user_id IS NOT NULL");
  } else if (filter === "ranked") {
    where.push("EXISTS (SELECT 1 FROM ranked_ratings r WHERE r.subject_id = p.id)");
  }
  const r = await db.execute({
    sql: `SELECT p.id, p.name, p.created_at, p.last_seen_at, p.clerk_user_id,
            (SELECT COUNT(*) FROM match_players mp WHERE mp.player_id = p.id)
              + (SELECT COUNT(*) FROM ranked_match_players rp WHERE rp.subject_id = p.id
                   AND NOT EXISTS (SELECT 1 FROM match_players mp2 WHERE mp2.match_id = rp.match_id AND mp2.player_id = p.id)) AS matches,
            (SELECT MAX(rating) FROM ranked_ratings rr WHERE rr.subject_id = p.id) AS rating,
            (SELECT COALESCE(SUM(amount), 0) FROM glory_ledger g WHERE g.player_id = p.id) AS glory,
            (SELECT COALESCE(SUM(amount), 0) FROM signet_ledger s WHERE s.player_id = p.id) AS signets,
            (SELECT COUNT(*) FROM signet_ledger s WHERE s.player_id = p.id AND s.source LIKE 'iap:%') AS purchases,
            (SELECT COUNT(*) FROM achievement_unlocks a WHERE a.player_id = p.id) AS deeds
          FROM players p
          ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY ${SORT_SQL[sort]}
          LIMIT ?`,
    args: [...args, limit],
  });
  return r.rows.map((row) => ({
    id: str(row["id"]),
    name: opt(row["name"]),
    createdAt: num(row["created_at"]),
    lastSeenAt: optNum(row["last_seen_at"]),
    linked: row["clerk_user_id"] !== null && row["clerk_user_id"] !== undefined,
    matches: num(row["matches"]),
    rating: optNum(row["rating"]),
    glory: num(row["glory"]),
    signets: num(row["signets"]),
    purchases: num(row["purchases"]),
    deeds: num(row["deeds"]),
  }));
};

// ── the activity feed ──────────────────────────────────────────────────────

export const ACTIVITY_KINDS = ["joined", "match", "purchase", "exchange", "unlock", "deed", "feedback", "code", "grant"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityRow {
  kind: ActivityKind;
  at: number;
  /** The player it's about; a match names every human seat in `players`. */
  playerId: string | null;
  players: string[];
  /** Kind-specific reference: the match id, the item id, the deed id, the
   * feedback id, the code, the ledger source. */
  ref: string;
  /** Kind-specific extra: the mode, the amount, the platform, … */
  detail: string;
}

/**
 * What happened, across every table that stamps a time — newest first,
 * paged by `before` (unix seconds). Ranked matches read from the match log
 * when logged and from the ranked history otherwise, never both.
 */
export const activityFeed = async (
  db: Db,
  opts: { before?: number | null; limit?: number; kinds?: readonly ActivityKind[] } = {},
): Promise<ActivityRow[]> => {
  const limit = Math.min(200, Math.max(1, Math.trunc(opts.limit ?? 60)));
  const before = opts.before ?? null;
  const kinds = new Set(opts.kinds && opts.kinds.length > 0 ? opts.kinds : ACTIVITY_KINDS);
  // Every part names its columns: the UNION takes its names from the first
  // SELECT, and a single-kind page may start anywhere.
  const cols = (kind: string, at: string, player: string, players: string, ref: string, detail: string) =>
    `SELECT '${kind}' AS kind, ${at} AS at, ${player} AS player_id, ${players} AS players, ${ref} AS ref, ${detail} AS detail`;
  const parts: string[] = [];
  if (kinds.has("joined")) parts.push(`${cols("joined", "created_at", "id", "''", "''", "''")} FROM players`);
  if (kinds.has("match")) {
    parts.push(
      `${cols(
        "match",
        "m.created_at",
        "NULL",
        "COALESCE((SELECT group_concat(x) FROM (SELECT player_id || ':' || won AS x FROM match_players mp WHERE mp.match_id = m.id ORDER BY team, player_id)), '')",
        "m.id",
        "m.mode || '|' || COALESCE(m.bracket, '') || '|' || m.humans || '|' || m.bots || '|' || COALESCE(m.arena, '')",
      )} FROM match_log m`,
      `${cols(
        "match",
        "r.created_at",
        "NULL",
        "COALESCE((SELECT group_concat(x) FROM (SELECT subject_id || ':' || won AS x FROM ranked_match_players rp WHERE rp.match_id = r.id AND rp.subject_id NOT LIKE 'bot:%' ORDER BY team, subject_id)), '')",
        "r.id",
        "'ranked|' || r.bracket || '|||'",
      )} FROM ranked_matches r WHERE NOT EXISTS (SELECT 1 FROM match_log m WHERE m.id = r.id)`,
    );
  }
  if (kinds.has("purchase")) parts.push(`${cols("purchase", "created_at", "player_id", "''", "source", "CAST(amount AS TEXT)")} FROM signet_ledger WHERE source LIKE 'iap:%'`);
  if (kinds.has("exchange")) parts.push(`${cols("exchange", "created_at", "player_id", "''", "source", "CAST(amount AS TEXT)")} FROM signet_ledger WHERE source = 'store:exchange' AND amount > 0`);
  if (kinds.has("unlock")) parts.push(`${cols("unlock", "granted_at", "player_id", "''", "item_id", "source")} FROM entitlements WHERE source LIKE 'purchase:%'`);
  if (kinds.has("deed")) parts.push(`${cols("deed", "unlocked_at", "player_id", "''", "achievement_id", "''")} FROM achievement_unlocks`);
  if (kinds.has("feedback")) parts.push(`${cols("feedback", "created_at", "player_id", "''", "CAST(id AS TEXT)", "kind")} FROM feedback`);
  if (kinds.has("code")) parts.push(`${cols("code", "created_at", "player_id", "''", "code", "''")} FROM code_redemptions`);
  if (kinds.has("grant")) {
    parts.push(
      `${cols("grant", "created_at", "player_id", "''", "source", "'glory:' || amount")} FROM glory_ledger WHERE source LIKE 'hq:%'`,
      `${cols("grant", "created_at", "player_id", "''", "source", "'signet:' || amount")} FROM signet_ledger WHERE source LIKE 'hq:%'`,
    );
  }
  if (parts.length === 0) return [];
  const r = await db.execute({
    sql: `SELECT * FROM (${parts.join(" UNION ALL ")}) WHERE (? IS NULL OR at < ?) ORDER BY at DESC LIMIT ?`,
    args: [before, before, limit],
  });
  return r.rows.map((row) => ({
    kind: str(row["kind"]) as ActivityKind,
    at: num(row["at"]),
    playerId: opt(row["player_id"]),
    players: str(row["players"])
      .split(",")
      .filter(Boolean)
      .map((s) => s.split(":")[0]!)
      .filter((id) => !id.startsWith("bot:")),
    ref: str(row["ref"]),
    detail: str(row["detail"]),
  }));
};

// ── HQ writes ──────────────────────────────────────────────────────────────

export interface HqGrantInput {
  playerId: string;
  ledger: "glory" | "signet";
  /** Signed: a negative amount takes away. */
  amount: number;
  /** Why — lands in the ledger source as `hq:<note>` so the wallet strip
   * and the activity feed read it back. */
  note: string;
  /** Idempotency: HQ mints one per form submit, so a double-click can't
   * pay twice. */
  key: string;
}

/** Credit or debit a player from HQ. False = the key already landed. */
export const hqGrant = async (db: Db, input: HqGrantInput): Promise<boolean> => {
  if (!Number.isInteger(input.amount) || input.amount === 0) throw new Error("amount must be a whole non-zero number");
  const note = input.note.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!note) throw new Error("a note is required");
  const table = input.ledger === "glory" ? "glory_ledger" : "signet_ledger";
  const r = await db.execute({
    sql: `INSERT OR IGNORE INTO ${table} (player_id, amount, source, idempotency_key) VALUES (?, ?, ?, ?)`,
    args: [input.playerId, input.amount, `hq:${note}`, `hq:${input.key}`],
  });
  return r.rowsAffected > 0;
};

/** HQ's free-text note on a player (empty clears it). */
export const setPlayerNote = async (db: Db, playerId: string, note: string): Promise<void> => {
  const clean = note.trim().slice(0, 2000);
  await db.execute({ sql: `UPDATE players SET note = ? WHERE id = ?`, args: [clean || null, playerId] });
};

// ── tidying out old test accounts ──────────────────────────────────────────

export interface StalePlayerRow extends PlayerTableRow {
  feedback: number;
  /** Why HQ leaves this one unticked: it looks like a real person. */
  protectedBy: ("paid" | "linked" | "feedback")[];
}

/**
 * "Nothing since the cutoff" as one SQL condition over `p`: not seen, no
 * daily-seen row, no logged or ranked seat, no ledger movement. Shared by
 * the read and the delete so the delete can't outrun the rule the list
 * was built from.
 */
const STALE_WHERE = `p.id NOT LIKE ? AND p.created_at < ?
  AND (p.last_seen_at IS NULL OR p.last_seen_at < ?)
  AND NOT EXISTS (SELECT 1 FROM player_days d WHERE d.player_id = p.id AND d.day >= ?)
  AND NOT EXISTS (SELECT 1 FROM match_players mp JOIN match_log m ON m.id = mp.match_id WHERE mp.player_id = p.id AND m.created_at >= ?)
  AND NOT EXISTS (SELECT 1 FROM ranked_match_players rp JOIN ranked_matches rm ON rm.id = rp.match_id WHERE rp.subject_id = p.id AND rm.created_at >= ?)
  AND NOT EXISTS (SELECT 1 FROM glory_ledger g WHERE g.player_id = p.id AND g.created_at >= ?)
  AND NOT EXISTS (SELECT 1 FROM signet_ledger s WHERE s.player_id = p.id AND s.created_at >= ?)`;

const staleArgs = (cutoffS: number): (string | number)[] => {
  const day = new Date(cutoffS * 1000).toISOString().slice(0, 10);
  return [BOT_PREFIX, cutoffS, cutoffS, day, cutoffS, cutoffS, cutoffS, cutoffS];
};

/** Players registered before the cutoff who've done nothing since: the
 * test-device leftovers, plus any real early player who never came back. */
export const stalePlayers = async (db: Db, cutoffS: number): Promise<StalePlayerRow[]> => {
  const r = await db.execute({
    sql: `SELECT p.id, p.name, p.created_at, p.last_seen_at, p.clerk_user_id,
            (SELECT COUNT(*) FROM match_players mp WHERE mp.player_id = p.id)
              + (SELECT COUNT(*) FROM ranked_match_players rp WHERE rp.subject_id = p.id
                   AND NOT EXISTS (SELECT 1 FROM match_players mp2 WHERE mp2.match_id = rp.match_id AND mp2.player_id = p.id)) AS matches,
            (SELECT MAX(rating) FROM ranked_ratings rr WHERE rr.subject_id = p.id) AS rating,
            (SELECT COALESCE(SUM(amount), 0) FROM glory_ledger g WHERE g.player_id = p.id) AS glory,
            (SELECT COALESCE(SUM(amount), 0) FROM signet_ledger s WHERE s.player_id = p.id) AS signets,
            (SELECT COUNT(*) FROM signet_ledger s WHERE s.player_id = p.id AND s.source LIKE 'iap:%') AS purchases,
            (SELECT COUNT(*) FROM achievement_unlocks a WHERE a.player_id = p.id) AS deeds,
            (SELECT COUNT(*) FROM feedback f WHERE f.player_id = p.id) AS feedback
          FROM players p
          WHERE ${STALE_WHERE}
          ORDER BY p.created_at`,
    args: staleArgs(cutoffS),
  });
  return r.rows.map((row) => {
    const linked = row["clerk_user_id"] !== null && row["clerk_user_id"] !== undefined;
    const purchases = num(row["purchases"]);
    const feedback = num(row["feedback"]);
    const protectedBy: StalePlayerRow["protectedBy"] = [];
    if (purchases > 0) protectedBy.push("paid");
    if (linked) protectedBy.push("linked");
    if (feedback > 0) protectedBy.push("feedback");
    return {
      id: str(row["id"]),
      name: opt(row["name"]),
      createdAt: num(row["created_at"]),
      lastSeenAt: optNum(row["last_seen_at"]),
      linked,
      matches: num(row["matches"]),
      rating: optNum(row["rating"]),
      glory: num(row["glory"]),
      signets: num(row["signets"]),
      purchases,
      deeds: num(row["deeds"]),
      feedback,
      protectedBy,
    };
  });
};

/**
 * Permanently delete the given players and everything that is only theirs
 * (wallets, deeds, rating, tokens, owned items, feedback, seen days).
 * Re-checks the stale rule inside the delete, so an id that has been active
 * since the list was drawn, or a bot, is silently kept. Match history stays:
 * those rows are other players' history too. Returns how many went.
 */
export const deleteStalePlayers = async (db: Db, ids: readonly string[], cutoffS: number): Promise<number> => {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return 0;
  const doomed = await db.execute({
    sql: `SELECT p.id FROM players p WHERE p.id IN (${unique.map(() => "?").join(",")}) AND ${STALE_WHERE}`,
    args: [...unique, ...staleArgs(cutoffS)],
  });
  const keep = doomed.rows.map((row) => str(row["id"]));
  if (keep.length === 0) return 0;
  const inList = `(${keep.map(() => "?").join(",")})`;
  // Every table with a foreign key into players, read off the live schema —
  // older databases still carry tables the code no longer creates (the
  // pre-rename writ_ledger), and one missed reference fails the whole batch.
  const referencing = await db.execute(
    `SELECT m.name AS tbl, f."from" AS col FROM sqlite_master m, pragma_foreign_key_list(m.name) f
      WHERE m.type = 'table' AND f."table" = 'players'`,
  );
  const owned = new Map<string, string>(referencing.rows.map((row) => [str(row["tbl"]), str(row["col"])]));
  // Plus the player-keyed tables that never declared the reference.
  for (const t of ["achievement_counters", "achievement_progress_marks", "player_days"]) owned.set(t, "player_id");
  await db.batch(
    [
      ...[...owned].map(([t, col]) => ({ sql: `DELETE FROM "${t}" WHERE "${col}" IN ${inList}`, args: keep })),
      { sql: `DELETE FROM skirmish_companions WHERE player_id IN ${inList} OR other_id IN ${inList}`, args: [...keep, ...keep] },
      { sql: `DELETE FROM ranked_ratings WHERE subject_id IN ${inList}`, args: keep },
      { sql: `DELETE FROM players WHERE id IN ${inList}`, args: keep },
    ],
    "write",
  );
  return keep.length;
};
