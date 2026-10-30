import Link from "next/link";
import { stalePlayers } from "@heroic/blood-in-the-sand-persistence";
import { PlayerLink } from "@/components/PlayerLink";
import { Stat, Tiles } from "@/components/Stat";
import { db, nowS } from "@/lib/db";
import { ago, date, n } from "@/lib/format";
import { deleteAction } from "./actions";
import { cutoffOf } from "./cutoff";

export const dynamic = "force-dynamic";

const WHY: Record<string, string> = {
  paid: "bought Signets",
  linked: "linked an account",
  feedback: "sent feedback",
};

export default async function Tidy({ searchParams }: { searchParams: Promise<{ before?: string; deleted?: string; asked?: string; error?: string }> }) {
  const sp = await searchParams;
  const { day, cutoffS } = cutoffOf(sp.before);
  const now = nowS();
  const rows = await stalePlayers(await db(), cutoffS);
  const ticked = rows.filter((r) => r.protectedBy.length === 0).length;
  const deleted = sp.deleted === undefined ? null : Number(sp.deleted);
  const asked = Number(sp.asked ?? 0);
  return (
    <>
      <p className="sub">
        <Link href="/blood-in-the-sand/players">‹ Players</Link>
      </p>
      <h1>Tidy up old accounts</h1>
      <p className="sub">
        Everyone who registered before the cutoff and hasn't done anything since: not opened the app, played, or earned. Mostly old test devices, but any real early
        player who never came back is here too, so have a look before you delete.
      </p>
      {deleted !== null ? (
        <div className="banner">
          Deleted {n(deleted)} {deleted === 1 ? "player" : "players"}.
          {asked > deleted ? ` ${n(asked - deleted)} kept because they've been active since the cutoff.` : ""}
        </div>
      ) : null}
      {sp.error ? <div className="banner err">Nothing deleted: {sp.error}</div> : null}

      <form className="search" method="get">
        <label className="muted">
          Quiet since <input type="date" name="before" defaultValue={day} />
        </label>
        <button type="submit" className="ghost">
          Look again
        </button>
      </form>

      <Tiles>
        <Stat label="Quiet since" value={date(cutoffS)} detail="registered before, nothing after" />
        <Stat label="Found" value={rows.length} />
        <Stat label="Ticked" value={ticked} detail="the rest look like real people" />
      </Tiles>

      <form action={deleteAction}>
        <input type="hidden" name="before" value={day} />
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>Player</th>
                <th className="r">Joined</th>
                <th className="r">Last seen</th>
                <th className="r">Matches</th>
                <th className="r">Glory</th>
                <th className="r">Signets</th>
                <th className="r">Deeds</th>
                <th>Left unticked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input type="checkbox" name="id" value={r.id} defaultChecked={r.protectedBy.length === 0} />
                  </td>
                  <td>
                    <PlayerLink id={r.id} name={r.name} /> {r.name ? <span className="muted mono">{r.id.slice(0, 8)}</span> : null}
                  </td>
                  <td className="r num">{date(r.createdAt)}</td>
                  <td className="r num">{r.lastSeenAt ? ago(r.lastSeenAt, now) : <span className="muted">never</span>}</td>
                  <td className="r num">{n(r.matches)}</td>
                  <td className="r num">{n(r.glory)}</td>
                  <td className="r num">{n(r.signets)}</td>
                  <td className="r num">{n(r.deeds)}</td>
                  <td>
                    {r.protectedBy.map((w) => (
                      <span key={w} className="pill warn">
                        {WHY[w]}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    Nobody's been quiet since then.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {rows.length > 0 ? (
          <div className="form" style={{ marginTop: 16 }}>
            <label>
              Type delete to confirm
              <input type="text" name="confirm" autoComplete="off" placeholder="delete" />
            </label>
            <button type="submit" className="danger">
              Delete the ticked players
            </button>
          </div>
        ) : null}
      </form>
      <p className="hint">
        This can't be undone. Each player goes with everything that's only theirs: wallet, deeds, rating, owned items, feedback and device tokens. Match history stays
        because it belongs to their opponents too. If an old test phone opens the app again it quietly signs up fresh and counts as one new player.
      </p>
    </>
  );
}
