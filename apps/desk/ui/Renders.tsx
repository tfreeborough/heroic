import { useEffect, useState } from "react";
import { type Batch, type GameApi, type GameInfo, type Post, type Render, fmtBytes, fmtDate, fmtSeconds } from "./api";
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
  const [queued, setQueued] = useState<Post[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const load = () =>
    Promise.all([
      api.batches().then(setBatches),
      api.schedule().then((s) => {
        setQueued(s.posts);
        setIgnored(s.ignored);
      }),
    ]);
  useEffect(() => void load(), [api]);
  const postOf = (b: Batch) => queued.find((p) => p.batch === b.id);
  const isIgnored = (b: Batch) => ignored.includes(b.id);
  const queueable = (b: Batch) => !postOf(b) && !isIgnored(b);
  const ignore = async (b: Batch, on: boolean) => {
    await api.ignore(b.id, on).catch((e: Error) => say(b.id, `✖ ${e.message}`));
    say(b.id, on ? "ignored by the queue" : "");
    await load();
  };
  const queue = async (ids: string[]) => {
    const r = await api.queue(ids).catch((e: Error) => ({ placed: [], skipped: ids, error: e.message }) as { placed: Post[]; skipped: string[]; error?: string });
    for (const p of r.placed) say(p.batch, `✔ queued for ${p.day} ${p.slot + 1}`);
    if ("error" in r && r.error) for (const id of ids) say(id, `✖ ${r.error}`);
    await load();
  };

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
        <div className="row">
          {batches?.some(queueable) ? (
            <button className="ghost" onClick={() => void queue(batches.filter(queueable).map((b) => b.id))}>
              Queue all unqueued
            </button>
          ) : null}
          <button onClick={() => go({ name: "make" })}>+ Make a video</button>
        </div>
      </div>
      {batches.length === 0 ? (
        <div className="panel muted">Nothing rendered yet.</div>
      ) : (
        <div className="grid">
          {batches.map((b) => {
            const r = shown(b);
            const pending = b.renders.filter((x) => !x.uploadedAt);
            const allUp = pending.length === 0;
            const post = postOf(b);
            return (
              <div className="card" key={b.id}>
                <div className={`thumb ${r.format === "landscape" ? "wide" : r.format === "square" ? "square" : ""}`} onClick={() => setPlaying(playing === b.id ? null : b.id)} style={{ cursor: "pointer" }}>
                  {playing === b.id ? <video key={r.slug} src={api.renderUrl(r.slug)} controls autoPlay /> : <img src={api.renderThumb(r.slug)} alt="" loading="lazy" />}
                </div>
                <div className="body">
                  <div className="title" title={b.renders.map((x) => x.slug).join("\n")}>
                    {isIgnored(b) ? <span className="badge" style={{ marginRight: 6 }}>ignored</span> : null}
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
                    {post ? (
                      <button className="small ghost" onClick={() => go({ name: "queue" })} title={post.title}>
                        In queue · {post.day} {post.slot + 1}
                      </button>
                    ) : isIgnored(b) ? (
                      <button className="small ghost" onClick={() => void ignore(b, false)} title="An experiment: the queue leaves it alone. Click to let it be queued again">
                        Ignored · undo
                      </button>
                    ) : (
                      <>
                        <button className="small ghost" onClick={() => void queue([b.id])}>
                          Queue
                        </button>
                        <button className="small link" onClick={() => void ignore(b, true)} title="Keep this one out of the posting queue (an experiment, a test render)">
                          ignore
                        </button>
                      </>
                    )}
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
