import { useEffect, useMemo, useState } from "react";
import { type Clip, type GameApi, fmtDate, fmtSeconds, kindOf, shelfLabel, thumbOf } from "./api";

const stem = (file: string) => file.replace(/\.[^.]+$/, "");

type Filter = "edits" | "raw" | "rendered" | "all";
const FILTERS: { id: Filter; label: string; hint: string }[] = [
  { id: "edits", label: "Edits, not rendered", hint: "Edits you haven't made a video from yet." },
  { id: "raw", label: "Recordings", hint: "Raw footage, shelf by shelf. A video straight from one, or Edit it first." },
  { id: "rendered", label: "Already rendered", hint: "Edits and recordings some render already used." },
  { id: "all", label: "Everything", hint: "Every edit, recording and old cut on disk." },
];

/**
 * The Make screen's clip chooser: the same cards as the Clips tab, filtered
 * down to what you'd actually pick (an edit nobody's rendered yet) with the
 * rest one tab away. Recordings come shelf by shelf, as on the Clips tab.
 * Hover a card to play it.
 */
export const ClipPicker: React.FC<{
  api: GameApi;
  clips: Clip[];
  /** clip file → how many render batches used it. */
  renderedCount: Map<string, number>;
  current?: string;
  onPick: (file: string) => void;
  onClose: () => void;
  /** The tab it opens on (default: edits not rendered yet). */
  initial?: Filter;
  title?: string;
}> = ({ api, clips, renderedCount, current, onPick, onClose, initial = "edits", title = "Pick a clip" }) => {
  const [filter, setFilter] = useState<Filter>(initial);
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const newest = [...clips].sort((a, b) => (a.facts.recordedAt < b.facts.recordedAt ? 1 : -1));
    // Recordings shelf by shelf (Unsorted first, then A–Z), newest first within one.
    const shelfOrder = (a: Clip, b: Clip) => {
      const x = a.shelf ?? "";
      const y = b.shelf ?? "";
      return x === y ? 0 : x === "" ? -1 : y === "" ? 1 : x.localeCompare(y);
    };
    return {
      edits: newest.filter((c) => c.path && !renderedCount.has(c.file)),
      raw: newest.filter((c) => !c.source && !c.path).sort(shelfOrder),
      rendered: newest.filter((c) => renderedCount.has(c.file)),
      all: newest,
    } satisfies Record<Filter, Clip[]>;
  }, [clips, renderedCount]);

  const needle = q.trim().toLowerCase();
  const shown = groups[filter].filter((c) => !needle || `${c.title} ${c.file} ${c.source ?? ""} ${c.shelf ?? ""} ${c.note}`.toLowerCase().includes(needle));

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>{title}</h2>
          <button className="ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="row">
          <div className="chips">
            {FILTERS.map((f) => (
              <button key={f.id} className={`chip${filter === f.id ? " on" : ""}`} onClick={() => setFilter(f.id)} title={f.hint}>
                {f.label} <span className="muted">{groups[f.id].length}</span>
              </button>
            ))}
          </div>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search title, file, shelf or note…" style={{ maxWidth: 260, marginLeft: "auto" }} autoFocus />
        </div>
        <div className="small muted">{FILTERS.find((f) => f.id === filter)!.hint}</div>
        <div className="modal-body">
          {shown.length === 0 ? (
            <div className="panel muted">Nothing here{needle ? " matching that" : ""}.</div>
          ) : (
            <div className="grid">
              {shown.map((c) => {
                const n = renderedCount.get(c.file) ?? 0;
                return (
                  <div
                    className={`card pick${c.file === current ? " on" : ""}`}
                    key={c.file}
                    onClick={() => onPick(c.file)}
                    onMouseEnter={() => setHover(c.file)}
                    onMouseLeave={() => setHover((h) => (h === c.file ? null : h))}
                  >
                    <div className={`thumb${!c.path && c.facts.width > c.facts.height ? " wide" : ""}`}>
                      {hover === c.file ? (
                        <video src={c.video ?? api.clipUrl(c.file)} autoPlay muted loop playsInline poster={thumbOf(api, c)} />
                      ) : (
                        <img src={thumbOf(api, c)} alt="" loading="lazy" />
                      )}
                    </div>
                    <div className="body">
                      <div className="title" title={c.file}>
                        {c.title || stem(c.file)}
                      </div>
                      <div className="small muted">
                        {fmtSeconds(c.facts.seconds)} · {fmtDate(c.facts.recordedAt)}
                      </div>
                      <div className="small muted mono" title={c.file} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.path ? `edit · ${c.shots} shot${c.shots === 1 ? "" : "s"}, ${c.sources} recording${c.sources === 1 ? "" : "s"}` : c.source ? `old cut from ${stem(c.source)}` : `${shelfLabel(c.shelf)} · ${c.file}`}
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        {c.path ? <span className="badge ok">edit</span> : c.source ? <span className="badge">old cut</span> : <span className="badge">{kindOf(c)}</span>}
                        {n ? <span className="badge ok">rendered{n > 1 ? ` ×${n}` : ""}</span> : null}
                        {c.file === current ? <span className="badge ok">selected</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
