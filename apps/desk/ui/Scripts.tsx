import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type GameApi, type GameInfo, type ScoreState, type Script, type ScriptPatch, type ScriptSummary, fmtDate } from "./api";
import { go } from "./App";
import { Markdown } from "./markdown";
import { type Palette, PicturesStep } from "./Pictures";
import { ThumbnailsStep } from "./Thumbnails";
import { Prompter } from "./Prompter";
import { ResearchPanel } from "./Research";
import { DocPicker } from "./DocPicker";
import { type ResearchState, wovenSource } from "../lib/research";
import { spokenText } from "../lib/doc";
import { type Beat, type Cut, type DiffOp, beatText, cutDiff, cutText, isStale, newId, paragraphs, spokenSeconds } from "../lib/scripts";

/**
 * The Scripts tab (docs/design/desk-scripts.md): the list down the left
 * (a script with only a title is an idea, as before), the script on the
 * right in steps: the source (pasted, saves itself), the rewrite (the long
 * cut and the shorts, as beats, in the game's voice), the review (each
 * beat against the paragraph it came from, what changed lit up, keep
 * mine, change it), the pictures (docs/design/desk-ascii-scripts.md: one
 * per beat, built out of glyphs, plus the music's mood and the chapters),
 * the prompter and organise.
 */
export const Scripts: React.FC<{ game: GameInfo; api: GameApi; id?: string }> = ({ api, id }) => {
  const [list, setList] = useState<ScriptSummary[] | null>(null);
  const [claude, setClaude] = useState(false);
  const [images, setImages] = useState(false);
  const [palette, setPalette] = useState<Palette>("matrix");
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState("");
  const [picking, setPicking] = useState(false);
  // The edits made from each script (script id → edits), to jump to from its row.
  const [edits, setEdits] = useState<Map<string, { id: string; name: string }[]>>(new Map());
  const refresh = useCallback(() => api.scripts().then((r) => (setList(r.list), setClaude(r.claude), setImages(r.images), setPalette(r.palette))), [api]);
  useEffect(() => void refresh().catch((e: Error) => setMsg(e.message)), [refresh]);
  useEffect(() => {
    void api
      .sequences()
      .then((l) => {
        const m = new Map<string, { id: string; name: string }[]>();
        for (const s of l) if (s.idea) m.set(s.idea, [...(m.get(s.idea) ?? []), { id: s.id, name: s.name }]);
        setEdits(m);
      })
      .catch(() => {});
  }, [api]);

  const add = async () => {
    if (!title.trim()) return;
    try {
      const s = await api.addScript(title);
      setTitle("");
      await refresh();
      go({ name: "scripts", id: s.id });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  /** A new script from a Google Doc: made, then the Doc pulled into it. */
  const fromDoc = async (doc: { id: string; name: string }) => {
    setPicking(false);
    try {
      const s = await api.addScript(doc.name);
      await api.pullDoc(s.id, doc.id);
      await refresh();
      go({ name: "scripts", id: s.id });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  if (!list) return <div className="muted">loading…</div>;
  const open = list.filter((s) => !s.done);
  const done = list.filter((s) => s.done);
  const row = (s: ScriptSummary) => (
    <a key={s.id} href={`#${location.hash.split("/")[0]!.slice(1)}/scripts/${encodeURIComponent(s.id)}`} className={`script-row ${s.id === id ? "on" : ""} ${s.done ? "done" : ""}`}>
      <span className="first">{s.title}</span>
      <span className="small muted">
        {s.done ? "made" : !s.hasSource ? "an idea" : !s.hasCuts ? "written, not rewritten" : s.stale ? "source changed since the rewrite" : "rewritten"}
      </span>
    </a>
  );
  return (
    <div className="scripts">
      <div className="stack script-list">
        <h2>Scripts</h2>
        <div className="row" style={{ gap: 6 }}>
          <input type="text" placeholder="A video worth making" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
          <button className="small" onClick={() => void add()} disabled={!title.trim()}>
            Add
          </button>
        </div>
        <button className="ghost small" onClick={() => setPicking(true)} title="A new script from a Google Doc in the Video Scripts folder: its headings and formatting come with it, and Pull the latest replaces re-pasting.">
          From a Google Doc…
        </button>
        {picking ? <DocPicker api={api} onPick={(d) => void fromDoc(d)} onClose={() => setPicking(false)} /> : null}
        {msg ? <div className="warn small">{msg}</div> : null}
        {open.length === 0 ? <div className="muted small">Nothing waiting.</div> : open.map(row)}
        {done.length ? (
          <div className="fold">
            <button className="link small" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "hide" : "show"} {done.length} made
            </button>
            {showDone ? done.map(row) : null}
          </div>
        ) : null}
      </div>
      <div className="script-page">
        {id ? <ScriptPage key={id} api={api} id={id} claude={claude} images={images} palette={palette} edits={edits.get(id) ?? []} onChanged={() => void refresh().catch(() => {})} /> : <div className="muted">Pick a script, or add one. Paste what you wrote and the Desk turns it into beats, each with a picture built out of glyphs.</div>}
      </div>
    </div>
  );
};

type Busy = "" | "rewrite" | "adjust" | string;

const ScriptPage: React.FC<{ api: GameApi; id: string; claude: boolean; images: boolean; palette: Palette; edits: { id: string; name: string }[]; onChanged: () => void }> = ({ api, id, claude, images, palette, edits, onChanged }) => {
  const [s, setS] = useState<Script | null>(null);
  // Pictures being made on the server right now ("<beat>:<k>"); while any are, the page polls and folds them in.
  const [pending, setPending] = useState<string[]>([]);
  // The newest edit's score: making, made, or failed (desk-ascii-scripts.md § The score).
  const [score, setScore] = useState<ScoreState | null>(null);
  // A research run going (or just failed) on the server (desk-research.md).
  const [researching, setResearching] = useState<ResearchState | null>(null);
  // The Doc picker (desk-docs.md), and whether the linked Doc has been edited in Drive since the last pull.
  const [picking, setPicking] = useState(false);
  const [docChanged, setDocChanged] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<Busy>("");
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "failed">("");
  const [sure, setSure] = useState(false);
  const [made, setMade] = useState<{ cut: string; title: string; id: string; missing: string[]; conflicts: { beat: string; takes: string[] }[]; youtube: string }[] | null>(null);
  const saved = useRef("");
  useEffect(() => {
    void api
      .script(id)
      .then(({ pending: p, score: sc, researching: rs, ...x }) => {
        saved.current = JSON.stringify(patchOf(x));
        setS(x);
        setPending(p);
        setScore(sc);
        setResearching(rs);
        if (x.doc) {
          const pulled = x.doc.modified;
          void api
            .docModified(id)
            .then((r) => setDocChanged(Boolean(r.modified && r.modified > pulled)))
            .catch(() => {});
        }
      })
      .catch((e: Error) => setErr(e.message));
  }, [api, id]);
  // Pictures land in the background: poll while any are in flight and take their src (and errors) into the page's copy.
  useEffect(() => {
    if (!pending.length) return;
    const t = setInterval(() => {
      void api
        .script(id)
        .then(({ pending: p, score: _sc, ...x }) => {
          setPending(p);
          const fresh = new Map((x.long?.beats ?? []).map((b) => [b.id, b.pictures ?? []] as const));
          setS((cur) => {
            if (!cur) return cur;
            // New candidates (and the server's choice of them, and errors) come in; the page's own edits stay.
            const fold = (c: Cut): Cut => ({ ...c, beats: c.beats.map((b) => {
              const f = fresh.get(b.id);
              if (!f?.length || !b.pictures) return b;
              return { ...b, pictures: b.pictures.map((p, k) => {
                const h = f[k];
                if (!h) return p;
                const missed = h.candidates.filter((c) => !p.candidates.includes(c));
                return missed.length || h.error !== p.error ? { ...p, candidates: [...p.candidates, ...missed], chosen: missed.length ? h.chosen : p.chosen, approved: missed.length ? false : p.approved, check: missed.length ? undefined : p.check, error: h.error } : p;
              }) };
            }) });
            // The thumbnail ideas the same way (desk-thumbnails.md).
            const freshThumbs = new Map((x.thumbnails ?? []).map((t) => [t.id, t] as const));
            const thumbnails = cur.thumbnails?.map((t) => {
              const h = freshThumbs.get(t.id);
              if (!h) return t;
              const missed = h.candidates.filter((c) => !t.candidates.includes(c));
              return missed.length || h.error !== t.error ? { ...t, candidates: [...t.candidates, ...missed], chosen: missed.length ? h.chosen : t.chosen, error: h.error } : t;
            });
            const next = { ...cur, long: cur.long ? fold(cur.long) : undefined, thumbnails };
            // What the server has is what's saved: don't let the fold look like an edit to save.
            saved.current = JSON.stringify(patchOf(next));
            return next;
          });
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [pending.length, api, id]);

  // A score being made: ask after it every few seconds until it's in.
  const askScore = useCallback(() => void api.script(id).then((r) => setScore(r.score)).catch(() => {}), [api, id]);
  useEffect(() => {
    if (score?.state !== "making") return;
    const t = setInterval(askScore, 4000);
    return () => clearInterval(t);
  }, [score?.state, askScore]);

  // Research runs for minutes: ask after it every few seconds, and take the findings in when it's done (research isn't the page's to save).
  useEffect(() => {
    if (researching?.state !== "running") return;
    const t = setInterval(() => {
      void api
        .script(id)
        .then((r) => {
          setResearching(r.researching);
          if (r.researching?.state !== "running") setS((cur) => (cur ? { ...cur, research: r.research } : cur));
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [researching?.state, api, id]);

  // The script saves itself a moment after the last change (the title, the source, a beat edited by hand).
  useEffect(() => {
    if (!s) return;
    const patch = patchOf(s);
    const body = JSON.stringify(patch);
    if (body === saved.current) return;
    setSaveState("saving");
    const t = setTimeout(() => {
      api
        .updateScript(id, patch)
        .then(() => {
          saved.current = body;
          setSaveState("saved");
          onChanged();
        })
        .catch((e: Error) => {
          setSaveState("failed");
          setErr(e.message);
        });
    }, 600);
    return () => clearTimeout(t);
  }, [s, api, id, onChanged]);

  /** A server step: the whole script comes back; it's the saved state now. */
  const step = async (name: Busy, run: () => Promise<Script>) => {
    setBusy(name);
    setErr("");
    try {
      const x = await run();
      saved.current = JSON.stringify(patchOf(x));
      setS(x);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const patch = (p: Partial<Script>) => setS((x) => (x ? { ...x, ...p } : x));
  const setCut = (c: Cut) => setS((x) => (x ? (c.kind === "long" ? { ...x, long: c } : { ...x, shorts: x.shorts.map((y) => (y.id === c.id ? c : y)) }) : x));

  if (err && !s) return <div className="warn">{err}</div>;
  if (!s) return <div className="muted">loading…</div>;
  const stale = isStale(s);
  const paras = paragraphs(s.source);
  const tick = () =>
    void api
      .updateScript(id, { done: !s.done })
      .then((x) => {
        saved.current = JSON.stringify(patchOf(x));
        setS(x);
        onChanged();
      })
      .catch((e: Error) => setErr(e.message));
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row between">
        <input type="text" className="script-title" value={s.title} onChange={(e) => patch({ title: e.target.value })} placeholder="The video's working title" />
        <span className="row small muted" style={{ gap: 10 }}>
          {saveState === "saving" ? "saving…" : saveState === "failed" ? <span className="warn">not saved</span> : saveState === "saved" ? "saved" : ""}
          <button className="link small" onClick={tick}>
            {s.done ? "not made after all" : "tick it off: made"}
          </button>
          {sure ? (
            <>
              <button className="danger small" onClick={() => void api.removeScript(id).then(() => (onChanged(), go({ name: "scripts" }))).catch((e: Error) => setErr(e.message))}>
                delete
              </button>
              <button className="ghost small" onClick={() => setSure(false)}>
                keep
              </button>
            </>
          ) : (
            <button className="link small muted" onClick={() => setSure(true)}>
              delete…
            </button>
          )}
        </span>
      </div>
      {edits.length ? (
        <div className="small muted">
          {s.done ? "made as " : "being made as "}
          {edits.map((e, k) => (
            <span key={e.id}>
              {k ? ", " : ""}
              <button className="link small" onClick={() => go({ name: "edit", id: e.id })}>
                {e.name}
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {err ? <div className="warn small">{err}</div> : null}

      {/* ── 1. the source ── */}
      <Step n={1} title="The script" hint={s.source.trim() ? `${spokenSeconds(spokenText(s.source))}s read aloud · ${paras.length} paragraph${paras.length === 1 ? "" : "s"}` : "paste it from the doc"} open={!s.long}>
        {s.doc ? (
          <>
            <div className="row between small" style={{ flexWrap: "wrap", gap: 8 }}>
              <span className="muted">
                From the Google Doc{" "}
                <a href={`https://docs.google.com/document/d/${s.doc.id}/edit`} target="_blank" rel="noreferrer">
                  {s.doc.name}
                </a>{" "}
                · pulled {fmtDate(s.doc.pulledAt)}
                {docChanged ? <span className="warn"> · edited in Drive since</span> : null}
              </span>
              <span className="row" style={{ gap: 12 }}>
                <button
                  className={docChanged ? "small" : "ghost small"}
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void step("pull", async () => {
                      const x = await api.pullDoc(id);
                      setDocChanged(false);
                      return x;
                    })
                  }
                  title="The Doc's words as they are in Drive now. Your research and the cuts stay; if the words changed, Adjust the cuts follows the change."
                >
                  {busy === "pull" ? "pulling…" : "Pull the latest"}
                </button>
                <button className="link small" onClick={() => setPicking(true)}>
                  a different Doc…
                </button>
                <button className="link small muted" onClick={() => void step("unlink", () => api.unlinkDoc(id))} title="Forget the Doc: the words stay here and the box is editable again.">
                  unlink
                </button>
              </span>
            </div>
            <Markdown className="desc script-doc" text={s.source} />
          </>
        ) : (
          <>
            <textarea className="script-source" rows={s.long ? 8 : 16} value={s.source} onChange={(e) => patch({ source: e.target.value })} placeholder="Paste the script here. Paragraphs as you wrote them; it saves as you go." />
            <div className="small">
              <button className="link small" onClick={() => setPicking(true)} title="Pull a Google Doc from the Video Scripts folder instead: its headings and formatting come with it, and Pull the latest replaces re-pasting.">
                or pull it from a Google Doc…
              </button>
            </div>
          </>
        )}
        {picking ? <DocPicker api={api} current={s.doc?.id} onPick={(d) => (setPicking(false), void step("pull", () => api.pullDoc(id, d.id)))} onClose={() => setPicking(false)} /> : null}
        <div className="row">
          {!s.long ? (
            <button onClick={() => void step("rewrite", () => api.rewriteScript(id))} disabled={!claude || !s.source.trim() || Boolean(busy)} title={claude ? "" : "Needs ANTHROPIC_API_KEY in apps/desk/.env and a script voice in the game's desk.config"}>
              {busy === "rewrite" ? "rewriting…" : "Rewrite into cuts"}
            </button>
          ) : stale ? (
            <>
              <button onClick={() => void step("adjust", () => api.adjustScript(id))} disabled={!claude || Boolean(busy)}>
                {busy === "adjust" ? "adjusting…" : "Adjust the cuts to the change"}
              </button>
              <span className="small muted">The script changed since the cuts were made. Adjust keeps every beat whose point still stands.</span>
            </>
          ) : (
            <button className="ghost small" onClick={() => void step("rewrite", () => api.rewriteScript(id))} disabled={!claude || Boolean(busy)} title="Throws the cuts away and starts again from the script.">
              {busy === "rewrite" ? "rewriting…" : "Rewrite from scratch"}
            </button>
          )}
          {!claude ? <span className="small warn">The rewrite steps need ANTHROPIC_API_KEY in apps/desk/.env and a script voice in the game's desk.config.</span> : null}
        </div>
        <ResearchPanel
          api={api}
          id={id}
          s={s}
          claude={claude}
          running={researching}
          onStart={() =>
            void api
              .research(id)
              .then(setResearching)
              .catch((e: Error) => setErr(e.message))
          }
          onResearch={(research) => setS((cur) => (cur ? { ...cur, research } : cur))}
          onError={setErr}
        />
      </Step>

      {/* ── 2. the cuts ── */}
      {s.long ? (
        <Step n={2} title="The long cut" hint={`${s.long.beats.length} beats · ${spokenSeconds(cutText(s, s.long))}s`} open>
          <CutView s={s} cut={s.long} paras={paras} busy={busy} onChange={setCut} onRedoBeat={(b, i) => void step(`beat:${b}`, () => api.redoBeat(id, s.long!.id, b, i))} onRedoCut={(i) => void step(`cut:${s.long!.id}`, () => api.redoCut(id, s.long!.id, i))} />
        </Step>
      ) : null}
      {s.long ? (
        <Step n={3} title="The pictures" hint={picturesHint(s, pending)} open={s.long.beats.some((b) => b.pictures?.length)}>
          <PicturesStep
            s={s}
            api={api}
            claude={claude}
            images={images}
            palette={palette}
            busy={busy}
            pending={pending}
            onBeat={(beatId, f) => setS((cur) => (cur?.long ? { ...cur, long: { ...cur.long, beats: cur.long.beats.map((b) => (b.id === beatId ? f(b) : b)) } } : cur))}
            onPlan={(all) => void step("plan", () => api.planPictures(id, all))}
            onTheme={(theme) => patch({ theme })}
            onMake={(only) =>
              void api
                .makePictures(id, only)
                .then((r) => {
                  if (!r.started) return setErr(only ? "Nothing to make there: give the picture a prompt first." : "Every picture is already made. Press again on one to try another.");
                  const keys = only ? only.map((o) => `${o.beat}:${o.k}`) : (s.long?.beats ?? []).flatMap((b) => (b.pictures ?? []).flatMap((p, k) => (p.prompt.trim() && !p.candidates.length ? [`${b.id}:${k}`] : [])));
                  setPending((p) => [...new Set([...p, ...keys])]);
                })
                .catch((e: Error) => setErr(e.message))
            }
            onOwn={(beat, k, file) => void step(`own:${beat}`, () => api.ownPicture(id, beat, k, file))}
            onNewPrompt={(beat, k, instruction) => void step(`prompt:${beat}:${k}`, () => api.newPicturePrompt(id, beat, k, instruction))}
          />
        </Step>
      ) : null}
      {s.long ? (
        <Step n={4} title="Record" hint={s.takes.length ? `${s.takes.length} take${s.takes.length === 1 ? "" : "s"}` : "nothing recorded yet"} open={false}>
          <Prompter
            api={api}
            s={s}
            id={id}
            onTakes={(takes) => patch({ takes })}
            onReplace={(x) => {
              saved.current = JSON.stringify(patchOf(x));
              setS(x);
            }}
            onError={setErr}
          />
        </Step>
      ) : null}
      {s.long ? (
        <Step n={5} title="Organise" hint={s.sequences?.length ? `${s.sequences.length} edit${s.sequences.length === 1 ? "" : "s"} made` : "not yet"} open={false}>
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 12 }}>
              <button
                disabled={!s.takes.length || Boolean(busy)}
                title="The long cut becomes a fresh edit: the takes sliced per beat in order, each beat's chosen picture as a glyph build at its start (a long beat's two split at its middle sentence), a marker per beat. Edits from an earlier run are never touched."
                onClick={() =>
                  void step("organise", async () => {
                    const r = await api.organise(id);
                    setMade(r.made);
                    setTimeout(askScore, 300);
                    return r.script;
                  })
                }
              >
                {busy === "organise" ? "organising…" : "Organise into edits"}
              </button>
              <label className="row small muted" style={{ gap: 6 }}>
                gap between beats
                <input type="number" min={0} max={3} step={0.1} value={s.gap} onChange={(e) => patch({ gap: Math.max(0, Math.min(3, Number(e.target.value) || 0)) })} style={{ width: 70 }} />
                s
              </label>
              {!s.takes.length ? <span className="small muted">Record something first.</span> : null}
            </div>
            {made ? (
              <div className="stack" style={{ gap: 6 }}>
                {made.map((m) => (
                  <div key={m.id} className="small">
                    <button className="link small" onClick={() => go({ name: "edit", id: m.id })}>
                      {m.title || m.id}
                    </button>
                    {m.missing.length ? <span className="warn"> · {m.missing.length} beat{m.missing.length === 1 ? "" : "s"} not recorded (skipped)</span> : null}
                    {m.conflicts.length ? <span className="warn"> · {m.conflicts.length} beat{m.conflicts.length === 1 ? "" : "s"} read in two takes (skipped: delete one and organise again)</span> : null}
                    {!m.missing.length && !m.conflicts.length ? <span className="muted"> · every beat in</span> : null}
                  </div>
                ))}
                <div className="small muted">Open the edit, check it, then Done › to Make with the Beats template: the title builds out of glyphs, then each picture while you say its beat, your words along the foot, a card for each chapter, and the end card. (The generated score is the next stage of desk-ascii-scripts.md.)</div>
                {made.find((m) => m.youtube) ? <YouTubeChapters text={made.find((m) => m.youtube)!.youtube} /> : null}
              </div>
            ) : null}
            {s.sequences?.length ? (
              <ScorePanel
                api={api}
                score={score}
                busy={busy}
                onRemake={(another) =>
                  void step(another ? "another" : "rescore", async () => {
                    const x = await api.remakeScore(id, another);
                    setTimeout(askScore, 300);
                    return x;
                  })
                }
              />
            ) : null}
            {!made && s.sequences?.at(-1)?.youtube ? <YouTubeChapters text={s.sequences.at(-1)!.youtube!} /> : null}
            {s.sequences?.length && !made ? (
              <div className="stack" style={{ gap: 4 }}>
                {[...s.sequences].reverse().slice(0, 8).map((x) => (
                  <div key={x.id} className="small">
                    <button className="link small" onClick={() => go({ name: "edit", id: x.id })}>
                      {x.id}
                    </button>
                    <span className="muted">
                      {" "}
                      · run {x.run} · {x.at.slice(0, 16).replace("T", " ")}
                      {x.missing ? ` · ${x.missing} not recorded` : ""}
                      {x.conflicts ? ` · ${x.conflicts} in two takes` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Step>
      ) : null}
      {s.long ? (
        <Step n={6} title="The title and thumbnail" hint={thumbnailsHint(s, pending)} open={Boolean(s.thumbnails?.length || s.titles?.length)}>
          <ThumbnailsStep
            s={s}
            api={api}
            claude={claude}
            images={images}
            busy={busy}
            pending={pending}
            onIdea={(ideaId, f) => setS((cur) => (cur ? { ...cur, thumbnails: (cur.thumbnails ?? []).map((t) => (t.id === ideaId ? f(t) : t)) } : cur))}
            onRemove={(ideaId) => setS((cur) => (cur ? { ...cur, thumbnails: (cur.thumbnails ?? []).filter((t) => t.id !== ideaId) } : cur))}
            onPlan={(instruction) => void step("thumbs", () => api.planThumbnails(id, instruction))}
            onMake={(only) =>
              void api
                .makeThumbnails(id, only)
                .then((r) => {
                  if (!r.started) return setErr(only ? "Nothing to make there: give the idea a prompt first." : "Every idea has a picture already. Press again on one to try another.");
                  const ids = only ?? (s.thumbnails ?? []).filter((t) => t.prompt.trim() && !t.candidates.length).map((t) => t.id);
                  setPending((p) => [...new Set([...p, ...ids.map((x) => `thumb:${x}`)])]);
                })
                .catch((e: Error) => setErr(e.message))
            }
            onOwn={(idea, file) => void step(`thumb-own:${idea}`, () => api.ownThumbnail(id, idea, file))}
            onTitles={(f) => setS((cur) => (cur ? { ...cur, titles: f(cur.titles ?? []) } : cur))}
            onPlanTitles={(instruction) => void step("titles", () => api.planTitles(id, instruction))}
          />
        </Step>
      ) : null}
      {s.long ? (
        <Step n={7} title="Description and tags" hint={s.youtube ? `${s.youtube.tags.split(",").filter((t) => t.trim()).length} tags` : "not written yet"} open={Boolean(s.youtube)}>
          <YouTubeStep
            youtube={s.youtube}
            chapters={s.sequences?.at(-1)?.youtube}
            claude={claude}
            busy={busy}
            onChange={(youtube) => patch({ youtube })}
            onWrite={(instruction) => void step("youtube", () => api.writeYouTube(id, instruction))}
          />
        </Step>
      ) : null}
    </div>
  );
};

const thumbnailsHint = (s: Script, pending: string[]): string => {
  const ideas = s.thumbnails ?? [];
  const titles = s.titles?.length ? `${s.titles.length} title${s.titles.length === 1 ? "" : "s"} to test · ` : "";
  if (!ideas.length) return `${titles}no thumbnail ideas yet`;
  const made = ideas.filter((t) => t.chosen).length;
  const making = pending.filter((k) => k.startsWith("thumb:")).length;
  return `${titles}${ideas.length} idea${ideas.length === 1 ? "" : "s"} · ${made} with a picture${making ? ` · ${making} making` : ""}`;
};

/**
 * The score under the newest edit: what the seed chose, a player, and
 * the two ways to make it again (for the edit as it is now, or a whole new
 * soundtrack). It's the edit's music bed already: Make plays it.
 */
const ScorePanel: React.FC<{ api: GameApi; score: ScoreState | null; busy: Busy; onRemake: (another: boolean) => void }> = ({ api, score, busy, onRemake }) => (
  <div className="panel stack" style={{ gap: 8 }}>
    <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
      <strong className="small">The score</strong>
      <span className="row" style={{ gap: 8 }}>
        <button className="ghost small" disabled={Boolean(busy) || score?.state === "making"} onClick={() => onRemake(false)} title="Write it again for the edit as it is now (after moving things in the editor). Same seed: the same piece, refitted.">
          Fit to the edit
        </button>
        <button className="ghost small" disabled={Boolean(busy) || score?.state === "making"} onClick={() => onRemake(true)} title="A new seed: a different key, tempo, style, instruments and theme.">
          Another soundtrack
        </button>
      </span>
    </div>
    {!score ? (
      <div className="small muted">Organise makes the score for the edit (about a minute for ten minutes of video). Press Fit to the edit if this Desk was restarted since.</div>
    ) : score.state === "making" ? (
      <div className="small muted">Writing the score… (seed {score.seed})</div>
    ) : score.state === "failed" ? (
      <div className="small warn">✖ {score.error}</div>
    ) : (
      <>
        {score.label ? <div className="small muted">{score.label}</div> : null}
        <audio controls preload="none" src={api.publicUrl(`music/${score.file}`)} style={{ width: "100%" }} />
        <div className="small muted">It's on the edit as its music bed, quiet; Beats ducks it a little more while you talk. A song you set on the edit yourself is never replaced.</div>
      </>
    )}
  </div>
);

/** The chapters as YouTube's description wants them (timestamps include the title's cold open). */
const YouTubeChapters: React.FC<{ text: string }> = ({ text }) => (
  <div className="panel stack" style={{ gap: 6 }}>
    <div className="row between">
      <strong className="small">Chapters for the YouTube description</strong>
      <button className="link small" onClick={() => void navigator.clipboard.writeText(text)}>
        copy
      </button>
    </div>
    <pre className="log small">{text}</pre>
  </div>
);

/**
 * The top of the long video's YouTube description and its tags: Claude
 * writes them from the long cut, Tom changes what he likes and copies them
 * across. The chapters (from the last organise) go under the lines, and his
 * own links and the rest under those, in YouTube.
 */
const YouTubeStep: React.FC<{ youtube?: { description: string; tags: string }; chapters?: string; claude: boolean; busy: Busy; onChange: (y: { description: string; tags: string }) => void; onWrite: (instruction: string) => void }> = ({ youtube, chapters, claude, busy, onChange, onWrite }) => {
  const [ask, setAsk] = useState("");
  const write = () => {
    onWrite(ask);
    setAsk("");
  };
  const tagsLength = (youtube?.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .reduce((n, t, i) => n + t.length + (t.includes(" ") ? 2 : 0) + (i ? 1 : 0), 0);
  const copy = (text: string) => void navigator.clipboard.writeText(text);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button onClick={write} disabled={!claude || Boolean(busy)} title="Claude reads the long cut and writes a couple of lines for the top of the description, plus the tags">
          {busy === "youtube" ? "writing…" : youtube ? "Write them again" : "Write them"}
        </button>
        <input type="text" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && claude && !busy && write()} placeholder='Steer it, or leave blank: "shorter", "mention the netcode"…' style={{ flex: 1, minWidth: 220, maxWidth: 460 }} />
      </div>
      {youtube ? (
        <>
          <div className="stack" style={{ gap: 4 }}>
            <div className="row between">
              <strong className="small">The top of the description</strong>
              <span className="row small" style={{ gap: 10 }}>
                <span className={youtube.description.length > 250 ? "warn" : "muted"}>{youtube.description.length} characters (about the first 120 show before "more")</span>
                <button className="link small" onClick={() => copy(youtube.description)}>
                  copy
                </button>
                {chapters ? (
                  <button className="link small" onClick={() => copy(`${youtube.description}\n\n${chapters}`)} title="These lines with the chapters under them">
                    copy with the chapters
                  </button>
                ) : null}
              </span>
            </div>
            <textarea rows={3} value={youtube.description} onChange={(e) => onChange({ ...youtube, description: e.target.value })} />
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <div className="row between">
              <strong className="small">Tags</strong>
              <span className="row small" style={{ gap: 10 }}>
                <span className={tagsLength > 500 ? "warn" : "muted"}>{tagsLength}/500</span>
                <button className="link small" onClick={() => copy(youtube.tags)} title="Paste into YouTube Studio's tags box: the commas split them">
                  copy
                </button>
              </span>
            </div>
            <textarea rows={2} value={youtube.tags} onChange={(e) => onChange({ ...youtube, tags: e.target.value })} />
          </div>
          {!chapters ? <div className="small muted">Organise once and the chapters show up here too, to copy under these lines.</div> : null}
        </>
      ) : (
        <div className="small muted">Claude writes a couple of lines about this video for the top of the description (the chapters go under them, your links and the rest under those) and the tags.</div>
      )}
    </div>
  );
};

const picturesHint = (s: Script, pending: string[]): string => {
  const beats = s.long?.beats ?? [];
  const pics = beats.flatMap((b) => b.pictures ?? []);
  if (!pics.length) return "not planned yet";
  return `${pics.filter((p) => p.chosen).length}/${pics.length} made · ${pics.filter((p) => p.approved).length} approved${pending.length ? ` · ${pending.length} making` : ""}`;
};

/** What the page saves of a script (the server owns the rest). */
const patchOf = (s: Script): ScriptPatch => ({ title: s.title, source: s.source, long: s.long, shorts: s.shorts, gap: s.gap, takes: s.takes, thumbnails: s.thumbnails, titles: s.titles, youtube: s.youtube, theme: s.theme ?? "" });

const Step: React.FC<{ n: number; title: string; hint?: string; open?: boolean; children: React.ReactNode }> = ({ n, title, hint, open = true, children }) => {
  const [show, setShow] = useState(open);
  return (
    <div className="panel stack script-step">
      <div className="row between" style={{ cursor: "pointer" }} onClick={() => setShow((v) => !v)}>
        <h3>
          <span className="muted">{n}.</span> {title}
        </h3>
        <span className="small muted">
          {hint} {show ? "▾" : "▸"}
        </span>
      </div>
      {show ? children : null}
    </div>
  );
};

/** A cut: its title (and hook), its beats each against the paragraph it came from. */
const CutView: React.FC<{
  s: Script;
  cut: Cut;
  paras: string[];
  busy: Busy;
  onChange: (c: Cut) => void;
  onRedoBeat: (beat: string, instruction: string) => void;
  onRedoCut: (instruction: string) => void;
}> = ({ s, cut, paras, busy, onChange, onRedoBeat, onRedoCut }) => {
  const [ask, setAsk] = useState("");
  // The whole script against the whole cut in one alignment, shared out to the beats (lib/scripts.ts cutDiff).
  const fits = useMemo(() => (cut.kind === "long" && s.source.trim() ? cutDiff(spokenText(wovenSource(s)), cut.beats.map((b) => beatText(s, b))) : null), [cut, s]);
  const setBeat = (b: Beat) => onChange({ ...cut, beats: cut.beats.map((x) => (x.id === b.id ? b : x)) });
  const dropBeat = (id: string) => onChange({ ...cut, beats: cut.beats.filter((x) => x.id !== id) });
  const addBeat = (after: number) => onChange({ ...cut, beats: [...cut.beats.slice(0, after + 1), { id: newId(), text: "", changed: true }, ...cut.beats.slice(after + 1)] });
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="fields">
        <label className={cut.kind === "long" ? "wide" : ""}>
          <span className="small muted">title</span>
          <input type="text" value={cut.title} onChange={(e) => onChange({ ...cut, title: e.target.value })} />
        </label>
        {cut.kind === "short" ? (
          <label>
            <span className="small muted">hook (said first, on screen from frame one)</span>
            <input type="text" value={cut.hook ?? ""} onChange={(e) => onChange({ ...cut, hook: e.target.value })} />
          </label>
        ) : null}
      </div>
      {cut.why ? <div className="small muted">{cut.why}</div> : null}
      <div className="beats">
        {cut.beats.map((b, i) => (
          <BeatRow key={b.id} s={s} cut={cut} beat={b} n={i + 1} fit={fits?.[i]} busy={busy === `beat:${b.id}`} onChange={setBeat} onDrop={() => dropBeat(b.id)} onAdd={() => addBeat(i)} onRedo={(ins) => onRedoBeat(b.id, ins)} />
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input type="text" placeholder={`Change the whole ${cut.kind} cut: "shorter", "lead with the bug", "less jokey"…`} value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask.trim() && (onRedoCut(ask), setAsk(""))} style={{ flex: 1 }} />
        <button className="ghost small" disabled={Boolean(busy) || !ask.trim()} onClick={() => (onRedoCut(ask), setAsk(""))}>
          {busy === `cut:${cut.id}` ? "writing…" : "Change it"}
        </button>
      </div>
    </div>
  );
};

/** One beat: the words (editable), what changed from the paragraph they came from, keep mine, change it. */
const BeatRow: React.FC<{
  s: Script;
  cut: Cut;
  beat: Beat;
  n: number;
  fit?: { ops: DiffOp[]; span: string };
  busy: boolean;
  onChange: (b: Beat) => void;
  onDrop: () => void;
  onAdd: () => void;
  onRedo: (instruction: string) => void;
}> = ({ s, cut, beat, n, fit, busy, onChange, onDrop, onAdd, onRedo }) => {
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState("");
  const [editing, setEditing] = useState(false);
  const text = beatText(s, beat);
  const shared = cut.kind === "short" && beat.from ? s.long?.beats.findIndex((x) => x.id === beat.from) : -1;
  const diff = fit?.ops ?? null;
  const changedFromSource = diff ? diff.some((d) => d.kind !== "same") : false;
  const longChanged = shared !== undefined && shared !== null && shared >= 0 ? s.long?.beats[shared]?.changed : false;
  return (
    <div className={`beat ${beat.changed || longChanged ? "changed" : ""}`}>
      <div className="beat-n small muted">{n}</div>
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        {editing ? (
          <textarea autoFocus rows={Math.max(2, Math.ceil(text.length / 90))} value={beat.from ? text : beat.text} onChange={(e) => onChange({ ...beat, text: e.target.value, from: undefined, changed: true })} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
        ) : (
          <div className="beat-text" onClick={() => setEditing(true)} title="click to edit">
            {diff && changedFromSource
              ? diff.map((d, k) =>
                  d.kind === "same" ? (
                    <span key={k}>{d.text} </span>
                  ) : d.kind === "added" ? (
                    <span key={k} className="added">
                      {d.text}{" "}
                    </span>
                  ) : (
                    <span key={k} className="removed">
                      {d.text}{" "}
                    </span>
                  ),
                )
              : text || <span className="muted">(empty: type the beat)</span>}
          </div>
        )}
        <div className="row small muted beat-tools" style={{ gap: 12 }}>
          <span>{spokenSeconds(text)}s</span>
          {shared !== undefined && shared !== null && shared >= 0 ? <span title="The same words as this long beat: one recording serves both.">same as long beat {shared + 1}</span> : null}
          {beat.changed || longChanged ? <span className="warn">changed</span> : null}
          {fit?.span && changedFromSource ? (
            <button className="link small" onClick={() => onChange({ ...beat, text: fit.span, from: undefined, changed: true })} title={`Back to your words for this beat, as you wrote them:\n${fit.span}`}>
              keep mine
            </button>
          ) : null}
          <button className="link small" onClick={() => setAsking((v) => !v)}>
            {busy ? "writing…" : "change…"}
          </button>
          <button className="link small" onClick={onAdd} title="A new, empty beat after this one">
            + beat
          </button>
          <button className="link small" onClick={onDrop} title="Take this beat out">
            ×
          </button>
        </div>
        {asking ? (
          <div className="row" style={{ gap: 6 }}>
            <input
              type="text"
              autoFocus
              placeholder='"plainer", "say why", "half as long"…'
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRedo(ask);
                  setAsk("");
                  setAsking(false);
                }
                if (e.key === "Escape") setAsking(false);
              }}
              style={{ flex: 1 }}
            />
            <button className="ghost small" disabled={busy} onClick={() => (onRedo(ask), setAsk(""), setAsking(false))}>
              Go
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** The long cut, or the source, as reading text: for the editor's Script panel. */
export const ScriptReading: React.FC<{ s: Script }> = ({ s }) =>
  s.long ? (
    <div className="stack" style={{ gap: 10 }}>
      {s.long.beats.map((b, i) => (
        <p key={b.id} className="beat-read">
          <span className="muted small">{i + 1} </span>
          {beatText(s, b)}
        </p>
      ))}
    </div>
  ) : s.source.trim() ? (
    <Markdown className="desc" text={s.source} />
  ) : (
    <div className="small muted">Nothing written for it yet. Paste the script on the Scripts tab and it shows here.</div>
  );

export const scriptLine = (s: ScriptSummary) => `${s.title}${s.done ? " ✓" : ""} · ${fmtDate(s.updatedAt)}`;
