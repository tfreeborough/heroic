import Link from "next/link";
import { feedbackOverview, listFeedback } from "@heroic/blood-in-the-sand-persistence";
import { Stat, Tiles } from "@/components/Stat";
import { db, nowS } from "@/lib/db";
import { ago, short, when } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE = 30;

export default async function Feedback({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const handle = await db();
  const now = nowS();
  const beforeId = Number(before);
  const [o, reports] = await Promise.all([
    feedbackOverview(handle, now),
    listFeedback(handle, { before: Number.isFinite(beforeId) ? beforeId : undefined, limit: PAGE }),
  ]);
  const last = reports[reports.length - 1];
  return (
    <>
      <h1>Feedback</h1>
      <p className="sub">Bug reports and ideas from the in-app form, newest first.</p>
      <Tiles>
        <Stat label="All time" value={o.total} />
        <Stat label="This week" value={o.week} />
        <Stat label="Bugs" value={o.byKind["bug"] ?? 0} />
        <Stat label="Ideas" value={o.byKind["idea"] ?? 0} />
        <Stat label="Other" value={o.byKind["other"] ?? 0} />
      </Tiles>
      <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
        {reports.map((r) => (
          <div className="card" key={r.id}>
            <div className="stamps">
              <span className={`pill ${r.kind === "bug" ? "bad" : r.kind === "idea" ? "ok" : ""}`}>{r.kind}</span>
              <span title={when(r.createdAt)}>{ago(r.createdAt, now)}</span>
              {r.playerName ? <span>{r.playerName}</span> : null}
              <span className="mono">{short(r.playerId)}</span>
              {r.contactEmail ? <a href={`mailto:${r.contactEmail}`}>{r.contactEmail}</a> : <span>no email</span>}
            </div>
            <p className="msg">{r.message}</p>
            <div className="stamps">
              {r.platform ? <span>{r.platform} {r.osVersion ?? ""}</span> : null}
              {r.appBinary ? <span>{r.appBinary}</span> : null}
              {r.appBundle ? <span>{r.appBundle}</span> : null}
              {r.rttMs !== null ? <span>ping {r.rttMs} ms</span> : null}
              <span className="mono">#{r.id}</span>
            </div>
          </div>
        ))}
        {reports.length === 0 ? <p className="hint">Nothing here.</p> : null}
      </div>
      {reports.length === PAGE && last ? (
        <p style={{ marginTop: 16 }}>
          <Link href={`?before=${last.id}`} className="pill">
            Older →
          </Link>
        </p>
      ) : null}
    </>
  );
}
