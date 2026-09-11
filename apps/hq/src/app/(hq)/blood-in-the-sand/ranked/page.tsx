import Link from "next/link";
import { ladderTop, loadoutStats, rankedOverview, ratingSpread } from "@heroic/blood-in-the-sand-persistence";
import { Bars } from "@/components/Bars";
import { Stat, Tiles } from "@/components/Stat";
import { BRACKETS, SEASON, abilityName, weaponName } from "@/lib/bits";
import { db } from "@/lib/db";
import { ms, n, pct, short } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Ranked({ searchParams }: { searchParams: Promise<{ bracket?: string }> }) {
  const { bracket: raw } = await searchParams;
  const bracket = (BRACKETS as readonly string[]).includes(raw ?? "") ? raw! : BRACKETS[0];
  const handle = await db();
  const [overview, ladder, spread, loadouts] = await Promise.all([
    rankedOverview(handle, SEASON),
    ladderTop(handle, SEASON, bracket, 25),
    ratingSpread(handle, SEASON, bracket),
    loadoutStats(handle, SEASON, bracket),
  ]);
  return (
    <>
      <h1>Ranked</h1>
      <p className="sub">Season {SEASON}. Bots are excluded from every player number here.</p>

      <h2>Brackets</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Bracket</th>
              <th className="r">Matches</th>
              <th className="r">Human-only</th>
              <th className="r">Players</th>
              <th className="r">Ping median</th>
              <th className="r">Ping samples</th>
            </tr>
          </thead>
          <tbody>
            {overview.map((b) => (
              <tr key={b.bracket}>
                <td>{b.bracket}</td>
                <td className="r num">{n(b.matches)}</td>
                <td className="r num">
                  {n(b.humanOnly)} <span className="muted">({pct(b.matches ? b.humanOnly / b.matches : 0)})</span>
                </td>
                <td className="r num">{n(b.players)}</td>
                <td className="r num">{ms(b.rttMedianMs)}</td>
                <td className="r num">{n(b.rttSamples)}</td>
              </tr>
            ))}
            {overview.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No ranked matches this season yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="hint">Ping is the seat's median server-measured round trip per match. A second region is worth it when a fat tail shows up here.</p>

      <div className="tabs" style={{ marginTop: 28 }}>
        {BRACKETS.map((b) => (
          <Link key={b} href={`?bracket=${b}`} className={b === bracket ? "active" : undefined}>
            {b}
          </Link>
        ))}
      </div>

      <h2>Rating spread · {bracket}</h2>
      {spread.length > 0 ? (
        <Bars rows={spread.map((b) => ({ label: String(b.floor), values: { n: b.count } }))} series={[{ key: "n", label: "Players", color: "var(--accent)" }]} height={100} />
      ) : (
        <p className="hint">Nobody rated yet.</p>
      )}

      <h2>Picks · {bracket}</h2>
      <Tiles>
        <Stat label="Human seats" value={loadouts.seats} detail="loadouts counted" />
      </Tiles>
      <div className="cards" style={{ marginTop: 12 }}>
        <div className="card">
          <h3>Weapons</h3>
          <PickTable rows={loadouts.weapons.map((r) => ({ ...r, name: weaponName(r.id) }))} />
        </div>
        <div className="card">
          <h3>Abilities</h3>
          <PickTable rows={loadouts.abilities.map((r) => ({ ...r, name: abilityName(r.id) }))} />
        </div>
      </div>

      <h2>Ladder · {bracket}</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th className="r">Rating</th>
              <th className="r">Peak</th>
              <th className="r">W</th>
              <th className="r">L</th>
            </tr>
          </thead>
          <tbody>
            {ladder.map((r, i) => (
              <tr key={r.subjectId}>
                <td className="num">{i + 1}</td>
                <td className="mono">{short(r.subjectId)}</td>
                <td className="r num">{r.rating}</td>
                <td className="r num">{r.peak}</td>
                <td className="r num">{r.wins}</td>
                <td className="r num">{r.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PickTable({ rows }: { rows: { id: string; name: string; picks: number; pickRate: number; winRate: number }[] }) {
  if (rows.length === 0) return <p className="hint">No picks recorded.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Pick</th>
          <th className="r">Picks</th>
          <th className="r">Pick rate</th>
          <th className="r">Win rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.name}</td>
            <td className="r num">{n(r.picks)}</td>
            <td className="r num">{pct(r.pickRate)}</td>
            <td className="r num">{pct(r.winRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
