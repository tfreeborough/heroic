import Link from "next/link";
import {
  deedCounts,
  funnel,
  iapByDay,
  matchOverview,
  matchesByDay,
  newPlayersByDay,
  playerDaysSince,
  pulseByDay,
  quietPaidPlayers,
  retentionCohorts,
  rttSummary,
} from "@heroic/blood-in-the-sand-persistence";
import { Bars } from "@/components/Bars";
import { LiveStats } from "@/components/LiveStats";
import { PlayerLink } from "@/components/PlayerLink";
import { Pulse } from "@/components/Pulse";
import { Stat, Tiles } from "@/components/Stat";
import { deeds, iapUsd } from "@/lib/bits";
import { db, nowS } from "@/lib/db";
import { liveStats } from "@/lib/live";
import { ago, ms, n, pct, secs } from "@/lib/format";

export const dynamic = "force-dynamic";

const DAYS = 28;
const PING_TAIL_MS = 150;

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => (xs.length === 0 ? 0 : sum(xs) / xs.length);

export default async function Health() {
  const handle = await db();
  const now = nowS();
  const [pulse, iap, since, cohorts, steps, quiet, rtt, matches, counts, byDay, fresh, live] = await Promise.all([
    pulseByDay(handle, DAYS, now),
    iapByDay(handle, DAYS, now),
    playerDaysSince(handle),
    retentionCohorts(handle, 8, now),
    funnel(handle),
    quietPaidPlayers(handle, 7, now),
    rttSummary(handle, 7, now),
    matchOverview(handle, now),
    deedCounts(handle),
    matchesByDay(handle, 30, now),
    newPlayersByDay(handle, 30, now),
    liveStats(),
  ]);

  // This week vs last: the last 7 days against the 7 before them.
  const last7 = pulse.slice(-7);
  const prev7 = pulse.slice(-14, -7);
  const revenueSeries = iap.map((d) => Object.entries(d.bySource).reduce((s, [src, c]) => s + c * iapUsd(src), 0));
  const rev7 = sum(revenueSeries.slice(-7));
  const revPrev7 = sum(revenueSeries.slice(-14, -7));
  const dauKnown = since !== null;
  const orphans = (() => {
    const known = new Set(deeds().map((d) => d.id));
    return counts.filter((c) => !known.has(c.achievementId));
  })();
  const feedback24 = sum(pulse.slice(-1).map((d) => d.feedback));

  const attention: { cls: string; what: string; text: React.ReactNode; href?: string }[] = [];
  if (live.state === "offline") attention.push({ cls: "bad", what: "server", text: `The game server is unreachable: ${live.reason}.` });
  if (feedback24 > 0) attention.push({ cls: "", what: "feedback", text: `${feedback24} new report${feedback24 === 1 ? "" : "s"} today.`, href: "/blood-in-the-sand/feedback" });
  for (const q of quiet.slice(0, 5)) {
    attention.push({
      cls: "",
      what: "gone quiet",
      text: (
        <>
          <PlayerLink id={q.id} name={q.name} /> paid for {q.purchases} pack{q.purchases === 1 ? "" : "s"} and was last seen {q.lastSeenAt ? ago(q.lastSeenAt, now) : "never (since the stamp)"}.
        </>
      ),
    });
  }
  if (quiet.length > 5) attention.push({ cls: "", what: "gone quiet", text: `…and ${quiet.length - 5} more paying players not seen this week.`, href: "/blood-in-the-sand/players?filter=paid" });
  if (rtt.p90 !== null && rtt.p90 > PING_TAIL_MS) attention.push({ cls: "bad", what: "ping", text: `p90 round trip this week is ${rtt.p90} ms over ${rtt.samples} seats — a fat tail. A second region is worth pricing.`, href: "/blood-in-the-sand/ranked" });
  if (orphans.length > 0) attention.push({ cls: "bad", what: "deeds", text: `${orphans.length} unlocked deed id${orphans.length === 1 ? " isn't" : "s aren't"} in this build's definitions.`, href: "/blood-in-the-sand/deeds" });
  if (sum(last7.map((d) => d.matches)) === 0) attention.push({ cls: "bad", what: "matches", text: "No online matches in seven days." });

  const step = (label: string, value: number, of: number, hint: string) => (
    <div className="step">
      <div className="k">{label}</div>
      <div className="v num">{n(value)}</div>
      <div className="d">
        {of > 0 ? pct(value / of) : "–"} {hint}
      </div>
      <div className="bar">
        <i style={{ width: `${steps.registered > 0 ? (value / steps.registered) * 100 : 0}%` }} />
      </div>
    </div>
  );
  const cell = (hit: number, eligible: number) =>
    eligible === 0 ? (
      <span className="muted">–</span>
    ) : (
      <>
        <b>{pct(hit / eligible)}</b>
        <span>
          {hit}/{eligible}
        </span>
      </>
    );

  return (
    <>
      <h1>Blood in the Sand</h1>
      <p className="sub">Whether the arena is getting better, and what wants a look today.</p>

      <h2>Live</h2>
      <LiveStats initial={live} variant="tiles" />

      <h2>This week against last · {DAYS}-day lines</h2>
      <Tiles>
        <Pulse
          label={dauKnown ? "Players a day" : "Players a day (no history yet)"}
          value={Math.round(mean(last7.map((d) => d.active)))}
          previous={dauKnown ? Math.round(mean(prev7.map((d) => d.active))) : null}
          series={pulse.map((d) => d.active)} labels={pulse.map((d) => d.day)}
          detail={dauKnown ? `7-day mean · tracked since ${since}` : "tracked from the first app open after this deploy"}
          color="var(--blue)"
        />
        <Pulse label="New players" value={sum(last7.map((d) => d.fresh))} previous={sum(prev7.map((d) => d.fresh))} series={pulse.map((d) => d.fresh)} labels={pulse.map((d) => d.day)} detail="last 7 days" color="var(--green)" />
        <Pulse label="Matches" value={sum(last7.map((d) => d.matches))} previous={sum(prev7.map((d) => d.matches))} series={pulse.map((d) => d.matches)} labels={pulse.map((d) => d.day)} detail="online, every mode" />
        <Pulse label="Human-only matches" value={sum(last7.map((d) => d.humanOnly))} previous={sum(prev7.map((d) => d.humanOnly))} series={pulse.map((d) => d.humanOnly)} labels={pulse.map((d) => d.day)} detail="no bot in the room" />
        <Pulse label="Packs" value={sum(last7.map((d) => d.purchases))} previous={sum(prev7.map((d) => d.purchases))} series={pulse.map((d) => d.purchases)} labels={pulse.map((d) => d.day)} detail="IAP purchases" color="var(--green)" />
        <Pulse label="Revenue" value={rev7} previous={revPrev7} series={revenueSeries} labels={iap.map((d) => d.day)} detail="US list price, before the store's cut" color="var(--green)" format={(v) => `$${v.toFixed(2)}`} />
        <Pulse label="Feedback" value={sum(last7.map((d) => d.feedback))} previous={sum(prev7.map((d) => d.feedback))} series={pulse.map((d) => d.feedback)} labels={pulse.map((d) => d.day)} detail="reports" />
      </Tiles>

      <h2>Attention</h2>
      {attention.length === 0 ? (
        <div className="attention">
          <div className="item ok">
            <span className="what">all quiet</span>
            <span>Nothing is asking for a look.</span>
          </div>
        </div>
      ) : (
        <div className="attention">
          {attention.map((a, i) => (
            <div className={`item ${a.cls}`} key={i}>
              <span className="what">{a.what}</span>
              <span>{a.text}</span>
              {a.href ? (
                <Link href={a.href} className="pill">
                  look →
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <h2>Where new players get to</h2>
      <div className="funnel">
        {step("Registered", steps.registered, 0, "")}
        {step("Played a match", steps.played, steps.registered, "of registered")}
        {step("Played 5", steps.playedFive, steps.played, "of those who played")}
        {step("Tried ranked", steps.ranked, steps.played, "of those who played")}
        {step("Linked an account", steps.linked, steps.registered, "of registered")}
        {step("Paid", steps.paid, steps.registered, "of registered")}
      </div>
      <p className="hint">Lifetime, bots excluded. "Played" counts ranked and human-vs-human skirmish from the counters, plus solo-vs-bots matches from the log.</p>

      <h2>Retention by registration week</h2>
      <div className="tablewrap">
        <table className="cohorts">
          <thead>
            <tr>
              <th>Week of</th>
              <th className="r">Joined</th>
              <th className="r">Back the next day</th>
              <th className="r">Back in days 2–7</th>
              <th className="r">Back in days 8–30</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.week}>
                <td>{c.week}</td>
                <td className="r num">{n(c.size)}</td>
                <td className="cell num">{cell(c.d1, c.d1Eligible)}</td>
                <td className="cell num">{cell(c.d7, c.d7Eligible)}</td>
                <td className="cell num">{cell(c.d30, c.d30Eligible)}</td>
              </tr>
            ))}
            {cohorts.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No registrations in eight weeks.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Each cell counts only players old enough for that window to have passed (shown as hit/eligible).{" "}
        {since ? `Days seen are recorded from ${since}; windows before that read low.` : "Nothing is recorded yet — the first app opens after this deploy start the history."}
      </p>

      <h2>Match quality · 7 days</h2>
      <Tiles>
        <Stat label="Ranked" value={matches.rankedWeek} detail={`${matches.rankedDay} today`} />
        <Stat label="Skirmish + brawl" value={matches.casualWeek} detail={`${matches.casualDay} today`} />
        <Stat label="With bots" value={pct(matches.botShareWeek)} detail="of logged matches" />
        <Stat label="Match length" value={secs(matches.avgDurationS)} detail="mean, logged matches" />
        <Stat label="Ping p50" value={ms(rtt.p50)} detail={`${n(rtt.samples)} seats`} />
        <Stat label="Ping p90" value={ms(rtt.p90)} detail={rtt.p90 !== null && rtt.p90 > PING_TAIL_MS ? "fat tail" : "fine"} />
      </Tiles>
      <p className="hint">Queue waits, voids and mid-match drops aren't recorded yet (hq-v2.md § Stage 4, parked).</p>

      <h2>Matches a day · 30 days</h2>
      <Bars
        rows={byDay.map((d) => ({ label: d.day.slice(5), title: d.day, values: { ranked: d.ranked, skirmish: d.skirmish, brawl: d.brawl } }))}
        series={[
          { key: "ranked", label: "Ranked", color: "var(--accent)" },
          { key: "skirmish", label: "Skirmish", color: "var(--blue)" },
          { key: "brawl", label: "Brawl", color: "var(--red)" },
        ]}
      />
      <p className="hint">Ranked comes from the ranked history (complete). Skirmish and brawl come from the match log, which starts the day the server first ran with it.</p>

      <h2>New players a day · 30 days</h2>
      <Bars rows={fresh.map((d) => ({ label: d.day.slice(5), title: d.day, values: { n: d.count } }))} series={[{ key: "n", label: "New", color: "var(--green)" }]} />
    </>
  );
}
