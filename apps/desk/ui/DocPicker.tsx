import { useCallback, useEffect, useState } from "react";
import { type GameApi, fmtDate } from "./api";
import type { DocEntry } from "../lib/doc";

/**
 * The Google Docs in the game's Video Scripts folder (docs/design/desk-docs.md),
 * newest first, to pull one into a script. When the Desk can't see the folder
 * yet, the one-time setup line, ready to copy.
 */
export const DocPicker: React.FC<{ api: GameApi; current?: string; onPick: (doc: DocEntry) => void; onClose: () => void }> = ({ api, current, onPick, onClose }) => {
  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const load = useCallback(
    (fresh: boolean) => {
      setErr("");
      void api
        .docs(fresh)
        .then((r) => setDocs(r.docs))
        .catch((e: Error) => (setErr(e.message), setDocs([])));
    },
    [api],
  );
  useEffect(() => load(false), [load]);
  // The setup line, when that's what's wrong: it's the part after the colon that starts "rclone config".
  const setup = /rclone config create .*/.exec(err)?.[0];
  const needle = q.trim().toLowerCase();
  const shown = (docs ?? []).filter((d) => !needle || `${d.name} ${d.path}`.toLowerCase().includes(needle));
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal doc-picker" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Pull a Google Doc</h2>
          <span className="row" style={{ gap: 8 }}>
            <button className="ghost small" onClick={() => (setDocs(null), load(true))}>
              Look again
            </button>
            <button className="ghost small" onClick={onClose}>
              Close
            </button>
          </span>
        </div>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search the scripts folder…" autoFocus />
        <div className="modal-body stack" style={{ gap: 4 }}>
          {docs === null ? (
            <div className="muted small">Looking in Drive…</div>
          ) : err ? (
            <div className="stack small" style={{ gap: 8 }}>
              <div className="warn">{setup ? err.slice(0, err.indexOf(setup)).replace(/[:\s]+$/, ".") : err}</div>
              {setup ? (
                <>
                  <pre className="log">{setup}</pre>
                  <div className="row" style={{ gap: 12 }}>
                    <button className="small" onClick={() => void navigator.clipboard.writeText(setup)}>
                      Copy it
                    </button>
                    <span className="muted">Run it in a terminal, say yes in the browser it opens, then Look again.</span>
                  </div>
                </>
              ) : null}
            </div>
          ) : shown.length === 0 ? (
            <div className="muted small">{needle ? "No Doc matches that." : "No Google Docs in the scripts folder yet."}</div>
          ) : (
            shown.map((d) => (
              <button key={d.id} className={`doc-row${d.id === current ? " on" : ""}`} onClick={() => onPick(d)}>
                <span className="first">{d.name}</span>
                <span className="small muted">
                  {d.path.includes("/") ? `${d.path.slice(0, d.path.lastIndexOf("/"))} · ` : ""}edited {fmtDate(d.modified)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
