/**
 * The Saves tab (docs/design/save-point-channel.md, stage 4): make a whole
 * save before it becomes a video. Idea → prompt → pictures (shown as the
 * glyphs they'll become) → Claude's words → Tom's words → Save, then Make.
 * Browser only; the server side is desk.server.ts.
 */
import { PALETTES, drawBuild, inkFromImage, planBuild } from "@heroic/ascii-build";
import { loadFont } from "@remotion/google-fonts/JetBrainsMono";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { GameTabProps } from "../desk/game";
import { presetMake } from "../desk/ui/form";
import type { Draft, Words } from "./desk.server";
import type { LibrarySave } from "./scripts/sync-library";
import { AUTOSAVE_LOOK } from "./src/look";
import { TAGLINE_MAX } from "./src/words";
import { EGGS, EGG_RATE, type Ledger, clock, nextSlot } from "./src/eggs";

const { fontFamily } = loadFont("normal", { weights: ["700"], subsets: ["latin"] });
const FAMILY = `"${fontFamily}", ui-monospace, monospace`;
const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(new Error(`couldn't load ${src}`));
    img.src = src;
  });

/** The finished glyph picture (the locked look, matrix green, the end glow) on a square canvas. */
const drawFinished = async (canvas: HTMLCanvasElement | OffscreenCanvas, src: string, margin = 0) => {
  const [img] = await Promise.all([loadImage(`/g/autosave/${src}`), document.fonts.load(`700 20px "${fontFamily}"`)]);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  const ink = inkFromImage(img, "light", 512, "auto");
  const b = planBuild({ ink, look: AUTOSAVE_LOOK, box: { x: margin, y: margin, w: w - 2 * margin, h: h - 2 * margin }, frame: { w, h }, start: 0, end: 0.01, seed: 1, arrival: "fade", order: "random" });
  ctx.fillStyle = PALETTES.matrix.bg;
  ctx.fillRect(0, 0, w, h);
  drawBuild(ctx, b, 10, { palette: PALETTES.matrix, glow: 0.25, glowFrom: 0, family: FAMILY });
};

/** A 2048px copy of a save as glyphs, for using elsewhere: a PNG data URL. */
const asciiPng = async (src: string): Promise<string> => {
  const c = document.createElement("canvas");
  c.width = c.height = 2048;
  await drawFinished(c, src, 96);
  return c.toDataURL("image/png");
};

const call = async <T,>(game: string, method: "GET" | "POST", name: string, body?: unknown): Promise<T> => {
  const res = await fetch(`/api/${game}/x/${name}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${name} failed (${res.status})`);
  return data;
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
/** A save already in the library, as the "saved" route lists it. */
type Saved = LibrarySave & { at: number; slots: number[] };
const SAVED = "saved:";
const open = (game: string, id?: string) => (location.hash = `#${game}/x/saves${id ? `/${encodeURIComponent(id)}` : ""}`);

/** A picture as Autosave will draw it: the real engine, the locked look, finished. Hover for the original. */
const AsGlyphs: React.FC<{ src: string }> = ({ src }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (canvas.current) void drawFinished(canvas.current, src).catch(() => {});
  }, [src]);
  return (
    <div className="thumb square" style={{ position: "relative" }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <canvas ref={canvas} width={720} height={720} style={{ width: "100%", height: "100%", display: hover ? "none" : "block" }} />
      {hover ? <img src={`/g/autosave/${src}`} alt="" /> : null}
    </div>
  );
};

const TAGLINE_HINT = `The one line under the video: YouTube's title as "Save 07: <tagline>", and the start of TikTok's caption, which cuts at about ${TAGLINE_MAX}. Shows from the first second, so don't give the memory away.`;

/** A box that's Tom's, with Claude's options under it as chips to swap in. */
const WordsBox: React.FC<{ label: string; hint: string; value: string; options?: string[]; long?: boolean | number; max?: number; onChange: (v: string) => void }> = ({ label, hint, value, options, long, max, onChange }) => (
  <div className="field wide">
    <label>{label}</label>
    {long ? <textarea rows={typeof long === "number" ? long : 3} value={value} onChange={(e) => onChange(e.target.value)} /> : <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />}
    {options?.length ? (
      <div className="chips">
        {options.map((o) => (
          <button key={o} type="button" className={`chip${o === value ? " on" : ""}`} style={{ whiteSpace: "normal", textAlign: "left" }} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    ) : null}
    <div className="hint">
      {max ? <span className={value.trim().length > max ? "warn" : ""}>{value.trim().length}/{max}. </span> : null}
      {hint}
    </div>
  </div>
);

export const Tab: React.FC<GameTabProps> = ({ game, arg }) => {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [keys, setKeys] = useState({ images: true, words: true });
  const [err, setErr] = useState("");
  const [missing, setMissing] = useState<{ name: string; file: string }[]>([]);
  const [copying, setCopying] = useState("");
  useEffect(() => void call<{ saves: { name: string; file: string }[] }>(game, "GET", "missing-ascii").then((r) => setMissing(r.saves)).catch(() => {}), [game]);
  const copyAll = async () => {
    for (const [i, m] of missing.entries()) {
      setCopying(`${i + 1}/${missing.length}`);
      await call(game, "POST", "ascii", { name: m.name, png: await asciiPng(m.file) });
    }
    setMissing([]);
    setCopying("");
  };
  const [saved, setSaved] = useState<Saved[]>([]);
  const refreshSaved = () => call<{ saves: Saved[] }>(game, "GET", "saved").then((r) => setSaved(r.saves));
  const refresh = () =>
    call<{ drafts: Draft[]; keys: typeof keys }>(game, "GET", "drafts").then((r) => {
      setDrafts(r.drafts);
      setKeys(r.keys);
      return r.drafts;
    });
  useEffect(() => {
    void refresh().catch((e: Error) => setErr(e.message));
    void refreshSaved().catch(() => {});
  }, [game]);
  // Pictures land in the background: poll while any are on their way.
  const waiting = drafts?.some((d) => d.pending > 0);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [waiting]);

  if (!drafts) return <div className="muted">{err || "loading…"}</div>;
  const draft = arg ? drafts.find((d) => d.id === arg) : undefined;
  const savedOne = arg?.startsWith(SAVED) ? saved.find((x) => x.name === arg.slice(SAVED.length)) : undefined;
  const label = (d: Draft) => d.memory || d.idea || d.prompt;
  return (
    <div className="scripts">
      <div className="stack script-list">
        <a className={`script-row${!arg ? " on" : ""}`} href={`#${game}/x/saves`}>
          <span className="first">New save</span>
          <span className="small muted">An idea, a picture, the words</span>
        </a>
        {drafts.map((d) => (
          <a key={d.id} className={`script-row${d.id === arg ? " on" : ""}`} href={`#${game}/x/saves/${encodeURIComponent(d.id)}`}>
            <span className="first" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(d)}</span>
            <span className="small muted">
              {d.pictures.length} picture{d.pictures.length === 1 ? "" : "s"}
              {d.pending ? `, ${d.pending} on the way` : ""}
            </span>
          </a>
        ))}
        {saved.length ? <b className="small" style={{ marginTop: 10 }}>Saved</b> : null}
        {saved.map((x) => (
          <a key={x.name} className={`script-row${arg === SAVED + x.name ? " on" : ""}`} href={`#${game}/x/saves/${encodeURIComponent(SAVED + x.name)}`}>
            <span className="first" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.memory}</span>
            <span className="small muted">{x.slots.length ? x.slots.map((n) => `Save ${String(n).padStart(2, "0")}`).join(", ") : "Not made yet"}</span>
          </a>
        ))}
        {err ? <div className="warn small">{err}</div> : null}
        <EggsPanel game={game} />
        {missing.length ? (
          <div className="small muted stack" style={{ gap: 4 }}>
            {missing.length} older save{missing.length === 1 ? " has" : "s have"} no glyph copy yet.
            <button className="ghost small" disabled={Boolean(copying)} onClick={() => void copyAll().catch((e: Error) => (setErr(e.message), setCopying("")))}>
              {copying ? `Drawing ${copying}…` : "Make them"}
            </button>
          </div>
        ) : null}
        {!keys.images || !keys.words ? <div className="warn small">{!keys.images ? "No OPENAI_API_KEY in apps/desk/.env, so no pictures. " : ""}{!keys.words ? "No ANTHROPIC_API_KEY, so no ideas or words." : ""}</div> : null}
      </div>
      <div className="script-page">
        {arg && !draft && !savedOne ? <div className="muted">{arg.startsWith(SAVED) ? "That save isn't in the library any more." : "That draft has gone (saved or binned)."}</div> : null}
        {savedOne ? <SavedPage key={savedOne.name} game={game} save={savedOne} onChanged={() => void refreshSaved()} /> : null}
        {!arg ? <NewSave game={game} onMade={(d) => void refresh().then(() => open(game, d.id))} /> : null}
        {draft ? <DraftPage key={draft.id} game={game} draft={draft} onChanged={() => void refresh()} /> : null}
      </div>
    </div>
  );
};

const NewSave: React.FC<{ game: string; onMade: (d: Draft) => void }> = ({ game, onMade }) => {
  const [idea, setIdea] = useState("");
  const [prompt, setPrompt] = useState("");
  const [ideas, setIdeas] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "suggest" | "make">("");
  const [err, setErr] = useState("");
  const suggest = () => {
    setBusy("suggest");
    setErr("");
    call<{ ideas: string[] }>(game, "POST", "suggest", { idea })
      .then((r) => setIdeas(r.ideas))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(""));
  };
  const make = () => {
    setBusy("make");
    setErr("");
    call<Draft>(game, "POST", "draft", { idea, prompt })
      .then(onMade)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(""));
  };
  return (
    <div className="stack" style={{ gap: 18, maxWidth: 820 }}>
      <h2>A new save</h2>
      <div className="field">
        <label>Your idea (optional)</label>
        <input type="text" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="In your own words, e.g. grandad teaching me chess" />
        <div className="row">
          <button className="ghost small" disabled={busy !== ""} onClick={suggest}>
            {busy === "suggest" ? "Thinking…" : idea.trim() ? "Suggest pictures from this" : "Suggest some pictures"}
          </button>
          <span className="small muted">Claude offers six. Click one to use it as the prompt.</span>
        </div>
        {ideas.length ? (
          <div className="stack" style={{ gap: 6 }}>
            {ideas.map((i) => (
              <button key={i} type="button" className={`chip${i === prompt ? " on" : ""}`} style={{ whiteSpace: "normal", textAlign: "left", fontSize: 13 }} onClick={() => setPrompt(i)}>
                {i}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="field">
        <label>What to draw</label>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="One bold subject, a few big shapes. The woodcut style is added for you." />
        <div className="hint">Busy scenes read badly as glyphs. One subject, large and centred, reads best.</div>
      </div>
      <div className="row">
        <button disabled={busy !== "" || !prompt.trim()} onClick={make}>
          {busy === "make" ? "Starting…" : "Make three pictures"}
        </button>
        <span className="small muted">They take a minute or so and land one by one.</span>
      </div>
      {err ? <div className="warn small">{err}</div> : null}
    </div>
  );
};

/** A journal Claude drafted or retold, offered beside the box. It never touches the box until a button says so. */
const JournalOffer: React.FC<{ text: string; current: string; onTake: (v: string) => void; onDismiss: () => void }> = ({ text, current, onTake, onDismiss }) => (
  <div className="panel stack" style={{ gap: 8 }}>
    <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>
    <div className="row">
      <button className="ghost small" onClick={() => onTake(text)}>
        {current.trim() ? "Replace mine with this" : "Use this"}
      </button>
      {current.trim() ? (
        <button className="ghost small" onClick={() => onTake(`${current.trim()}\n\n${text}`)}>
          Add it under mine
        </button>
      ) : null}
      <button className="link small muted" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  </div>
);

const DraftPage: React.FC<{ game: string; draft: Draft; onChanged: () => void }> = ({ game, draft, onChanged }) => {
  // The boxes are local and save as you type; the server copy catches up.
  const [f, setF] = useState(() => ({ prompt: draft.prompt, chosen: draft.chosen ?? "", memory: draft.memory, tagline: draft.tagline, journal: draft.journal ?? "", name: draft.name }));
  const [journalDraft, setJournalDraft] = useState("");
  const [words, setWords] = useState<Words | undefined>(draft.words);
  const [busy, setBusy] = useState<"" | "more" | "words" | "journal" | "retell" | "save" | "bin">("");
  const [err, setErr] = useState("");
  const [sure, setSure] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void call(game, "POST", "update", { id: draft.id, ...f }).catch(() => {}), 500);
    return () => clearTimeout(t);
  }, [f]);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const run = (what: typeof busy, p: Promise<unknown>) => {
    setBusy(what);
    setErr("");
    void p.catch((e: Error) => setErr(e.message)).finally(() => setBusy(""));
  };

  const more = () => run("more", call(game, "POST", "more", { id: draft.id, prompt: f.prompt }).then(onChanged));
  const write = () =>
    run(
      "words",
      call<Draft>(game, "POST", "words", { id: draft.id, picture: f.chosen }).then((d) => {
        setWords(d.words);
        // Claude's first option fills an empty box; anything you've written stays, with the options under it.
        if (d.words) setF((x) => ({ ...x, memory: x.memory || d.words!.memory[0]!, tagline: x.tagline || d.words!.tagline[0]! }));
      }),
    );
  const draftJournal = () => run("journal", call<{ journal: string }>(game, "POST", "journal", { id: draft.id }).then((r) => setJournalDraft(r.journal)));
  const retellJournal = () => run("retell", call<{ journal: string }>(game, "POST", "retell", { journal: f.journal }).then((r) => setJournalDraft(r.journal)));
  const name = f.name.trim() || slug(f.memory);
  const save = () =>
    run(
      "save",
      asciiPng(f.chosen)
        .then((ascii) => call<{ file: string; memory: string; tagline: string; journal: string }>(game, "POST", "save", { id: draft.id, picture: f.chosen, name, memory: f.memory, tagline: f.tagline, journal: f.journal, ascii }))
        .then((r) => {
        presetMake(game, { image: r.file, memory: r.memory, tagline: r.tagline, journal: r.journal });
        location.hash = `#${game}/make`;
        // A fresh page, so Make's picture list has the new save in it.
        location.reload();
      }),
    );
  const bin = () => run("bin", call(game, "POST", "bin", { id: draft.id }).then(() => (onChanged(), open(game))));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>{f.memory || "A save in the making"}</h2>
        {sure ? (
          <span className="row small">
            <button className="danger small" disabled={busy !== ""} onClick={bin}>
              Bin this draft
            </button>
            <button className="ghost small" onClick={() => setSure(false)}>
              Keep it
            </button>
          </span>
        ) : (
          <button className="link small muted" onClick={() => setSure(true)}>
            Bin…
          </button>
        )}
      </div>
      {draft.idea ? <div className="small muted">Your idea: {draft.idea}</div> : null}

      <div className="field">
        <label>What to draw</label>
        <textarea rows={2} value={f.prompt} onChange={(e) => set("prompt")(e.target.value)} />
      </div>
      <div className="grid">
        {draft.pictures.map((p) => (
          <div key={p} className="card" style={{ outline: p === f.chosen ? "2px solid var(--sand)" : undefined, cursor: "pointer" }} onClick={() => set("chosen")(p)}>
            <AsGlyphs src={p} />
            <div className="body small">{p === f.chosen ? <b>This one</b> : <span className="muted">Pick this one</span>}</div>
          </div>
        ))}
        {Array.from({ length: draft.pending }, (_, i) => (
          <div key={`p${i}`} className="card">
            <div className="thumb square muted small">drawing…</div>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="ghost" disabled={busy !== "" || draft.pending > 0} onClick={more}>
          {busy === "more" ? "Starting…" : "Three more"}
        </button>
        <span className="small muted">Uses the prompt as it stands. Hover a picture to see the original.</span>
      </div>
      {draft.errors.length ? <div className="warn small">{draft.errors[draft.errors.length - 1]}</div> : null}

      <div className="panel stack" style={{ gap: 14 }}>
        <div className="row between">
          <b>The words</b>
          <button className="ghost small" disabled={!f.chosen || busy !== ""} onClick={write} title="Claude looks at the chosen picture and drafts three of each">
            {busy === "words" ? "Writing…" : words ? "Write again" : "Write them"}
          </button>
        </div>
        {!f.chosen ? <div className="small muted">Pick a picture first: Claude writes from what's actually in it.</div> : null}
        <div className="fields">
          <WordsBox label="Memory" hint="Revealed on screen when the save completes. As long as you like, up to about three lines." long value={f.memory} options={words?.memory} onChange={set("memory")} />
          <WordsBox label="Tagline" hint={TAGLINE_HINT} max={TAGLINE_MAX} value={f.tagline} options={words?.tagline} onChange={set("tagline")} />
          <WordsBox label="Journal" hint="Goes in the pinned comment (the video says to check the comments). As long as you like. Yours; Claude only drafts one if you ask." long={8} value={f.journal} onChange={set("journal")} />
        </div>
        <div className="row">
          <button className="ghost small" disabled={!f.chosen || busy !== ""} onClick={draftJournal}>
            {busy === "journal" ? "Writing…" : "Draft a journal entry"}
          </button>
          <button className="ghost small" disabled={!f.journal.trim() || busy !== ""} onClick={retellJournal} title="Retells what's in the box the way you write (voice.md + your own saves)">
            {busy === "retell" ? "Retelling…" : "Retell in my voice"}
          </button>
          <span className="small muted">Drafts come already retold. Neither touches your box.</span>
        </div>
        {journalDraft ? <JournalOffer text={journalDraft} current={f.journal} onTake={(v) => (set("journal")(v), setJournalDraft(""))} onDismiss={() => setJournalDraft("")} /> : null}
      </div>

      <div className="row">
        <input type="text" style={{ width: 280 }} value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder={name || "file name"} />
        <button disabled={busy !== "" || !f.chosen || !f.memory.trim() || !name} onClick={save}>
          {busy === "save" ? "Saving…" : "Save, then make a video"}
        </button>
        <span className="small muted">Goes in public/saves as {name || "…"}.png with its words, and a glyph copy in public/saves/ascii.</span>
      </div>
      {err ? <div className="warn small">{err}</div> : null}
    </div>
  );
};

/** A save's music as Claude chose it from the picture and words (desk.server.ts), and a fresh pick on demand.
 * A new choice goes into the next render; videos already made keep their music. */
const MusicPanel: React.FC<{ game: string; save: Saved; onChanged: () => void }> = ({ game, save, onChanged }) => {
  const [music, setMusic] = useState(save.music);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const choose = () => {
    setBusy(true);
    setErr("");
    void call<{ music: NonNullable<Saved["music"]> }>(game, "POST", "music-choose", { name: save.name })
      .then((r) => (setMusic(r.music), onChanged()))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <b>Music</b>
        <span className="small">{music ? `${music.mood} · ${music.styles.join(", ")}` : "Not chosen yet (it's chosen the first time you make a video)."}</span>
        <button className="ghost small" disabled={busy} onClick={choose}>
          {busy ? "Choosing…" : music ? "Choose again" : "Choose now"}
        </button>
      </div>
      {music?.why ? <div className="small muted">{music.why} The first style the last two slots didn't use is the one that plays.</div> : null}
      {err ? <div className="warn small">{err}</div> : null}
    </div>
  );
};

/** A save already in the library: its words, still yours to change until it's made (and after, for the next render). */
const SavedPage: React.FC<{ game: string; save: Saved; onChanged: () => void }> = ({ game, save, onChanged }) => {
  const [f, setF] = useState(() => ({ memory: save.memory, tagline: save.tagline, journal: save.journal }));
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const [offer, setOffer] = useState("");
  const [retelling, setRetelling] = useState(false);
  const [err, setErr] = useState("");
  const [sure, setSure] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState("saving");
    const t = setTimeout(
      () =>
        void call(game, "POST", "saved-update", { name: save.name, ...f })
          .then(() => (setState("saved"), setErr(""), onChanged()))
          .catch((e: Error) => (setState(""), setErr(e.message))),
      600,
    );
    return () => clearTimeout(t);
  }, [f]);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const make = () => {
    presetMake(game, { image: save.file, ...f });
    location.hash = `#${game}/make`;
    // A fresh page, so Make reads the library with these words in it.
    location.reload();
  };
  const retire = () =>
    void call(game, "POST", "saved-retire", { name: save.name })
      .then(() => (onChanged(), open(game)))
      .catch((e: Error) => setErr(e.message));
  const retellJournal = () => {
    setRetelling(true);
    setErr("");
    void call<{ journal: string }>(game, "POST", "retell", { journal: f.journal })
      .then((r) => setOffer(r.journal))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setRetelling(false));
  };
  const made = save.slots.length > 0;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>{f.memory || save.name}</h2>
        {made ? null : sure ? (
          <span className="row small">
            <button className="danger small" onClick={retire}>
              Retire this save
            </button>
            <button className="ghost small" onClick={() => setSure(false)}>
              Keep it
            </button>
          </span>
        ) : (
          <button className="link small muted" onClick={() => setSure(true)} title="Moves it to retired/, out of the library">
            Retire…
          </button>
        )}
      </div>
      <div className="small muted">
        {made ? `Made as ${save.slots.map((n) => `Save ${String(n).padStart(2, "0")}`).join(", ")}. Changes here go into the next render; videos already made keep their words.` : "Not made into a video yet."}{" "}
        public/saves/{save.name}.png
      </div>
      <div className="row" style={{ alignItems: "flex-start", gap: 24 }}>
        <div style={{ width: 300, flex: "none" }}>
          <AsGlyphs src={save.file} />
        </div>
        <div className="fields" style={{ flex: 1 }}>
          <WordsBox label="Memory" hint="Revealed on screen when the save completes. Up to about three lines." long value={f.memory} onChange={set("memory")} />
          <WordsBox label="Tagline" hint={TAGLINE_HINT} max={TAGLINE_MAX} value={f.tagline} onChange={set("tagline")} />
          <WordsBox label="Journal" hint="The pinned comment." long={8} value={f.journal} onChange={set("journal")} />
          <div className="row">
            <button className="ghost small" disabled={!f.journal.trim() || retelling} onClick={retellJournal} title="Retells the journal the way you write (voice.md + your own saves). Offered, not applied.">
              {retelling ? "Retelling…" : "Retell in my voice"}
            </button>
            <span className="small muted">For the older generated saves.</span>
          </div>
          {offer ? <JournalOffer text={offer} current={f.journal} onTake={(v) => (set("journal")(v), setOffer(""))} onDismiss={() => setOffer("")} /> : null}
        </div>
      </div>
      <MusicPanel key={save.name} game={game} save={save} onChanged={onChanged} />
      <div className="row">
        <button disabled={state === "saving" || !f.memory.trim()} onClick={make}>
          Make a video
        </button>
        <span className="small muted">{state === "saving" ? "Saving…" : state === "saved" ? "Saved." : "Changes save as you type."}</span>
      </div>
      {err ? <div className="warn small">{err}</div> : null}
    </div>
  );
};

/** The egg registry at a glance: what's fired so far, what's pinned ahead, and ideas not built yet (src/eggs.ts). */
const EggsPanel: React.FC<{ game: string }> = ({ game }) => {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  useEffect(() => void call<Ledger>(game, "GET", "slots").then(setLedger).catch(() => {}), [game]);
  if (!ledger) return null;
  const next = nextSlot(ledger);
  const label = (id: string) => EGGS.find((e) => e.id === id)?.label ?? id;
  const used = ledger.slots.filter((e) => e.egg);
  const pinned = EGGS.filter((e) => e.status === "live").flatMap((e) => (e.slots ?? []).filter((n) => n >= next).map((n) => ({ n, e }))).sort((a, b) => a.n - b.n);
  const ideas = EGGS.filter((e) => e.status === "idea");
  const total = ledger.slots.reduce((n, e) => n + e.seconds, 0);
  return (
    <div className="fold small" style={{ gap: 8 }}>
      <b>Eggs</b>
      <span className="muted">
        Next slot {next}. PLAYTIME so far {clock(total)}. About 1 in {Math.round(1 / EGG_RATE)} saves get an egg.
      </span>
      {used.length ? (
        <div className="stack" style={{ gap: 2 }}>
          {used.map((e) => (
            <span key={e.slot}>
              Slot {String(e.slot).padStart(2, "0")}: {label(e.egg)}
            </span>
          ))}
        </div>
      ) : (
        <span className="muted">None used yet.</span>
      )}
      {pinned.length ? (
        <div className="stack" style={{ gap: 2 }}>
          <span className="muted">Coming up</span>
          {pinned.map(({ n, e }) => (
            <span key={`${e.id}${n}`}>
              Slot {String(n).padStart(2, "0")}: {e.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="stack" style={{ gap: 2 }}>
        <span className="muted">Ideas not built yet</span>
        {ideas.length ? ideas.map((e) => <span key={e.id} title={e.note}>{e.label}</span>) : <span className="muted">None. Add one to src/eggs.ts with status "idea", or ask Claude.</span>}
      </div>
    </div>
  );
};
