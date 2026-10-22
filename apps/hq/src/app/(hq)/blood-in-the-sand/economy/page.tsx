import Link from "next/link";
import {
  balanceBuckets,
  economyOverview,
  economyPulse,
  entitlementCounts,
  iapByDay,
  ledgerByDay,
  ledgerBySource,
  playerOverview,
  purchases,
  storeUnlocks,
  topSpenders,
} from "@heroic/blood-in-the-sand-persistence";
import { Bars } from "@/components/Bars";
import { PlayerLink } from "@/components/PlayerLink";
import { Pulse } from "@/components/Pulse";
import { Stat, Tiles } from "@/components/Stat";
import { SKU_USD, iapUsd, itemName, packName } from "@/lib/bits";
import { db, nowS } from "@/lib/db";
import { ago, n, pct, when } from "@/lib/format";

export const dynamic = "force-dynamic";

const DAYS = 28;
const PAGE = 40;
const COLORS = ["var(--accent)", "var(--blue)", "var(--green)", "var(--red)", "var(--sand)", "#9b6bd6"];
/** The server's default SIGNET_GLORY_PRICE — what a Signet costs in Glory. */
const SIGNET_PRICE = 800;

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const usd = (v: number) => `$${v.toFixed(2)}`;

const SOURCE_WORDS: Record<string, string> = {
  ranked: "ranked match pay",
  achievement: "deed bounties",
  store: "the store (exchanges, unlocks)",
  iap: "packs bought",
  code: "codes",
  merge: "device merges",
  hq: "HQ grants",
  "dev-grant": "dev grants",
};

export default async function Economy({ searchParams }: { searchParams: Promise<{ before?: string; unlocksBefore?: string }> }) {
  const sp = await searchParams;
  const before = Number(sp.before);
  const unlocksBefore = Number(sp.unlocksBefore);
  const handle = await db();
  const now = nowS();
  const [o, pulse, players, glory, signets, iap, gloryDays, signetDays, items, bought, spenders, gloryBuckets, signetBuckets, unlocks] = await Promise.all([
    economyOverview(handle, now),
    economyPulse(handle, now),
    playerOverview(handle, now),
    ledgerBySource(handle, "glory", 30, now),
    ledgerBySource(handle, "signet", 30, now),
    iapByDay(handle, DAYS, now),
    ledgerByDay(handle, "glory", 30, now),
    ledgerByDay(handle, "signet", 30, now),
    entitlementCounts(handle),
    purchases(handle, { before: Number.isFinite(before) ? before : null, limit: PAGE }),
    topSpenders(handle, 15),
    balanceBuckets(handle, "glory", [1, 200, 500, SIGNET_PRICE, SIGNET_PRICE * 2]),
    balanceBuckets(handle, "signet", [1, 2, 6]),
    storeUnlocks(handle, { before: Number.isFinite(unlocksBefore) ? unlocksBefore : null, limit: 20 }),
  ]);
  const skus = [...new Set(iap.flatMap((d) => Object.keys(d.bySource)))].sort();
  const packsSeries = iap.map((d) => sum(Object.values(d.bySource)));
  const revenueSeries = iap.map((d) => sum(Object.entries(d.bySource).map(([src, c]) => c * iapUsd(src))));
  const revenueAll = o.iapTotal === 0 ? 0 : (await purchasesTotalUsd(handle));
  const last7 = (xs: number[]) => sum(xs.slice(-7));
  const prev7 = (xs: number[]) => sum(xs.slice(-14, -7));
  const arppu = pulse.payingPlayers > 0 ? revenueAll / pulse.payingPlayers : 0;
  const lastPurchase = bought[bought.length - 1];
  const lastUnlock = unlocks[unlocks.length - 1];
  const soldItems = items.filter((i) => i.source === "purchase");
  const maxBucket = (b: { players: number }[]) => Math.max(1, ...b.map((x) => x.players));
  const bucketLabel = (b: { floor: number; ceil: number | null }) => (b.ceil === null ? `${n(b.floor)}+` : b.floor === b.ceil ? n(b.floor) : `${n(b.floor)}–${n(b.ceil)}`);

  return (
    <>
      <h1>Economy</h1>
      <p className="sub">Money in, Glory and Signets moving, and what people actually buy.</p>

      <h2>This week against last · {DAYS}-day lines</h2>
      <Tiles>
        <Pulse label="Revenue" value={last7(revenueSeries)} previous={prev7(revenueSeries)} series={revenueSeries} labels={iap.map((d) => d.day)} format={usd} detail="US list price, before the store's cut" color="var(--green)" />
        <Pulse label="Packs" value={last7(packsSeries)} previous={prev7(packsSeries)} series={packsSeries} labels={iap.map((d) => d.day)} detail={`${n(o.iapTotal)} ever`} color="var(--green)" />
        <Pulse label="Glory minted" value={last7(gloryDays.map((d) => d.minted))} previous={prev7(gloryDays.map((d) => d.minted))} series={gloryDays.map((d) => d.minted)} labels={gloryDays.map((d) => d.day)} detail="credits, all sources" />
        <Pulse label="Glory spent" value={last7(gloryDays.map((d) => d.burned))} previous={prev7(gloryDays.map((d) => d.burned))} series={gloryDays.map((d) => d.burned)} labels={gloryDays.map((d) => d.day)} detail="debits — exchanges, mostly" color="var(--red)" />
        <Pulse label="Signets spent" value={last7(signetDays.map((d) => d.burned))} previous={prev7(signetDays.map((d) => d.burned))} series={signetDays.map((d) => d.burned)} labels={signetDays.map((d) => d.day)} detail="unlocks" color="var(--blue)" />
      </Tiles>

      <h2>Who pays</h2>
      <Tiles>
        <Stat label="Paying players" value={pulse.payingPlayers} detail={`${pct(players.total ? pulse.payingPlayers / players.total : 0, 1)} of ${n(players.total)} registered`} />
        <Stat label="Bought this week" value={pulse.payingWeek} detail={`${pulse.firstTimeBuyersWeek} for the first time`} />
        <Stat label="Repeat buyers" value={pulse.repeatBuyers} detail={`${pct(pulse.payingPlayers ? pulse.repeatBuyers / pulse.payingPlayers : 0)} of payers bought twice+`} />
        <Stat label="Revenue ever" value={usd(revenueAll)} detail="at US list price" />
        <Stat label="Per payer" value={usd(arppu)} detail="revenue ÷ paying players" />
        <Stat label="Exchanges" value={pulse.exchangesTotal} detail={`${pulse.exchangesWeek} this week · ${n(SIGNET_PRICE)} Glory → 1 Signet`} />
        <Stat label="Unlocks" value={o.unlocks} detail={`${pulse.unlocksWeek} this week · items bought with Signets`} />
      </Tiles>

      <h2>Purchases</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Player</th>
              <th>Pack</th>
              <th>Store</th>
              <th className="r">Price</th>
              <th>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {bought.map((b) => (
              <tr key={b.id}>
                <td title={when(b.at)} style={{ whiteSpace: "nowrap" }}>
                  {ago(b.at, now)} <span className="muted">· {when(b.at)}</span>
                </td>
                <td>
                  <PlayerLink id={b.playerId} name={b.name} />
                </td>
                <td>{packName(b.sku)}</td>
                <td>{b.platform}</td>
                <td className="r num">{usd(iapUsd(b.source))}</td>
                <td className="mono muted">{b.transactionId}</td>
              </tr>
            ))}
            {bought.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  {Number.isFinite(before) ? "No older purchases." : "Nobody has bought a pack yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {bought.length === PAGE && lastPurchase ? (
        <p style={{ marginTop: 10 }}>
          <Link href={`?before=${lastPurchase.at}`} className="pill">
            Older →
          </Link>
        </p>
      ) : null}

      <h2>Revenue a day · {DAYS} days</h2>
      {skus.length > 0 ? (
        <Bars
          rows={iap.map((d) => ({ label: d.day.slice(5), title: d.day, values: Object.fromEntries(Object.entries(d.bySource).map(([src, c]) => [src, Math.round(c * iapUsd(src) * 100) / 100])) }))}
          series={skus.map((s, i) => ({ key: s, label: `${packName(s.split(":")[2] ?? "")} · ${s.split(":")[1]}`, color: COLORS[i % COLORS.length]! }))}
          unit="usd"
        />
      ) : (
        <p className="hint">No pack purchases in the last {DAYS} days.</p>
      )}

      <div className="two" style={{ marginTop: 28 }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Glory a day · 30 days</h2>
          <Bars
            rows={gloryDays.map((d) => ({ label: d.day.slice(5), title: d.day, values: { minted: d.minted, burned: d.burned } }))}
            series={[
              { key: "minted", label: "Minted", color: "var(--accent)" },
              { key: "burned", label: "Spent", color: "var(--red)" },
            ]}
            height={110}
          />
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>Signets a day · 30 days</h2>
          <Bars
            rows={signetDays.map((d) => ({ label: d.day.slice(5), title: d.day, values: { minted: d.minted, burned: d.burned } }))}
            series={[
              { key: "minted", label: "Minted", color: "var(--blue)" },
              { key: "burned", label: "Spent", color: "var(--red)" },
            ]}
            height={110}
          />
        </div>
      </div>

      <div className="cards" style={{ marginTop: 28 }}>
        <div className="card">
          <h3>Where Glory comes from and goes · 30 days</h3>
          <FlowTable rows={glory} />
          <p className="hint">
            Held {n(o.gloryHeld)} · minted {n(o.gloryMinted)} · spent {n(o.gloryBurned)}, all time.
          </p>
        </div>
        <div className="card">
          <h3>Where Signets come from and go · 30 days</h3>
          <FlowTable rows={signets} />
          <p className="hint">
            Held {n(o.signetsHeld)} · minted {n(o.signetsMinted)} · spent {n(o.signetsBurned)}, all time.
          </p>
        </div>
      </div>

      <h2>Who holds what</h2>
      <div className="two">
        <div className="card">
          <h3>Glory in wallets</h3>
          <p className="hint" style={{ marginBottom: 8 }}>
            Players by balance. {n(SIGNET_PRICE)} is one Signet — the line between "saving up" and "can buy".
          </p>
          {gloryBuckets.map((b) => (
            <div key={b.floor} style={{ marginBottom: 6 }}>
              <div className="stamps">
                <span className="num" style={{ minWidth: 90 }}>
                  {bucketLabel(b)}
                </span>
                <span className="num">{n(b.players)}</span>
                <span>{pct(players.total ? b.players / players.total : 0)}</span>
              </div>
              <div className="progress">
                <i style={{ width: `${(b.players / maxBucket(gloryBuckets)) * 100}%`, background: b.floor >= SIGNET_PRICE ? "var(--green)" : "var(--accent)" }} />
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Signets in wallets</h3>
          <p className="hint" style={{ marginBottom: 8 }}>
            Unspent Signets are unlocks waiting to happen.
          </p>
          {signetBuckets.map((b) => (
            <div key={b.floor} style={{ marginBottom: 6 }}>
              <div className="stamps">
                <span className="num" style={{ minWidth: 90 }}>
                  {bucketLabel(b)}
                </span>
                <span className="num">{n(b.players)}</span>
                <span>{pct(players.total ? b.players / players.total : 0)}</span>
              </div>
              <div className="progress">
                <i style={{ width: `${(b.players / maxBucket(signetBuckets)) * 100}%`, background: "var(--blue)" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <h2>Top spenders</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th className="r">Packs</th>
              <th className="r">Spent</th>
              <th>Mix</th>
              <th>First</th>
              <th>Last</th>
            </tr>
          </thead>
          <tbody>
            {spenders.map((s) => (
              <tr key={s.playerId}>
                <td>
                  <PlayerLink id={s.playerId} name={s.name} />
                </td>
                <td className="r num">{n(s.purchases)}</td>
                <td className="r num">{usd(sum(Object.entries(s.bySku).map(([sku, c]) => c * (SKU_USD[sku] ?? 0))))}</td>
                <td className="muted">
                  {Object.entries(s.bySku)
                    .sort((a, b) => b[1] - a[1])
                    .map(([sku, c]) => `${c}× ${packName(sku)}`)
                    .join(", ")}
                </td>
                <td title={when(s.firstAt)}>{ago(s.firstAt, now)}</td>
                <td title={when(s.lastAt)}>{ago(s.lastAt, now)}</td>
              </tr>
            ))}
            {spenders.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Nobody yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2>What Signets buy</h2>
      <div className="two">
        <div className="card">
          <h3>By item</h3>
          {soldItems.length === 0 ? <p className="hint">Nothing unlocked with a Signet yet.</p> : null}
          {soldItems.map((r) => (
            <div key={r.itemId} style={{ marginBottom: 6 }}>
              <div className="stamps">
                <span style={{ color: "var(--text)" }}>{itemName(r.itemId)}</span>
                <span className="mono">{r.itemId}</span>
                <span className="num">{n(r.count)}</span>
              </div>
              <div className="progress">
                <i style={{ width: `${(r.count / Math.max(1, soldItems[0]?.count ?? 1)) * 100}%`, background: "var(--blue)" }} />
              </div>
            </div>
          ))}
          {items.filter((i) => i.source !== "purchase").length > 0 ? (
            <>
              <h3 style={{ marginTop: 14 }}>Granted other ways</h3>
              {items
                .filter((i) => i.source !== "purchase")
                .map((r) => (
                  <div key={`${r.itemId}:${r.source}`} className="stamps" style={{ marginBottom: 4 }}>
                    <span>{itemName(r.itemId)}</span>
                    <span>{r.source === "achievement" ? "deed reward" : r.source}</span>
                    <span className="num">{n(r.count)}</span>
                  </div>
                ))}
            </>
          ) : null}
        </div>
        <div className="card">
          <h3>Latest unlocks</h3>
          <table>
            <tbody>
              {unlocks.map((u) => (
                <tr key={`${u.playerId}:${u.itemId}`}>
                  <td title={when(u.at)} className="muted" style={{ whiteSpace: "nowrap" }}>
                    {ago(u.at, now)}
                  </td>
                  <td>
                    <PlayerLink id={u.playerId} name={u.name} />
                  </td>
                  <td>{itemName(u.itemId)}</td>
                </tr>
              ))}
              {unlocks.length === 0 ? (
                <tr>
                  <td className="muted">None yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {unlocks.length === 20 && lastUnlock ? (
            <p style={{ marginTop: 10 }}>
              <Link href={`?unlocksBefore=${lastUnlock.at}`} className="pill">
                Older →
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Revenue ever, at list price: every iap row through the price table. */
async function purchasesTotalUsd(handle: Awaited<ReturnType<typeof db>>): Promise<number> {
  const rows = await purchases(handle, { limit: 500 });
  let total = rows.reduce((s, r) => s + iapUsd(r.source), 0);
  let last = rows[rows.length - 1];
  let page = rows;
  while (page.length === 500 && last) {
    page = await purchases(handle, { before: last.at, limit: 500 });
    total += page.reduce((s, r) => s + iapUsd(r.source), 0);
    last = page[page.length - 1];
  }
  return total;
}

function FlowTable({ rows }: { rows: { source: string; entries: number; amount: number }[] }) {
  if (rows.length === 0) return <p className="hint">No movement.</p>;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.amount)));
  return (
    <table>
      <thead>
        <tr>
          <th>Source</th>
          <th className="r">Entries</th>
          <th className="r">Net</th>
          <th style={{ width: "35%" }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.source}>
            <td>
              {SOURCE_WORDS[r.source] ?? r.source} <span className="muted mono">{r.source}</span>
            </td>
            <td className="r num">{n(r.entries)}</td>
            <td className="r num" style={{ color: r.amount < 0 ? "var(--red)" : "var(--green)" }}>
              {r.amount > 0 ? "+" : ""}
              {n(r.amount)}
            </td>
            <td>
              <div className="progress">
                <i style={{ width: `${(Math.abs(r.amount) / max) * 100}%`, background: r.amount < 0 ? "var(--red)" : "var(--green)" }} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
