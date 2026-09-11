import { economyOverview, entitlementCounts, iapByDay, ledgerBySource } from "@heroic/blood-in-the-sand-persistence";
import { Bars } from "@/components/Bars";
import { Stat, Tiles } from "@/components/Stat";
import { iapUsd, itemName } from "@/lib/bits";
import { db, nowS } from "@/lib/db";
import { n } from "@/lib/format";

export const dynamic = "force-dynamic";

const COLORS = ["var(--accent)", "var(--blue)", "var(--green)", "var(--red)", "var(--sand)", "#9b6bd6"];

export default async function Economy() {
  const handle = await db();
  const now = nowS();
  const [o, glory, signets, iap, items] = await Promise.all([
    economyOverview(handle, now),
    ledgerBySource(handle, "glory", 30, now),
    ledgerBySource(handle, "signet", 30, now),
    iapByDay(handle, 30, now),
    entitlementCounts(handle),
  ]);
  const sources = [...new Set(iap.flatMap((d) => Object.keys(d.bySource)))].sort();
  const revenue30 = iap.reduce((sum, d) => sum + Object.entries(d.bySource).reduce((s, [src, c]) => s + c * iapUsd(src), 0), 0);
  return (
    <>
      <h1>Economy</h1>
      <p className="sub">Glory, Signets, packs and what people unlock.</p>

      <Tiles>
        <Stat label="Packs · 24h" value={o.iapDay} />
        <Stat label="Packs · 7d" value={o.iapWeek} />
        <Stat label="Packs · ever" value={o.iapTotal} />
        <Stat label="Revenue · 30d" value={`$${revenue30.toFixed(2)}`} detail="at US list price, before the store's cut" />
        <Stat label="Unlocks" value={o.unlocks} detail="items bought with Signets" />
        <Stat label="Glory held" value={o.gloryHeld} detail={`${n(o.gloryMinted)} minted · ${n(o.gloryBurned)} spent`} />
        <Stat label="Signets held" value={o.signetsHeld} detail={`${n(o.signetsMinted)} minted · ${n(o.signetsBurned)} spent`} />
      </Tiles>

      <h2>Packs a day · 30 days</h2>
      {sources.length > 0 ? (
        <Bars
          rows={iap.map((d) => ({ label: d.day.slice(5), values: d.bySource }))}
          series={sources.map((s, i) => ({ key: s, label: s.replace(/^iap:/, ""), color: COLORS[i % COLORS.length]! }))}
        />
      ) : (
        <p className="hint">No pack purchases in the last 30 days.</p>
      )}

      <div className="cards" style={{ marginTop: 28 }}>
        <div className="card">
          <h3>Glory by source · 30 days</h3>
          <FlowTable rows={glory} />
        </div>
        <div className="card">
          <h3>Signets by source · 30 days</h3>
          <FlowTable rows={signets} />
        </div>
      </div>

      <h2>Owned items</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Via</th>
              <th className="r">Owners</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={`${r.itemId}:${r.source}`}>
                <td>
                  {itemName(r.itemId)} <span className="muted mono">{r.itemId}</span>
                </td>
                <td>{r.source}</td>
                <td className="r num">{n(r.count)}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  Nothing owned yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FlowTable({ rows }: { rows: { source: string; entries: number; amount: number }[] }) {
  if (rows.length === 0) return <p className="hint">No movement.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Source</th>
          <th className="r">Entries</th>
          <th className="r">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.source}>
            <td>{r.source}</td>
            <td className="r num">{n(r.entries)}</td>
            <td className="r num" style={{ color: r.amount < 0 ? "var(--red)" : "var(--green)" }}>
              {r.amount > 0 ? "+" : ""}
              {n(r.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
