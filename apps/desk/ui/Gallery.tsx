/**
 * A template's `gallery` field on Make: small preview squares instead of a
 * select, split into what hasn't been made into a video yet and what has
 * (any render that used it), so a long library stays usable.
 */
import { useState } from "react";
import type { GalleryItem } from "../game";

export const Gallery: React.FC<{
  label: string;
  items: GalleryItem[];
  value: string;
  /** Values some render has already used. */
  made: Set<string>;
  /** Where the game's public dir is served, e.g. /g/autosave. */
  base: string;
  onPick: (value: string) => void;
}> = ({ label, items, value, made, base, onPick }) => {
  const todo = items.filter((i) => !made.has(i.value));
  const done = items.filter((i) => made.has(i.value));
  const [tab, setTab] = useState<"todo" | "done">(() => (made.has(value) && todo.length === 0 ? "done" : "todo"));
  const shown = tab === "todo" ? todo : done;
  const chosen = items.find((i) => i.value === value);
  return (
    <div className="field">
      <label>{label}</label>
      {chosen ? (
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <img src={`${base}/${chosen.thumb}`} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chosen.label}</strong>
            {made.has(chosen.value) ? <span className="small muted">already made into a video</span> : null}
          </div>
        </div>
      ) : (
        <span className="small muted">Pick one below.</span>
      )}
      <div className="chips">
        <button type="button" className={`chip${tab === "todo" ? " on" : ""}`} onClick={() => setTab("todo")}>
          To make ({todo.length})
        </button>
        <button type="button" className={`chip${tab === "done" ? " on" : ""}`} onClick={() => setTab("done")}>
          Made ({done.length})
        </button>
      </div>
      {shown.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 6, maxHeight: 220, overflowY: "auto" }}>
          {shown.map((i) => (
            <button
              key={i.value}
              type="button"
              title={i.label}
              onClick={() => onPick(i.value)}
              style={{ padding: 0, aspectRatio: "1", overflow: "hidden", borderRadius: 6, background: "var(--ink)", outline: i.value === value ? "2px solid var(--sand)" : "1px solid var(--line)" }}
            >
              <img src={`${base}/${i.thumb}`} alt={i.label} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </button>
          ))}
        </div>
      ) : (
        <div className="small muted">{tab === "todo" ? "Everything's been made. New ones come from the Saves tab." : "Nothing made into a video yet."}</div>
      )}
    </div>
  );
};
