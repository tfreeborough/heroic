/**
 * The Scripts tab's Thumbnail step (docs/design/desk-thumbnails.md): ideas
 * for the long video's thumbnail, each a fresh picture built out of green
 * glyphs plus up to four words built out of glyphs in red or white. Drawn
 * with the real engine at YouTube's 1280×720, and the download is that
 * same canvas. Below, every idea as YouTube would show it next to the
 * title: the phone home feed and the up next list, dark and light. Three of
 * them go to Test & compare.
 */
import { THUMB, type ThumbAccent, type ThumbSide, drawThumbnail, inkFromImage, planThumbnail } from "@heroic/ascii-build";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { useEffect, useRef, useState } from "react";
import type { GameApi, Script } from "./api";
import type { ThumbnailIdea, TitleIdea } from "../lib/scripts";

const mono = loadMono("normal", { weights: ["700"], subsets: ["latin"] });
const anton = loadAnton("normal", { weights: ["400"], subsets: ["latin"] });
const FAMILY = `"${mono.fontFamily}", ui-monospace, monospace`;
const WORDS_FAMILY = `"${anton.fontFamily}", Impact, sans-serif`;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(new Error(`couldn't load ${src}`));
    img.src = src;
  });

/** A picture dragged from one idea's card to another's. */
const PICTURE = "application/x-desk-thumb-picture";

/** A file name from the title: "how-does-cheating-work-thumbnail-2.png". */
const fileName = (title: string, n: number) =>
  `${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "video"
  }-thumbnail-${n}.png`;

/**
 * One thumbnail drawn at full size. Hands the finished PNG up (an object
 * URL) for the feed preview and the download, each time it's redrawn.
 */
const ThumbCanvas: React.FC<{ url: string; words: string; accent: ThumbAccent; side?: ThumbSide; onDrawn: (png: string | null, side: ThumbSide | null) => void }> = ({ url, words, accent, side, onDrawn }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const drawn = useRef(onDrawn);
  drawn.current = onDrawn;
  useEffect(() => {
    let live = true;
    setImg(null);
    void Promise.all([loadImage(url), document.fonts.load(`700 12px ${FAMILY}`), document.fonts.load(`400 40px ${WORDS_FAMILY}`)])
      .then(([i]) => live && setImg(i))
      .catch(() => drawn.current(null, null));
    return () => {
      live = false;
    };
  }, [url]);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !img) return;
    // The words wait a moment while they're being typed: planning the glyphs isn't free.
    const t = setTimeout(() => {
      const plan = planThumbnail({ picture: inkFromImage(img, "light", 512, "auto"), words, seed: 3, side, family: WORDS_FAMILY });
      drawThumbnail(ctx, plan, { accent, family: FAMILY });
      canvas.current?.toBlob((b) => drawn.current(b ? URL.createObjectURL(b) : null, plan.side), "image/png");
    }, 150);
    return () => clearTimeout(t);
  }, [img, words, accent, side]);
  return <canvas ref={canvas} width={THUMB.w} height={THUMB.h} />;
};

export const ThumbnailsStep: React.FC<{
  s: Script;
  api: GameApi;
  claude: boolean;
  images: boolean;
  busy: string;
  pending: string[];
  onIdea: (id: string, f: (t: ThumbnailIdea) => ThumbnailIdea) => void;
  onRemove: (id: string) => void;
  onPlan: (instruction: string) => void;
  onMake: (only?: string[]) => void;
  onOwn: (idea: string, file: File) => void;
  onTitles: (f: (t: TitleIdea[]) => TitleIdea[]) => void;
  onPlanTitles: (instruction: string) => void;
}> = ({ s, api, claude, images, busy, pending, onIdea, onRemove, onPlan, onMake, onOwn, onTitles, onPlanTitles }) => {
  const ideas = s.thumbnails ?? [];
  const working = s.long?.title || s.title;
  // The feed shows the working title or one of the titles to test.
  const titles = [{ id: "", text: working }, ...(s.titles ?? []).filter((t) => t.text.trim())];
  const [feedTitle, setFeedTitle] = useState("");
  const onFeed = titles.find((t) => t.id === feedTitle) ?? titles[0]!;
  const title = onFeed.text;
  const [ask, setAsk] = useState("");
  // The drawn PNG of each idea, for the feed and the download.
  const [pngs, setPngs] = useState<Record<string, string>>({});
  const [sides, setSides] = useState<Record<string, ThumbSide>>({});
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const toMake = ideas.filter((t) => t.prompt.trim() && !t.candidates.length && !pending.includes(`thumb:${t.id}`)).length;
  const making = ideas.filter((t) => pending.includes(`thumb:${t.id}`)).length;
  const own = useRef<HTMLInputElement>(null);
  const drawnFor = (id: string) => (png: string | null, side: ThumbSide | null) => {
    setPngs((cur) => {
      if (cur[id]) URL.revokeObjectURL(cur[id]!);
      const next = { ...cur };
      if (png) next[id] = png;
      else delete next[id];
      return next;
    });
    if (side) setSides((cur) => (cur[id] === side ? cur : { ...cur, [id]: side }));
  };
  const shown = ideas.filter((t) => t.chosen && pngs[t.id]);
  // Every picture made for any idea, to borrow onto another.
  const pictures = [...new Set(ideas.flatMap((t) => t.candidates))];
  const plan = () => {
    onPlan(ask);
    setAsk("");
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <Titles working={working} titles={s.titles ?? []} claude={claude} busy={busy} onChange={onTitles} onPlan={onPlanTitles} />
      <h4 style={{ margin: "6px 0 0" }}>Thumbnails</h4>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button onClick={plan} disabled={!claude || Boolean(busy)} title="Claude reads the title and the script and comes up with three different thumbnails: a picture each, and a few words or none. The ones you have stay.">
          {busy === "thumbs" ? "thinking…" : ideas.length ? "Three more ideas" : "Three ideas"}
        </button>
        <input type="text" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && claude && !busy && plan()} placeholder='Steer them, or leave blank: "more like the eye", "no faces"…' style={{ flex: 1, minWidth: 220, maxWidth: 460 }} />
        {ideas.length ? (
          <button className="ghost" onClick={() => onMake()} disabled={!images || !toMake} title={images ? "A picture for every idea that hasn't one; each lands here as it finishes." : "Needs OPENAI_API_KEY in apps/desk/.env"}>
            {toMake ? `Make ${toMake} picture${toMake === 1 ? "" : "s"}` : making ? `making ${making}…` : "All made"}
          </button>
        ) : null}
        <button className="link small" onClick={() => own.current?.click()} title="Your own picture as a new thumbnail idea">
          my own picture
        </button>
        <input ref={own} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => (e.target.files?.[0] && onOwn("", e.target.files[0]), (e.target.value = ""))} />
        {!images ? <span className="small warn">Pictures need OPENAI_API_KEY in apps/desk/.env.</span> : null}
      </div>
      <div className="small muted">The words should add to the title, never repeat it. Upload three to YouTube Studio's Test & compare and let it pick.</div>

      {ideas.length ? (
        <div className="thumb-grid">
          {ideas.map((t, i) => (
            <ThumbCard
              key={t.id}
              api={api}
              n={i + 1}
              t={t}
              title={working}
              png={pngs[t.id]}
              side={sides[t.id]}
              others={pictures.filter((c) => !t.candidates.includes(c))}
              images={images}
              making={pending.includes(`thumb:${t.id}`)}
              onChange={(f) => onIdea(t.id, f)}
              onRemove={() => onRemove(t.id)}
              onMake={() => onMake([t.id])}
              onOwn={(f) => onOwn(t.id, f)}
              onDrawn={drawnFor(t.id)}
            />
          ))}
        </div>
      ) : (
        <div className="small muted">No ideas yet. Press Three ideas and Claude comes up with three thumbnails for this video: at least one face or eye looking at you, and at least one with no words.</div>
      )}

      {shown.length ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            <h4 style={{ margin: 0 }}>In the feed</h4>
            <span className="small muted">the size most people see it, next to the title</span>
            <span className="row" style={{ gap: 4 }}>
              {(["dark", "light"] as const).map((x) => (
                <button key={x} className={`chip ${theme === x ? "on" : ""}`} onClick={() => setTheme(x)}>
                  {x}
                </button>
              ))}
            </span>
          </div>
          {titles.length > 1 ? (
            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
              <span className="small muted">title:</span>
              {titles.map((t) => (
                <button key={t.id} className={`chip ${onFeed.id === t.id ? "on" : ""}`} onClick={() => setFeedTitle(t.id)} title={t.text}>
                  {t.text.length > 34 ? `${t.text.slice(0, 32)}…` : t.text}
                </button>
              ))}
            </div>
          ) : null}
          <div className={`yt yt-${theme}`}>
            <div className="yt-home">
              {shown.map((t) => (
                <div key={t.id} className="yt-card">
                  <div className="yt-thumb">
                    <img src={pngs[t.id]} alt="" />
                    <span className="yt-dur">11:42</span>
                  </div>
                  <div className="yt-meta">
                    <div className="yt-avatar" />
                    <div>
                      <div className="yt-title">{title}</div>
                      <div className="yt-sub">Your channel · 1.2K views · 2 days ago</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="yt-next">
              {shown.map((t) => (
                <div key={t.id} className="yt-row">
                  <div className="yt-thumb">
                    <img src={pngs[t.id]} alt="" />
                    <span className="yt-dur">11:42</span>
                  </div>
                  <div>
                    <div className="yt-title">{title}</div>
                    <div className="yt-sub">Your channel · 1.2K views</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/**
 * YouTube titles to test against the working one (Test & compare does
 * titles too). Claude's, or Tom's own; the working title is the long
 * cut's, the one the video builds on screen, and stays as it is.
 */
const Titles: React.FC<{ working: string; titles: TitleIdea[]; claude: boolean; busy: string; onChange: (f: (t: TitleIdea[]) => TitleIdea[]) => void; onPlan: (instruction: string) => void }> = ({ working, titles, claude, busy, onChange, onPlan }) => {
  const [ask, setAsk] = useState("");
  const plan = () => {
    onPlan(ask);
    setAsk("");
  };
  const length = (text: string) => <span className={`small ${text.length > 60 ? "warn" : "muted"}`} title="A phone shows about 60 characters before it cuts a title off">{text.length}</span>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h4 style={{ margin: 0 }}>Titles</h4>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button onClick={plan} disabled={!claude || Boolean(busy)} title="Claude reads the script (and the thumbnails' words) and comes up with three titles to test against the working one. The ones you have stay.">
          {busy === "titles" ? "thinking…" : titles.length ? "Three more titles" : "Three titles"}
        </button>
        <input type="text" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && claude && !busy && plan()} placeholder='Steer them, or leave blank: "more personal", "use a number"…' style={{ flex: 1, minWidth: 220, maxWidth: 460 }} />
        <button className="link small" onClick={() => onChange((t) => [...t, { id: Math.random().toString(36).slice(2, 10), text: "" }])}>
          my own title
        </button>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row small" style={{ gap: 8 }}>
          <span className="muted" style={{ width: 64 }}>working</span>
          <span style={{ flex: 1 }}>{working}</span>
          {length(working)}
        </div>
        {titles.map((t) => (
          <div key={t.id} className="stack" style={{ gap: 2 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="small muted" style={{ width: 64 }}>to test</span>
              <input type="text" value={t.text} maxLength={100} onChange={(e) => onChange((all) => all.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)))} placeholder="Your own title" style={{ flex: 1 }} />
              {length(t.text)}
              <button className="link small" onClick={() => void navigator.clipboard.writeText(t.text)} disabled={!t.text.trim()}>
                copy
              </button>
              <button className="link small" onClick={() => onChange((all) => all.filter((x) => x.id !== t.id))} title="Drop this title">
                ×
              </button>
            </div>
            {t.why ? <div className="small muted" style={{ marginLeft: 72 }}>{t.why}</div> : null}
          </div>
        ))}
      </div>
      {titles.length ? <div className="small muted">Test & compare tries up to three. Pick the ones you'd click, and check them against the thumbnails in the feed below.</div> : null}
    </div>
  );
};

const ThumbCard: React.FC<{
  api: GameApi;
  n: number;
  t: ThumbnailIdea;
  title: string;
  png?: string;
  side?: ThumbSide;
  /** The other ideas' pictures, to borrow. */
  others: string[];
  images: boolean;
  making: boolean;
  onChange: (f: (t: ThumbnailIdea) => ThumbnailIdea) => void;
  onRemove: () => void;
  onMake: () => void;
  onOwn: (f: File) => void;
  onDrawn: (png: string | null, side: ThumbSide | null) => void;
}> = ({ api, n, t, title, png, side, others, images, making, onChange, onRemove, onMake, onOwn, onDrawn }) => {
  const file = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [borrowing, setBorrowing] = useState(false);
  const take = (files: FileList | null) => {
    const f = files?.[0];
    if (f && f.type.startsWith("image/")) onOwn(f);
  };
  // Any idea's picture under this idea's words: it joins this idea's tries (the server keeps it there too).
  const use = (c: string) => onChange((x) => ({ ...x, chosen: c, candidates: x.candidates.includes(c) ? x.candidates : [...x.candidates, c] }));
  const drag = (c: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData(PICTURE, c);
    e.dataTransfer.effectAllowed = "copy";
  };
  return (
    <div
      className={`pic-card thumb-card ${over ? "over" : ""}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const c = e.dataTransfer.getData(PICTURE);
        if (c) use(c);
        else take(e.dataTransfer.files);
      }}
    >
      <div className="glyphs" draggable={Boolean(t.chosen)} onDragStart={t.chosen ? drag(t.chosen) : undefined} title={t.chosen ? "Drag onto another idea to try this picture under its words" : undefined}>
        {t.chosen ? <ThumbCanvas url={api.publicUrl(t.chosen)} words={t.words} accent={t.accent} side={t.side} onDrawn={onDrawn} /> : <div className="glyphs empty small muted">{making ? "making…" : t.error ? "" : "not made yet · drop an image here"}</div>}
      </div>
      {t.candidates.length > 1 ? (
        <div className="pic-cands">
          {t.candidates.map((c) => (
            <button key={c} className={c === t.chosen ? "on" : ""} onClick={() => onChange((x) => ({ ...x, chosen: c }))} draggable onDragStart={drag(c)} title="Use this one (or drag it onto another idea)">
              <img src={api.publicUrl(c)} alt="" />
            </button>
          ))}
        </div>
      ) : null}
      {borrowing && others.length ? (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">the other ideas' pictures, under these words:</span>
          <div className="pic-cands">
            {others.map((c) => (
              <button key={c} onClick={() => (use(c), setBorrowing(false))} title="Use this picture with this idea's words">
                <img src={api.publicUrl(c)} alt="" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {t.why ? <div className="small muted">{t.why}</div> : null}
      <div className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <textarea rows={2} value={t.words} onChange={(e) => onChange((x) => ({ ...x, words: e.target.value }))} placeholder="The words (blank for none). A new line breaks the line." className="thumb-words" />
        <div className="stack" style={{ gap: 6 }}>
          <span className="row" style={{ gap: 4 }} title="The words' colour">
            {(["red", "white"] as const).map((a) => (
              <button key={a} className={`chip accent-${a} ${t.accent === a ? "on" : ""}`} onClick={() => onChange((x) => ({ ...x, accent: a }))}>
                {a}
              </button>
            ))}
          </span>
          <span className="row" style={{ gap: 4 }} title="Which side the words go. Auto puts them on the picture's darker side.">
            {(["auto", "left", "right"] as const).map((x) => (
              <button key={x} className={`chip ${(t.side ?? "auto") === x ? "on" : ""}`} onClick={() => onChange((y) => ({ ...y, side: x === "auto" ? undefined : x }))}>
                {x === "auto" && !t.side && side ? `auto (${side})` : x}
              </button>
            ))}
          </span>
        </div>
      </div>
      <textarea rows={3} value={t.prompt} onChange={(e) => onChange((x) => ({ ...x, prompt: e.target.value }))} placeholder="What the picture shows: one subject, close, where the light falls" />
      <div className="row small" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="muted">idea {n}</span>
        <button className="link small" disabled={!images || making || !t.prompt.trim()} onClick={onMake} title={t.candidates.length ? "Another picture from the prompt (the others stay to pick from)" : "Make this one now"}>
          {making ? "making…" : t.candidates.length ? "again" : "make"}
        </button>
        <button className="link small" onClick={() => file.current?.click()} title="Use your own picture (or drop one on the card)">
          my own
        </button>
        <input ref={file} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => (take(e.target.files), (e.target.value = ""))} />
        {others.length ? (
          <button className="link small" onClick={() => setBorrowing((b) => !b)} title="Try a picture from another idea under these words (or drag one onto this card)">
            {borrowing ? "close" : "borrow"}
          </button>
        ) : null}
        {png ? (
          <a className="small" href={png} download={fileName(title, n)} title="The 1280×720 PNG for YouTube">
            download
          </a>
        ) : null}
        <button className="link small" onClick={onRemove} title="Drop this idea (its pictures stay on disk)">
          ×
        </button>
      </div>
      {t.error ? <div className="small warn">✖ {t.error}</div> : null}
    </div>
  );
};
