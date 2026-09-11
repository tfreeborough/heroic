import Link from "next/link";
import { economyOverview, matchOverview, playerOverview, feedbackOverview } from "@heroic/blood-in-the-sand-persistence";
import { LiveStats } from "@/components/LiveStats";
import { db, nowS } from "@/lib/db";
import { liveStats } from "@/lib/live";
import { n } from "@/lib/format";

export const dynamic = "force-dynamic";

/** The studio overview: one card per game. */
export default async function Overview() {
  const handle = await db();
  const now = nowS();
  const [players, matches, economy, feedback, live] = await Promise.all([
    playerOverview(handle, now),
    matchOverview(handle, now),
    economyOverview(handle, now),
    feedbackOverview(handle, now),
    liveStats(),
  ]);
  return (
    <>
      <h1>Overview</h1>
      <p className="sub">Every game, at a glance.</p>
      <div className="cards">
        <div className="card">
          <h3>
            <Link href="/blood-in-the-sand">Blood in the Sand</Link>{" "}
            <LiveStats initial={live} variant="pill" />
          </h3>
          <div className="row">
            <span>
              players <b className="num">{n(players.total)}</b>
            </span>
            <span>
              active today <b className="num">{n(players.activeDay)}</b>
            </span>
            <span>
              matches today <b className="num">{n(matches.rankedDay + matches.casualDay)}</b>
            </span>
            <span>
              packs this week <b className="num">{n(economy.iapWeek)}</b>
            </span>
            <span>
              feedback this week <b className="num">{n(feedback.week)}</b>
            </span>
          </div>
        </div>
        <div className="card muted">
          <h3>Next game</h3>
          <div className="row">A new game gets its own section in the sidebar and a card here.</div>
        </div>
      </div>
    </>
  );
}
