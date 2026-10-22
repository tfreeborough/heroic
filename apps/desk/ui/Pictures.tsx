/**
 * The Scripts tab's Pictures stage (docs/design/desk-ascii-scripts.md): a
 * picture per beat (two on a long one), each shown AS GLYPHS with the real
 * engine and its own look seed, because a picture that's fine as a photo
 * can turn to mush as glyphs. A grid of them, the picked one's beat open
 * on the right (docs/design/desk-scripts-ux.md): approve, again, edit the
 * prompt, my own, reroll the look; the beat's mood for the score, its
 * pulled word, a chapter starting there.
 */
import { ARRIVALS, LOCKED_LOOK, ORDERS, PALETTES, drawBuild, inkFromImage, lookFromSeed, newCache, planBuild } from "@heroic/ascii-build";
import { loadFont } from "@remotion/google-fonts/JetBrainsMono";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { GameApi, Script } from "./api";
import { type Beat, type BeatMood, type BeatPicture, CHAPTER_GAP, type PlanState, SCORE_MOODS, type ScoreMood, allowedChapters, beatStarts, newLook, picturesWanted, spokenSeconds } from "../lib/scripts";

const { fontFamily } = loadFont("normal", { weights: ["700"], subsets: ["latin"] });
const FAMILY = `"${fontFamily}", ui-monospace, monospace`;

export type Palette = keyof typeof PALETTES;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(new Error(`couldn't load ${src}`));
    img.src = src;
  });

/** The build's timing, only so the still lands at the same moment the video holds on: everything landed, nothing left yet. */
const BUILD = { start: 0.1, end: 2.6 };
const EXIT = { start: 4.4, end: 5.6 };
const STILL = 4;

/** The Beats video's frame and its default glyph columns (apps/bits-promos/src/Beats.tsx `cols`): the preview shows exactly the detail the video will. */
const FRAME = { w: 1920, h: 1080 };
export const VIDEO_COLS = 280;

/** One canvas for every still: each picture is drawn at full frame size once, then kept as an image. */
let frameCanvas: HTMLCanvasElement | null = null;

/**
 * A picture as the video will show it once built: the real engine at the
 * video's frame size and columns, drawn once as a still (no animation:
 * the build order is a random seed anyway, so watching it told nothing).
 */
export const GlyphPicture: React.FC<{ url: string; look: number; palette: Palette }> = ({ url, look, palette }) => {
  const [still, setStill] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setStill(null);
    void Promise.all([loadImage(url), document.fonts.load(`700 12px "${fontFamily}"`)])
      .then(([img]) => {
        if (!live) return;
        frameCanvas ??= Object.assign(document.createElement("canvas"), { width: FRAME.w, height: FRAME.h });
        const ctx = frameCanvas.getContext("2d")!;
        const ink = inkFromImage(img, "light", 512, "auto");
        const { arrival, order } = lookFromSeed(look);
        const build = planBuild({ ink, look: { ...LOCKED_LOOK, cols: VIDEO_COLS }, box: { x: 0, y: 0, ...FRAME }, frame: FRAME, start: BUILD.start, end: BUILD.end, seed: look, arrival, order, exit: EXIT });
        const pal = PALETTES[palette];
        ctx.fillStyle = pal.bg;
        ctx.fillRect(0, 0, FRAME.w, FRAME.h);
        drawBuild(ctx, build, STILL, { palette: pal, family: FAMILY, ambient: true, glow: 0.25, glowFrom: BUILD.end + 0.3, cache: newCache() });
        // toBlob copies the canvas as it is right now, so the shared canvas is free for the next picture straight away.
        frameCanvas.toBlob((blob) => {
          if (!blob) return;
          made = URL.createObjectURL(blob);
          if (live) setStill(made);
          else URL.revokeObjectURL(made);
        });
      })
      .catch(() => {});
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url, look, palette]);
  return (
    <div className="glyphs" onMouseLeave={() => setShowOriginal(false)}>
      {showOriginal ? <img src={url} alt="" /> : still ? <img src={still} alt="" /> : null}
      <button className="link small glyphs-orig" onMouseEnter={() => setShowOriginal(true)} onMouseLeave={() => setShowOriginal(false)} title="The picture as it came">
        original
      </button>
    </div>
  );
};

const lookLabel = (seed: number) => {
  const { arrival, order } = lookFromSeed(seed);
  return `${ARRIVALS[arrival].label.toLowerCase()} · ${ORDERS[order].toLowerCase()}`;
};
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

type BeatEdit = (beatId: string, f: (b: Beat) => Beat) => void;

const castText = (cast: Script["cast"]) => (cast ?? []).map((c) => `${c.name}: ${c.look}`).join("\n");

/** The world's look (sent with every picture) and its cast (written out in every prompt they're in). The cast saves when the box loses focus, so a half-typed line isn't dropped. */
const WorldLook: React.FC<{ s: Script; onWorld: (w: Pick<Script, "theme" | "look" | "cast">) => void }> = ({ s, onWorld }) => {
  const [cast, setCast] = useState(castText(s.cast));
  useEffect(() => setCast(castText(s.cast)), [s.cast]);
  const saveCast = () =>
    onWorld({
      theme: s.theme,
      look: s.look,
      cast: cast.split("\n").flatMap((line) => {
        const at = line.indexOf(":");
        return at > 0 && line.slice(at + 1).trim() ? [{ name: line.slice(0, at).trim(), look: line.slice(at + 1).trim() }] : [];
      }),
    });
  return (
    <>
      <div className="row" style={{ gap: 8 }} title="Sent to the image model with every picture: it never sees the world above or the script, so this is how it knows what era and genre it's drawing. Literal things only, no colours. Empty: Plan again writes it.">
        <span className="small muted">look</span>
        <input type="text" value={s.look ?? ""} onChange={(e) => onWorld({ theme: s.theme, look: e.target.value, cast: s.cast })} placeholder="Empty: Plan again writes what this world looks like" style={{ flex: 1 }} />
      </div>
      <div className="row" style={{ gap: 8, alignItems: "flex-start" }} title="Who and what comes back from picture to picture, one per line as name: look. A cast member's look is written out word for word in every prompt they're in, so they're drawn the same each time. Changes apply at the next Plan again or new prompt.">
        <span className="small muted">cast</span>
        <textarea rows={Math.min(6, Math.max(2, (s.cast?.length ?? 0) + 1))} value={cast} onChange={(e) => setCast(e.target.value)} onBlur={saveCast} placeholder="Empty: Plan again writes it. One per line, name: what they look like" style={{ flex: 1 }} />
      </div>
    </>
  );
};

export const PicturesStep: React.FC<{
  s: Script;
  api: GameApi;
  claude: boolean;
  images: boolean;
  palette: Palette;
  busy: string;
  pending: string[];
  /** The story or the prompts running on the server, or how the last run failed. */
  planning: PlanState | null;
  onBeat: BeatEdit;
  onStory: () => void;
  onPrompts: (all: boolean) => void;
  onWorld: (w: Pick<Script, "theme" | "look" | "cast">) => void;
  onMake: (only?: { beat: string; k: number }[]) => void;
  onOwn: (beat: string, k: number, file: File) => void;
  onNewPrompt: (beat: string, k: number, instruction: string) => void;
}> = ({ s, api, claude, images, palette, busy, pending, planning, onBeat, onStory, onPrompts, onWorld, onMake, onOwn, onNewPrompt }) => {
  const beats = s.long?.beats ?? [];
  // The story first (a scene line a beat), then the prompts from it, then the pictures.
  const storied = beats.some((b) => b.scene?.trim());
  const planned = beats.some((b) => b.pictures?.length);
  const planRunning = planning?.state === "running";
  const toWrite = beats.filter((b) => !b.pictures?.length).length;
  const pics = beats.flatMap((b) => b.pictures ?? []);
  const toMake = beats.reduce((n, b) => n + (b.pictures ?? []).filter((p, k) => p.prompt.trim() && !p.candidates.length && !pending.includes(`${b.id}:${k}`)).length, 0);
  const unapproved = pics.filter((p) => p.chosen && !p.approved).length;
  // Remake all: another try at every made picture not yet approved (an approved one is a keep). The old tries stay to pick from.
  const toRemake = beats.flatMap((b) => (b.pictures ?? []).flatMap((p, k) => (p.prompt.trim() && p.candidates.length && !p.approved && !pending.includes(`${b.id}:${k}`) ? [{ beat: b.id, k }] : [])));
  const [confirmRemake, setConfirmRemake] = useState(false);
  const starts = useMemo(() => beatStarts(beats), [beats]);
  const allowed = useMemo(() => allowedChapters(beats), [beats]);
  const chapters = beats.filter((b) => b.chapter?.trim());

  // The grid: a tile per picture (a beat not planned yet gets one empty tile), filtered; the picked one open on the right.
  const tiles = useMemo<Tile[]>(() => beats.flatMap((beat, i): Tile[] => ((beat.pictures ?? []).length ? beat.pictures!.map((p, k) => ({ beat, n: i + 1, k, p, of: beat.pictures!.length })) : [{ beat, n: i + 1, k: 0, p: undefined, of: 0 }])), [beats]);
  const [show, setShow] = useState<"all" | "approve" | "unmade">("all");
  const shown = tiles.filter((t) => (show === "approve" ? t.p?.chosen && !t.p.approved : show === "unmade" ? !t.p?.chosen : true));
  const [picked, setPicked] = useState("");
  const sel = shown.find((t) => `${t.beat.id}:${t.k}` === picked) ?? tiles.find((t) => `${t.beat.id}:${t.k}` === picked) ?? shown[0];
  // ← → through the tiles shown, A approves the picked one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.tagName === "SELECT" || e.metaKey || e.ctrlKey || e.altKey || !sel) return;
      const i = shown.indexOf(sel);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const to = shown[i + (e.key === "ArrowRight" ? 1 : -1)];
        if (to) {
          e.preventDefault();
          setPicked(`${to.beat.id}:${to.k}`);
          document.getElementById(`tile-${to.beat.id}-${to.k}`)?.scrollIntoView({ block: "nearest" });
        }
      } else if ((e.key === "a" || e.key === "A") && sel.p?.chosen) {
        e.preventDefault();
        onBeat(sel.beat.id, (b) => ({ ...b, pictures: b.pictures?.map((p, k) => (k === sel.k ? { ...p, approved: !p.approved } : p)) }));
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button onClick={onStory} disabled={!claude || Boolean(busy) || planRunning} title={storied ? "The story again, in the world above: a new scene line for every beat, the moods, the pulled words and the chapters. Prompts and pictures already written stay until you write them again." : "One call over the whole script: Claude picks the video's world and cast, the chapters, and writes one line per beat saying what its picture shows, so you can read the story before any prompt is written."}>
          {planRunning && planning.stage === "story" ? "planning the story…" : storied ? "Plan the story again" : "Plan the story"}
        </button>
        {storied ? (
          <button onClick={() => onPrompts(planned && !toWrite)} disabled={!claude || Boolean(busy) || planRunning} title={planned && !toWrite ? "Every prompt written again from the story as it stands now. Pictures already made are kept, and marked to check where their prompt changed." : "Each beat's scene line told as a full picture prompt (two for a long beat), a batch of beats at a time, each landing here as it's done."}>
            {planRunning && planning.stage === "prompts" ? `writing prompts ${planning.done}/${planning.total}…` : planned && !toWrite ? "Write the prompts again" : `Write the prompts${planned ? ` (${toWrite} left)` : ""}`}
          </button>
        ) : null}
        {planned ? (
          <button className="ghost" onClick={() => onMake()} disabled={!images || !toMake || planRunning} title={images ? "Every picture not yet made, four at a time; each lands here as it finishes." : "Needs OPENAI_API_KEY in apps/desk/.env"}>
            {toMake ? `Make ${toMake} picture${toMake === 1 ? "" : "s"}` : pending.length ? `making ${pending.length}…` : "All made"}
          </button>
        ) : null}
        {toRemake.length ? (
          confirmRemake ? (
            <span className="row small" style={{ gap: 6 }}>
              Remake {toRemake.length}?
              <button className="ghost small" onClick={() => (setConfirmRemake(false), onMake(toRemake))}>
                yes
              </button>
              <button className="link small" onClick={() => setConfirmRemake(false)}>
                no
              </button>
            </span>
          ) : (
            <button className="ghost" onClick={() => setConfirmRemake(true)} disabled={!images} title="Another try at every picture already made that you haven't approved (approved ones are kept as they are). The old tries stay to pick from.">
              Remake all {toRemake.length}
            </button>
          )
        ) : null}
        {unapproved ? (
          <button className="ghost small" onClick={() => beats.forEach((b) => b.pictures?.some((p) => p.chosen && !p.approved) && onBeat(b.id, (x) => ({ ...x, pictures: x.pictures?.map((p) => (p.chosen ? { ...p, approved: true } : p)) })))}>
            Approve all {unapproved}
          </button>
        ) : null}
        <span className="small muted">
          {pics.filter((p) => p.approved).length}/{pics.length} approved{pending.length ? ` · ${pending.length} making` : ""}
        </span>
        {!images ? <span className="small warn">Pictures need OPENAI_API_KEY in apps/desk/.env.</span> : null}
      </div>
      <div className="row" style={{ gap: 8 }} title="Every picture in the video lives in this world. Claude picks one at the first plan; write your own, or clear it and Plan again for a new one.">
        <span className="small muted">world</span>
        {/* A new world needs a new look and cast: they're cleared so Plan again writes them for it. */}
        <input type="text" value={s.theme ?? ""} onChange={(e) => onWorld({ theme: e.target.value, look: undefined, cast: undefined })} placeholder={planned ? "Empty: Plan again and Claude picks a new one" : "Empty: Claude picks one from the script. Or write your own (a submarine crew, a lighthouse winter…)"} style={{ flex: 1 }} />
      </div>
      {s.theme?.trim() ? <WorldLook s={s} onWorld={onWorld} /> : null}
      {storied ? (
        <div className="small muted">
          {chapters.length
            ? `Chapters: ${chapters.map((b) => `${b.chapter} (${fmtTime(starts[beats.indexOf(b)]!)})${allowed.has(b.id) ? "" : " ✖ too close"}`).join(" · ")}. YouTube only shows its chapter bar with three or more.`
            : `No chapters yet. Add one on the beat it starts at.`}
        </div>
      ) : (
        <div className="small muted">Plan the story and Claude picks the video's world and writes one line per beat saying what its picture shows. Read it, change what's wrong, then write the prompts from it, make the pictures, and approve them or try again.</div>
      )}
      {storied ? <Story beats={beats} open={!planned} starts={starts} onBeat={onBeat} onPick={(id) => (setPicked(`${id}:0`), document.getElementById(`tile-${id}-0`)?.scrollIntoView({ block: "nearest" }))} /> : null}
      {storied || planned ? (
        <div className="pic-stage">
          <div className="stack" style={{ gap: 8, minWidth: 0 }}>
            <div className="row" style={{ gap: 4 }}>
              {(
                [
                  ["all", `all ${tiles.length}`],
                  ["approve", `to approve ${tiles.filter((t) => t.p?.chosen && !t.p.approved).length}`],
                  ["unmade", `not made ${tiles.filter((t) => !t.p?.chosen).length}`],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={`chip ${show === k ? "on" : ""}`} onClick={() => setShow(k)}>
                  {label}
                </button>
              ))}
              <span className="grow" />
              <span className="small muted">← → move · A approves</span>
            </div>
            <div className="pic-tiles">
              {shown.map((t) => (
                <PictureTile
                  key={`${t.beat.id}:${t.k}`}
                  api={api}
                  t={t}
                  palette={palette}
                  on={sel?.beat.id === t.beat.id && sel.k === t.k}
                  making={pending.includes(`${t.beat.id}:${t.k}`)}
                  onPick={() => setPicked(`${t.beat.id}:${t.k}`)}
                />
              ))}
              {!shown.length ? <div className="small muted">Nothing here.</div> : null}
            </div>
          </div>
          <div className="pic-detail">
            {sel ? (
              <PictureRow
                key={sel.beat.id}
                api={api}
                n={sel.n}
                at={starts[sel.n - 1]!}
                beat={sel.beat}
                palette={palette}
                images={images}
                chapterOk={allowed.has(sel.beat.id)}
                pending={pending}
                onBeat={(f) => onBeat(sel.beat.id, f)}
                onMake={(k) => onMake([{ beat: sel.beat.id, k }])}
                onOwn={(k, f) => onOwn(sel.beat.id, k, f)}
                claude={claude}
                busy={busy}
                onNewPrompt={(k, ins) => onNewPrompt(sel.beat.id, k, ins)}
              />
            ) : (
              <div className="small muted">Pick a picture.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

/**
 * The story as a page: one line per beat saying what its picture shows,
 * chapters as headings, each line yours to change before the prompts are
 * written from it. Open by default until the prompts exist.
 */
const Story: React.FC<{ beats: Beat[]; open: boolean; starts: number[]; onBeat: BeatEdit; onPick: (id: string) => void }> = ({ beats, open, starts, onBeat, onPick }) => (
  <details className="story" open={open}>
    <summary className="small">
      The story: {beats.length} scenes{beats.some((b) => !b.scene?.trim()) ? ` (${beats.filter((b) => !b.scene?.trim()).length} without a line)` : ""}. Change a line here, then write its prompt again.
    </summary>
    <div className="stack story-lines" style={{ gap: 2 }}>
      {beats.map((b, i) => (
        <Fragment key={b.id}>
          {b.chapter?.trim() ? <div className="rail-chapter">{b.chapter}</div> : null}
          <div className="row story-line" style={{ gap: 8, alignItems: "baseline" }}>
            <button className="link small muted story-n" onClick={() => onPick(b.id)} title={`${fmtTime(starts[i] ?? 0)} · ${b.text}`}>
              {i + 1}
            </button>
            <input type="text" value={b.scene ?? ""} onChange={(e) => onBeat(b.id, (x) => ({ ...x, scene: e.target.value }))} placeholder="What we see while this is said" style={{ flex: 1 }} />
            <span className="small muted story-mark" title={b.pictures?.length ? "prompt written" : "no prompt yet"}>
              {b.pictures?.length ? "✓" : "·"}
            </span>
          </div>
        </Fragment>
      ))}
    </div>
  </details>
);

/** The beat's words with its pulled words lit. */
const Words: React.FC<{ text: string; pulled: string[] }> = ({ text, pulled }) => {
  if (!pulled.length) return <>{text}</>;
  const want = new Set(pulled.map((w) => w.toLowerCase()));
  return (
    <>
      {text.split(/(\s+)/).map((w, k) => {
        const bare = w.toLowerCase().replace(/[^a-z0-9'’]/g, "");
        return want.has(bare) ? (
          <mark key={k} className="pulled">
            {w}
          </mark>
        ) : (
          <span key={k}>{w}</span>
        );
      })}
    </>
  );
};

type Tile = { beat: Beat; n: number; k: number; p: BeatPicture | undefined; of: number };

/** One picture in the grid: the glyph still, the beat's number, how it stands. */
const PictureTile: React.FC<{ api: GameApi; t: Tile; palette: Palette; on: boolean; making: boolean; onPick: () => void }> = ({ api, t, palette, on, making, onPick }) => (
  <div id={`tile-${t.beat.id}-${t.k}`} className={`pic-tile${on ? " on" : ""}${t.p?.approved ? " approved" : ""}`} onClick={onPick}>
    {t.p?.chosen ? <GlyphPicture url={api.publicUrl(t.p.chosen)} look={t.p.look} palette={palette} /> : <div className="glyphs empty small muted">{making ? "making…" : t.p?.error ? "✖ failed" : t.p ? "not made" : "not planned"}</div>}
    <div className="pic-tile-meta small">
      <span className="muted">
        {t.n}
        {t.of > 1 ? (t.k ? "b" : "a") : ""}
      </span>
      {t.beat.chapter?.trim() ? <span className="pic-tile-chapter">{t.beat.chapter}</span> : <span className="muted pic-tile-words">{t.beat.text}</span>}
      <span className="grow" />
      {t.p?.approved ? <span className="ok">✓</span> : making ? <span className="muted">…</span> : t.p?.check ? <span className="warn" title="Changed since it was made">!</span> : null}
    </div>
  </div>
);

const PictureRow: React.FC<{
  api: GameApi;
  n: number;
  at: number;
  beat: Beat;
  palette: Palette;
  images: boolean;
  chapterOk: boolean;
  pending: string[];
  onBeat: (f: (b: Beat) => Beat) => void;
  onMake: (k: number) => void;
  onOwn: (k: number, f: File) => void;
  claude: boolean;
  busy: string;
  onNewPrompt: (k: number, instruction: string) => void;
}> = ({ api, n, at, beat, palette, images, chapterOk, pending, onBeat, onMake, onOwn, claude, busy, onNewPrompt }) => {
  const [word, setWord] = useState("");
  const pictures = beat.pictures ?? [];
  const wants = picturesWanted(beat.text);
  const mood: BeatMood = beat.mood ?? { mood: "focus", intensity: 0.4 };
  const setPic = (k: number, f: (p: BeatPicture) => BeatPicture) => onBeat((b) => ({ ...b, pictures: (b.pictures ?? []).map((p, i) => (i === k ? f(p) : p)) }));
  const setMood = (m: Partial<BeatMood>) => onBeat((b) => ({ ...b, mood: { ...mood, ...m } }));
  const addWord = () => {
    const w = word.trim();
    if (!w) return;
    onBeat((b) => ({ ...b, pulled: [...new Set([...(b.pulled ?? []), w])].slice(0, 4) }));
    setWord("");
  };
  return (
    <div className={`beat pic-row ${beat.changed ? "changed" : ""}`}>
      <div className="beat-n small muted">{n}</div>
      <div className="stack" style={{ gap: 8, minWidth: 0 }}>
        {beat.chapter !== undefined ? (
          <div className="row chapter-row" style={{ gap: 8 }}>
            <span className="small muted">chapter</span>
            <input type="text" value={beat.chapter} onChange={(e) => onBeat((b) => ({ ...b, chapter: e.target.value }))} placeholder="Two to four words" style={{ flex: 1, maxWidth: 360 }} />
            <span className="small muted">at {fmtTime(at)}</span>
            {!chapterOk && beat.chapter.trim() ? <span className="small warn">{`within ${CHAPTER_GAP}s of the chapter before (it won't show)`}</span> : null}
            <button className="link small" onClick={() => onBeat((b) => ({ ...b, chapter: undefined }))} title="No chapter here">
              ×
            </button>
          </div>
        ) : null}
        <div className="small plan-words">
          <Words text={beat.text} pulled={beat.pulled ?? []} />
        </div>
        <div className="row" style={{ gap: 8 }} title="The story line: what the picture shows. The prompts are written from it; change it, then write the prompt again.">
          <span className="small muted">shows</span>
          <input type="text" value={beat.scene ?? ""} onChange={(e) => onBeat((b) => ({ ...b, scene: e.target.value }))} placeholder="What we see while this is said (Plan the story writes it)" style={{ flex: 1 }} />
        </div>
        <div className="pic-grid">
          {pictures.map((p, k) => (
            <PictureCard
              key={k}
              api={api}
              p={p}
              label={pictures.length > 1 ? (k ? "second half" : "first half") : ""}
              palette={palette}
              images={images}
              making={pending.includes(`${beat.id}:${k}`)}
              onChange={(f) => setPic(k, f)}
              onMake={() => onMake(k)}
              onOwn={(f) => onOwn(k, f)}
              claude={claude}
              writing={busy === `prompt:${beat.id}:${k}`}
              onNewPrompt={(ins) => onNewPrompt(k, ins)}
              onDrop={k ? () => onBeat((b) => ({ ...b, pictures: (b.pictures ?? []).slice(0, 1) })) : undefined}
            />
          ))}
          {pictures.length === 1 && wants > 1 ? (
            <button className="ghost small pic-add" onClick={() => onBeat((b) => ({ ...b, pictures: [...(b.pictures ?? []), { prompt: "", candidates: [], look: newLook() }] }))} title={`About ${spokenSeconds(beat.text)}s spoken: long enough for a second picture.`}>
              + second picture
            </button>
          ) : null}
          {!pictures.length ? <div className="small muted">{beat.scene?.trim() ? "No prompt yet: Write the prompts, or drop your own image here." : "Not planned yet: Plan the story, then write the prompts, or drop your own image here."}</div> : null}
        </div>
        <div className="row small muted beat-tools" style={{ gap: 10, flexWrap: "wrap" }}>
          <span>{spokenSeconds(beat.text)}s</span>
          <label className="row" style={{ gap: 4 }} title="What the music feels like under this beat">
            mood
            <select value={mood.mood} onChange={(e) => setMood({ mood: e.target.value as ScoreMood })} style={{ width: "auto", padding: "2px 6px" }}>
              {SCORE_MOODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="row" style={{ gap: 4 }} title="How much is going on in the music: 0 bare, 1 everything">
            intensity
            <input type="range" min={0} max={1} step={0.05} value={mood.intensity} onChange={(e) => setMood({ intensity: Number(e.target.value) })} style={{ width: 90 }} />
            {mood.intensity.toFixed(2)}
          </label>
          <label className="row" style={{ gap: 4 }} title="The turn of the whole video: the music steps up a key here. One or two a video at most, or it stops meaning anything.">
            <input type="checkbox" checked={Boolean(mood.lift)} onChange={(e) => setMood({ lift: e.target.checked || undefined })} />
            big moment
          </label>
          <span className="row" style={{ gap: 4 }} title="Words the picture's glyphs fly out to spell as you say them. Fewer is better.">
            pulled
            {(beat.pulled ?? []).map((w) => (
              <span key={w} className="chip">
                {w}
                <button className="link small" onClick={() => onBeat((b) => ({ ...b, pulled: (b.pulled ?? []).filter((x) => x !== w) }))}>
                  ×
                </button>
              </span>
            ))}
            <input type="text" value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWord()} placeholder="+ word" style={{ width: 80, padding: "2px 6px" }} />
          </span>
          {beat.chapter === undefined ? (
            <button className="link small" onClick={() => onBeat((b) => ({ ...b, chapter: "" }))}>
              + chapter here
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const PictureCard: React.FC<{
  api: GameApi;
  p: BeatPicture;
  label: string;
  palette: Palette;
  images: boolean;
  making: boolean;
  onChange: (f: (p: BeatPicture) => BeatPicture) => void;
  onMake: () => void;
  onOwn: (f: File) => void;
  claude: boolean;
  writing: boolean;
  onNewPrompt: (instruction: string) => void;
  onDrop?: () => void;
}> = ({ api, p, label, palette, images, making, onChange, onMake, onOwn, claude, writing, onNewPrompt, onDrop }) => {
  const file = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState("");
  const send = () => {
    onNewPrompt(ask);
    setAsk("");
    setAsking(false);
  };
  const take = (files: FileList | null) => {
    const f = files?.[0];
    if (f && f.type.startsWith("image/")) onOwn(f);
  };
  return (
    <div
      className={`pic-card ${p.approved ? "approved" : ""} ${over ? "over" : ""}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => (e.preventDefault(), setOver(false), take(e.dataTransfer.files))}
    >
      {p.chosen ? (
        <GlyphPicture url={api.publicUrl(p.chosen)} look={p.look} palette={palette} />
      ) : (
        <div className="glyphs empty small muted">{making ? "making…" : p.error ? "" : "not made yet · drop an image here"}</div>
      )}
      {p.candidates.length > 1 ? (
        <div className="pic-cands">
          {p.candidates.map((c) => (
            <button key={c} className={c === p.chosen ? "on" : ""} onClick={() => onChange((x) => ({ ...x, chosen: c, approved: false }))} title="Use this one">
              <img src={api.publicUrl(c)} alt="" />
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        rows={3}
        value={p.prompt}
        onChange={(e) => onChange((x) => ({ ...x, prompt: e.target.value, check: x.candidates.length ? true : undefined }))}
        placeholder="What the picture shows: one scene, where the light falls, the camera's angle"
      />
      <div className="row small" style={{ gap: 10, flexWrap: "wrap" }}>
        {label ? <span className="muted">{label}</span> : null}
        {p.chosen ? (
          <button className={p.approved ? "tickbtn on" : "tickbtn"} onClick={() => onChange((x) => ({ ...x, approved: !x.approved }))}>
            {p.approved ? "✓ approved" : "approve"}
          </button>
        ) : null}
        <button className="link small" disabled={!images || making || !p.prompt.trim()} onClick={onMake} title={p.candidates.length ? "Another picture from the prompt (the others stay to pick from)" : "Make this one now"}>
          {making ? "making…" : p.candidates.length ? "again" : "make"}
        </button>
        <button className="link small" disabled={!claude || writing} onClick={() => setAsking((v) => !v)} title="Claude writes this picture's prompt again (say what to change, or leave it blank for a better idea). Then press again to make it.">
          {writing ? "writing…" : "new prompt…"}
        </button>
        <button className="link small" onClick={() => file.current?.click()} title="Use your own image (or drop one on the card)">
          my own
        </button>
        <input ref={file} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => (take(e.target.files), (e.target.value = ""))} />
        <button className="link small" onClick={() => onChange((x) => ({ ...x, look: newLook() }))} title="A new look seed: how the glyphs arrive and fill in. The picture stays.">
          reroll look
        </button>
        <span className="muted" title={`look seed ${p.look}`}>
          {lookLabel(p.look)}
        </span>
        {onDrop ? (
          <button className="link small" onClick={onDrop} title="Just the one picture on this beat">
            ×
          </button>
        ) : null}
      </div>
      {asking ? (
        <div className="row" style={{ gap: 6 }}>
          <input
            type="text"
            autoFocus
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
              if (e.key === "Escape") setAsking(false);
            }}
            placeholder='"closer on his hands", "show the arena", "less literal"… or blank'
            style={{ flex: 1, padding: "4px 8px" }}
          />
          <button className="ghost small" onClick={send}>
            Write it
          </button>
        </div>
      ) : null}
      {p.check ? <div className="small warn">The words or the prompt changed since this was made: press again to make it from the new prompt.</div> : null}
      {p.error ? <div className="small warn">✖ {p.error}</div> : null}
    </div>
  );
};
