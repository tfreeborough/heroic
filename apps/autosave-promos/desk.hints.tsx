/**
 * The Hints tab: the loading-screen hints every save types out under the
 * bar, two per video. The queue is in the order they'll be used (drag to
 * move, click to reword); a Render press on Make takes the top two and
 * they move across to Used, most recent first. Browser only; the server
 * side is scripts/hints.ts behind desk.server.ts.
 */
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { GameTabProps } from "../desk/game";
import type { Hint } from "./scripts/hints";
import { HINT_MAX } from "./src/words";

type View = { queue: Hint[]; used: Hint[] };

const call = async (game: string, name: string, body?: unknown): Promise<View> => {
  const res = await fetch(`/api/${game}/x/${name}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = (await res.json()) as View & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${name} failed (${res.status})`);
  return data;
};
const when = (at: number) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const Tab: React.FC<GameTabProps> = ({ game }) => {
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  useEffect(() => void call(game, "hints").then(setView).catch((e: Error) => setErr(e.message)), [game]);
  /** Show the change at once, then take the server's word for it. */
  const send = (name: string, body: unknown, guess?: View) => {
    if (guess) setView(guess);
    setErr("");
    call(game, name, body)
      .then(setView)
      .catch((e: Error) => (setErr(e.message), void call(game, "hints").then(setView).catch(() => {})));
  };

  if (!view) return <div className="muted">{err || "loading…"}</div>;
  const q = filter.trim().toLowerCase();
  const shown = q ? view.queue.filter((h) => h.text.toLowerCase().includes(q)) : view.queue;
  const add = (top: boolean) => {
    if (!text.trim()) return;
    send("hints-add", { text, top });
    setText("");
  };
  const moveTo = (id: string, to: number) => {
    const ids = view.queue.map((h) => h.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
    const byId = new Map(view.queue.map((h) => [h.id, h]));
    send("hints-order", { ids }, { ...view, queue: ids.map((x) => byId.get(x)!) });
  };
  const edit = (id: string, t: string) => {
    const re = (hs: Hint[]) => hs.map((h) => (h.id === id ? { ...h, text: t.trim() } : h));
    send("hints-edit", { id, text: t }, { queue: re(view.queue), used: re(view.used) });
  };
  const remove = (id: string) => send("hints-delete", { id }, { queue: view.queue.filter((h) => h.id !== id), used: view.used.filter((h) => h.id !== id) });
  const requeue = (h: Hint) => send("hints-requeue", { id: h.id }, { queue: [{ ...h, used: undefined }, ...view.queue], used: view.used.filter((x) => x.id !== h.id) });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 420px)", gap: 28, alignItems: "start" }}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>Up next</h2>
          <span className="small muted">
            {view.queue.length} hints, about {Math.floor(view.queue.length / 2)} video{Math.floor(view.queue.length / 2) === 1 ? "" : "s"}' worth
          </span>
        </div>
        <div className="small muted">Each video takes the top two (Make fills them in on a fresh form, and Render takes them). Drag to move, click one to reword it.</div>
        <div className="field">
          <div className="row">
            <input
              type="text"
              style={{ flex: 1 }}
              value={text}
              placeholder="Tip: Your own one. Enter puts it next."
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add(true)}
            />
            <button disabled={!text.trim()} onClick={() => add(true)}>
              Add next
            </button>
            <button className="ghost" disabled={!text.trim()} onClick={() => add(false)}>
              Add last
            </button>
          </div>
          <div className="hint">
            <span className={text.trim().length > HINT_MAX ? "warn" : ""}>{text.trim().length}/{HINT_MAX}. </span>
            Start it however you like: Tip:, Hint:, Did you know?, Lore:. Longer than {HINT_MAX} runs to a third line.
          </div>
        </div>
        <input type="text" value={filter} placeholder="Find a hint…" onChange={(e) => setFilter(e.target.value)} />
        {q ? <div className="small muted">{shown.length} match{shown.length === 1 ? "" : "es"}. Clear the search to drag.</div> : null}
        {err ? <div className="warn small">{err}</div> : null}
        <div className="stack" style={{ gap: 0 }} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrag((d) => d && { ...d, over: -1 })}>
          {shown.map((h) => {
            const i = view.queue.indexOf(h);
            return (
              <HintRow
                key={h.id}
                hint={h}
                n={i + 1}
                next={i < 2}
                draggable={!q}
                gapAbove={drag?.over === i}
                gapBelow={drag?.over === view.queue.length && i === view.queue.length - 1}
                faded={drag?.id === h.id}
                onDragStart={() => setDrag({ id: h.id, over: -1 })}
                onDragOver={(after) => setDrag((d) => d && { ...d, over: after ? i + 1 : i })}
                onDrop={() => {
                  if (drag && drag.over >= 0) {
                    const from = view.queue.findIndex((x) => x.id === drag.id);
                    moveTo(drag.id, drag.over > from ? drag.over - 1 : drag.over);
                  }
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
                onEdit={(t) => edit(h.id, t)}
                onDelete={() => remove(h.id)}
                extra={
                  i > 0 && !q ? (
                    <button className="link small muted" title="Make it the next one used" onClick={() => moveTo(h.id, 0)}>
                      To the top
                    </button>
                  ) : null
                }
              />
            );
          })}
          {!view.queue.length ? <div className="muted small">The queue's empty. Add some above, or put used ones back.</div> : null}
        </div>
      </div>

      <div className="stack" style={{ gap: 14, position: "sticky", top: 80 }}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>Used</h2>
          <span className="small muted">{view.used.length}, most recent first</span>
        </div>
        <div className="stack" style={{ gap: 0, maxHeight: "calc(100vh - 180px)", overflowY: "auto" }}>
          {view.used.map((h) => (
            <HintRow
              key={h.id}
              hint={h}
              note={`${h.used!.in}, ${when(h.used!.at)}`}
              onEdit={(t) => edit(h.id, t)}
              onDelete={() => remove(h.id)}
              extra={
                <button className="link small muted" title="Back to the top of the queue" onClick={() => requeue(h)}>
                  Use again
                </button>
              }
            />
          ))}
          {!view.used.length ? <div className="muted small">Nothing yet. A render on Make moves its two hints here.</div> : null}
        </div>
      </div>
    </div>
  );
};

/** One hint: click the words to reword, Enter or click away keeps it, Esc doesn't. */
const HintRow: React.FC<{
  hint: Hint;
  n?: number;
  next?: boolean;
  note?: string;
  draggable?: boolean;
  gapAbove?: boolean;
  gapBelow?: boolean;
  faded?: boolean;
  extra?: React.ReactNode;
  onDragStart?: () => void;
  onDragOver?: (after: boolean) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}> = ({ hint, n, next, note, draggable, gapAbove, gapBelow, faded, extra, onDragStart, onDragOver, onDrop, onDragEnd, onEdit, onDelete }) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing !== null) box.current?.focus();
  }, [editing !== null]);
  const keep = () => {
    if (editing !== null && editing.trim() && editing.trim() !== hint.text) onEdit(editing);
    setEditing(null);
  };
  const line = "2px solid var(--sand)";
  return (
    <div
      draggable={draggable && editing === null}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragOver={(e) => {
        if (!onDragOver) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOver(e.clientY > r.top + r.height / 2);
      }}
      onDrop={(e) => (e.preventDefault(), onDrop?.())}
      onDragEnd={onDragEnd}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "7px 8px",
        borderTop: gapAbove ? line : "2px solid transparent",
        borderBottom: gapBelow ? line : "1px solid var(--line)",
        opacity: faded ? 0.35 : 1,
        background: next ? "var(--panel)" : undefined,
      }}
    >
      {draggable ? (
        <span className="muted" style={{ cursor: "grab", userSelect: "none", lineHeight: "20px" }} title="Drag to move">
          ⋮⋮
        </span>
      ) : null}
      {n ? (
        <span className="small muted" style={{ width: 30, textAlign: "right", lineHeight: "20px", flexShrink: 0 }}>
          {n}
        </span>
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing !== null ? (
          <>
            <textarea
              ref={box}
              rows={2}
              style={{ width: "100%" }}
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onBlur={keep}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), keep());
                if (e.key === "Escape") setEditing(null);
              }}
            />
            <div className={`small ${editing.trim().length > HINT_MAX ? "warn" : "muted"}`}>
              {editing.trim().length}/{HINT_MAX}. Enter keeps it, Esc doesn't.
            </div>
          </>
        ) : (
          <div style={{ cursor: "text", lineHeight: "20px" }} onClick={() => setEditing(hint.text)} title="Click to reword">
            {hint.text}
            {hint.text.length > HINT_MAX ? <span className="warn small"> ({hint.text.length})</span> : null}
          </div>
        )}
        {note || next ? <div className="small muted">{next ? (n === 1 ? "Next video, first hint" : "Next video, second hint") : note}</div> : null}
      </div>
      <span className="row small" style={{ flexShrink: 0, gap: 8 }}>
        {sure ? (
          <>
            <button className="danger small" onClick={onDelete}>
              Delete
            </button>
            <button className="link small muted" onClick={() => setSure(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            {extra}
            <button className="link small muted" onClick={() => setSure(true)}>
              Delete…
            </button>
          </>
        )}
      </span>
    </div>
  );
};
