import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type GameApi, type GameInfo, type Script, type ScriptPatch, type ScriptSummary, fmtDate } from "./api";
import { go } from "./App";
import { Markdown } from "./markdown";
import { Prompter } from "./Prompter";
import { type Beat, type BeatCard, type Cut, beatText, cutText, isStale, newId, paragraphs, plannedBeats, shotList, sourceOf, spokenSeconds, wordDiff } from "../lib/scripts";

/**
 * The Scripts tab (docs/design/desk-scripts.md): the list down the left
 * (a script with only a title is an idea, as before), the script on the
 * right in steps: the source (pasted, saves itself), the rewrite (the long
 * cut and the shorts, as beats, in the game's voice), the review (each
 * beat against the paragraph it came from, what changed lit up, keep
 * mine, change it). Later stages add the visual plan, the prompter and
 * organise under it.
 */
export const Scripts: React.FC<{ game: GameInfo; api: GameApi; id?: string }> = ({ api, id }) => {
  const [list, setList] = useState<ScriptSummary[] | null>(null);
  const [claude, setClaude] = useState(false);
  const [images, setImages] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState("");
  // The edits made from each script (script id → edits), to jump to from its row.
  const [edits, setEdits] = useState<Map<string, { id: string; name: string }[]>>(new Map());
  const refresh = useCallback(() => api.scripts().then((r) => (setList(r.list), setClaude(r.claude), setImages(r.images))), [api]);
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

  if (!list) return <div className="muted">loading…</div>;
  const open = list.filter((s) => !s.done);
  const done = list.filter((s) => s.done);
  const row = (s: ScriptSummary) => (
    <a key={s.id} href={`#${location.hash.split("/")[0]!.slice(1)}/scripts/${encodeURIComponent(s.id)}`} className={`script-row ${s.id === id ? "on" : ""} ${s.done ? "done" : ""}`}>
      <span className="first">{s.title}</span>
      <span className="small muted">
        {s.done ? "made" : !s.hasSource ? "an idea" : !s.hasCuts ? "written, not rewritten" : s.stale ? "source changed since the rewrite" : `long + ${s.shorts} short${s.shorts === 1 ? "" : "s"}`}
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
        {id ? <ScriptPage key={id} api={api} id={id} claude={claude} images={images} edits={edits.get(id) ?? []} onChanged={() => void refresh().catch(() => {})} /> : <div className="muted">Pick a script, or add one. Paste what you wrote and the Desk turns it into a long cut and some shorts.</div>}
      </div>
    </div>
  );
};

type Busy = "" | "rewrite" | "adjust" | string;

const ScriptPage: React.FC<{ api: GameApi; id: string; claude: boolean; images: boolean; edits: { id: string; name: string }[]; onChanged: () => void }> = ({ api, id, claude, images, edits, onChanged }) => {
  const [s, setS] = useState<Script | null>(null);
  // Beats whose sketch is being made on the server right now; while any are, the page polls and folds the pictures in.
  const [pending, setPending] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<Busy>("");
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "failed">("");
  const [sure, setSure] = useState(false);
  const [made, setMade] = useState<{ cut: string; title: string; id: string; missing: string[]; conflicts: { beat: string; takes: string[] }[] }[] | null>(null);
  const saved = useRef("");
  useEffect(() => {
    void api
      .script(id)
      .then(({ pending: p, ...x }) => {
        saved.current = JSON.stringify(patchOf(x));
        setS(x);
        setPending(p);
      })
      .catch((e: Error) => setErr(e.message));
  }, [api, id]);
  // Pictures land in the background: poll while any are in flight and take their src (and errors) into the page's copy.
  useEffect(() => {
    if (!pending.length) return;
    const t = setInterval(() => {
      void api
        .script(id)
        .then(({ pending: p, ...x }) => {
          setPending(p);
          const fresh = new Map(cutsOfScript(x).flatMap((c) => c.beats.map((b) => [b.id, b.card] as const)));
          setS((cur) => {
            if (!cur) return cur;
            const fold = (c: Cut): Cut => ({ ...c, beats: c.beats.map((b) => {
              const f = fresh.get(b.id);
              return f && b.card && (f.src !== b.card.src || f.error !== b.card.error) ? { ...b, card: { ...b.card, src: f.src, error: f.error } } : b;
            }) });
            const next = { ...cur, long: cur.long ? fold(cur.long) : undefined, shorts: cur.shorts.map(fold) };
            // What the server has is what's saved: don't let the fold look like an edit to save.
            saved.current = JSON.stringify(patchOf(next));
            return next;
          });
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [pending.length, api, id]);

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
      <Step n={1} title="The script" hint={s.source.trim() ? `${spokenSeconds(s.source)}s read aloud · ${paras.length} paragraph${paras.length === 1 ? "" : "s"}` : "paste it from the doc"} open={!s.long}>
        <textarea className="script-source" rows={s.long ? 8 : 16} value={s.source} onChange={(e) => patch({ source: e.target.value })} placeholder="Paste the script here. Paragraphs as you wrote them; it saves as you go." />
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
      </Step>

      {/* ── 2. the cuts ── */}
      {s.long ? (
        <Step n={2} title="The long cut" hint={`${s.long.beats.length} beats · ${spokenSeconds(cutText(s, s.long))}s`} open>
          <CutView s={s} cut={s.long} paras={paras} busy={busy} onChange={setCut} onRedoBeat={(b, i) => void step(`beat:${b}`, () => api.redoBeat(id, s.long!.id, b, i))} onRedoCut={(i) => void step(`cut:${s.long!.id}`, () => api.redoCut(id, s.long!.id, i))} />
        </Step>
      ) : null}
      {s.long ? <ShortsStep s={s} busy={busy} setCut={setCut} patch={patch} paras={paras} api={api} id={id} step={step} /> : null}
      {s.long ? (
        <Step n={4} title="The visuals" hint={planHint(s, pending)} open={plannedBeats(s).some((x) => x.beat.card)}>
          <Plan
            s={s}
            api={api}
            id={id}
            claude={claude}
            images={images}
            busy={busy}
            pending={pending}
            onBeat={(beatId, card) => setS((cur) => (cur ? withBeatCard(cur, beatId, card) : cur))}
            onPlan={(all) => void step("plan", () => api.planVisuals(id, all))}
            onMake={(beats) =>
              void api
                .makeSketches(id, beats)
                .then((r) => {
                  if (!r.started) return setErr(beats ? "Nothing to make for that beat: give it a sketch prompt first." : "Every sketch is already made. Change a prompt and press again on its row.");
                  setPending((p) => [...new Set([...p, ...(beats ?? plannedBeats(s).filter((x) => x.beat.card?.kind === "sketch" && !x.beat.card.src).map((x) => x.beat.id))])]);
                })
                .catch((e: Error) => setErr(e.message))
            }
          />
        </Step>
      ) : null}
      {s.long ? (
        <Step n={5} title="Record" hint={s.takes.length ? `${s.takes.length} take${s.takes.length === 1 ? "" : "s"}` : "nothing recorded yet"} open={false}>
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
        <Step n={6} title="Organise" hint={s.sequences?.length ? `${s.sequences.length} edit${s.sequences.length === 1 ? "" : "s"} made` : "not yet"} open={false}>
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 12 }}>
              <button
                disabled={!s.takes.length || Boolean(busy)}
                title="Every cut becomes a fresh edit: the takes sliced per beat in order, the cards at each beat's start, a marker per beat. Edits from an earlier run are never touched."
                onClick={() =>
                  void step("organise", async () => {
                    const r = await api.organise(id);
                    setMade(r.made);
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
                <div className="small muted">Open an edit, drop footage onto the b-roll slots, pick a song, then Done › to Make: Talk for the long cut, any vertical template for a short.</div>
              </div>
            ) : null}
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
    </div>
  );
};

const ShortsStep: React.FC<{ s: Script; busy: Busy; setCut: (c: Cut) => void; patch: (p: Partial<Script>) => void; paras: string[]; api: GameApi; id: string; step: (name: Busy, run: () => Promise<Script>) => Promise<void> }> = ({ s, busy, setCut, patch, paras, api, id, step }) => (
  <Step n={3} title="The shorts" hint={s.shorts.length ? `${s.shorts.length}` : "none yet"} open>
    <Shorts s={s} busy={busy} onChange={setCut} onDrop={(c) => patch({ shorts: s.shorts.filter((x) => x.id !== c) })} onRedoBeat={(c, b, i) => void step(`beat:${b}`, () => api.redoBeat(id, c, b, i))} onRedoCut={(c, i) => void step(`cut:${c}`, () => api.redoCut(id, c, i))} onAnother={(i) => void step("short", () => api.anotherShort(id, i))} paras={paras} />
  </Step>
);

const cutsOfScript = (s: Pick<Script, "long" | "shorts">): Cut[] => [...(s.long ? [s.long] : []), ...s.shorts];
const withBeatCard = (s: Script, beatId: string, card: BeatCard | undefined): Script => {
  const map = (c: Cut): Cut => ({ ...c, beats: c.beats.map((b) => (b.id === beatId ? { ...b, card } : b)) });
  return { ...s, long: s.long ? map(s.long) : undefined, shorts: s.shorts.map(map) };
};
const planHint = (s: Script, pending: string[]): string => {
  const all = plannedBeats(s);
  const planned = all.filter((x) => x.beat.card).length;
  if (!planned) return "not planned yet";
  const sketches = all.filter((x) => x.beat.card?.kind === "sketch");
  const made = sketches.filter((x) => x.beat.card?.src).length;
  const broll = all.filter((x) => x.beat.card?.kind === "broll").length;
  return `${planned}/${all.length} planned · ${made}/${sketches.length} sketches made${pending.length ? ` (${pending.length} making)` : ""} · ${broll} to film`;
};

/** Step 4: a visual per beat. Pick what's on screen, edit its words or prompt or note, make the sketches, take the shot list out. */
const Plan: React.FC<{
  s: Script;
  api: GameApi;
  id: string;
  claude: boolean;
  images: boolean;
  busy: Busy;
  pending: string[];
  onBeat: (beatId: string, card: BeatCard | undefined) => void;
  onPlan: (all: boolean) => void;
  onMake: (beats?: string[]) => void;
}> = ({ s, api, claude, images, busy, pending, onBeat, onPlan, onMake }) => {
  const [shots, setShots] = useState(false);
  const rows = plannedBeats(s);
  const planned = rows.some((x) => x.beat.card);
  const toMake = rows.filter((x) => x.beat.card?.kind === "sketch" && x.beat.card.prompt?.trim() && !x.beat.card.src && !pending.includes(x.beat.id)).length;
  const list = shotList(s);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <button onClick={() => onPlan(planned)} disabled={!claude || Boolean(busy)} title={planned ? "Every beat planned again (sketches already made are kept where the beat stays a sketch)." : "Claude picks what's on screen for every beat: a few words, a sketch, footage to film, or nothing."}>
          {busy === "plan" ? "planning…" : planned ? "Plan again" : "Plan the visuals"}
        </button>
        {planned ? (
          <button className="ghost" onClick={() => onMake()} disabled={!images || !toMake} title={images ? "Every sketch not yet made, three at a time; each lands here as it finishes." : "Needs OPENAI_API_KEY in apps/desk/.env"}>
            {toMake ? `Make ${toMake} sketch${toMake === 1 ? "" : "es"}` : pending.length ? `making ${pending.length}…` : "Sketches made"}
          </button>
        ) : null}
        {list ? (
          <button className="ghost small" onClick={() => setShots((v) => !v)}>
            {shots ? "hide" : "show"} the shot list
          </button>
        ) : null}
        {!images ? <span className="small warn">Sketches need OPENAI_API_KEY in apps/desk/.env.</span> : null}
      </div>
      {shots && list ? (
        <div className="panel stack" style={{ gap: 8 }}>
          <div className="row between">
            <strong className="small">What to film</strong>
            <button className="link small" onClick={() => void navigator.clipboard.writeText(list)}>
              copy
            </button>
          </div>
          <pre className="log small" style={{ maxHeight: 400 }}>{list}</pre>
        </div>
      ) : null}
      {planned ? (
        <div className="beats">
          {rows.map(({ cut, beat }, i) => (
            <PlanRow key={beat.id} api={api} n={i + 1} cut={cut} beat={beat} making={pending.includes(beat.id)} onChange={(c) => onBeat(beat.id, c)} onMake={() => onMake([beat.id])} images={images} />
          ))}
        </div>
      ) : (
        <div className="small muted">Plan the visuals and each beat gets what's on screen while you say it: a few words, a simple sketch, a note of footage to film, or nothing. Change any of them, then make the sketches.</div>
      )}
    </div>
  );
};

const PlanRow: React.FC<{ api: GameApi; n: number; cut: Cut; beat: Beat; making: boolean; images: boolean; onChange: (c: BeatCard | undefined) => void; onMake: () => void }> = ({ api, n, cut, beat, making, images, onChange, onMake }) => {
  const card: BeatCard = beat.card ?? { kind: "none" };
  const set = (p: Partial<BeatCard>) => onChange({ ...card, ...p });
  const pickKind = (k: BeatCard["kind"]) => onChange({ kind: k, ...(k === "text" ? { text: card.text ?? "" } : k === "sketch" ? { prompt: card.prompt ?? "", src: card.src } : k === "broll" ? { note: card.note ?? "" } : {}) });
  return (
    <div className="beat plan-row">
      <div className="beat-n small muted">{cut.kind === "short" ? `s${n}` : n}</div>
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <div className="small muted plan-words">{beat.text}</div>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <select value={card.kind} onChange={(e) => pickKind(e.target.value as BeatCard["kind"])} style={{ width: "auto" }}>
            <option value="text">a few words</option>
            <option value="sketch">a sketch</option>
            <option value="broll">footage to film</option>
            <option value="none">nothing new</option>
          </select>
          {card.kind === "text" ? <input type="text" value={card.text ?? ""} onChange={(e) => set({ text: e.target.value })} placeholder="Two to six words on screen" style={{ flex: 1 }} /> : null}
          {card.kind === "sketch" ? <input type="text" value={card.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value, check: Boolean(card.src) })} placeholder="What to draw, one subject, one sentence" style={{ flex: 1 }} /> : null}
          {card.kind === "broll" ? <input type="text" value={card.note ?? ""} onChange={(e) => set({ note: e.target.value })} placeholder="What to film, and where to find it" style={{ flex: 1 }} /> : null}
          {card.kind === "sketch" ? (
            <button className="ghost small" onClick={onMake} disabled={!images || making || !card.prompt?.trim()} title={card.src ? "Another go at the picture (the old one is kept on disk)" : "Make this one now"}>
              {making ? "making…" : card.src ? "again" : "make"}
            </button>
          ) : null}
        </div>
        {card.kind === "sketch" && card.src ? (
          <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
            <img className="plan-sketch" src={api.publicUrl(card.src)} alt="" />
            {card.check ? <span className="small warn">The prompt changed since this was made.</span> : null}
          </div>
        ) : null}
        {card.error ? <div className="small warn">✖ {card.error}</div> : null}
      </div>
    </div>
  );
};

/** What the page saves of a script (the server owns the rest). */
const patchOf = (s: Script): ScriptPatch => ({ title: s.title, source: s.source, long: s.long, shorts: s.shorts, gap: s.gap, takes: s.takes });

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
          <BeatRow key={b.id} s={s} cut={cut} beat={b} n={i + 1} paras={paras} busy={busy === `beat:${b.id}`} onChange={setBeat} onDrop={() => dropBeat(b.id)} onAdd={() => addBeat(i)} onRedo={(ins) => onRedoBeat(b.id, ins)} />
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
  paras: string[];
  busy: boolean;
  onChange: (b: Beat) => void;
  onDrop: () => void;
  onAdd: () => void;
  onRedo: (instruction: string) => void;
}> = ({ s, cut, beat, n, paras, busy, onChange, onDrop, onAdd, onRedo }) => {
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState("");
  const [editing, setEditing] = useState(false);
  const text = beatText(s, beat);
  const shared = cut.kind === "short" && beat.from ? s.long?.beats.findIndex((x) => x.id === beat.from) : -1;
  const from = useMemo(() => (cut.kind === "long" ? sourceOf(text, paras) : undefined), [cut.kind, text, paras]);
  const diff = useMemo(() => (from ? wordDiff(from.text, text) : null), [from, text]);
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
          {from && changedFromSource ? (
            <button className="link small" onClick={() => onChange({ ...beat, text: from.text, from: undefined, changed: true })} title={`Back to the paragraph as you wrote it:\n${from.text}`}>
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

const Shorts: React.FC<{
  s: Script;
  paras: string[];
  busy: Busy;
  onChange: (c: Cut) => void;
  onDrop: (id: string) => void;
  onRedoBeat: (cut: string, beat: string, instruction: string) => void;
  onRedoCut: (cut: string, instruction: string) => void;
  onAnother: (instruction: string) => void;
}> = ({ s, paras, busy, onChange, onDrop, onRedoBeat, onRedoCut, onAnother }) => {
  const [tab, setTab] = useState(0);
  const [ask, setAsk] = useState("");
  const [sure, setSure] = useState(false);
  const cur = s.shorts[Math.min(tab, s.shorts.length - 1)];
  return (
    <div className="stack">
      <div className="row" style={{ gap: 6 }}>
        {s.shorts.map((c, i) => (
          <button key={c.id} className={`small ${c === cur ? "" : "ghost"}`} onClick={() => (setTab(i), setSure(false))}>
            {i + 1}. {c.title || "untitled"} · {spokenSeconds(cutText(s, c))}s
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <input type="text" placeholder="Another short about… (blank = whatever's left)" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (onAnother(ask), setAsk(""))} style={{ width: 300 }} />
        <button className="ghost small" disabled={Boolean(busy)} onClick={() => (onAnother(ask), setAsk(""))}>
          {busy === "short" ? "writing…" : "+ short"}
        </button>
      </div>
      {cur ? (
        <>
          <CutView s={s} cut={cur} paras={paras} busy={busy} onChange={onChange} onRedoBeat={(b, i) => onRedoBeat(cur.id, b, i)} onRedoCut={(i) => onRedoCut(cur.id, i)} />
          <div className="row">
            {sure ? (
              <>
                <button className="danger small" onClick={() => (onDrop(cur.id), setSure(false), setTab(0))}>
                  drop this short
                </button>
                <button className="ghost small" onClick={() => setSure(false)}>
                  keep
                </button>
              </>
            ) : (
              <button className="link small muted" onClick={() => setSure(true)}>
                drop this short…
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="small muted">No shorts came out of this one. Ask for one above and say what it should be about.</div>
      )}
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
