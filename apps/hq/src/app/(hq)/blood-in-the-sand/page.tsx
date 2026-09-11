import {
  economyOverview,
  feedbackOverview,
  matchOverview,
  matchesByDay,
  newPlayersByDay,
  playerOverview,
} from "@heroic/blood-in-the-sand-persistence";
import { Bars } from "@/components/Bars";
import { Stat, Tiles } from "@/components/Stat";
import { db, nowS } from "@/lib/db";
import { liveStats } from "@/lib/live";
import { pct, secs } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const handle = await db();
  const now = nowS();
  const [players, matches, economy, feedback, byDay, fresh, live] = await Promise.all([
    playerOverview(handle, now),
    matchOverview(handle, now),
    economyOverview(handle, now),
    feedbackOverview(handle, now),
    matchesByDay(handle, 30, now),
    newPlayersByDay(handle, 30, now),
    liveStats(),
  ]);
  return (
    <>
      <h1>Blood in the Sand</h1>
      <p className="sub">How the arena is doing right now and over the last month.</p>

      <h2>Live</h2>
      {live.state === "ok" ? (
        <Tiles>
          <Stat label="Connected" value={live.stats.connections} detail="open sockets" />
          <Stat label="In rooms" value={live.stats.seatedHumans} detail="humans seated" />
          <Stat label="Rooms" value={live.stats.rooms} detail={`${live.stats.roomsInMatch} mid-match · ${live.stats.rankedRooms} ranked`} />
          {Object.entries(live.stats.queue).map(([bracket, size]) => (
            <Stat key={bracket} label={`Queue ${bracket}`} value={size} detail="waiting" />
          ))}
          <Stat label="Pending" value={live.stats.pendingMatches} detail="matches awaiting accept" />
        </Tiles>
      ) : live.state === "offline" ? (
        <p className="hint">
          Game server unreachable: {live.reason}. (BITS_SERVER_URL is set, so this is worth a look.)
        </p>
      ) : (
        <p className="hint">Set BITS_SERVER_URL and BITS_STATS_TOKEN (matching the server's STATS_TOKEN) to see who's online.</p>
      )}

      <h2>Today</h2>
      <Tiles>
        <Stat label="Active players" value={players.activeDay} detail={`${players.activeWeek} this week · ${players.activeMonth} this month`} />
        <Stat label="New players" value={players.newDay} detail={`${players.newWeek} this week`} />
        <Stat label="Ranked matches" value={matches.rankedDay} detail={`${matches.rankedWeek} this week`} />
        <Stat label="Skirmish + brawl" value={matches.casualDay} detail={`${matches.casualWeek} this week`} />
        <Stat label="Packs sold" value={economy.iapDay} detail={`${economy.iapWeek} this week · ${economy.iapTotal} ever`} />
        <Stat label="Feedback" value={feedback.week} detail="reports this week" />
        <Stat label="Match length" value={secs(matches.avgDurationS)} detail="7-day mean, logged matches" />
        <Stat label="With bots" value={pct(matches.botShareWeek)} detail="of logged matches, 7 days" />
      </Tiles>

      <h2>Matches a day · 30 days</h2>
      <Bars
        rows={byDay.map((d) => ({ label: d.day.slice(5), values: { ranked: d.ranked, skirmish: d.skirmish, brawl: d.brawl } }))}
        series={[
          { key: "ranked", label: "Ranked", color: "var(--accent)" },
          { key: "skirmish", label: "Skirmish", color: "var(--blue)" },
          { key: "brawl", label: "Brawl", color: "var(--red)" },
        ]}
      />
      <p className="hint">Ranked comes from the ranked history (complete). Skirmish and brawl come from the match log, which starts the day the server first ran with it.</p>

      <h2>New players a day · 30 days</h2>
      <Bars rows={fresh.map((d) => ({ label: d.day.slice(5), values: { n: d.count } }))} series={[{ key: "n", label: "New", color: "var(--green)" }]} />
    </>
  );
}
