import { useEffect, useMemo, useState } from "react";
import { type GameApi, type GameInfo, type Platform, type Post, type Schedule } from "./api";
import { go } from "./App";
import { PLATFORMS, addDays, dayDiff, isDone, today } from "../lib/schedule";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${DAY_NAMES[new Date(y, m - 1, d).getDay()]} ${d}/${m}`;
};

/**
 * The posting queue: what goes out today (overdue first), then the days
 * ahead, two slots each. A slot holds one finished video with its words
 * for the platforms and a tick per platform. The Desk doesn't upload to
 * the platforms; you do, through their own schedulers, and tick it here.
 */
export const Queue: React.FC<{ game: GameInfo; api: GameApi }> = ({ game, api }) => {
  const [s, setS] = useState<(Schedule & { claude?: boolean }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // post id being redrafted
  const [open, setOpen] = useState<string | null>(null); // post id being edited
  const [playing, setPlaying] = useState<Post | null>(null); // open in the preview modal
  const [dragging, setDragging] = useState<string | null>(null); // post id on the drag handle
  const [over, setOver] = useState<string | null>(null); // "day/slot" under the cursor
  const [msg, setMsg] = useState("");
  const [showDone, setShowDone] = useState(false);
  const now = today();
  useEffect(() => void api.schedule().then(setS), [api]);
  useEffect(() => {
    if (!playing) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPlaying(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [playing]);

  const days = useMemo(() => {
    if (!s) return [];
    const byDay = new Map<string, Post[]>();
    for (const p of s.posts) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p]);
    // Every past day with something still open, then today and two weeks ahead, then any later day with a post.
    const set = new Set<string>();
    for (const p of s.posts) if (p.day < now && !isDone(p)) set.add(p.day);
    for (let i = 0; i < 14; i++) set.add(addDays(now, i));
    for (const p of s.posts) if (p.day > now) set.add(p.day);
    if (showDone) for (const p of s.posts) set.add(p.day);
    return [...set].sort().map((day) => ({ day, posts: (byDay.get(day) ?? []).sort((a, b) => a.slot - b.slot) }));
  }, [s, now, showDone]);

  if (!s) return <div className="muted">loading…</div>;

  const save = (next: Promise<Schedule>) =>
    next.then((n) => setS((cur) => ({ ...n, claude: cur?.claude }))).catch((e: Error) => setMsg(`✖ ${e.message}`));
  const redraft = async (p: Post) => {
    setBusy(p.id);
    setMsg("asking Claude…");
    await save(api.redraft(p.id)).then(() => setMsg("redrafted"));
    setBusy(null);
  };
  const tick = (p: Post, pl: Platform) => {
    const posted = { ...p.posted };
    if (posted[pl]) delete posted[pl];
    else posted[pl] = new Date().toISOString();
    void save(api.updatePost(p.id, { posted }));
  };
  const markDone = (p: Post) => void save(api.updatePost(p.id, { doneAt: p.doneAt ? null : new Date().toISOString() }));
  const patch = (p: Post, fields: Partial<Pick<Post, "day" | "slot" | "title" | "description">>) => void save(api.updatePost(p.id, fields));
  const remove = (p: Post) => {
    if (!confirm(`Take ${p.name} out of the queue? The video stays in Renders.`)) return;
    void save(api.unqueue(p.id));
  };
  /** Drop targets: a slot (swaps with whatever's there) or a day's date (its first free slot). */
  const dropOn = (day: string, slot: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setOver(`${day}/${slot}`);
    },
    onDragLeave: () => setOver((o) => (o === `${day}/${slot}` ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const id = dragging;
      setDragging(null);
      setOver(null);
      const p = s.posts.find((x) => x.id === id);
      if (!p || (p.day === day && p.slot === slot)) return;
      // Optimistic, so the card lands where it was dropped before the server answers.
      setS({ ...s, posts: s.posts.map((x) => (x.id === p.id ? { ...x, day, slot } : x.day === day && x.slot === slot ? { ...x, day: p.day, slot: p.slot } : x)) });
      void save(api.move(p.id, day, slot));
    },
  });
  const freeSlot = (day: string, id: string) => {
    for (let i = 0; i < s.slotsPerDay; i++) if (!s.posts.some((x) => x.id !== id && x.day === day && x.slot === i)) return i;
    return s.slotsPerDay; // full: past the last slot rather than swapping someone out
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`copied the ${what}`);
    } catch {
      setMsg("couldn't copy (browser blocked the clipboard)");
    }
  };

  const overdue = s.posts.filter((p) => p.day < now && !isDone(p)).length;
  const dueToday = s.posts.filter((p) => p.day === now && !isDone(p));
  const week = days.filter((d) => d.day >= now && dayDiff(now, d.day) < 7);
  const gaps = week.reduce((n, d) => n + Math.max(0, s.slotsPerDay - d.posts.length), 0);

  const slotView = (p: Post) => {
    const done = isDone(p);
    const editing = open === p.id;
    return (
      <div className={`qslot${done ? " done" : ""}${dragging === p.id ? " dragging" : ""}${over === `${p.day}/${p.slot}` && dragging !== p.id ? " over" : ""}`} key={p.id} {...dropOn(p.day, p.slot)}>
        <span
          className="qhandle"
          draggable
          title="drag to another day or slot"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", p.id);
            const card = e.currentTarget.parentElement;
            if (card) e.dataTransfer.setDragImage(card, 12, 20);
            setDragging(p.id);
          }}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
        >
          ⠿
        </span>
        <span className="label">{s.slotLabels[p.slot] ?? `slot ${p.slot + 1}`}</span>
        <img src={api.renderThumb(p.slug)} alt="" loading="lazy" onClick={() => setPlaying(p)} title="play" />
        <div className="what">
          <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</strong>
          <span className="small hook muted" title={p.hook}>
            {p.hook || p.template}
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button className="small link" onClick={() => setOpen(editing ? null : p.id)}>
              {editing ? "close" : "words + move"}
            </button>
            <a className="small" href={api.renderUrl(p.slug)} download>
              download
            </a>
            <button className="small link" onClick={() => void copy(p.description, "description")}>
              copy description
            </button>
            <button className="small link" onClick={() => void copy(p.title, "title")}>
              copy title
            </button>
          </span>
        </div>
        <div className="ticks">
          {PLATFORMS.map((pl) => (
            <button key={pl.id} className={`tickbtn${p.posted[pl.id] ? " on" : ""}`} onClick={() => tick(p, pl.id)} title={p.posted[pl.id] ? `up since ${p.posted[pl.id]!.slice(0, 16).replace("T", " ")}` : `tick when it's scheduled on ${pl.label}`}>
              {p.posted[pl.id] ? "✔ " : ""}
              {pl.label}
            </button>
          ))}
          <button className={`tickbtn${p.doneAt ? " on" : ""}`} onClick={() => markDone(p)} title={p.doneAt ? `marked done ${p.doneAt.slice(0, 16).replace("T", " ")}` : "mark it done without ticking every platform"}>
            {p.doneAt ? "✔ Done" : "Done"}
          </button>
        </div>
        {editing ? (
          <div className="qedit">
            <div className="field">
              <label>Title (Shorts)</label>
              <input type="text" value={p.title} onChange={(e) => setS({ ...s, posts: s.posts.map((x) => (x.id === p.id ? { ...x, title: e.target.value } : x)) })} onBlur={(e) => patch(p, { title: e.target.value })} />
              <span className={`count${p.title.length > 100 ? " over" : ""}`}>{p.title.length}/100</span>
              {p.titleOptions && p.titleOptions.length > 1 ? (
                <div className="chips" style={{ marginTop: 4 }}>
                  {p.titleOptions.map((t) => (
                    <button key={t} className={`chip${t === p.title ? " on" : ""}`} onClick={() => patch(p, { title: t })} title="use this title">
                      {t}
                    </button>
                  ))}
                </div>
              ) : null}
              <span className="small muted">
                {p.draftedBy === "claude" ? "drafted by Claude" : "from the template"}
                {s.claude ? (
                  <>
                    {" · "}
                    <button className="small link" disabled={busy === p.id} onClick={() => void redraft(p)}>
                      {busy === p.id ? "asking Claude…" : p.draftedBy === "claude" ? "redraft" : "draft with Claude"}
                    </button>
                  </>
                ) : null}
              </span>
            </div>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field">
                <label>Day</label>
                <input type="date" value={p.day} onChange={(e) => e.target.value && patch(p, { day: e.target.value })} />
              </div>
              <div className="field">
                <label>Slot</label>
                <select value={p.slot} onChange={(e) => patch(p, { slot: Number(e.target.value) })}>
                  {Array.from({ length: s.slotsPerDay }, (_, i) => (
                    <option key={i} value={i}>
                      {s.slotLabels[i] ?? `slot ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
              <button className="small danger" onClick={() => remove(p)}>
                Remove from queue
              </button>
            </div>
            <div className="field wide">
              <label>Description (every platform)</label>
              <textarea value={p.description} onChange={(e) => setS({ ...s, posts: s.posts.map((x) => (x.id === p.id ? { ...x, description: e.target.value } : x)) })} onBlur={(e) => patch(p, { description: e.target.value })} />
              <span className="count">{p.description.length} characters · the same words everywhere, so the platforms stay consistent</span>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between">
        <div>
          <h2>Queue</h2>
          <div className="muted small">
            What to upload, when. Queue a batch from Renders and it lands in the next free slot; hooks of the same clip are kept {s.minGapDays} days apart. Upload through each platform's own scheduler, then tick it here.
          </div>
        </div>
        <div className="row">
          <label className="small muted">
            slots a day{" "}
            <input type="number" min={1} max={6} value={s.slotsPerDay} style={{ width: 60 }} onChange={(e) => void save(api.scheduleSettings({ slotsPerDay: Number(e.target.value) }))} />
          </label>
          <label className="small muted">
            same clip gap{" "}
            <input type="number" min={1} max={14} value={s.minGapDays} style={{ width: 60 }} onChange={(e) => void save(api.scheduleSettings({ minGapDays: Number(e.target.value) }))} />
          </label>
          <button className="ghost" onClick={() => void save(api.reflow())} title="Lift everything not yet posted and lay it out again from today, in order, under the spacing rule">
            Re-flow from today
          </button>
          <button onClick={() => go({ name: "renders" })}>Renders</button>
        </div>
      </div>

      <div className="panel stack">
        <div className="row between">
          <h3 style={{ margin: 0 }}>Today · {fmtDay(now)}</h3>
          <span className="small muted">
            {overdue ? <span style={{ color: "var(--crimson)" }}>{overdue} overdue · </span> : null}
            {dueToday.length} to upload today · {gaps ? `${gaps} empty slot${gaps === 1 ? "" : "s"} this week: render some spotlights` : "the week is full"}
          </span>
        </div>
        {dueToday.length === 0 && !overdue ? <div className="muted small">Nothing due. Queue a batch from Renders.</div> : null}
        {msg ? <div className="small muted">{msg}</div> : null}
      </div>

      <div>
        {days.map(({ day, posts }) => {
          const past = day < now;
          const free = Array.from({ length: s.slotsPerDay }, (_, i) => i).filter((i) => !posts.some((p) => p.slot === i));
          if (past && posts.every(isDone) && !showDone) return null;
          return (
            <div className={`qday${day === now ? " today" : past ? " past" : ""}`} key={day} {...(dragging ? dropOn(day, freeSlot(day, dragging)) : {})}>
              <div className="qdate">
                {fmtDay(day)}
                <div className="small muted">{day === now ? "today" : past ? "overdue" : `in ${dayDiff(now, day)} day${dayDiff(now, day) === 1 ? "" : "s"}`}</div>
              </div>
              <div className="qslots">
                {posts.map(slotView)}
                {!past
                  ? free.map((i) => (
                      <div className={`qslot empty${over === `${day}/${i}` ? " over" : ""}`} key={`e${i}`} {...dropOn(day, i)}>
                        <span />
                        <span className="label">{s.slotLabels[i] ?? `slot ${i + 1}`}</span>
                        <span />
                        <span className="small">empty</span>
                        <span />
                      </div>
                    ))
                  : null}
              </div>
            </div>
          );
        })}
      </div>
      <label className="small muted">
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> show days that are all done
      </label>
      {playing ? (
        <div className="modal-back" onClick={() => setPlaying(null)}>
          <div className="qpreview" onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{playing.name}</strong>
              <button className="ghost small" onClick={() => setPlaying(null)}>
                Close
              </button>
            </div>
            <video src={api.renderUrl(playing.slug)} controls autoPlay />
          </div>
        </div>
      ) : null}
      <div className="small muted">Stored in {game.rendersDir}/schedule.json. Deleting a render takes it out of the queue.</div>
    </div>
  );
};
