import Link from "next/link";
import {
  PLAYER_FILTERS,
  PLAYER_SORTS,
  activePlayersByDay,
  newPlayersByDay,
  playerDaysSince,
  playerOverview,
  playersTable,
  pulseByDay,
  type PlayerFilter,
  type PlayerSort,
} from "@heroic/blood-in-the-sand-persistence";
import { Bars } from "@/components/Bars";
import { PlayerLink } from "@/components/PlayerLink";
import { Stat, Tiles } from "@/components/Stat";
import { iapUsd } from "@/lib/bits";
import { db, nowS } from "@/lib/db";
import { ago, date, n, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

const FILTER_LABEL: Record<PlayerFilter, string> = {
  all: "everyone",
  active: "active this week",
  new: "new this week",
  paid: "paid",
  linked: "linked",
  ranked: "ranked",
};

const SORT_LABEL: Record<PlayerSort, string> = {
  seen: "Last seen",
  joined: "Joined",
  matches: "Matches",
  rating: "Rating",
  glory: "Glory",
  signets: "Signets",
  spent: "Packs",
  deeds: "Deeds",
};

export default async function Players({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; filter?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const sort = (PLAYER_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as PlayerSort) : "seen";
  const filter = (PLAYER_FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as PlayerFilter) : "all";
  const handle = await db();
  const now = nowS();
  const [o, fresh, floor, pulse, since, rows] = await Promise.all([
    playerOverview(handle, now),
    newPlayersByDay(handle, 60, now),
    activePlayersByDay(handle, 60, now),
    pulseByDay(handle, 60, now),
    playerDaysSince(handle),
    playersTable(handle, { q, sort, filter, limit: 200 }, now),
  ]);
  const href = (next: Partial<{ q: string; sort: PlayerSort; filter: PlayerFilter }>) => {
    const p = new URLSearchParams();
    const qq = next.q ?? q;
    const ss = next.sort ?? sort;
    const ff = next.filter ?? filter;
    if (qq) p.set("q", qq);
    if (ss !== "seen") p.set("sort", ss);
    if (ff !== "all") p.set("filter", ff);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };
  void iapUsd;
  return (
    <>
      <h1>Players</h1>
      <p className="sub">Anonymous identities, the linked share, and who's been around. Click any player for everything about them.</p>
      <Tiles>
        <Stat label="Players" value={o.total} detail="identities ever registered" />
        <Stat label="Linked" value={o.linked} detail={`${pct(o.total ? o.linked / o.total : 0)} have an account`} />
        <Stat label="Devices" value={o.devices} detail="live device tokens" />
        <Stat label="Active · day" value={o.activeDay} />
        <Stat label="Active · week" value={o.activeWeek} />
        <Stat label="Active · month" value={o.activeMonth} />
        <Stat label="New · day" value={o.newDay} />
        <Stat label="New · week" value={o.newWeek} />
      </Tiles>

      <h2>Everyone</h2>
      <form className="search" method="get">
        <input type="search" name="q" defaultValue={q} placeholder="id prefix, name, or feedback email" />
        {sort !== "seen" ? <input type="hidden" name="sort" value={sort} /> : null}
        {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
        <button type="submit" className="ghost">
          Find
        </button>
        <span className="pills">
          {PLAYER_FILTERS.map((f) => (
            <Link key={f} href={href({ filter: f })} className={f === filter ? "active" : undefined}>
              {FILTER_LABEL[f]}
            </Link>
          ))}
        </span>
      </form>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              {PLAYER_SORTS.map((s) => (
                <th key={s} className="r">
                  <Link href={href({ sort: s })} className={s === sort ? "active" : undefined}>
                    {SORT_LABEL[s]}
                  </Link>
                </th>
              ))}
              <th>Linked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <PlayerLink id={r.id} name={r.name} /> {r.name ? <span className="muted mono">{r.id.slice(0, 8)}</span> : null}
                </td>
                <td className="r num">{r.lastSeenAt ? ago(r.lastSeenAt, now) : <span className="muted">–</span>}</td>
                <td className="r num">{date(r.createdAt)}</td>
                <td className="r num">{n(r.matches)}</td>
                <td className="r num">{r.rating ?? <span className="muted">–</span>}</td>
                <td className="r num">{n(r.glory)}</td>
                <td className="r num">{n(r.signets)}</td>
                <td className="r num">{r.purchases > 0 ? n(r.purchases) : <span className="muted">–</span>}</td>
                <td className="r num">{n(r.deeds)}</td>
                <td>{r.linked ? <span className="pill ok">linked</span> : null}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="muted">
                  Nobody matches.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {rows.length === 200 ? "Showing the first 200 — narrow it down with a search or a filter. " : ""}
        Matches counts every online match on record (the log plus older ranked history). Rating is the best bracket.{" "}
        <Link href="/blood-in-the-sand/players/tidy">Tidy up old test accounts</Link>
      </p>

      <h2>New players a day · 60 days</h2>
      <Bars rows={fresh.map((d) => ({ label: d.day.slice(5), title: d.day, values: { n: d.count } }))} series={[{ key: "n", label: "New", color: "var(--green)" }]} />

      <h2>Players seen a day · 60 days</h2>
      <Bars rows={pulse.map((d) => ({ label: d.day.slice(5), title: d.day, values: { n: d.active } }))} series={[{ key: "n", label: "Seen", color: "var(--blue)" }]} />
      <p className="hint">
        {since ? `A true count of distinct players who opened the app each day, recorded from ${since}.` : "Recorded from the day the daily-seen table landed — nothing yet."} Before that, the
        last-seen floor below is all there is.
      </p>
      <h2>Last seen, by day · 60 days (the old floor)</h2>
      <Bars rows={floor.map((d) => ({ label: d.day.slice(5), title: d.day, values: { n: d.count } }))} series={[{ key: "n", label: "Players", color: "var(--muted)" }]} height={80} />
    </>
  );
}
