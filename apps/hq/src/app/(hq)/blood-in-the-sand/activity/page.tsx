import Link from "next/link";
import { ACTIVITY_KINDS, activityFeed, namesOf, type ActivityKind } from "@heroic/blood-in-the-sand-persistence";
import { PlayerLink } from "@/components/PlayerLink";
import { arenaName, deedTitle, describeSource, itemName } from "@/lib/bits";
import { db, nowS } from "@/lib/db";
import { ago, when } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE = 80;

const KIND_LABEL: Record<ActivityKind, string> = {
  joined: "joined",
  match: "matches",
  purchase: "purchases",
  exchange: "exchanges",
  unlock: "unlocks",
  deed: "deeds",
  feedback: "feedback",
  code: "codes",
  grant: "grants",
};

export default async function Activity({ searchParams }: { searchParams: Promise<{ kind?: string; before?: string }> }) {
  const sp = await searchParams;
  const kind = (ACTIVITY_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as ActivityKind) : null;
  const before = Number(sp.before);
  const handle = await db();
  const now = nowS();
  const rows = await activityFeed(handle, { before: Number.isFinite(before) ? before : null, limit: PAGE, kinds: kind ? [kind] : undefined });
  const names = await namesOf(handle, rows.flatMap((r) => [...(r.playerId ? [r.playerId] : []), ...r.players]));
  const last = rows[rows.length - 1];
  const href = (k: ActivityKind | null, b?: number) => {
    const p = new URLSearchParams();
    if (k) p.set("kind", k);
    if (b) p.set("before", String(b));
    const s = p.toString();
    return s ? `?${s}` : "?";
  };
  const who = (id: string | null) => (id ? <PlayerLink id={id} name={names.get(id)} /> : null);
  const line = (r: (typeof rows)[number]) => {
    switch (r.kind) {
      case "joined":
        return <>{who(r.playerId)} registered</>;
      case "match": {
        const [mode, bracket, humans, bots, arena] = r.detail.split("|");
        return (
          <>
            {mode}
            {bracket ? ` ${bracket}` : ""}
            {arena ? ` on ${arenaName(arena)}` : ""}
            {humans ? ` · ${humans} human${humans === "1" ? "" : "s"}` : ""}
            {bots && bots !== "0" ? `, ${bots} bot${bots === "1" ? "" : "s"}` : ""}
            {r.players.length > 0 ? (
              <>
                {" · "}
                {r.players.map((p, i) => (
                  <span key={p}>
                    {i > 0 ? ", " : ""}
                    <PlayerLink id={p} name={names.get(p)} />
                  </span>
                ))}
              </>
            ) : null}
          </>
        );
      }
      case "purchase":
        return (
          <>
            {who(r.playerId)} {describeSource(r.ref, "signet", Number(r.detail))}
          </>
        );
      case "exchange":
        return <>{who(r.playerId)} exchanged Glory for a Signet</>;
      case "unlock":
        return (
          <>
            {who(r.playerId)} unlocked {itemName(r.ref)}
          </>
        );
      case "deed":
        return (
          <>
            {who(r.playerId)} earned <b>{deedTitle(r.ref)}</b>
          </>
        );
      case "feedback":
        return (
          <>
            {who(r.playerId)} sent {r.detail === "idea" ? "an idea" : r.detail === "bug" ? "a bug report" : "feedback"} ·{" "}
            <Link href="/blood-in-the-sand/feedback" className="plink">
              #{r.ref}
            </Link>
          </>
        );
      case "code":
        return (
          <>
            {who(r.playerId)} redeemed <code>{r.ref}</code>
          </>
        );
      case "grant": {
        const [ledger, amount] = r.detail.split(":");
        return (
          <>
            {who(r.playerId)} was granted {Number(amount) > 0 ? "+" : ""}
            {amount} {ledger === "glory" ? "Glory" : "Signets"} · {r.ref.replace(/^hq:/, "")}
          </>
        );
      }
    }
  };
  return (
    <>
      <h1>Activity</h1>
      <p className="sub">What happened on the platform, newest first — every table that stamps a time, in one stream.</p>
      <div className="search">
        <span className="pills">
          <Link href={href(null)} className={kind === null ? "active" : undefined}>
            everything
          </Link>
          {ACTIVITY_KINDS.map((k) => (
            <Link key={k} href={href(k)} className={k === kind ? "active" : undefined}>
              {KIND_LABEL[k]}
            </Link>
          ))}
        </span>
      </div>
      <div className="feed">
        {rows.map((r, i) => (
          <div className="row" key={`${r.kind}:${r.ref}:${r.playerId}:${r.at}:${i}`}>
            <span className="when" title={when(r.at)}>
              {ago(r.at, now)}
            </span>
            <span className={`kind ${r.kind}`}>{r.kind}</span>
            <span>{line(r)}</span>
          </div>
        ))}
        {rows.length === 0 ? <p className="hint">Nothing here.</p> : null}
      </div>
      {rows.length === PAGE && last ? (
        <p style={{ marginTop: 16 }}>
          <Link href={href(kind, last.at)} className="pill">
            Older →
          </Link>
        </p>
      ) : null}
    </>
  );
}
