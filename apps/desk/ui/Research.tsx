import { Fragment, useMemo, useState } from "react";
import type { GameApi, Script } from "./api";
import { type Finding, type ResearchState, type ScriptResearch, findingsWanted, forTheDoc, normal, sentences, sourcesBlock, weave } from "../lib/research";
import { spokenSeconds } from "../lib/scripts";
import { spokenText, stripMarks } from "../lib/doc";

/**
 * Research on the draft (docs/design/desk-research.md), under step 1: one
 * press, then the paste as reading text with each finding in place after
 * the sentence it backs up. Accept puts it into what the rewrite reads;
 * the paste in the box stays exactly what came from the Google Doc.
 */
export const ResearchPanel: React.FC<{
  api: GameApi;
  id: string;
  s: Script;
  claude: boolean;
  running: ResearchState | null;
  onStart: () => void;
  onResearch: (r: ScriptResearch) => void;
  onError: (e: string) => void;
}> = ({ api, id, s, claude, running, onStart, onResearch, onError }) => {
  const [copied, setCopied] = useState("");
  const [showMore, setShowMore] = useState(false);
  const r = s.research;
  const list = useMemo(() => sentences(s.source), [s.source]);
  const placed = useMemo(() => (r ? weave(s.source, r.findings).placed : new Map()), [r, s.source]);
  const decide = (f: Finding, d: { status?: string; text?: string; anchor?: string }) =>
    void api
      .decideFinding(id, f.id, d)
      .then(onResearch)
      .catch((e: Error) => onError(e.message));
  const copy = (what: string, text: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => (setCopied(what), setTimeout(() => setCopied(""), 1500)))
      .catch(() => onError("couldn't copy"));

  const want = findingsWanted(spokenSeconds(spokenText(s.source)));
  const busy = running?.state === "running";
  const inPlace = (r?.findings ?? []).filter((f) => f.status === "offered" || (f.status === "accepted" && placed.get(f.id) !== "lost"));
  const lost = (r?.findings ?? []).filter((f) => f.status === "accepted" && placed.get(f.id) === "lost");
  const more = (r?.findings ?? []).filter((f) => f.status === "more");
  const accepted = (r?.findings ?? []).filter((f) => f.status === "accepted");
  const waiting = (r?.findings ?? []).filter((f) => f.status === "offered").length;
  const forDoc = r ? forTheDoc(s.source, r.findings) : "";
  const sources = r ? sourcesBlock(s.source, r.findings) : "";

  return (
    <div className="research stack" style={{ gap: 10 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="row" style={{ gap: 10 }}>
          <strong className="small">Research</strong>
          <span className="small muted">
            {r ? `${accepted.length} in the script${waiting ? ` · ${waiting} to look at` : ""}` : `finds facts from real sources to back up your points, about ${want} for a script this long`}
          </span>
        </span>
        <button className={r ? "ghost small" : "small"} disabled={!claude || busy || !s.source.trim()} onClick={onStart} title={r ? "A fresh search. What you've accepted stays, and what you turned down isn't offered again." : "Takes a few minutes. Your words aren't touched: each finding is offered as a line or two to go after one of your sentences."}>
          {busy ? "researching…" : r ? "Research again" : "Research the draft"}
        </button>
      </div>
      {running?.state === "running" ? <div className="small muted">{running.stage}… ({minutesSince(running.startedAt)})</div> : null}
      {running?.state === "failed" ? <div className="small warn">✖ The research didn't finish: {running.error}</div> : null}
      {r ? (
        <div className="small muted">
          Ran {r.at.slice(0, 16).replace("T", " ")} · {r.searches} search{r.searches === 1 ? "" : "es"}
          {r.dropped ? ` · ${r.dropped} thrown out (the quote wasn't on its page)` : ""}
          {r.cost !== undefined ? ` · about $${r.cost.toFixed(2)}` : ""}
          {normal(r.source) !== normal(s.source) ? " · the script has changed since" : ""}
        </div>
      ) : null}

      {lost.map((f) => (
        <div key={f.id} className="finding lost stack" style={{ gap: 6 }}>
          <div className="small warn">Lost its place: the sentence it went after isn't in the script any more.</div>
          <div className="small muted">
            was after: <s>{stripMarks(f.anchor)}</s>
          </div>
          <div className="finding-text">{f.text}</div>
          <div className="row" style={{ gap: 8 }}>
            <select value="" onChange={(e) => e.target.value && decide(f, { anchor: e.target.value })} style={{ flex: 1 }}>
              <option value="">Put it after…</option>
              {list.map((x, i) => (
                <option key={i} value={x.text}>
                  {i + 1}. {stripMarks(x.text).length > 90 ? `${stripMarks(x.text).slice(0, 90)}…` : stripMarks(x.text)}
                </option>
              ))}
            </select>
            <button className="link small" onClick={() => decide(f, { status: "rejected" })}>
              drop it
            </button>
          </div>
        </div>
      ))}

      {inPlace.length ? <Draft source={s.source} list={list} findings={inPlace} placed={placed} onDecide={decide} /> : null}
      {r && !inPlace.length && !lost.length && !busy ? <div className="small muted">Nothing waiting. {more.length ? "There are more below." : ""}</div> : null}

      {more.length ? (
        <div className="fold">
          <button className="link small" onClick={() => setShowMore((v) => !v)}>
            {showMore ? "hide" : "show"} {more.length} more finding{more.length === 1 ? "" : "s"}
          </button>
          {showMore
            ? more.map((f) => (
                <div key={f.id} className="stack" style={{ gap: 4 }}>
                  <div className="small muted">after: {stripMarks(f.anchor)}</div>
                  <FindingCard f={f} placement={undefined} onDecide={decide} />
                </div>
              ))
            : null}
        </div>
      ) : null}

      {r?.unbacked.length ? (
        <div className="stack small" style={{ gap: 4 }}>
          <span className="muted">Couldn't find solid backing for these. Worth softening before you record:</span>
          {r.unbacked.map((u, i) => (
            <div key={i}>
              · {stripMarks(u.anchor)} <span className="muted">({u.claim})</span>
            </div>
          ))}
        </div>
      ) : null}

      {r && (forDoc || sources) ? (
        <div className="row small" style={{ gap: 14 }}>
          {forDoc ? (
            <button className="link small" onClick={() => copy("doc", forDoc)} title="Every accepted addition that isn't in your Google Doc yet, with the sentence it goes after.">
              {copied === "doc" ? "copied" : "copy for the doc"}
            </button>
          ) : null}
          {sources ? (
            <button className="link small" onClick={() => copy("sources", sources)} title="One line per source you've used, for the YouTube description.">
              {copied === "sources" ? "copied" : "copy sources for the description"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const minutesSince = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/**
 * The paste as reading text, only the paragraphs that have something in
 * them (the rest folded to ⋯), each finding as a card after its sentence.
 */
const Draft: React.FC<{
  source: string;
  list: { text: string; start: number; end: number }[];
  findings: Finding[];
  placed: Map<string, string>;
  onDecide: (f: Finding, d: { status?: string; text?: string }) => void;
}> = ({ source, list, findings, placed, onDecide }) => {
  const at = new Map<number, Finding[]>();
  for (const f of findings) {
    const a = normal(f.anchor);
    const i = list.findIndex((x) => normal(x.text) === a);
    if (i >= 0) at.set(i, [...(at.get(i) ?? []), f]);
  }
  // Paragraphs: a run of sentences with no line break between them.
  const paras: number[][] = [];
  list.forEach((x, i) => {
    const gap = i ? source.slice(list[i - 1]!.end, x.start) : "\n";
    if (gap.includes("\n") || !paras.length) paras.push([i]);
    else paras.at(-1)!.push(i);
  });
  const out: React.ReactNode[] = [];
  let folded = false;
  paras.forEach((p, k) => {
    if (!p.some((i) => at.has(i))) {
      if (!folded) out.push(<div key={`f${k}`} className="muted small">⋯</div>);
      folded = true;
      return;
    }
    folded = false;
    out.push(
      <div key={k} className="draft-para">
        {p.map((i) => (
          <Fragment key={i}>
            <span className={at.has(i) ? "anchor" : ""}>{stripMarks(list[i]!.text)}</span>{" "}
            {(at.get(i) ?? []).map((f) => (
              <FindingCard key={f.id} f={f} placement={placed.get(f.id)} onDecide={onDecide} />
            ))}
          </Fragment>
        ))}
      </div>,
    );
  });
  return <div className="draft stack" style={{ gap: 10 }}>{out}</div>;
};

const STANCE_LABEL: Record<Finding["stance"], string> = { supports: "backs this up", concedes: "a fair point against", refutes: "cuts against your point" };

/** One finding: the words to say (or, against the point, a note), the source and its quote, and Tom's call. */
const FindingCard: React.FC<{ f: Finding; placement: string | undefined; onDecide: (f: Finding, d: { status?: string; text?: string }) => void }> = ({ f, placement, onDecide }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(f.text);
  const [showQuote, setShowQuote] = useState(false);
  const against = f.stance === "refutes";
  const accepted = f.status === "accepted";
  return (
    <div className={`finding stack ${against ? "against" : accepted ? "accepted" : ""}`} style={{ gap: 6 }}>
      <div className="row small" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className={against ? "warn" : "muted"}>{STANCE_LABEL[f.stance]}</span>
        {f.strength === "fair" ? <span className="muted">fair source</span> : null}
        {f.check === "unopened" ? <span className="warn" title="The Desk couldn't open the page to check the quote (a paywall, a PDF, or a site that blocks it). Open it and check yourself.">check this one yourself</span> : <span className="muted" title="The Desk found the quote on the page.">quote checked</span>}
        {accepted ? <span className="ok">{placement === "inDoc" ? "in your doc" : "in the script"}</span> : null}
      </div>
      {against ? (
        <div className="small">{f.note}</div>
      ) : editing ? (
        <textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (setEditing(false), setText(f.text))} />
      ) : (
        <div className="finding-text">{f.text}</div>
      )}
      {f.numberWarning && !against ? <div className="small warn">{f.numberWarning} isn't in the quote. Check the number before you say it.</div> : null}
      <div className="small muted">
        {f.source.publisher}
        {f.source.date ? ` · ${f.source.date}` : ""} ·{" "}
        <a href={f.source.url} target="_blank" rel="noreferrer">
          {f.source.title || f.source.url}
        </a>{" "}
        ·{" "}
        <button className="link small" onClick={() => setShowQuote((v) => !v)}>
          {showQuote ? "hide the quote" : "the quote"}
        </button>
      </div>
      {showQuote ? <blockquote className="small">{f.quote}</blockquote> : null}
      {!against && f.note && !showQuote ? <div className="small muted">{f.note}</div> : null}
      <div className="row small" style={{ gap: 12 }}>
        {against ? (
          <button className="ghost small" onClick={() => onDecide(f, { status: "noted" })}>
            Noted
          </button>
        ) : editing ? (
          <>
            <button className="small" disabled={!text.trim()} onClick={() => (onDecide(f, { text, status: "accepted" }), setEditing(false))}>
              {accepted ? "Save" : "Save and accept"}
            </button>
            <button className="link small" onClick={() => (setEditing(false), setText(f.text))}>
              cancel
            </button>
          </>
        ) : accepted ? (
          <>
            <button className="link small" onClick={() => (setText(f.text), setEditing(true))}>
              edit
            </button>
            <button className="link small" onClick={() => onDecide(f, { status: "offered" })} title="Out of the script, but kept here to think about.">
              take it out
            </button>
          </>
        ) : (
          <>
            <button className="small" onClick={() => onDecide(f, { status: "accepted" })}>
              Accept
            </button>
            <button className="ghost small" onClick={() => (setText(f.text), setEditing(true))}>
              Edit
            </button>
            <button className="link small" onClick={() => onDecide(f, { status: "rejected" })}>
              reject
            </button>
          </>
        )}
      </div>
    </div>
  );
};
