import { useEffect, useState } from "react";
import { type Batch, type GameApi, type GameInfo, type Render, fmtBytes, fmtDate, fmtSeconds } from "./api";
import { go } from "./App";

/**
 * The finished library, one card per BATCH — the formats you rendered
 * together. Pick a format chip to play or download it; Upload pushes every
 * format not yet on Drive in one go; Re-open restores the whole batch in Make.
 */
export const Renders: React.FC<{ game: GameInfo; api: GameApi }> = ({ game, api }) => {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [active, setActive] = useState<Record<string, string>>({}); // batch id → slug shown
  const [playing, setPlaying] = useState<string | null>(null); // batch id
  const [msg, setMsg] = useState<Record<string, string>>({});
  const load = () => api.batches().then(setBatches);
  useEffect(() => void load(), [api]);

  const shown = (b: Batch): Render => b.renders.find((r) => r.slug === active[b.id]) ?? b.renders[0]!;
  const say = (id: string, text: string) => setMsg((m) => ({ ...m, [id]: text }));

  const upload = async (b: Batch, slugs: string[]) => {
    say(b.id, `uploading ${slugs.length}…`);
    const res = await api.upload(slugs).catch((e: Error) => ({ ok: false, log: e.message, uploaded: [] as string[] }));
    say(b.id, res.ok ? `✔ ${res.uploaded.length} on Drive` : `✖ ${res.log}`);
    await load();
  };
  const deleteBatch = async (b: Batch) => {
    const n = b.renders.length;
    if (!confirm(`Delete ${b.name} — ${n === 1 ? "its one render" : `all ${n} formats`} — for good?`)) return;
    await api.deleteBatch(b.id);
    await load();
  };
  const deleteOne = async (b: Batch, r: Render) => {
    if (!confirm(`Delete just the ${r.format} of ${b.name}?`)) return;
    await api.deleteRender(r.slug);
    await load();
  };

  if (!batches) return <div className="muted">loading…</div>;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between">
        <div>
          <h2>Renders</h2>
          <div className="muted small">Finished videos in {game.rendersDir}/, grouped by the render that made them. Upload pushes a batch to the game's Drive folder.</div>
        </div>
        <button onClick={() => go({ name: "make" })}>+ Make a video</button>
      </div>
      {batches.length === 0 ? (
        <div className="panel muted">Nothing rendered yet.</div>
      ) : (
        <div className="grid">
          {batches.map((b) => {
            const r = shown(b);
            const pending = b.renders.filter((x) => !x.uploadedAt);
            const allUp = pending.length === 0;
            return (
              <div className="card" key={b.id}>
                <div className={`thumb ${r.format === "landscape" ? "wide" : r.format === "square" ? "square" : ""}`} onClick={() => setPlaying(playing === b.id ? null : b.id)} style={{ cursor: "pointer" }}>
                  {playing === b.id ? <video key={r.slug} src={api.renderUrl(r.slug)} controls autoPlay /> : <img src={api.renderThumb(r.slug)} alt="" loading="lazy" />}
                </div>
                <div className="body">
                  <div className="title" title={b.renders.map((x) => x.slug).join("\n")}>
                    {b.name}
                  </div>
                  <div className="small muted">
                    {b.template} · {fmtDate(b.renderedAt)}
                  </div>
                  <div className="chips">
                    {b.renders.map((x) => (
                      <button key={x.slug} className={`chip${x.slug === r.slug ? " on" : ""}`} onClick={() => setActive((a) => ({ ...a, [b.id]: x.slug }))} title={x.slug}>
                        {x.format}
                        {x.uploadedAt ? <span className="tick" title={`on Drive · ${fmtDate(x.uploadedAt)}`}>✔</span> : null}
                      </button>
                    ))}
                  </div>
                  <div className="small muted">
                    {r.width}×{r.height} · {fmtSeconds(r.seconds)} · {fmtBytes(r.bytes)}
                    {r.uploadedAt ? " · on Drive" : ""}
                  </div>
                  <div className="actions">
                    <a className="small" href={api.renderUrl(r.slug)} download>
                      <button className="small ghost">Download {r.format}</button>
                    </a>
                    <button className="small" onClick={() => void upload(b, allUp ? b.renders.map((x) => x.slug) : pending.map((x) => x.slug))}>
                      {allUp ? (b.renders.length === 1 ? "Re-upload" : "Re-upload all") : pending.length === b.renders.length ? (b.renders.length === 1 ? "Upload to Drive" : `Upload all ${b.renders.length} to Drive`) : `Upload ${pending.length} missing to Drive`}
                    </button>
                    <button className="small ghost" onClick={() => go({ name: "make", batch: b.id })}>
                      Re-open
                    </button>
                    <button className="small danger" onClick={() => void deleteBatch(b)}>
                      Delete{b.renders.length > 1 ? " all" : ""}
                    </button>
                    {b.renders.length > 1 ? (
                      <button className="small link" onClick={() => void deleteOne(b, r)}>
                        just the {r.format}
                      </button>
                    ) : null}
                  </div>
                  {msg[b.id] ? <div className="small muted">{msg[b.id]}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
