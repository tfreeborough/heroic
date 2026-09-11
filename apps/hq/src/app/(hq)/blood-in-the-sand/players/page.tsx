import { activePlayersByDay, newPlayersByDay, playerOverview } from "@heroic/blood-in-the-sand-persistence";
import { Bars } from "@/components/Bars";
import { Stat, Tiles } from "@/components/Stat";
import { db, nowS } from "@/lib/db";
import { pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Players() {
  const handle = await db();
  const now = nowS();
  const [o, fresh, active] = await Promise.all([
    playerOverview(handle, now),
    newPlayersByDay(handle, 60, now),
    activePlayersByDay(handle, 60, now),
  ]);
  return (
    <>
      <h1>Players</h1>
      <p className="sub">Anonymous identities, the linked share, and who's been around.</p>
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
      <p className="hint">
        "Active" reads each player's last-seen stamp, refreshed by the wallet read at app boot (at most every ten minutes). Players who haven't opened the app since the stamp shipped never count.
      </p>

      <h2>New players a day · 60 days</h2>
      <Bars rows={fresh.map((d) => ({ label: d.day.slice(5), values: { n: d.count } }))} series={[{ key: "n", label: "New", color: "var(--green)" }]} />

      <h2>Last seen, by day · 60 days</h2>
      <Bars rows={active.map((d) => ({ label: d.day.slice(5), values: { n: d.count } }))} series={[{ key: "n", label: "Players", color: "var(--blue)" }]} />
      <p className="hint">Each player sits on the day of their most recent visit only, so this is a floor on daily actives, not a history of them.</p>
    </>
  );
}
