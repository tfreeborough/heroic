import { useEffect, useState } from "react";
import { type GameApi, type GameInfo, type Idea, type IdeaPatch } from "./api";
import { go } from "./App";
import { Markdown } from "./markdown";

const HINT = "**bold**, *italics*, - bullets, 1. numbered";

/** The add box's draft, in localStorage (wrapped: private windows and blocked storage throw). */
const stash = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`desk_idea_${k}`) ?? "";
    } catch {
      return "";
    }
  },
  set: (k: string, v: string) => {
    try {
      if (v) localStorage.setItem(`desk_idea_${k}`, v);
      else localStorage.removeItem(`desk_idea_${k}`);
    } catch {
      /* nothing to do */
    }
  },
};

/**
 * Video ideas: a title and, if you want one, a description in basic
 * markdown. Tick an idea when it's made (done ones fold away under the
 * list), click one to edit, × to delete.
 */
export const Ideas: React.FC<{ game: GameInfo; api: GameApi }> = ({ api }) => {
  const [list, setList] = useState<Idea[] | null>(null);
  // The box you're typing in survives a reload or a closed tab: it's kept in the browser until it's added.
  const [title, setTitle] = useState(() => stash.get("title"));
  const [description, setDescription] = useState(() => stash.get("description"));
  const [showDone, setShowDone] = useState(false);
  const [msg, setMsg] = useState("");
  // The edits made from each idea (idea id → edits), to jump to from its row.
  const [edits, setEdits] = useState<Map<string, { id: string; name: string }[]>>(new Map());
  useEffect(() => void api.ideas().then(setList), [api]);
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
  useEffect(() => stash.set("title", title), [title]);
  useEffect(() => stash.set("description", description), [description]);
  // Resolves when the server has the change. A failure surfaces in the row that tried (the add box shows its own).
  const run = (p: Promise<Idea[]>) => p.then(setList);
  const add = async () => {
    if (!title.trim()) return;
    try {
      const l = await api.addIdea(title, description);
      setList(l);
      // A server started before this code existed keeps the title and drops the rest. Don't clear the box until it's really saved.
      const saved = l[0];
      if (!saved || saved.title !== title.trim() || (saved.description ?? "") !== description.trim()) {
        setMsg("The server didn't save that properly: it's probably running old code. Your text is still here. Stop the Desk (Ctrl+C), run `bun run desk` again, then press Add.");
        return;
      }
      setMsg("");
      setTitle("");
      setDescription("");
    } catch (e) {
      setMsg(`${(e as Error).message} Your text is still here.`);
    }
  };

  if (!list) return <div className="muted">loading…</div>;
  const open = list.filter((i) => !i.done);
  const done = list.filter((i) => i.done);
  const row = (i: Idea) => <Row key={i.id} idea={i} edits={edits.get(i.id) ?? []} onChange={(p) => run(api.updateIdea(i.id, p))} onDelete={() => run(api.removeIdea(i.id)).catch((e: Error) => setMsg(e.message))} />;
  return (
    <div className="stack ideas">
      <h2>Ideas</h2>
      <div className="panel stack idea-new">
        <input type="text" placeholder="A video worth making" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <textarea rows={3} placeholder={`What's in it, footage to use, the opening line. ${HINT}.`} value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && void add()} />
        <div className="row between">
          <span className="small muted">Enter in the title adds it, or ⌘↩ from the description.</span>
          <button className="small" onClick={() => void add()} disabled={!title.trim()}>
            Add
          </button>
        </div>
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
  );
};

const Row: React.FC<{ idea: Idea; edits: { id: string; name: string }[]; onChange: (p: IdeaPatch) => Promise<unknown>; onDelete: () => void }> = ({ idea, edits, onChange, onDelete }) => {
  // An edit in progress is stashed in the browser as you type (per idea), so a dead server, a reload or a
  // closed tab can't lose it. Opening the idea again picks the stash back up; a successful save clears it.
  const key = (f: "title" | "description") => `edit_${idea.id}_${f}`;
  const stashed = stash.get(key("title")) || stash.get(key("description"));
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(idea.title);
  const [description, setDescription] = useState(idea.description);
  const [sure, setSure] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const start = () => {
    setTitle(stash.get(key("title")) || idea.title);
    setDescription(stash.get(key("description")) || idea.description);
    setErr("");
    setEditing(true);
  };
  useEffect(() => {
    if (editing) stash.set(key("title"), title === idea.title ? "" : title);
  }, [editing, title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (editing) stash.set(key("description"), description === idea.description ? "" : description);
  }, [editing, description]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearStash = () => {
    stash.set(key("title"), "");
    stash.set(key("description"), "");
  };
  const save = async () => {
    const patch: IdeaPatch = {};
    if (title.trim() && title.trim() !== idea.title) patch.title = title;
    if (description.trim() !== idea.description) patch.description = description;
    if (!Object.keys(patch).length) {
      clearStash();
      setEditing(false);
      return;
    }
    // The box stays open, with the text, until the server really has it.
    setSaving(true);
    setErr("");
    try {
      await onChange(patch);
      clearStash();
      setEditing(false);
    } catch (e) {
      setErr(`${(e as Error).message} Your text is still here (and kept in this browser until it saves). Is the Desk running?`);
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => {
    clearStash();
    setEditing(false);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") cancel();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
  };
  return (
    <div className={`idea ${idea.done ? "done" : ""}`}>
      <input type="checkbox" checked={Boolean(idea.done)} onChange={(e) => onChange({ done: e.target.checked })} title={idea.done ? "made" : "not made yet"} />
      {editing ? (
        <div className="stack" style={{ gap: 8 }}>
          <input type="text" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={keys} />
          <textarea rows={Math.max(3, description.split("\n").length + 1)} placeholder={HINT} value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={keys} />
          <div className="row">
            <button className="small" onClick={() => void save()} disabled={!title.trim() || saving}>
              {saving ? "saving…" : "Save"}
            </button>
            <button className="ghost small" onClick={cancel} disabled={saving} title="Drops the edit, and the copy kept in this browser.">
              Cancel
            </button>
            <span className="small muted">⌘↩ saves, Esc cancels. {HINT}.</span>
          </div>
          {err ? <div className="warn small">{err}</div> : null}
        </div>
      ) : (
        <div className="text" onClick={() => !idea.done && start()} title={idea.done ? "" : "click to edit"}>
          <div className="first">
            {idea.title}
            {stashed && !idea.done ? <span className="small warn"> · unsaved edit kept, click to carry on</span> : null}
          </div>
          {idea.description ? <Markdown className="desc small" text={idea.description} /> : null}
          {edits.length ? (
            <div className="small muted" onClick={(e) => e.stopPropagation()}>
              {idea.done ? "made as " : "being made as "}
              {edits.map((s, k) => (
                <span key={s.id}>
                  {k ? ", " : ""}
                  <button className="link small" onClick={() => go({ name: "edit", id: s.id })}>
                    {s.name}
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {sure ? (
        <span className="row" style={{ gap: 6 }}>
          <button className="danger small" onClick={onDelete}>
            delete
          </button>
          <button className="ghost small" onClick={() => setSure(false)}>
            keep
          </button>
        </span>
      ) : (
        <button className="link small muted" onClick={() => setSure(true)}>
          ×
        </button>
      )}
    </div>
  );
};
