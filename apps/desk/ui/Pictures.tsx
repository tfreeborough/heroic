/**
 * The Scripts tab's Pictures step (docs/design/desk-ascii-scripts.md): a
 * picture per beat (two on a long one), each shown AS GLYPHS with the real
 * engine and its own look seed, because a picture that's fine as a photo
 * can turn to mush as glyphs. Approve, again, edit the prompt, my own,
 * reroll the look; the beat's mood for the score, its pulled word, a
 * chapter starting there.
 */
import { ARRIVALS, LOCKED_LOOK, ORDERS, PALETTES, drawBuild, inkFromImage, lookFromSeed, newCache, planBuild } from "@heroic/ascii-build";
import { loadFont } from "@remotion/google-fonts/JetBrainsMono";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameApi, Script } from "./api";
import { type Beat, type BeatMood, type BeatPicture, CHAPTERS_FROM, CHAPTER_GAP, SCORE_MOODS, type ScoreMood, allowedChapters, beatStarts, newLook, picturesWanted, spokenSeconds } from "../lib/scripts";

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

/** One loop of the preview: build, hold, leave. */
const BUILD = { start: 0.1, end: 2.6 };
const EXIT = { start: 4.4, end: 5.6 };
const LOOP = 6;
/** The still: everything landed, nothing left yet. */
const STILL = 4;

/**
 * A picture as the video will build it: the real engine, the locked look,
 * this picture's look seed. A still until hovered (or just landed), then it
 * builds on a loop. Forty animating canvases would melt the page.
 */
export const GlyphPicture: React.FC<{ url: string; look: number; palette: Palette; play?: boolean }> = ({ url, look, palette, play }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [build, setBuild] = useState<ReturnType<typeof planBuild> | null>(null);
  const [hover, setHover] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const cache = useRef(newCache());
  useEffect(() => {
    let live = true;
    setBuild(null);
    void Promise.all([loadImage(url), document.fonts.load(`700 12px "${fontFamily}"`)])
      .then(([img]) => {
        if (!live || !canvas.current) return;
        const { width: w, height: h } = canvas.current;
        const ink = inkFromImage(img, "light", 512, "auto");
        const { arrival, order } = lookFromSeed(look);
        setBuild(planBuild({ ink, look: LOCKED_LOOK, box: { x: 0, y: 0, w, h }, frame: { w, h }, start: BUILD.start, end: BUILD.end, seed: look, arrival, order, exit: EXIT }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url, look]);
  const playing = Boolean(play || hover) && !showOriginal;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !build) return;
    const pal = PALETTES[palette];
    const draw = (t: number) => {
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      drawBuild(ctx, build, t, { palette: pal, family: FAMILY, ambient: true, glow: 0.25, glowFrom: BUILD.end + 0.3, cache: cache.current });
    };
    if (!playing) {
      draw(STILL);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      draw(((now - t0) / 1000) % LOOP);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [build, playing, palette]);
  return (
    <div className="glyphs" onMouseEnter={() => setHover(true)} onMouseLeave={() => (setHover(false), setShowOriginal(false))}>
      <canvas ref={canvas} width={640} height={360} style={{ display: showOriginal ? "none" : "block" }} />
      {showOriginal ? <img src={url} alt="" /> : null}
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

export const PicturesStep: React.FC<{
  s: Script;
  api: GameApi;
  claude: boolean;
  images: boolean;
  palette: Palette;
  busy: string;
  pending: string[];
  onBeat: BeatEdit;
  onPlan: (all: boolean) => void;
  onMake: (only?: { beat: string; k: number }[]) => void;
  onOwn: (beat: string, k: number, file: File) => void;
  onNewPrompt: (beat: string, k: number, instruction: string) => void;
}> = ({ s, api, claude, images, palette, busy, pending, onBeat, onPlan, onMake, onOwn, onNewPrompt }) => {
  const beats = s.long?.beats ?? [];
  const planned = beats.some((b) => b.pictures?.length);
  const pics = beats.flatMap((b) => b.pictures ?? []);
  const toMake = beats.reduce((n, b) => n + (b.pictures ?? []).filter((p, k) => p.prompt.trim() && !p.candidates.length && !pending.includes(`${b.id}:${k}`)).length, 0);
  const unapproved = pics.filter((p) => p.chosen && !p.approved).length;
  const starts = useMemo(() => beatStarts(beats), [beats]);
  const total = beats.reduce((n, b) => n + spokenSeconds(b.text), 0);
  const allowed = useMemo(() => allowedChapters(beats), [beats]);
  const chapters = beats.filter((b) => b.chapter?.trim());
  // A picture that just landed builds once, so it's seen as glyphs straight away.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Map<string, string | undefined>>(new Map());
  useEffect(() => {
    const now = new Set<string>();
    for (const b of beats)
      (b.pictures ?? []).forEach((p, k) => {
        const key = `${b.id}:${k}`;
        const was = seen.current.get(key);
        if (seen.current.has(key) && p.chosen && p.chosen !== was) now.add(key);
        seen.current.set(key, p.chosen);
      });
    if (!now.size) return;
    setFresh((f) => new Set([...f, ...now]));
    const t = setTimeout(() => setFresh((f) => new Set([...f].filter((k) => !now.has(k)))), LOOP * 1000);
    return () => clearTimeout(t);
  }, [beats]);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => onPlan(planned)} disabled={!claude || Boolean(busy)} title={planned ? "Every beat planned again: new prompts, moods, pulled words and chapters. Pictures already made are kept." : "Claude writes a picture prompt for every beat (two for a long one), the music's mood under it, a pulled word now and then, and the chapters."}>
          {busy === "plan" ? "planning…" : planned ? "Plan again" : "Plan the pictures"}
        </button>
        {planned ? (
          <button className="ghost" onClick={() => onMake()} disabled={!images || !toMake} title={images ? "Every picture not yet made, four at a time; each lands here as it finishes." : "Needs OPENAI_API_KEY in apps/desk/.env"}>
            {toMake ? `Make ${toMake} picture${toMake === 1 ? "" : "s"}` : pending.length ? `making ${pending.length}…` : "All made"}
          </button>
        ) : null}
        {unapproved ? (
          <button className="ghost small" onClick={() => beats.forEach((b) => b.pictures?.some((p) => p.chosen && !p.approved) && onBeat(b.id, (x) => ({ ...x, pictures: x.pictures?.map((p) => (p.chosen ? { ...p, approved: true } : p)) })))}>
            Approve all {unapproved}
          </button>
        ) : null}
        <span className="small muted">
          {pics.filter((p) => p.approved).length}/{pics.length} approved · {pending.length ? `${pending.length} making · ` : ""}hover a picture to watch it build
        </span>
        {!images ? <span className="small warn">Pictures need OPENAI_API_KEY in apps/desk/.env.</span> : null}
      </div>
      {planned ? (
        <div className="small muted">
          {total < CHAPTERS_FROM
            ? `No chapters: the video is about ${fmtTime(total)} and chapters start at ${CHAPTERS_FROM / 60} minutes.`
            : chapters.length
              ? `Chapters: ${chapters.map((b) => `${b.chapter} (${fmtTime(starts[beats.indexOf(b)]!)})${allowed.has(b.id) ? "" : " ✖ too close"}`).join(" · ")}. At most one every ${CHAPTER_GAP / 60} minutes.`
              : `No chapters yet. Add one on the beat it starts at (at most one every ${CHAPTER_GAP / 60} minutes).`}
        </div>
      ) : (
        <div className="small muted">Plan the pictures and every beat gets a scene to build out of glyphs while you say it, plus a mood for the music. Change anything, make the pictures, then approve them or try again.</div>
      )}
      {planned ? (
        <div className="beats">
          {beats.map((b, i) => (
            <PictureRow
              key={b.id}
              api={api}
              n={i + 1}
              at={starts[i]!}
              beat={b}
              palette={palette}
              images={images}
              chapterOk={allowed.has(b.id)}
              short={total < CHAPTERS_FROM}
              pending={pending}
              fresh={fresh}
              onBeat={(f) => onBeat(b.id, f)}
              onMake={(k) => onMake([{ beat: b.id, k }])}
              onOwn={(k, f) => onOwn(b.id, k, f)}
              claude={claude}
              busy={busy}
              onNewPrompt={(k, ins) => onNewPrompt(b.id, k, ins)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

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

const PictureRow: React.FC<{
  api: GameApi;
  n: number;
  at: number;
  beat: Beat;
  palette: Palette;
  images: boolean;
  chapterOk: boolean;
  short: boolean;
  pending: string[];
  fresh: Set<string>;
  onBeat: (f: (b: Beat) => Beat) => void;
  onMake: (k: number) => void;
  onOwn: (k: number, f: File) => void;
  claude: boolean;
  busy: string;
  onNewPrompt: (k: number, instruction: string) => void;
}> = ({ api, n, at, beat, palette, images, chapterOk, short, pending, fresh, onBeat, onMake, onOwn, claude, busy, onNewPrompt }) => {
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
            {!chapterOk && beat.chapter.trim() ? <span className="small warn">{short ? "the video's too short for chapters" : "too close to the chapter before (it won't show)"}</span> : null}
            <button className="link small" onClick={() => onBeat((b) => ({ ...b, chapter: undefined }))} title="No chapter here">
              ×
            </button>
          </div>
        ) : null}
        <div className="small plan-words">
          <Words text={beat.text} pulled={beat.pulled ?? []} />
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
              play={fresh.has(`${beat.id}:${k}`)}
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
          {!pictures.length ? <div className="small muted">Not planned yet: Plan the pictures, or drop your own image here.</div> : null}
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
  play: boolean;
  onChange: (f: (p: BeatPicture) => BeatPicture) => void;
  onMake: () => void;
  onOwn: (f: File) => void;
  claude: boolean;
  writing: boolean;
  onNewPrompt: (instruction: string) => void;
  onDrop?: () => void;
}> = ({ api, p, label, palette, images, making, play, onChange, onMake, onOwn, claude, writing, onNewPrompt, onDrop }) => {
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
        <GlyphPicture url={api.publicUrl(p.chosen)} look={p.look} palette={palette} play={play} />
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
