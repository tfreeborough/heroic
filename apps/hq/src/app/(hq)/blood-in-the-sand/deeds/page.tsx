import Link from "next/link";
import { counterTotals, deedOverview, deedStats, recentUnlocks, unlocksByDay } from "@heroic/blood-in-the-sand-persistence";
import { Bars } from "@/components/Bars";
import { PlayerLink } from "@/components/PlayerLink";
import { Stat, Tiles } from "@/components/Stat";
import { challenges, chapters, deedTitle, deeds } from "@/lib/bits";
import { db, nowS } from "@/lib/db";
import { ago, date, n, pct, when } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE = 40;

export default async function Deeds({ searchParams }: { searchParams: Promise<{ before?: string; sort?: string }> }) {
  const sp = await searchParams;
  const before = Number(sp.before);
  const byRarity = sp.sort === "rarity";
  const handle = await db();
  const now = nowS();
  const [o, stats, byDay, recent, totals] = await Promise.all([
    deedOverview(handle, now),
    deedStats(handle, now),
    unlocksByDay(handle, 30, now),
    recentUnlocks(handle, { before: Number.isFinite(before) ? before : null, limit: PAGE }),
    counterTotals(handle, "challenge:"),
  ]);
  const defs = deeds();
  const byId = new Map(defs.map((d) => [d.id, d]));
  const statOf = new Map(stats.map((s) => [s.achievementId, s]));
  const players = Math.max(1, o.players);
  const budget = defs.reduce((s, d) => s + d.bounty, 0);
  const earnedIds = new Set(stats.map((s) => s.achievementId));
  const never = defs.filter((d) => !earnedIds.has(d.id));
  const orphans = stats.filter((s) => !byId.has(s.achievementId));
  const rarest = stats
    .filter((s) => byId.has(s.achievementId))
    .sort((a, b) => a.unlocks - b.unlocks || b.lastAt - a.lastAt)
    .slice(0, 5);
  const commonest = [...stats].sort((a, b) => b.unlocks - a.unlocks).slice(0, 5);
  const weekTop = stats.filter((s) => s.week > 0).sort((a, b) => b.week - a.week).slice(0, 5);
  const lastRecent = recent[recent.length - 1];
  const chapterList = chapters();
  const totalOf = new Map(totals.map((t) => [t.counter, t]));
  const chall = challenges();

  const rows = (ids: string[]) => {
    const list = ids.flatMap((id) => {
      const d = byId.get(id);
      return d ? [{ ...d, stat: statOf.get(id) ?? null }] : [];
    });
    return byRarity ? list.sort((a, b) => (a.stat?.unlocks ?? 0) - (b.stat?.unlocks ?? 0)) : list;
  };

  return (
    <>
      <h1>Deeds</h1>
      <p className="sub">What's being earned, how rare each deed is, and where nobody has got to yet.</p>

      <Tiles>
        <Stat label="Deeds" value={defs.length} detail={`${defs.filter((d) => d.secret).length} secret · ${chapterList.length} chapters`} />
        <Stat label="Unlocks" value={o.unlocks} detail={`${o.unlocksWeek} this week`} />
        <Stat label="Players with a deed" value={o.playersWithDeeds} detail={`${pct(o.playersWithDeeds / players)} of ${n(o.players)}`} />
        <Stat label="Per player" value={(o.playersWithDeeds ? o.unlocks / o.playersWithDeeds : 0).toFixed(1)} detail="mean deeds, players with any" />
        <Stat label="Bounties paid" value={o.bountiesPaid} detail={`Glory, from the ledger · ${n(budget)} is the full board`} />
        <Stat label="Earned by someone" value={defs.length - never.length} detail={`${never.length} never earned`} />
      </Tiles>

      <h2>Unlocks a day · 30 days</h2>
      <Bars rows={byDay.map((d) => ({ label: d.day.slice(5), title: d.day, values: { n: d.count } }))} series={[{ key: "n", label: "Unlocks", color: "var(--blue)" }]} height={100} />

      <div className="cards" style={{ marginTop: 28 }}>
        <div className="card">
          <h3>Hot this week</h3>
          {weekTop.length === 0 ? <p className="hint">No unlocks in seven days.</p> : null}
          {weekTop.map((s) => (
            <div key={s.achievementId} className="stamps" style={{ marginBottom: 4 }}>
              <b style={{ color: "var(--text)" }}>{deedTitle(s.achievementId)}</b>
              <span className="num">{n(s.week)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Rarest earned</h3>
          {rarest.map((s) => (
            <div key={s.achievementId} className="stamps" style={{ marginBottom: 4 }}>
              <b style={{ color: "var(--text)" }}>{deedTitle(s.achievementId)}</b>
              <span className="num">
                {n(s.unlocks)} · {pct(s.unlocks / players, 1)}
              </span>
              <span title={when(s.lastAt)}>last {ago(s.lastAt, now)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Commonest</h3>
          {commonest.map((s) => (
            <div key={s.achievementId} className="stamps" style={{ marginBottom: 4 }}>
              <b style={{ color: "var(--text)" }}>{deedTitle(s.achievementId)}</b>
              <span className="num">
                {n(s.unlocks)} · {pct(s.unlocks / players, 1)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {orphans.length > 0 ? (
        <>
          <h2>Not in this build</h2>
          <div className="attention">
            {orphans.map((s) => (
              <div className="item bad" key={s.achievementId}>
                <span className="what">orphan</span>
                <span>
                  <span className="mono">{s.achievementId}</span> has {n(s.unlocks)} unlock{s.unlocks === 1 ? "" : "s"} but no definition here — a renamed id or a stale HQ build.
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h2>Recent unlocks</h2>
      <div className="feed">
        {recent.map((u, i) => (
          <div className="row" key={`${u.playerId}:${u.achievementId}:${i}`}>
            <span className="when" title={when(u.at)}>
              {ago(u.at, now)}
            </span>
            <span className="kind deed">{byId.get(u.achievementId)?.board ?? "deed"}</span>
            <span>
              <PlayerLink id={u.playerId} name={u.name} /> earned <b>{deedTitle(u.achievementId)}</b>
              {(byId.get(u.achievementId)?.bounty ?? 0) > 0 ? <span className="muted"> · +{byId.get(u.achievementId)!.bounty} Glory</span> : null}
              {byId.get(u.achievementId)?.secret ? <span className="pill" style={{ marginLeft: 6 }}>secret</span> : null}
            </span>
          </div>
        ))}
        {recent.length === 0 ? <p className="hint">Nothing earned yet.</p> : null}
      </div>
      {recent.length === PAGE && lastRecent ? (
        <p style={{ marginTop: 10 }}>
          <Link href={`?before=${lastRecent.at}${byRarity ? "&sort=rarity" : ""}`} className="pill">
            Older →
          </Link>
        </p>
      ) : null}

      <h2>Challenges</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Challenge</th>
              <th>Tier</th>
              <th className="r">Tried by</th>
              <th className="r">Cleared by</th>
              <th className="r">Clear rate</th>
              <th className="r">Attempts</th>
              <th className="r">Clears</th>
              <th className="r">Attempts per clear</th>
            </tr>
          </thead>
          <tbody>
            {chall.map((c) => {
              const att = totalOf.get(c.attemptsCounter);
              const clr = totalOf.get(c.clearsCounter);
              const tried = att?.players ?? 0;
              const clearedBy = clr?.players ?? 0;
              return (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b> <span className="muted">{c.premise}</span>
                  </td>
                  <td className="muted">{c.tier}</td>
                  <td className="r num">{n(tried)}</td>
                  <td className="r num">{n(clearedBy)}</td>
                  <td className="r num">{tried > 0 ? pct(clearedBy / tried) : <span className="muted">–</span>}</td>
                  <td className="r num">{n(att?.total ?? 0)}</td>
                  <td className="r num">{n(clr?.total ?? 0)}</td>
                  <td className="r num">{(clr?.total ?? 0) > 0 ? ((att?.total ?? 0) / (clr?.total ?? 1)).toFixed(1) : <span className="muted">–</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">From the challenge counters every device reports. "Tried by" counts players with at least one attempt; attempts include the clearing run.</p>

      <h2>
        The board, by chapter{" "}
        <Link href={byRarity ? "?" : "?sort=rarity"} className="pill" style={{ marginLeft: 8, verticalAlign: "middle" }}>
          {byRarity ? "show in chapter order" : "sort each chapter by rarity"}
        </Link>
      </h2>
      {chapterList.map((ch) => {
        const list = rows(ch.ids);
        const earned = list.filter((d) => d.stat).length;
        const unlocks = list.reduce((s, d) => s + (d.stat?.unlocks ?? 0), 0);
        return (
          <div className="card" key={ch.id} style={{ marginTop: 12 }}>
            <h3>
              {ch.title} <span className="muted">· {earned} of {list.length} deeds earned by anyone · {n(unlocks)} unlocks</span>
            </h3>
            <table>
              <thead>
                <tr>
                  <th>Deed</th>
                  <th className="r">Bounty</th>
                  <th className="r">Unlocked by</th>
                  <th style={{ width: "22%" }}>Share</th>
                  <th>First</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} style={d.stat ? undefined : { opacity: 0.6 }}>
                    <td>
                      <b>{d.title}</b> {d.secret ? <span className="pill">secret</span> : null}
                      <div className="muted">{d.description}</div>
                    </td>
                    <td className="r num">{d.bounty > 0 ? n(d.bounty) : ""}</td>
                    <td className="r num">{d.stat ? n(d.stat.unlocks) : <span className="muted">nobody</span>}</td>
                    <td>
                      <div className="stamps" style={{ gap: 6 }}>
                        <span className="num">{pct((d.stat?.unlocks ?? 0) / players, 1)}</span>
                      </div>
                      <div className="progress">
                        <i style={{ width: `${Math.min(100, ((d.stat?.unlocks ?? 0) / players) * 100)}%` }} />
                      </div>
                    </td>
                    <td className="muted" title={d.stat ? when(d.stat.firstAt) : undefined}>
                      {d.stat ? date(d.stat.firstAt) : ""}
                    </td>
                    <td className="muted" title={d.stat ? when(d.stat.lastAt) : undefined}>
                      {d.stat ? ago(d.stat.lastAt, now) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="hint">Share is unlocks over all {n(o.players)} players. A chapter nobody finishes is a chapter to look at — too hard, or not worth it.</p>
    </>
  );
}
