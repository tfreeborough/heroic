/**
 * The studio console's reads (hq.md): aggregate queries over the tables the
 * game already writes. Every function here is read-only, takes the clock as
 * an argument where "today" matters (so tests can pin it), and returns plain
 * rows the HQ pages render as they are. Day keys are UTC `YYYY-MM-DD`.
 *
 * Bots never count as players: a ranked bot's subject id is `bot:<uuid>`
 * (bits-ranked-bots.md) and the ladder writer already keeps them out of
 * ranked_ratings, so only the history tables need the LIKE filter.
 */
import type { Db } from "./db";

const DAY_S = 86_400;
const BOT_PREFIX = "bot:%";

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** UTC day key for a unix-seconds timestamp. */
export const dayKey = (unixS: number): string => new Date(unixS * 1000).toISOString().slice(0, 10);

/** The last `days` day keys ending today, oldest first — the x-axis every
 * per-day series is filled against so a quiet day reads as 0, not absent. */
export const dayKeys = (days: number, nowS: number): string[] => {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(nowS - i * DAY_S));
  return keys;
};

const sinceDays = (days: number, nowS: number): number => nowS - (days - 1) * DAY_S - (nowS % DAY_S);

// ── players ────────────────────────────────────────────────────────────────

export interface PlayerOverview {
  total: number;
  linked: number;
  /** Registered in the last 24h / 7 days. */
  newDay: number;
  newWeek: number;
  /** Seen (players.last_seen_at) in the last 1 / 7 / 30 days. */
  activeDay: number;
  activeWeek: number;
  activeMonth: number;
  /** Device credentials outstanding (player_tokens rows). */
  devices: number;
}

export const playerOverview = async (db: Db, nowS: number): Promise<PlayerOverview> => {
  const r = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM players) AS total,
            (SELECT COUNT(*) FROM players WHERE clerk_user_id IS NOT NULL) AS linked,
            (SELECT COUNT(*) FROM players WHERE created_at >= ?) AS new_day,
            (SELECT COUNT(*) FROM players WHERE created_at >= ?) AS new_week,
            (SELECT COUNT(*) FROM players WHERE last_seen_at >= ?) AS active_day,
            (SELECT COUNT(*) FROM players WHERE last_seen_at >= ?) AS active_week,
            (SELECT COUNT(*) FROM players WHERE last_seen_at >= ?) AS active_month,
            (SELECT COUNT(*) FROM player_tokens) AS devices`,
    args: [nowS - DAY_S, nowS - 7 * DAY_S, nowS - DAY_S, nowS - 7 * DAY_S, nowS - 30 * DAY_S],
  });
  const row = r.rows[0]!;
  return {
    total: num(row["total"]),
    linked: num(row["linked"]),
    newDay: num(row["new_day"]),
    newWeek: num(row["new_week"]),
    activeDay: num(row["active_day"]),
    activeWeek: num(row["active_week"]),
    activeMonth: num(row["active_month"]),
    devices: num(row["devices"]),
  };
};

export interface DayCount {
  day: string;
  count: number;
}

const fillDays = (rows: Map<string, number>, days: number, nowS: number): DayCount[] =>
  dayKeys(days, nowS).map((day) => ({ day, count: rows.get(day) ?? 0 }));

/** New registrations per day, last `days` days (zero-filled). */
export const newPlayersByDay = async (db: Db, days: number, nowS: number): Promise<DayCount[]> => {
  const r = await db.execute({
    sql: `SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS n
          FROM players WHERE created_at >= ? GROUP BY day`,
    args: [sinceDays(days, nowS)],
  });
  return fillDays(new Map(r.rows.map((row) => [str(row["day"]), num(row["n"])])), days, nowS);
};

/** Distinct players seen per day (from last_seen_at, so a player counts on
 * the day of their LAST visit only — a floor on daily actives, not the
 * truth; the console labels it that way). */
export const activePlayersByDay = async (db: Db, days: number, nowS: number): Promise<DayCount[]> => {
  const r = await db.execute({
    sql: `SELECT date(last_seen_at, 'unixepoch') AS day, COUNT(*) AS n
          FROM players WHERE last_seen_at >= ? GROUP BY day`,
    args: [sinceDays(days, nowS)],
  });
  return fillDays(new Map(r.rows.map((row) => [str(row["day"]), num(row["n"])])), days, nowS);
};

// ── matches ────────────────────────────────────────────────────────────────

export interface MatchesDay {
  day: string;
  ranked: number;
  skirmish: number;
  brawl: number;
}

/** Matches per day by mode. Ranked reads ranked_matches (the full history,
 * older than the log); skirmish and brawl read match_log. */
export const matchesByDay = async (db: Db, days: number, nowS: number): Promise<MatchesDay[]> => {
  const since = sinceDays(days, nowS);
  const [ranked, logged] = await Promise.all([
    db.execute({
      sql: `SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS n
            FROM ranked_matches WHERE created_at >= ? GROUP BY day`,
      args: [since],
    }),
    db.execute({
      sql: `SELECT date(created_at, 'unixepoch') AS day, mode, COUNT(*) AS n
            FROM match_log WHERE created_at >= ? AND mode != 'ranked' GROUP BY day, mode`,
      args: [since],
    }),
  ]);
  const byDay = new Map<string, MatchesDay>(dayKeys(days, nowS).map((day) => [day, { day, ranked: 0, skirmish: 0, brawl: 0 }]));
  for (const row of ranked.rows) {
    const d = byDay.get(str(row["day"]));
    if (d) d.ranked = num(row["n"]);
  }
  for (const row of logged.rows) {
    const d = byDay.get(str(row["day"]));
    const mode = str(row["mode"]);
    if (d && (mode === "skirmish" || mode === "brawl")) d[mode] = num(row["n"]);
  }
  return [...byDay.values()];
};

export interface MatchOverview {
  /** Ranked matches in the last 24h / 7d (ranked_matches). */
  rankedDay: number;
  rankedWeek: number;
  /** Logged non-ranked matches in the last 24h / 7d (match_log). */
  casualDay: number;
  casualWeek: number;
  /** Mean logged match length over the last 7 days, seconds (null = none). */
  avgDurationS: number | null;
  /** Share of logged matches in the last 7 days with at least one bot seat. */
  botShareWeek: number | null;
}

export const matchOverview = async (db: Db, nowS: number): Promise<MatchOverview> => {
  const r = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM ranked_matches WHERE created_at >= ?) AS ranked_day,
            (SELECT COUNT(*) FROM ranked_matches WHERE created_at >= ?) AS ranked_week,
            (SELECT COUNT(*) FROM match_log WHERE mode != 'ranked' AND created_at >= ?) AS casual_day,
            (SELECT COUNT(*) FROM match_log WHERE mode != 'ranked' AND created_at >= ?) AS casual_week,
            (SELECT AVG(duration_s) FROM match_log WHERE created_at >= ? AND duration_s IS NOT NULL) AS avg_duration,
            (SELECT COUNT(*) FROM match_log WHERE created_at >= ?) AS logged_week,
            (SELECT COUNT(*) FROM match_log WHERE created_at >= ? AND bots > 0) AS botted_week`,
    args: [nowS - DAY_S, nowS - 7 * DAY_S, nowS - DAY_S, nowS - 7 * DAY_S, nowS - 7 * DAY_S, nowS - 7 * DAY_S, nowS - 7 * DAY_S],
  });
  const row = r.rows[0]!;
  const loggedWeek = num(row["logged_week"]);
  return {
    rankedDay: num(row["ranked_day"]),
    rankedWeek: num(row["ranked_week"]),
    casualDay: num(row["casual_day"]),
    casualWeek: num(row["casual_week"]),
    avgDurationS: row["avg_duration"] === null ? null : Math.round(num(row["avg_duration"])),
    botShareWeek: loggedWeek === 0 ? null : num(row["botted_week"]) / loggedWeek,
  };
};

// ── ranked ─────────────────────────────────────────────────────────────────

export interface BracketOverview {
  bracket: string;
  matches: number;
  /** Matches where every seat was human. */
  humanOnly: number;
  /** Distinct human subjects who played. */
  players: number;
  /** Median of the seat-level server-measured rtt, ms (bits-regions.md
   * Stage 1), over the most recent sample; null with no data. */
  rttMedianMs: number | null;
  rttSamples: number;
}

export const rankedOverview = async (db: Db, season: number): Promise<BracketOverview[]> => {
  const [matches, rtts] = await Promise.all([
    db.execute({
      sql: `SELECT m.bracket AS bracket,
              COUNT(DISTINCT m.id) AS matches,
              COUNT(DISTINCT CASE WHEN NOT EXISTS (
                SELECT 1 FROM ranked_match_players b WHERE b.match_id = m.id AND b.subject_id LIKE ?
              ) THEN m.id END) AS human_only,
              COUNT(DISTINCT CASE WHEN p.subject_id NOT LIKE ? THEN p.subject_id END) AS players
            FROM ranked_matches m
            LEFT JOIN ranked_match_players p ON p.match_id = m.id
            WHERE m.season = ?
            GROUP BY m.bracket ORDER BY m.bracket`,
      args: [BOT_PREFIX, BOT_PREFIX, season],
    }),
    db.execute({
      sql: `SELECT m.bracket AS bracket, p.rtt_ms AS rtt
            FROM ranked_match_players p JOIN ranked_matches m ON m.id = p.match_id
            WHERE m.season = ? AND p.rtt_ms IS NOT NULL AND p.subject_id NOT LIKE ?
            ORDER BY m.created_at DESC LIMIT 5000`,
      args: [season, BOT_PREFIX],
    }),
  ]);
  const samples = new Map<string, number[]>();
  for (const row of rtts.rows) {
    const b = str(row["bracket"]);
    if (!samples.has(b)) samples.set(b, []);
    samples.get(b)!.push(num(row["rtt"]));
  }
  return matches.rows.map((row) => {
    const bracket = str(row["bracket"]);
    const s = (samples.get(bracket) ?? []).sort((a, b) => a - b);
    return {
      bracket,
      matches: num(row["matches"]),
      humanOnly: num(row["human_only"]),
      players: num(row["players"]),
      rttMedianMs: s.length === 0 ? null : s[Math.floor(s.length / 2)]!,
      rttSamples: s.length,
    };
  });
};

export interface LadderRow {
  subjectId: string;
  rating: number;
  wins: number;
  losses: number;
  peak: number;
}

/** Top `limit` of a bracket's ladder — human subjects only (the writer never
 * rates bots, but the filter costs nothing and documents the promise). */
export const ladderTop = async (db: Db, season: number, bracket: string, limit = 20): Promise<LadderRow[]> => {
  const r = await db.execute({
    sql: `SELECT subject_id, rating, wins, losses, peak_rating FROM ranked_ratings
          WHERE season = ? AND bracket = ? AND subject_id NOT LIKE ?
          ORDER BY rating DESC LIMIT ?`,
    args: [season, bracket, BOT_PREFIX, limit],
  });
  return r.rows.map((row) => ({
    subjectId: str(row["subject_id"]),
    rating: num(row["rating"]),
    wins: num(row["wins"]),
    losses: num(row["losses"]),
    peak: Math.max(num(row["rating"]), num(row["peak_rating"])),
  }));
};

export interface RatingBucket {
  /** Bucket floor (rating rounded down to `width`). */
  floor: number;
  count: number;
}

/** Rating histogram for a bracket in `width`-point buckets, ascending. */
export const ratingSpread = async (db: Db, season: number, bracket: string, width = 100): Promise<RatingBucket[]> => {
  const r = await db.execute({
    sql: `SELECT (rating / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS floor, COUNT(*) AS n FROM ranked_ratings
          WHERE season = ? AND bracket = ? AND subject_id NOT LIKE ?
          GROUP BY floor ORDER BY floor`,
    args: [width, width, season, bracket, BOT_PREFIX],
  });
  return r.rows.map((row) => ({ floor: num(row["floor"]), count: num(row["n"]) }));
};

export interface PickRow {
  id: string;
  picks: number;
  wins: number;
  /** picks / human seats in the bracket. */
  pickRate: number;
  /** wins / picks. */
  winRate: number;
}

export interface LoadoutStats {
  /** Human seats considered. */
  seats: number;
  weapons: PickRow[];
  abilities: PickRow[];
}

/** Weapon and ability pick/win rates from the ranked history's loadout JSON
 * ({ weapon, abilities: [] }), human seats only, one season, one bracket or
 * all (null). */
export const loadoutStats = async (db: Db, season: number, bracket: string | null): Promise<LoadoutStats> => {
  const where = `m.season = ? AND p.subject_id NOT LIKE ? AND p.loadout IS NOT NULL${bracket ? " AND m.bracket = ?" : ""}`;
  const args = bracket ? [season, BOT_PREFIX, bracket] : [season, BOT_PREFIX];
  const [seats, weapons, abilities] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) AS n FROM ranked_match_players p JOIN ranked_matches m ON m.id = p.match_id WHERE ${where}`,
      args,
    }),
    db.execute({
      sql: `SELECT json_extract(p.loadout, '$.weapon') AS pick_id, COUNT(*) AS picks, SUM(p.won) AS wins
            FROM ranked_match_players p JOIN ranked_matches m ON m.id = p.match_id
            WHERE ${where} GROUP BY pick_id ORDER BY picks DESC`,
      args,
    }),
    db.execute({
      sql: `SELECT a.value AS pick_id, COUNT(*) AS picks, SUM(p.won) AS wins
            FROM ranked_match_players p JOIN ranked_matches m ON m.id = p.match_id,
                 json_each(json_extract(p.loadout, '$.abilities')) a
            WHERE ${where} GROUP BY pick_id ORDER BY picks DESC`,
      args,
    }),
  ]);
  const n = num(seats.rows[0]?.["n"]);
  const rows = (rs: typeof weapons): PickRow[] =>
    rs.rows
      .filter((row) => row["pick_id"] !== null)
      .map((row) => {
        const picks = num(row["picks"]);
        const wins = num(row["wins"]);
        return { id: str(row["pick_id"]), picks, wins, pickRate: n === 0 ? 0 : picks / n, winRate: picks === 0 ? 0 : wins / picks };
      });
  return { seats: n, weapons: rows(weapons), abilities: rows(abilities) };
};

// ── economy ────────────────────────────────────────────────────────────────

export interface EconomyOverview {
  /** Glory: total credited, total debited (positive number), and the sum of
   * every wallet right now. */
  gloryMinted: number;
  gloryBurned: number;
  gloryHeld: number;
  signetsMinted: number;
  signetsBurned: number;
  signetsHeld: number;
  /** IAP pack purchases: all time, last 24h, last 7d. */
  iapTotal: number;
  iapDay: number;
  iapWeek: number;
  /** Store unlocks (entitlements with a purchase source). */
  unlocks: number;
}

export const economyOverview = async (db: Db, nowS: number): Promise<EconomyOverview> => {
  const r = await db.execute({
    sql: `SELECT
            (SELECT COALESCE(SUM(amount), 0) FROM glory_ledger WHERE amount > 0) AS g_in,
            (SELECT COALESCE(-SUM(amount), 0) FROM glory_ledger WHERE amount < 0) AS g_out,
            (SELECT COALESCE(SUM(amount), 0) FROM glory_ledger) AS g_held,
            (SELECT COALESCE(SUM(amount), 0) FROM signet_ledger WHERE amount > 0) AS s_in,
            (SELECT COALESCE(-SUM(amount), 0) FROM signet_ledger WHERE amount < 0) AS s_out,
            (SELECT COALESCE(SUM(amount), 0) FROM signet_ledger) AS s_held,
            (SELECT COUNT(*) FROM signet_ledger WHERE source LIKE 'iap:%') AS iap_total,
            (SELECT COUNT(*) FROM signet_ledger WHERE source LIKE 'iap:%' AND created_at >= ?) AS iap_day,
            (SELECT COUNT(*) FROM signet_ledger WHERE source LIKE 'iap:%' AND created_at >= ?) AS iap_week,
            (SELECT COUNT(*) FROM entitlements WHERE source LIKE 'purchase:%') AS unlocks`,
    args: [nowS - DAY_S, nowS - 7 * DAY_S],
  });
  const row = r.rows[0]!;
  return {
    gloryMinted: num(row["g_in"]),
    gloryBurned: num(row["g_out"]),
    gloryHeld: num(row["g_held"]),
    signetsMinted: num(row["s_in"]),
    signetsBurned: num(row["s_out"]),
    signetsHeld: num(row["s_held"]),
    iapTotal: num(row["iap_total"]),
    iapDay: num(row["iap_day"]),
    iapWeek: num(row["iap_week"]),
    unlocks: num(row["unlocks"]),
  };
};

export interface SourceFlow {
  /** The source namespace — everything before the first colon
   * (`match`, `achievement`, `iap`, `store`, `code`, …). */
  source: string;
  entries: number;
  /** Signed sum. */
  amount: number;
}

/** Ledger movement by source namespace over the last `days` days. */
export const ledgerBySource = async (db: Db, ledger: "glory" | "signet", days: number, nowS: number): Promise<SourceFlow[]> => {
  const table = ledger === "glory" ? "glory_ledger" : "signet_ledger";
  const r = await db.execute({
    sql: `SELECT CASE WHEN instr(source, ':') > 0 THEN substr(source, 1, instr(source, ':') - 1) ELSE source END AS ns,
            COUNT(*) AS n, SUM(amount) AS total
          FROM ${table} WHERE created_at >= ? GROUP BY ns ORDER BY ABS(total) DESC`,
    args: [sinceDays(days, nowS)],
  });
  return r.rows.map((row) => ({ source: str(row["ns"]), entries: num(row["n"]), amount: num(row["total"]) }));
};

export interface IapDay {
  day: string;
  /** `iap:<platform>:<sku>` → purchases that day. */
  bySource: Record<string, number>;
}

/** IAP purchases per day per source, zero-filled on days. */
export const iapByDay = async (db: Db, days: number, nowS: number): Promise<IapDay[]> => {
  const r = await db.execute({
    sql: `SELECT date(created_at, 'unixepoch') AS day, source, COUNT(*) AS n
          FROM signet_ledger WHERE source LIKE 'iap:%' AND created_at >= ? GROUP BY day, source`,
    args: [sinceDays(days, nowS)],
  });
  const byDay = new Map<string, IapDay>(dayKeys(days, nowS).map((day) => [day, { day, bySource: {} }]));
  for (const row of r.rows) {
    const d = byDay.get(str(row["day"]));
    if (d) d.bySource[str(row["source"])] = num(row["n"]);
  }
  return [...byDay.values()];
};

export interface ItemCount {
  itemId: string;
  /** Source namespace: `purchase`, `achievement`, `dev`, … */
  source: string;
  count: number;
}

/** Entitlement counts per item and source namespace, most-held first. */
export const entitlementCounts = async (db: Db): Promise<ItemCount[]> => {
  const r = await db.execute(
    `SELECT item_id, CASE WHEN instr(source, ':') > 0 THEN substr(source, 1, instr(source, ':') - 1) ELSE source END AS ns, COUNT(*) AS n
     FROM entitlements GROUP BY item_id, ns ORDER BY n DESC`,
  );
  return r.rows.map((row) => ({ itemId: str(row["item_id"]), source: str(row["ns"]), count: num(row["n"]) }));
};

// ── deeds ──────────────────────────────────────────────────────────────────

export interface DeedCount {
  achievementId: string;
  unlocks: number;
}

/** Unlock count per deed, most common first — with the player total, a
 * rarity table. Deeds nobody has earned are absent (the page fills them in
 * from the defs). */
export const deedCounts = async (db: Db): Promise<DeedCount[]> => {
  const r = await db.execute(
    `SELECT achievement_id, COUNT(*) AS n FROM achievement_unlocks GROUP BY achievement_id ORDER BY n DESC`,
  );
  return r.rows.map((row) => ({ achievementId: str(row["achievement_id"]), unlocks: num(row["n"]) }));
};

// ── feedback ───────────────────────────────────────────────────────────────

export interface FeedbackOverview {
  total: number;
  week: number;
  byKind: Record<string, number>;
}

export const feedbackOverview = async (db: Db, nowS: number): Promise<FeedbackOverview> => {
  const [totals, kinds] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS week FROM feedback`,
      args: [nowS - 7 * DAY_S],
    }),
    db.execute(`SELECT kind, COUNT(*) AS n FROM feedback GROUP BY kind`),
  ]);
  const byKind: Record<string, number> = {};
  for (const row of kinds.rows) byKind[str(row["kind"])] = num(row["n"]);
  return { total: num(totals.rows[0]?.["total"]), week: num(totals.rows[0]?.["week"]), byKind };
};
