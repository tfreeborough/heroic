import { useEffect, useMemo, useState } from "react";
import { type Clip, type GameApi, fmtDate, fmtSeconds } from "./api";

const stem = (file: string) => file.replace(/\.[^.]+$/, "");

type Filter = "ready" | "rendered" | "raw" | "all";
const FILTERS: { id: Filter; label: string; hint: string }[] = [
  { id: "ready", label: "Cut, not rendered", hint: "Cuts you've cleaned up but haven't made a video from yet." },
  { id: "rendered", label: "Already rendered", hint: "Cuts or recordings that some render already used." },
  { id: "raw", label: "Untouched raws", hint: "Recordings with no cut yet — clean them up first, usually." },
  { id: "all", label: "Everything", hint: "Every clip on disk, originals included." },
];

/**
 * The Make screen's clip chooser: the same cards as the Clips tab, filtered
 * down to what you'd actually pick (a cut nobody's rendered yet) with the
 * rest one tab away. Hover a card to play it.
 */
export const ClipPicker: React.FC<{
  api: GameApi;
  clips: Clip[];
  /** clip file → how many render batches used it. */
  renderedCount: Map<string, number>;
  current?: string;
  onPick: (file: string) => void;
  onClose: () => void;
}> = ({ api, clips, renderedCount, current, onPick, onClose }) => {
  const [filter, setFilter] = useState<Filter>("ready");
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const hasCuts = new Set(clips.filter((c) => c.source).map((c) => c.source!));
    const newest = [...clips].sort((a, b) => (a.facts.recordedAt < b.facts.recordedAt ? 1 : -1));
    return {
      ready: newest.filter((c) => c.source && !renderedCount.has(c.file)),
      rendered: newest.filter((c) => renderedCount.has(c.file)),
      raw: newest.filter((c) => !c.source && !hasCuts.has(c.file) && !renderedCount.has(c.file)),
      all: newest,
    } satisfies Record<Filter, Clip[]>;
  }, [clips, renderedCount]);

  const needle = q.trim().toLowerCase();
  const shown = groups[filter].filter((c) => !needle || `${c.title} ${c.file} ${c.source ?? ""}`.toLowerCase().includes(needle));

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Pick a clip</h2>
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
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search title or file…" style={{ maxWidth: 260, marginLeft: "auto" }} autoFocus />
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
                    <div className="thumb">
                      {hover === c.file ? (
                        <video src={api.clipUrl(c.file)} autoPlay muted loop playsInline poster={api.clipThumb(c.file, Math.min(c.facts.seconds * 0.3, 8))} />
                      ) : (
                        <img src={api.clipThumb(c.file, Math.min(c.facts.seconds * 0.3, 8))} alt="" loading="lazy" />
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
                        {c.source ? `cut from ${stem(c.source)}` : c.file}
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        {c.source ? <span className="badge">cut</span> : <span className="badge">raw</span>}
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
