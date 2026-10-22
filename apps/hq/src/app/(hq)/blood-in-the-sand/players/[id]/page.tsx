import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import {
  achievementCounters,
  achievementUnlocks,
  companionsOf,
  entitlementsOf,
  listFeedback,
  namesOf,
  playerCard,
  playerCodes,
  playerDays,
  playerMatches,
  playerWallet,
  rankedSummary,
} from "@heroic/blood-in-the-sand-persistence";
import { PlayerLink } from "@/components/PlayerLink";
import { Stat, Tiles } from "@/components/Stat";
import { SEASON, abilityName, arenaName, challenges, deeds, describeGrant, describeSource, iapUsd, itemName, weaponName } from "@/lib/bits";
import { clerkConfigured, clerkEmail } from "@/lib/clerk";
import { db, nowS } from "@/lib/db";
import { ago, date, ms, n, pct, secs, when } from "@/lib/format";
import { grantAction, noteAction } from "./actions";

export const dynamic = "force-dynamic";

const DAY_S = 86_400;

export default async function Player({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ granted?: string; error?: string }>;
}) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const { granted, error } = await searchParams;
  const handle = await db();
  const now = nowS();
  const card = await playerCard(handle, id);
  if (!card) notFound();
  const [ranked, counters, unlocks, owned, companions, matches, wallet, codes, days, feedback] = await Promise.all([
    rankedSummary(handle, id, SEASON),
    achievementCounters(handle, id),
    achievementUnlocks(handle, id),
    entitlementsOf(handle, id),
    companionsOf(handle, id),
    playerMatches(handle, id, 60),
    playerWallet(handle, id, 120),
    playerCodes(handle, id),
    playerDays(handle, id, 90),
    listFeedback(handle, { playerId: id, limit: 50 }),
  ]);
  const names = await namesOf(handle, [...matches.flatMap((m) => m.others.map((o) => o.playerId)), ...companions.map((c) => c.otherId)]);
  const email = card.clerkUserId ? await clerkEmail(card.clerkUserId) : null;

  const displayName = card.name ?? card.lastFeedback?.name ?? null;
  const spentUsd = card.purchases.reduce((s, src) => s + iapUsd(src), 0);
  const rankedPlayed = counters["ranked_matches"] ?? 0;
  const skirmishPlayed = (counters["skirmish:matches"] ?? 0) + (counters["skirmish:brawl_matches"] ?? 0);
  const soloLogged = matches.filter((m) => m.mode !== "ranked" && (m.humans ?? 0) <= 1).length;
  const wins = matches.filter((m) => m.won).length;
  const allDeeds = deeds();
  const unlockedIds = new Set(unlocks.map((u) => u.id));
  const unlockedAt = new Map(unlocks.map((u) => [u.id, u.unlockedAt]));
  const byBoard = new Map<string, typeof allDeeds>();
  for (const d of allDeeds.filter((d) => unlockedIds.has(d.id))) byBoard.set(d.board, [...(byBoard.get(d.board) ?? []), d]);
  const nearest = allDeeds
    .filter((d) => !unlockedIds.has(d.id) && d.milestone && (counters[d.milestone.counter] ?? 0) > 0)
    .map((d) => ({ ...d, have: counters[d.milestone!.counter] ?? 0, frac: Math.min(1, (counters[d.milestone!.counter] ?? 0) / d.milestone!.threshold) }))
    .sort((a, b) => b.frac - a.frac)
    .slice(0, 8);
  const dayset = new Set(days);
  const grid = Array.from({ length: 90 }, (_, i) => new Date((now - (89 - i) * DAY_S) * 1000).toISOString().slice(0, 10));
  const chall = challenges();
  const cleared = chall.filter((c) => (counters[c.clearsCounter] ?? 0) > 0).length;
  const grantKey = randomUUID();

  return (
    <>
      <div className="phead">
        <div>
          <h1>{displayName ?? "Unnamed player"}</h1>
          <div className="ids">
            <span className="mono" title="player id">
              {card.id}
            </span>
            {card.clerkUserId ? <span className="pill ok">linked{email ? ` · ${email}` : ""}</span> : <span className="pill">anonymous</span>}
            {card.clerkUserId && !email && !clerkConfigured() ? <span>set CLERK_SECRET_KEY to see the address</span> : null}
            <span>joined {date(card.createdAt)}</span>
            <span>{card.lastSeenAt ? `seen ${ago(card.lastSeenAt, now)}` : "never seen since the stamp landed"}</span>
            <span>
              {card.devices} device{card.devices === 1 ? "" : "s"}
            </span>
            {card.lastFeedback?.platform ? (
              <span>
                {card.lastFeedback.platform} {card.lastFeedback.osVersion ?? ""} · app {card.lastFeedback.appBinary ?? "?"} / {card.lastFeedback.appBundle ?? "?"} (from their last report)
              </span>
            ) : null}
            {card.lastFeedback?.email ? <a href={`mailto:${card.lastFeedback.email}`}>{card.lastFeedback.email}</a> : null}
          </div>
        </div>
      </div>
      {!card.name && displayName ? <p className="hint">Name from their last feedback report — they haven't joined a room since names were stamped.</p> : null}

      {granted ? <div className="banner">{granted === "already" ? "That grant had already landed — nothing paid twice." : `Granted ${granted}.`}</div> : null}
      {error ? <div className="banner err">Refused: {error}</div> : null}

      <Tiles>
        <Stat label="Ranked" value={rankedPlayed} detail={`${counters["ranked_wins"] ?? 0} won · lifetime`} />
        <Stat label="Skirmish + brawl" value={skirmishPlayed} detail={`with other humans · ${soloLogged} solo vs bots logged`} />
        {ranked.map((r) => (
          <Stat key={r.bracket} label={`Rating ${r.bracket}`} value={r.rating} detail={`peak ${r.peak} · ${r.wins}W ${r.losses}L`} />
        ))}
        <Stat label="Glory" value={card.glory} detail={`${n(counters["glory_earned"] ?? 0)} earned lifetime`} />
        <Stat label="Signets" value={card.signets} />
        <Stat label="Spent" value={`$${spentUsd.toFixed(2)}`} detail={`${card.purchases.length} pack${card.purchases.length === 1 ? "" : "s"} · US list price`} />
        <Stat label="Deeds" value={unlocks.length} detail={`of ${allDeeds.length}`} />
        <Stat label="Challenges" value={cleared} detail={`of ${chall.length} cleared`} />
        <Stat label="Days seen" value={card.daysActive} detail="since daily tracking began" />
      </Tiles>
      <div className="days" style={{ marginTop: 10 }} title="the last 90 days — green = opened the app">
        {grid.map((d) => (
          <i key={d} className={dayset.has(d) ? "on" : undefined} title={d} />
        ))}
      </div>

      <h2>Matches</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Mode</th>
              <th>Result</th>
              <th>Rating</th>
              <th>Loadout</th>
              <th className="r">K / D</th>
              <th className="r">Dmg</th>
              <th>Arena</th>
              <th className="r">Length</th>
              <th className="r">Ping</th>
              <th>With / against</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.matchId}>
                <td title={when(m.at)}>{ago(m.at, now)}</td>
                <td>
                  {m.mode}
                  {m.bracket ? ` ${m.bracket}` : ""}
                  {m.bots ? <span className="muted"> · {m.bots} bot{m.bots === 1 ? "" : "s"}</span> : null}
                </td>
                <td className={m.won ? "win" : "loss"}>{m.won ? "won" : "lost"}</td>
                <td className="num">
                  {m.ratingBefore !== null && m.ratingAfter !== null ? (
                    <>
                      {m.ratingBefore} → {m.ratingAfter}{" "}
                      <span className={m.ratingAfter >= m.ratingBefore ? "win" : "loss"}>
                        ({m.ratingAfter >= m.ratingBefore ? "+" : ""}
                        {m.ratingAfter - m.ratingBefore})
                      </span>
                    </>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
                <td>
                  {weaponName(m.weapon)}
                  {m.abilities.length > 0 ? <span className="muted"> · {m.abilities.map(abilityName).join(", ")}</span> : null}
                </td>
                <td className="r num">{m.kills === null ? <span className="muted">–</span> : `${m.kills} / ${m.deaths}`}</td>
                <td className="r num">{m.damageDealt === null ? <span className="muted">–</span> : n(m.damageDealt)}</td>
                <td>{arenaName(m.arena)}</td>
                <td className="r num">{secs(m.durationS)}</td>
                <td className="r num">{ms(m.rttMs)}</td>
                <td>
                  {m.others.length === 0 ? (
                    <span className="muted">{m.bots ? "bots only" : "–"}</span>
                  ) : (
                    m.others.map((o, i) => (
                      <span key={o.playerId}>
                        {i > 0 ? ", " : ""}
                        <PlayerLink id={o.playerId} name={names.get(o.playerId)} />
                        <span className="muted">{o.team === m.team ? " (with)" : ""}</span>
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
            {matches.length === 0 ? (
              <tr>
                <td colSpan={11} className="muted">
                  No online matches on record.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="hint">Ranked rows older than the match log show rating and loadout only. Kills, damage, arena and opponents in casual modes start from the day the seat table landed.</p>

      <div className="two" style={{ marginTop: 28 }}>
        <div className="card">
          <h3>Wallet</h3>
          <table>
            <tbody>
              {wallet.map((w) => (
                <tr key={`${w.ledger}:${w.key}`}>
                  <td title={when(w.at)} className="muted" style={{ whiteSpace: "nowrap" }}>
                    {ago(w.at, now)}
                  </td>
                  <td className="r num" style={{ color: w.amount < 0 ? "var(--red)" : "var(--green)", whiteSpace: "nowrap" }}>
                    {w.amount > 0 ? "+" : ""}
                    {n(w.amount)} {w.ledger === "glory" ? "G" : "S"}
                  </td>
                  <td>
                    {describeSource(w.source, w.ledger, w.amount)} <span className="muted mono">{w.source.length > 28 ? `${w.source.slice(0, 28)}…` : w.source}</span>
                  </td>
                </tr>
              ))}
              {wallet.length === 0 ? (
                <tr>
                  <td className="muted">Nothing has moved.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div>
          <div className="card">
            <h3>Store</h3>
            {card.purchases.length === 0 ? <p className="hint">No packs bought.</p> : null}
            {card.purchases.map((src, i) => (
              <div key={i} className="stamps" style={{ marginBottom: 4 }}>
                <span>{describeSource(src, "signet", 1)}</span>
                <span className="num">${iapUsd(src).toFixed(2)}</span>
              </div>
            ))}
            <h3 style={{ marginTop: 14 }}>Owns</h3>
            {owned.length === 0 ? <p className="hint">Nothing beyond the free kit.</p> : null}
            {owned.map((e) => (
              <div key={e.itemId} className="stamps" style={{ marginBottom: 4 }}>
                <span>{itemName(e.itemId)}</span>
                <span>{describeGrant(e.source)}</span>
                <span title={when(e.grantedAt)}>{date(e.grantedAt)}</span>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Grant</h3>
            <form action={grantAction} className="form">
              <input type="hidden" name="playerId" value={card.id} />
              <input type="hidden" name="key" value={grantKey} />
              <label>
                What
                <select name="ledger" defaultValue="glory">
                  <option value="glory">Glory</option>
                  <option value="signet">Signets</option>
                </select>
              </label>
              <label>
                Amount (negative takes away)
                <input name="amount" type="number" required placeholder="e.g. 200" />
              </label>
              <label className="full">
                Why (lands in their wallet as the source)
                <input name="note" required maxLength={120} placeholder="e.g. sorry about the crash on 22 Oct" />
              </label>
              <div className="full">
                <button type="submit" className="primary">
                  Grant
                </button>
              </div>
            </form>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Note</h3>
            <form action={noteAction}>
              <input type="hidden" name="playerId" value={card.id} />
              <textarea name="note" className="note form" defaultValue={card.note ?? ""} placeholder="anything worth remembering about this player — only HQ sees it" style={{ background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)", borderRadius: 6, padding: 8, fontFamily: "inherit", fontSize: 13 }} />
              <div style={{ marginTop: 8 }}>
                <button type="submit" className="ghost">
                  Save note
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <h2>Deeds · {unlocks.length} unlocked</h2>
      <div className="cards">
        {[...byBoard.entries()].map(([board, list]) => (
          <div className="card" key={board}>
            <h3>{board}</h3>
            {list
              .sort((a, b) => (unlockedAt.get(b.id) ?? 0) - (unlockedAt.get(a.id) ?? 0))
              .map((d) => (
                <div key={d.id} className="stamps" style={{ marginBottom: 4 }}>
                  <b style={{ color: "var(--text)" }}>{d.title}</b>
                  {d.bounty > 0 ? <span>+{d.bounty} G</span> : null}
                  <span title={when(unlockedAt.get(d.id) ?? 0)}>{date(unlockedAt.get(d.id) ?? 0)}</span>
                </div>
              ))}
          </div>
        ))}
        <div className="card">
          <h3>Nearest</h3>
          {nearest.length === 0 ? <p className="hint">No milestone underway.</p> : null}
          {nearest.map((d) => (
            <div key={d.id} style={{ marginBottom: 8 }}>
              <div className="stamps">
                <b style={{ color: "var(--text)" }}>{d.title}</b>
                <span className="num">
                  {n(d.have)} / {n(d.milestone!.threshold)}
                </span>
                <span>{pct(d.frac)}</span>
              </div>
              <div className="progress">
                <i style={{ width: `${d.frac * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <h2>Challenges · {cleared} of {chall.length}</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Challenge</th>
              <th>Tier</th>
              <th className="r">Clears</th>
              <th className="r">Attempts</th>
            </tr>
          </thead>
          <tbody>
            {chall.map((c) => {
              const clears = counters[c.clearsCounter] ?? 0;
              const attempts = counters[c.attemptsCounter] ?? 0;
              return (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b> <span className="muted">{c.premise}</span>
                  </td>
                  <td className="muted">{c.tier}</td>
                  <td className={`r num ${clears > 0 ? "win" : ""}`}>{clears > 0 ? n(clears) : attempts > 0 ? "not yet" : ""}</td>
                  <td className="r num">{attempts > 0 ? n(attempts) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="two" style={{ marginTop: 28 }}>
        <div className="card">
          <h3>Companions</h3>
          {companions.length === 0 ? <p className="hint">Hasn't shared a skirmish room with another account.</p> : null}
          {companions
            .sort((a, b) => b.withCount + b.againstCount - (a.withCount + a.againstCount))
            .map((c) => (
              <div key={c.otherId} className="stamps" style={{ marginBottom: 4 }}>
                <PlayerLink id={c.otherId} name={names.get(c.otherId)} />
                <span>
                  {c.withCount} beside · {c.againstCount} against
                </span>
              </div>
            ))}
        </div>
        <div className="card">
          <h3>Codes</h3>
          {codes.length === 0 ? <p className="hint">None redeemed.</p> : null}
          {codes.map((c) => (
            <div key={c.code} className="stamps" style={{ marginBottom: 4 }}>
              <code>{c.display}</code>
              <span>{c.kind}</span>
              <span>
                {c.glory > 0 ? `+${c.glory} G ` : ""}
                {c.signets > 0 ? `+${c.signets} S` : ""}
              </span>
              <span title={when(c.at)}>{date(c.at)}</span>
            </div>
          ))}
        </div>
      </div>

      <h2>Feedback · {feedback.length}</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {feedback.map((r) => (
          <div className="card" key={r.id}>
            <div className="stamps">
              <span className={`pill ${r.kind === "bug" ? "bad" : r.kind === "idea" ? "ok" : ""}`}>{r.kind}</span>
              <span title={when(r.createdAt)}>{ago(r.createdAt, now)}</span>
              {r.platform ? (
                <span>
                  {r.platform} {r.osVersion ?? ""}
                </span>
              ) : null}
              {r.appBinary ? <span>{r.appBinary}</span> : null}
              {r.rttMs !== null ? <span>ping {r.rttMs} ms</span> : null}
              <span className="mono">#{r.id}</span>
            </div>
            <p className="msg">{r.message}</p>
          </div>
        ))}
        {feedback.length === 0 ? <p className="hint">Nothing sent.</p> : null}
      </div>
    </>
  );
}
