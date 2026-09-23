import { useEffect, useMemo, useState } from "react";
import { type Binned, type Clip, type GameApi, type GameInfo, fmtDate, fmtSeconds } from "./api";
import { go } from "./App";

const stem = (file: string) => file.replace(/\.[^.]+$/, "");

/**
 * The clip library, cuts up front: what you'd actually make a video from —
 * your cleaned-up cuts, plus any recording you haven't touched yet. A raw
 * drops out of the grid once it has a cut and lives under "Originals";
 * each cut links back to it. Binned recordings stay binned across syncs.
 */
export const Clips: React.FC<{ game: GameInfo; api: GameApi }> = ({ game, api }) => {
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [binned, setBinned] = useState<Binned[]>([]);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [showOriginals, setShowOriginals] = useState(false);
  const [showBin, setShowBin] = useState(false);
  const load = () => Promise.all([api.clips().then(setClips), api.bin().then(setBinned)]).catch((e) => setLog(String(e)));
  useEffect(() => void load(), []);

  const { front, originals, cutsOf } = useMemo(() => {
    const all = clips ?? [];
    const cutsOf = new Map<string, Clip[]>();
    for (const c of all) if (c.source) cutsOf.set(c.source, [...(cutsOf.get(c.source) ?? []), c]);
    return {
      front: all.filter((c) => c.source || !cutsOf.has(c.file)),
      originals: all.filter((c) => !c.source && cutsOf.has(c.file)),
      cutsOf,
    };
  }, [clips]);
  const byFile = (file: string) => clips?.find((c) => c.file === file);

  const sync = async (offline: boolean) => {
    setBusy(true);
    setLog(offline ? "re-probing…" : "checking the Drive folder…");
    try {
      const r = await api.sync(offline);
      setLog(r.log);
      await load();
    } catch (e) {
      setLog(`✖ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const bin = async (c: Clip) => {
    const cuts = cutsOf.get(c.file) ?? [];
    const warn = cuts.length ? `\n\n${cuts.length} cut${cuts.length === 1 ? "" : "s"} came from it (${cuts.map((x) => stem(x.file)).join(", ")}) — they keep working, but can't be re-cut.` : "";
    if (!confirm(`Bin ${c.file}?\n\nIt goes to ${game.footageDir}/.trash, not the void, and Sync won't bring it back from Drive.${warn}`)) return;
    await api.trashClip(c.file);
    await load();
  };
  const restore = async (b: Binned) => {
    const r = await api.restoreClip(b.file);
    setLog(r.onDisk ? `↩ ${b.file} is back in the library` : `↩ ${b.file} taken off the bin list — the next Sync from Drive fetches it again`);
    await load();
  };

  const card = (c: Clip) => {
    const cuts = cutsOf.get(c.file) ?? [];
    const original = c.source ? byFile(c.source) : undefined;
    return (
      <div className="card" key={c.file}>
        <div className="thumb" onClick={() => go({ name: "clean", file: c.file })} style={{ cursor: "pointer" }}>
          <img src={api.clipThumb(c.file, Math.min(c.facts.seconds * 0.3, 8))} alt="" loading="lazy" />
        </div>
        <div className="body">
          <div className="title" title={c.file}>
            {c.title || stem(c.file)}
          </div>
          <div className="small muted">
            {fmtSeconds(c.facts.seconds)} · {c.facts.width}×{c.facts.height} · {fmtDate(c.facts.recordedAt)}
          </div>
          {c.source ? (
            original ? (
              <button className="link small" onClick={() => go({ name: "clean", file: c.source!, from: c.file })} title={`Open ${c.source} with this cut's edit loaded`}>
                cut from {stem(c.source)} · re-cut ↗
              </button>
            ) : (
              <span className="small muted">cut from {stem(c.source)} (binned)</span>
            )
          ) : cuts.length ? (
            <span className="badge">{cuts.length} cut{cuts.length === 1 ? "" : "s"}</span>
          ) : (
            <span className="badge">raw · untouched</span>
          )}
          <div className="actions">
            <button className="small" onClick={() => go({ name: "make", file: c.file })}>
              Make a video
            </button>
            <button className="small ghost" onClick={() => go({ name: "clean", file: c.file })}>
              {c.source ? "Trim" : "Clean up"}
            </button>
            <button className="small danger" onClick={() => void bin(c)}>
              Bin
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between">
        <div>
          <h2>Clips</h2>
          <div className="muted small">
            Record on the phone, drop it in the{" "}
            <a href={`https://drive.google.com/drive/folders/${game.footageFolderId}`} target="_blank" rel="noreferrer">
              Drive footage folder
            </a>
            , press Sync. Clean a recording up and the cut takes its place here.
          </div>
        </div>
        <div className="row">
          <button className="ghost" disabled={busy} onClick={() => void sync(true)}>
            Re-probe disk
          </button>
          <button disabled={busy} onClick={() => void sync(false)}>
            {busy ? "Syncing…" : "Sync from Drive"}
          </button>
        </div>
      </div>
      {log ? <pre className="log small">{log}</pre> : null}
      {clips === null ? (
        <div className="muted">loading…</div>
      ) : front.length === 0 ? (
        <div className="panel muted">Nothing here yet. Drop a recording in the Drive folder and press Sync.</div>
      ) : (
        <div className="grid">{front.map(card)}</div>
      )}

      {originals.length ? (
        <section className="fold">
          <button className="link" onClick={() => setShowOriginals((v) => !v)}>
            {showOriginals ? "▾" : "▸"} Originals already cut ({originals.length})
          </button>
          {showOriginals ? (
            <>
              <div className="small muted">The raw recordings behind the cuts above. Clean up again for a different cut; Bin when you're done with one.</div>
              <div className="grid">{originals.map(card)}</div>
            </>
          ) : null}
        </section>
      ) : null}

      {binned.length ? (
        <section className="fold">
          <button className="link" onClick={() => setShowBin((v) => !v)}>
            {showBin ? "▾" : "▸"} Bin ({binned.length})
          </button>
          {showBin ? (
            <>
              <div className="small muted">Sync leaves these on Drive. Restore puts one back — from {game.footageDir}/.trash if it's still there, else Drive re-sends it next sync.</div>
              <div className="stack" style={{ gap: 6 }}>
                {binned.map((b) => (
                  <div className="row between panel" style={{ padding: "8px 14px" }} key={b.file}>
                    <span className="mono">
                      {b.file} <span className="muted">{b.onDisk ? "in .trash" : "not on disk"}</span>
                    </span>
                    <button className="small ghost" onClick={() => void restore(b)}>
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};
