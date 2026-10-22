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

// ── health (hq-v2.md § Stage 3) ────────────────────────────────────────────

export interface PulseDay {
  day: string;
  /** Distinct players seen that day (player_days — a true history from the
   * day the table landed). */
  active: number;
  fresh: number;
  matches: number;
  humanOnly: number;
  purchases: number;
  feedback: number;
}

/** One row per day, zero-filled, for the sparkline tiles. Matches read the
 * same two sources as matchesByDay (ranked history + the log). */
export const pulseByDay = async (db: Db, days: number, nowS: number): Promise<PulseDay[]> => {
  const since = sinceDays(days, nowS);
  const sinceDay = dayKey(since);
  const [active, fresh, logged, ranked, purchases, feedback] = await Promise.all([
    db.execute({ sql: `SELECT day, COUNT(*) AS n FROM player_days WHERE day >= ? GROUP BY day`, args: [sinceDay] }),
    db.execute({ sql: `SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS n FROM players WHERE created_at >= ? GROUP BY day`, args: [since] }),
    db.execute({
      sql: `SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS n, SUM(CASE WHEN bots = 0 THEN 1 ELSE 0 END) AS human
            FROM match_log WHERE created_at >= ? GROUP BY day`,
      args: [since],
    }),
    db.execute({
      sql: `SELECT date(r.created_at, 'unixepoch') AS day, COUNT(*) AS n,
                   SUM(CASE WHEN EXISTS (SELECT 1 FROM ranked_match_players p WHERE p.match_id = r.id AND p.subject_id LIKE ?) THEN 0 ELSE 1 END) AS human
            FROM ranked_matches r WHERE r.created_at >= ? AND NOT EXISTS (SELECT 1 FROM match_log m WHERE m.id = r.id) GROUP BY day`,
      args: [BOT_PREFIX, since],
    }),
    db.execute({ sql: `SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS n FROM signet_ledger WHERE source LIKE 'iap:%' AND created_at >= ? GROUP BY day`, args: [since] }),
    db.execute({ sql: `SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS n FROM feedback WHERE created_at >= ? GROUP BY day`, args: [since] }),
  ]);
  const byDay = new Map<string, PulseDay>(dayKeys(days, nowS).map((day) => [day, { day, active: 0, fresh: 0, matches: 0, humanOnly: 0, purchases: 0, feedback: 0 }]));
  const put = (rows: typeof active.rows, set: (d: PulseDay, row: (typeof active.rows)[number]) => void) => {
    for (const row of rows) {
      const d = byDay.get(str(row["day"]));
      if (d) set(d, row);
    }
  };
  put(active.rows, (d, row) => (d.active = num(row["n"])));
  put(fresh.rows, (d, row) => (d.fresh = num(row["n"])));
  put(logged.rows, (d, row) => {
    d.matches += num(row["n"]);
    d.humanOnly += num(row["human"]);
  });
  put(ranked.rows, (d, row) => {
    d.matches += num(row["n"]);
    d.humanOnly += num(row["human"]);
  });
  put(purchases.rows, (d, row) => (d.purchases = num(row["n"])));
  put(feedback.rows, (d, row) => (d.feedback = num(row["n"])));
  return [...byDay.values()];
};

/** The first day player_days has a row for — where the true-DAU history
 * starts; null while the table is empty. */
export const playerDaysSince = async (db: Db): Promise<string | null> => {
  const r = await db.execute(`SELECT MIN(day) AS d FROM player_days`);
  const d = r.rows[0]?.["d"];
  return d === null || d === undefined ? null : String(d);
};

export interface Cohort {
  /** Monday of the registration week (UTC day key). */
  week: string;
  size: number;
  /** Players who came back on the day after registering / on any of days
   * 2–7 / on any of days 8–30, and how many of the cohort are old enough
   * for each window to have fully elapsed. */
  d1: number;
  d1Eligible: number;
  d7: number;
  d7Eligible: number;
  d30: number;
  d30Eligible: number;
}

/**
 * Retention by registration week, newest first. Reads player_days, so a
 * cohort older than the table reads low on windows that predate it — the
 * page shows the table's start date beside the grid.
 */
export const retentionCohorts = async (db: Db, weeks: number, nowS: number): Promise<Cohort[]> => {
  const since = nowS - weeks * 7 * DAY_S;
  const r = await db.execute({
    sql: `SELECT p.id, p.created_at,
            EXISTS (SELECT 1 FROM player_days d WHERE d.player_id = p.id AND d.day = date(p.created_at + 86400, 'unixepoch')) AS d1,
            EXISTS (SELECT 1 FROM player_days d WHERE d.player_id = p.id
                      AND d.day BETWEEN date(p.created_at + 2 * 86400, 'unixepoch') AND date(p.created_at + 7 * 86400, 'unixepoch')) AS d7,
            EXISTS (SELECT 1 FROM player_days d WHERE d.player_id = p.id
                      AND d.day BETWEEN date(p.created_at + 8 * 86400, 'unixepoch') AND date(p.created_at + 30 * 86400, 'unixepoch')) AS d30
          FROM players p WHERE p.created_at >= ? AND p.id NOT LIKE ?`,
    args: [since, BOT_PREFIX],
  });
  const cohorts = new Map<string, Cohort>();
  for (const row of r.rows) {
    const created = num(row["created_at"]);
    const d = new Date(created * 1000);
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    const monday = dayKey(created - dow * DAY_S - (created % DAY_S));
    let c = cohorts.get(monday);
    if (!c) {
      c = { week: monday, size: 0, d1: 0, d1Eligible: 0, d7: 0, d7Eligible: 0, d30: 0, d30Eligible: 0 };
      cohorts.set(monday, c);
    }
    c.size += 1;
    const age = nowS - created;
    if (age >= 2 * DAY_S) {
      c.d1Eligible += 1;
      c.d1 += num(row["d1"]);
    }
    if (age >= 8 * DAY_S) {
      c.d7Eligible += 1;
      c.d7 += num(row["d7"]);
    }
    if (age >= 31 * DAY_S) {
      c.d30Eligible += 1;
      c.d30 += num(row["d30"]);
    }
  }
  return [...cohorts.values()].sort((a, b) => (a.week < b.week ? 1 : -1));
};

export interface Funnel {
  registered: number;
  /** Any online match on record (counters, the log, or the ranked history). */
  played: number;
  playedFive: number;
  ranked: number;
  linked: number;
  paid: number;
}

/** Where new players get to — lifetime, bots excluded. "Played" is the
 * larger of the counters and the match rows, so a settle that never
 * reached the deed pass still counts. */
export const funnel = async (db: Db): Promise<Funnel> => {
  const r = await db.execute({
    sql: `WITH played AS (
            SELECT p.id,
              MAX(
                COALESCE((SELECT SUM(value) FROM achievement_counters c WHERE c.player_id = p.id AND c.counter IN ('ranked_matches', 'skirmish:matches', 'skirmish:brawl_matches')), 0),
                (SELECT COUNT(*) FROM ranked_match_players rp WHERE rp.subject_id = p.id)
                + (SELECT COUNT(*) FROM match_players mp WHERE mp.player_id = p.id AND EXISTS (SELECT 1 FROM match_log m WHERE m.id = mp.match_id AND m.mode != 'ranked'))
              ) AS n
            FROM players p WHERE p.id NOT LIKE ?
          )
          SELECT
            (SELECT COUNT(*) FROM players WHERE id NOT LIKE ?) AS registered,
            (SELECT COUNT(*) FROM played WHERE n > 0) AS played,
            (SELECT COUNT(*) FROM played WHERE n >= 5) AS played_five,
            (SELECT COUNT(DISTINCT subject_id) FROM ranked_ratings WHERE subject_id NOT LIKE ?) AS ranked,
            (SELECT COUNT(*) FROM players WHERE clerk_user_id IS NOT NULL) AS linked,
            (SELECT COUNT(DISTINCT player_id) FROM signet_ledger WHERE source LIKE 'iap:%') AS paid`,
    args: [BOT_PREFIX, BOT_PREFIX, BOT_PREFIX],
  });
  const row = r.rows[0]!;
  return {
    registered: num(row["registered"]),
    played: num(row["played"]),
    playedFive: num(row["played_five"]),
    ranked: num(row["ranked"]),
    linked: num(row["linked"]),
    paid: num(row["paid"]),
  };
};

export interface QuietPaidPlayer {
  id: string;
  name: string | null;
  lastSeenAt: number | null;
  purchases: number;
}

/** Players who've paid and haven't opened the app for `days` days. */
export const quietPaidPlayers = async (db: Db, days: number, nowS: number): Promise<QuietPaidPlayer[]> => {
  const r = await db.execute({
    sql: `SELECT p.id, p.name, p.last_seen_at, COUNT(*) AS n
          FROM signet_ledger s JOIN players p ON p.id = s.player_id
          WHERE s.source LIKE 'iap:%' GROUP BY p.id
          HAVING p.last_seen_at IS NULL OR p.last_seen_at < ?
          ORDER BY p.last_seen_at DESC`,
    args: [nowS - days * DAY_S],
  });
  return r.rows.map((row) => ({ id: str(row["id"]), name: opt(row["name"]), lastSeenAt: optNum(row["last_seen_at"]), purchases: num(row["n"]) }));
};

export interface RttSummary {
  samples: number;
  p50: number | null;
  p90: number | null;
}

/** Server-measured seat round trips over the last `days` days, from both
 * seat tables (ranked rows that are also logged count once). */
export const rttSummary = async (db: Db, days: number, nowS: number): Promise<RttSummary> => {
  const since = nowS - days * DAY_S;
  const r = await db.execute({
    sql: `SELECT rtt FROM (
            SELECT p.rtt_ms AS rtt FROM match_players p JOIN match_log m ON m.id = p.match_id WHERE m.created_at >= ? AND p.rtt_ms IS NOT NULL
            UNION ALL
            SELECT p.rtt_ms FROM ranked_match_players p JOIN ranked_matches m ON m.id = p.match_id
            WHERE m.created_at >= ? AND p.rtt_ms IS NOT NULL AND p.subject_id NOT LIKE ?
              AND NOT EXISTS (SELECT 1 FROM match_players mp WHERE mp.match_id = p.match_id AND mp.player_id = p.subject_id)
          ) ORDER BY rtt`,
    args: [since, since, BOT_PREFIX],
  });
  const xs = r.rows.map((row) => num(row["rtt"]));
  const at = (q: number): number | null => (xs.length === 0 ? null : xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]!);
  return { samples: xs.length, p50: at(0.5), p90: at(0.9) };
};

const opt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const optNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ── economy, in detail (hq-v2.md, Tom 2026-10-22: "a time-ordered list of
// purchases") ──────────────────────────────────────────────────────────────

export interface PurchaseRow {
  /** The ledger row id (a stable key). */
  id: number;
  at: number;
  playerId: string;
  name: string | null;
  /** `iap:<platform>:<sku>` as written. */
  source: string;
  platform: string;
  sku: string;
  /** The store's transaction id, from the idempotency key. */
  transactionId: string;
  signets: number;
}

/** Every pack bought, newest first, paged by time (`before` = unix seconds). */
export const purchases = async (db: Db, opts: { before?: number | null; limit?: number } = {}): Promise<PurchaseRow[]> => {
  const limit = Math.min(500, Math.max(1, Math.trunc(opts.limit ?? 50)));
  const before = opts.before ?? null;
  const r = await db.execute({
    sql: `SELECT s.id, s.created_at, s.player_id, p.name, s.source, s.idempotency_key, s.amount
          FROM signet_ledger s LEFT JOIN players p ON p.id = s.player_id
          WHERE s.source LIKE 'iap:%' AND (? IS NULL OR s.created_at < ?)
          ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
    args: [before, before, limit],
  });
  return r.rows.map((row) => {
    const source = str(row["source"]);
    const [, platform = "", sku = ""] = source.split(":");
    const key = str(row["idempotency_key"]);
    return {
      id: num(row["id"]),
      at: num(row["created_at"]),
      playerId: str(row["player_id"]),
      name: opt(row["name"]),
      source,
      platform,
      sku,
      transactionId: key.split(":").slice(2).join(":"),
      signets: num(row["amount"]),
    };
  });
};

export interface LedgerDay {
  day: string;
  minted: number;
  /** Positive number. */
  burned: number;
}

/** Credits and debits per day for one ledger, zero-filled. */
export const ledgerByDay = async (db: Db, ledger: "glory" | "signet", days: number, nowS: number): Promise<LedgerDay[]> => {
  const table = ledger === "glory" ? "glory_ledger" : "signet_ledger";
  const r = await db.execute({
    sql: `SELECT date(created_at, 'unixepoch') AS day,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS minted,
            COALESCE(-SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS burned
          FROM ${table} WHERE created_at >= ? GROUP BY day`,
    args: [sinceDays(days, nowS)],
  });
  const byDay = new Map<string, LedgerDay>(dayKeys(days, nowS).map((day) => [day, { day, minted: 0, burned: 0 }]));
  for (const row of r.rows) {
    const d = byDay.get(str(row["day"]));
    if (d) {
      d.minted = num(row["minted"]);
      d.burned = num(row["burned"]);
    }
  }
  return [...byDay.values()];
};

export interface SpenderRow {
  playerId: string;
  name: string | null;
  purchases: number;
  /** sku → count. */
  bySku: Record<string, number>;
  firstAt: number;
  lastAt: number;
}

/** Players by packs bought, most first. */
export const topSpenders = async (db: Db, limit = 20): Promise<SpenderRow[]> => {
  const r = await db.execute({
    sql: `SELECT s.player_id, p.name, s.source, COUNT(*) AS n, MIN(s.created_at) AS first_at, MAX(s.created_at) AS last_at
          FROM signet_ledger s LEFT JOIN players p ON p.id = s.player_id
          WHERE s.source LIKE 'iap:%' GROUP BY s.player_id, s.source`,
    args: [],
  });
  const by = new Map<string, SpenderRow>();
  for (const row of r.rows) {
    const id = str(row["player_id"]);
    const sku = str(row["source"]).split(":")[2] ?? "";
    let s = by.get(id);
    if (!s) {
      s = { playerId: id, name: opt(row["name"]), purchases: 0, bySku: {}, firstAt: num(row["first_at"]), lastAt: num(row["last_at"]) };
      by.set(id, s);
    }
    s.purchases += num(row["n"]);
    s.bySku[sku] = (s.bySku[sku] ?? 0) + num(row["n"]);
    s.firstAt = Math.min(s.firstAt, num(row["first_at"]));
    s.lastAt = Math.max(s.lastAt, num(row["last_at"]));
  }
  return [...by.values()].sort((a, b) => b.purchases - a.purchases || b.lastAt - a.lastAt).slice(0, limit);
};

export interface BalanceBucket {
  /** Inclusive floor; the last bucket has no ceiling. */
  floor: number;
  ceil: number | null;
  players: number;
}

/** How many players hold how much — every non-bot player, a missing
 * ledger row counting as a zero balance. `edges` are ascending floors
 * after the implicit zero bucket, e.g. [1, 200, 500, 800]. */
export const balanceBuckets = async (db: Db, ledger: "glory" | "signet", edges: readonly number[]): Promise<BalanceBucket[]> => {
  const table = ledger === "glory" ? "glory_ledger" : "signet_ledger";
  const r = await db.execute({
    sql: `SELECT COALESCE((SELECT SUM(amount) FROM ${table} l WHERE l.player_id = p.id), 0) AS bal
          FROM players p WHERE p.id NOT LIKE ?`,
    args: [BOT_PREFIX],
  });
  const floors = [0, ...edges];
  const buckets: BalanceBucket[] = floors.map((f, i) => ({ floor: f, ceil: i + 1 < floors.length ? floors[i + 1]! - 1 : null, players: 0 }));
  for (const row of r.rows) {
    const bal = num(row["bal"]);
    let idx = 0;
    for (let i = 0; i < floors.length; i++) if (bal >= floors[i]!) idx = i;
    buckets[idx]!.players += 1;
  }
  return buckets;
};

export interface StoreUnlockRow {
  at: number;
  playerId: string;
  name: string | null;
  itemId: string;
}

/** Items bought with a Signet, newest first, paged by time. */
export const storeUnlocks = async (db: Db, opts: { before?: number | null; limit?: number } = {}): Promise<StoreUnlockRow[]> => {
  const limit = Math.min(500, Math.max(1, Math.trunc(opts.limit ?? 50)));
  const before = opts.before ?? null;
  const r = await db.execute({
    sql: `SELECT e.granted_at, e.player_id, p.name, e.item_id
          FROM entitlements e LEFT JOIN players p ON p.id = e.player_id
          WHERE e.source LIKE 'purchase:%' AND (? IS NULL OR e.granted_at < ?)
          ORDER BY e.granted_at DESC, e.rowid DESC LIMIT ?`,
    args: [before, before, limit],
  });
  return r.rows.map((row) => ({ at: num(row["granted_at"]), playerId: str(row["player_id"]), name: opt(row["name"]), itemId: str(row["item_id"]) }));
};

export interface EconomyPulse {
  /** Players who have ever bought a pack, and how many bought in the last 7 days. */
  payingPlayers: number;
  payingWeek: number;
  /** Players whose FIRST pack landed in the last 7 days. */
  firstTimeBuyersWeek: number;
  /** Players with two or more packs. */
  repeatBuyers: number;
  exchangesWeek: number;
  exchangesTotal: number;
  unlocksWeek: number;
}

export const economyPulse = async (db: Db, nowS: number): Promise<EconomyPulse> => {
  const week = nowS - 7 * DAY_S;
  const r = await db.execute({
    sql: `WITH buys AS (
            SELECT player_id, COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at
            FROM signet_ledger WHERE source LIKE 'iap:%' GROUP BY player_id
          )
          SELECT
            (SELECT COUNT(*) FROM buys) AS paying,
            (SELECT COUNT(*) FROM buys WHERE last_at >= ?) AS paying_week,
            (SELECT COUNT(*) FROM buys WHERE first_at >= ?) AS first_week,
            (SELECT COUNT(*) FROM buys WHERE n >= 2) AS repeat,
            (SELECT COUNT(*) FROM signet_ledger WHERE source = 'store:exchange' AND amount > 0 AND created_at >= ?) AS ex_week,
            (SELECT COUNT(*) FROM signet_ledger WHERE source = 'store:exchange' AND amount > 0) AS ex_total,
            (SELECT COUNT(*) FROM entitlements WHERE source LIKE 'purchase:%' AND granted_at >= ?) AS unlocks_week`,
    args: [week, week, week, week],
  });
  const row = r.rows[0]!;
  return {
    payingPlayers: num(row["paying"]),
    payingWeek: num(row["paying_week"]),
    firstTimeBuyersWeek: num(row["first_week"]),
    repeatBuyers: num(row["repeat"]),
    exchangesWeek: num(row["ex_week"]),
    exchangesTotal: num(row["ex_total"]),
    unlocksWeek: num(row["unlocks_week"]),
  };
};

// ── deeds, in detail ───────────────────────────────────────────────────────

export interface DeedStat {
  achievementId: string;
  unlocks: number;
  /** Unlocks in the last 7 days. */
  week: number;
  firstAt: number;
  lastAt: number;
}

/** Every deed anyone has earned: how many, how recently, when first. */
export const deedStats = async (db: Db, nowS: number): Promise<DeedStat[]> => {
  const r = await db.execute({
    sql: `SELECT achievement_id, COUNT(*) AS n, SUM(CASE WHEN unlocked_at >= ? THEN 1 ELSE 0 END) AS week,
                 MIN(unlocked_at) AS first_at, MAX(unlocked_at) AS last_at
          FROM achievement_unlocks GROUP BY achievement_id`,
    args: [nowS - 7 * DAY_S],
  });
  return r.rows.map((row) => ({
    achievementId: str(row["achievement_id"]),
    unlocks: num(row["n"]),
    week: num(row["week"]),
    firstAt: num(row["first_at"]),
    lastAt: num(row["last_at"]),
  }));
};

export interface DeedOverview {
  unlocks: number;
  unlocksWeek: number;
  /** Non-bot players, and how many hold at least one deed. */
  players: number;
  playersWithDeeds: number;
  /** Glory the ledger shows paid as deed bounties (source achievement:%). */
  bountiesPaid: number;
}

export const deedOverview = async (db: Db, nowS: number): Promise<DeedOverview> => {
  const r = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM achievement_unlocks) AS unlocks,
            (SELECT COUNT(*) FROM achievement_unlocks WHERE unlocked_at >= ?) AS week,
            (SELECT COUNT(*) FROM players WHERE id NOT LIKE ?) AS players,
            (SELECT COUNT(DISTINCT player_id) FROM achievement_unlocks) AS with_deeds,
            (SELECT COALESCE(SUM(amount), 0) FROM glory_ledger WHERE source LIKE 'achievement:%' AND amount > 0) AS paid`,
    args: [nowS - 7 * DAY_S, BOT_PREFIX],
  });
  const row = r.rows[0]!;
  return {
    unlocks: num(row["unlocks"]),
    unlocksWeek: num(row["week"]),
    players: num(row["players"]),
    playersWithDeeds: num(row["with_deeds"]),
    bountiesPaid: num(row["paid"]),
  };
};

/** Deed unlocks per day, zero-filled. */
export const unlocksByDay = async (db: Db, days: number, nowS: number): Promise<DayCount[]> => {
  const r = await db.execute({
    sql: `SELECT date(unlocked_at, 'unixepoch') AS day, COUNT(*) AS n FROM achievement_unlocks WHERE unlocked_at >= ? GROUP BY day`,
    args: [sinceDays(days, nowS)],
  });
  return fillDays(new Map(r.rows.map((row) => [str(row["day"]), num(row["n"])])), days, nowS);
};

export interface UnlockRow {
  at: number;
  playerId: string;
  name: string | null;
  achievementId: string;
}

/** Who earned what, newest first, paged by time. */
export const recentUnlocks = async (db: Db, opts: { before?: number | null; limit?: number } = {}): Promise<UnlockRow[]> => {
  const limit = Math.min(500, Math.max(1, Math.trunc(opts.limit ?? 50)));
  const before = opts.before ?? null;
  const r = await db.execute({
    sql: `SELECT u.unlocked_at, u.player_id, p.name, u.achievement_id
          FROM achievement_unlocks u LEFT JOIN players p ON p.id = u.player_id
          WHERE (? IS NULL OR u.unlocked_at < ?)
          ORDER BY u.unlocked_at DESC, u.rowid DESC LIMIT ?`,
    args: [before, before, limit],
  });
  return r.rows.map((row) => ({ at: num(row["unlocked_at"]), playerId: str(row["player_id"]), name: opt(row["name"]), achievementId: str(row["achievement_id"]) }));
};

export interface CounterTotal {
  counter: string;
  /** Sum over every player. */
  total: number;
  /** Players holding a non-zero value. */
  players: number;
}

/** Lifetime counters summed across players, for one prefix (the challenge
 * board reads `challenge:`). */
export const counterTotals = async (db: Db, prefix: string): Promise<CounterTotal[]> => {
  const r = await db.execute({
    sql: `SELECT counter, SUM(value) AS total, SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END) AS players
          FROM achievement_counters WHERE counter LIKE ? AND player_id NOT LIKE ? GROUP BY counter`,
    args: [`${prefix.replace(/[%_]/g, "\\$&")}%`, BOT_PREFIX],
  });
  return r.rows.map((row) => ({ counter: str(row["counter"]), total: num(row["total"]), players: num(row["players"]) }));
};
