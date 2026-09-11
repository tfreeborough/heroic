import { deedCounts, playerOverview } from "@heroic/blood-in-the-sand-persistence";
import { deeds } from "@/lib/bits";
import { db, nowS } from "@/lib/db";
import { n, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Deeds() {
  const handle = await db();
  const [counts, players] = await Promise.all([deedCounts(handle), playerOverview(handle, nowS())]);
  const byId = new Map(counts.map((c) => [c.achievementId, c.unlocks]));
  const defs = deeds();
  const known = new Set(defs.map((d) => d.id));
  const rows = defs
    .map((d) => ({ ...d, unlocks: byId.get(d.id) ?? 0 }))
    .sort((a, b) => b.unlocks - a.unlocks || a.board.localeCompare(b.board) || a.title.localeCompare(b.title));
  const orphans = counts.filter((c) => !known.has(c.achievementId));
  const total = Math.max(1, players.total);
  return (
    <>
      <h1>Deeds</h1>
      <p className="sub">
        How rare each deed is: unlocks over all {n(players.total)} players. {n(counts.reduce((s, c) => s + c.unlocks, 0))} unlocks in total.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Deed</th>
              <th>Board</th>
              <th className="r">Unlocked by</th>
              <th className="r">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>
                  <b>{d.title}</b> {d.secret ? <span className="pill">secret</span> : null}
                  <div className="muted">{d.description}</div>
                </td>
                <td className="muted">{d.board}</td>
                <td className="r num">{n(d.unlocks)}</td>
                <td className="r num">{pct(d.unlocks / total, 1)}</td>
              </tr>
            ))}
            {orphans.map((c) => (
              <tr key={c.achievementId}>
                <td>
                  <span className="mono">{c.achievementId}</span> <span className="pill warn">not in this build's defs</span>
                </td>
                <td />
                <td className="r num">{n(c.unlocks)}</td>
                <td className="r num">{pct(c.unlocks / total, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
