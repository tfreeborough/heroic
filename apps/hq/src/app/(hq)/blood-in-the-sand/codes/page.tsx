import { listCodes } from "@heroic/blood-in-the-sand-persistence";
import { db, nowS } from "@/lib/db";
import { date, n } from "@/lib/format";
import { mintAction, toggleAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function Codes({ searchParams }: { searchParams: Promise<{ minted?: string; error?: string }> }) {
  const { minted, error } = await searchParams;
  const codes = await listCodes(await db());
  const now = nowS();
  return (
    <>
      <h1>Codes</h1>
      <p className="sub">Promo codes (public, use-limited, dated) and tester codes (single use). Android only — iOS never sees the door.</p>

      {minted ? (
        <div className="banner">
          Minted. Copy them now — this is the only time they're shown together.
          <div className="codes">
            {minted.split(",").map((c) => (
              <code key={c}>{c}</code>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <div className="banner err">Refused: {error}</div> : null}

      <div className="card">
        <h3>Mint</h3>
        <form action={mintAction} className="form">
          <label>
            Kind
            <select name="kind" defaultValue="promo">
              <option value="promo">promo — public, needs a use limit and expiry</option>
              <option value="tester">tester — generated, single use</option>
            </select>
          </label>
          <label>
            Glory
            <input name="glory" type="number" min={0} defaultValue={0} />
          </label>
          <label>
            Signets
            <input name="signets" type="number" min={0} defaultValue={0} />
          </label>
          <label>
            Code (promo only, blank = generated)
            <input name="display" placeholder="LAUNCH-WEEK" />
          </label>
          <label>
            Use limit (promo)
            <input name="maxRedemptions" type="number" min={1} placeholder="e.g. 500" />
          </label>
          <label>
            Expires (promo)
            <input name="expiresAt" type="date" />
          </label>
          <label>
            How many (tester)
            <input name="count" type="number" min={1} max={100} placeholder="1" />
          </label>
          <label className="full">
            Note
            <input name="note" placeholder="who it's for, where it was posted" maxLength={200} />
          </label>
          <div>
            <button className="primary" type="submit">
              Mint
            </button>
          </div>
        </form>
      </div>

      <h2>All codes</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Kind</th>
              <th className="r">Pays</th>
              <th className="r">Used</th>
              <th>Expires</th>
              <th>Note</th>
              <th>Minted</th>
              <th>State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => {
              const expired = c.expiresAt !== null && c.expiresAt < now;
              const exhausted = c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions;
              const state = !c.active ? "off" : expired ? "expired" : exhausted ? "used up" : "live";
              return (
                <tr key={c.code}>
                  <td className="mono">{c.display}</td>
                  <td>{c.kind}</td>
                  <td className="r num">
                    {c.glory ? `${n(c.glory)} Glory` : ""}
                    {c.glory && c.signets ? " · " : ""}
                    {c.signets ? `${n(c.signets)} Signet${c.signets === 1 ? "" : "s"}` : ""}
                  </td>
                  <td className="r num">
                    {n(c.redemptions)}
                    {c.maxRedemptions !== null ? ` / ${n(c.maxRedemptions)}` : ""}
                  </td>
                  <td>{c.expiresAt !== null ? date(c.expiresAt) : "–"}</td>
                  <td className="muted">{c.note ?? ""}</td>
                  <td className="muted">{date(c.createdAt)}</td>
                  <td>
                    <span className={`pill ${state === "live" ? "ok" : state === "off" ? "bad" : ""}`}>{state}</span>
                  </td>
                  <td>
                    <form action={toggleAction} className="inline">
                      <input type="hidden" name="code" value={c.code} />
                      <input type="hidden" name="active" value={c.active ? "0" : "1"} />
                      <button className="ghost" type="submit">
                        {c.active ? "switch off" : "switch on"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {codes.length === 0 ? (
              <tr>
                <td colSpan={9} className="muted">
                  No codes yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
