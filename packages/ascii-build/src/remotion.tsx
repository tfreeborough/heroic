/**
 * The glyph look in a Remotion video (docs/design/desk-ascii-scripts.md):
 *
 *   BuildLayer        an edit's BUILD cards: each picture builds itself out
 *                     of glyphs at the start of its card, holds, and falls
 *                     away as rain while the next one is already arriving;
 *                     a PULLED word borrows the picture's glyphs to spell
 *                     itself large as it's said, then gives them back
 *   TextBuild         words built out of glyphs (the title, a chapter, the
 *                     channel name)
 *   ChapterCard       the name built, then rain
 *   EndCard           every picture again as a reel, a mosaic of them all,
 *                     the channel name out of their glyphs, then a hold for
 *                     YouTube's end screen
 *   TerminalCaptions  the voice as a terminal line: each word decodes out
 *                     of scrambled glyphs on the frame it's said, the line
 *                     scrolls up when it fills, a cursor blinks in the pauses
 *
 * Content in, look out: a game's template hands over its palette, font
 * and where things sit. Import from "@heroic/ascii-build/remotion" (the
 * main entry stays free of Remotion for the Desk's pages).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { AbsoluteFill, Sequence, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { type BuildCache, drawBuild, newCache } from "./draw";
import { type Ink, inkFromImage } from "./ink";
import { inkFromText } from "./text";
import { type Look, type Palette, clamp, hash, lerp, mulberry, rgba, smooth } from "./look";
import { type Arrival, type Build, type Order, type Rect, lookFromSeed, planBuild } from "./plan";
import { CHAPTER_CARD } from "./video";

const srcUrl = (src: string) => (/^(\/|https?:|blob:|data:)/.test(src) ? src : staticFile(src));

// ── builds ──

/** A picture to build: where it is, its look seed, its stretch of the video (seconds), and any pulled words (seconds from its start). */
export type BuildShow = { id: string; src: string; seed: number; at: number; seconds: number; pulls?: { word: string; at: number }[]; /** A fast start: much of the picture lands in the first moments (a short's opening frame, under its hook). */ burst?: boolean };

/** The burst: this share of the glyphs set off in the first this-many seconds (Autosave's first-second hook, quicker). */
export const BURST = { share: 0.45, seconds: 0.6 } as const;

/** Seconds a build keeps falling away after its card ends (the next one is arriving meanwhile). */
export const BUILD_TAIL = 1;

export type BuildTiming = { start: number; end: number; exit?: { start: number; end: number } };

/** When a card's build happens, from its own start: in over the first 60% (at most 8s), out as rain across its end. */
export const buildTiming = (seconds: number) => {
  const end = clamp(Math.min(seconds * 0.6, 8), Math.min(1.2, seconds * 0.7), 8);
  return { start: 0.12, end, exit: { start: Math.max(end + 0.2, seconds - 0.25), end: Math.max(end + 0.2, seconds - 0.25) + BUILD_TAIL + 0.25 } };
};

/** Holds the render until `load` settles (an image, a font). */
const useLoaded = <T,>(label: string, load: () => Promise<T>, deps: unknown[]): T | null => {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    const handle = delayRender(label);
    let live = true;
    let done = false;
    const finish = () => {
      if (!done) (done = true), continueRender(handle);
    };
    load()
      .then((v) => live && setValue(v))
      .catch(() => {})
      .finally(finish);
    return () => {
      live = false;
      finish();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(new Error(`couldn't load ${src}`));
    img.src = srcUrl(src);
  });

/** A picture's ink, loaded once. */
const usePictureInk = (src: string, family: string): Ink | null =>
  useLoaded(`glyph picture ${src}`, async () => {
    const [img] = await Promise.all([loadImage(src), document.fonts.load(`700 20px ${family}`).catch(() => [])]);
    return inkFromImage(img, "light", 512, "auto");
  }, [src, family]);

export { inkFromText };

/** Type builds best with a hard edge (the dither edge eats the first and last letters). */
const textLook = (look: Look, cols: number): Look => ({ ...look, cols, edge: "hard", levels: Math.max(look.levels, 4) });

// ── pulled words ──

/** Seconds a pulled word takes: out, hold, back. It starts a moment before the word is said. */
const PULL = { early: 0.15, out: 0.45, hold: 1.0, back: 0.45 };
export const PULL_SECONDS = PULL.out + PULL.hold + PULL.back;

type PullPlan = { at: number; sources: Build["cells"]; targets: Build["cells"]; fontFrom: number; fontTo: number };

/** Which of the picture's glyphs fly where to spell `word`. */
const planPull = (build: Build, word: string, at: number, family: string, look: Look, seed: number, frame: { w: number; h: number }): PullPlan => {
  const ink = inkFromText(word.toUpperCase(), `800 220px ${family}`, 4000);
  const box = { x: frame.w * 0.1, y: frame.h * 0.26, w: frame.w * 0.8, h: frame.h * 0.36 };
  const cols = Math.round(clamp(word.length * 11, 36, 120));
  const target = planBuild({ ink, look: textLook(look, cols), box, frame, start: 0, end: 0.01, seed, arrival: "pop", order: "random" });
  // The picture's brightest glyphs go first: they're the ones you see leave.
  const r = mulberry(seed * 13 + 7);
  const pool = [...build.cells].sort((a, b) => b.v - a.v + (r() - 0.5) * 0.6);
  const sources = target.cells.map((_, i) => pool[i % Math.max(1, pool.length)]!);
  return { at, sources, targets: target.cells, fontFrom: build.fontPx, fontTo: target.fontPx };
};

/** How far a pulled glyph is towards its letter at `t` (0 = in the picture, 1 = in the word). */
const pullAt = (p: PullPlan, i: number, t: number): number => {
  const t0 = p.at - PULL.early + hash(i * 7 + 3) * 0.15;
  if (t < t0) return 0;
  if (t < t0 + PULL.out + PULL.hold) return smooth(clamp((t - t0) / PULL.out, 0, 1));
  return 1 - smooth(clamp((t - t0 - PULL.out - PULL.hold) / PULL.back, 0, 1));
};

const drawPull = (ctx: CanvasRenderingContext2D, b: Build, p: PullPlan, t: number, pal: Palette, family: string) => {
  const t0 = p.at - PULL.early;
  const t1 = t0 + PULL_SECONDS + 0.2;
  if (t < t0 || t > t1) return;
  // The picture steps back while the word is up.
  const env = Math.min(smooth(clamp((t - t0) / 0.3, 0, 1)), smooth(clamp((t1 - t) / 0.35, 0, 1)));
  ctx.fillStyle = pal.bg;
  ctx.globalAlpha = 0.62 * env;
  ctx.fillRect(0, 0, b.frame.w, b.frame.h);
  ctx.globalAlpha = 1;
  // Where the borrowed glyphs were: holes.
  for (let i = 0; i < p.sources.length; i++) {
    if (pullAt(p, i, t) <= 0.02) continue;
    const s = p.sources[i]!;
    ctx.fillRect(s.x, s.y, b.cw, b.ch);
  }
  ctx.textBaseline = "top";
  let font = -1;
  for (let i = 0; i < p.targets.length; i++) {
    const e = pullAt(p, i, t);
    if (e <= 0.02) continue;
    const s = p.sources[i]!;
    const d = p.targets[i]!;
    const size = Math.round(lerp(p.fontFrom, p.fontTo, e) / 2) * 2;
    if (size !== font) {
      ctx.font = `700 ${size}px ${family}`;
      font = size;
    }
    const settled = e > 0.97;
    ctx.fillStyle = settled ? rgba(pal.ink, 0.55 + 0.45 * d.v) : e > 0.5 ? pal.head : rgba(pal.trail, 0.85);
    ctx.fillText(e > 0.5 ? d.ch : s.ch, lerp(s.x, d.x, e), lerp(s.y, d.y, e));
  }
};

// ── one build ──

/**
 * A build drawn at `t` (its own seconds): the picture (or text) as glyphs,
 * plus any pulled words. `t` comes from the parent so set pieces can run
 * their own clocks.
 */
const BuildCanvas: React.FC<{
  ink: Ink | null;
  seed: number;
  look: Look;
  box: Rect;
  timing: BuildTiming;
  t: number;
  palette: Palette;
  family: string;
  glow?: number;
  ambient?: boolean;
  hidden?: boolean;
  arrival?: Arrival;
  order?: Order;
  burst?: { share: number; seconds: number };
  pulls?: { word: string; at: number }[];
}> = ({ ink, seed, look, box, timing, t, palette, family, glow = 0, ambient = false, hidden = false, arrival, order, burst, pulls }) => {
  const { width, height } = useVideoConfig();
  const build = useMemo<Build | null>(() => {
    if (!ink) return null;
    const shuffled = lookFromSeed(seed);
    return planBuild({ ink, look, box, frame: { w: width, h: height }, start: timing.start, end: timing.end, seed, arrival: arrival ?? shuffled.arrival, order: order ?? shuffled.order, exit: timing.exit, ...(burst ? { burst } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ink, look, box.x, box.y, box.w, box.h, width, height, seed, timing.start, timing.end, timing.exit?.start, timing.exit?.end, arrival, order, burst?.share, burst?.seconds]);
  const pullPlans = useMemo(() => (build && pulls?.length ? pulls.map((p, i) => planPull(build, p.word, p.at, family, look, seed + i * 101, { w: width, h: height })) : []), [build, pulls, family, look, seed, width, height]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cache = useRef<BuildCache>(newCache());
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!build || hidden) return;
    drawBuild(ctx, build, t, { palette, family, ambient, glow, glowFrom: timing.end + 0.3, cache: cache.current });
    for (const p of pullPlans) drawPull(ctx, build, p, t, palette, family);
  }, [build, t, width, height, palette, family, glow, ambient, timing.end, hidden, pullPlans]);
  return <canvas ref={canvas} width={width} height={height} style={{ position: "absolute", inset: 0 }} />;
};

/** One build card, inside its own Sequence: frame 0 is its card's start. */
const OneBuild: React.FC<{ card: BuildShow; palette: Palette; family: string; look: Look; box: Rect; glow: number; hiddenAt?: (seconds: number) => boolean }> = ({ card, palette, family, look, box, glow, hiddenAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ink = usePictureInk(card.src, family);
  // A burst starts straight away: glyphs are already landing on the first frame.
  const timing = useMemo(() => (card.burst ? { ...buildTiming(card.seconds), start: 0.05 } : buildTiming(card.seconds)), [card.seconds, card.burst]);
  const t = frame / fps;
  return <BuildCanvas ink={ink} seed={card.seed} look={look} box={box} timing={timing} t={t} palette={palette} family={family} glow={glow} ambient hidden={hiddenAt?.(card.at + t) ?? false} pulls={card.pulls} burst={card.burst ? BURST : undefined} />;
};

/**
 * Every build card of an edit, each in its own Sequence so it only exists
 * while it shows (plus its tail). `offset` = the edit's frame at this
 * layer's frame zero. `hiddenAt` (edit seconds) skips drawing, e.g. while
 * footage plays over it.
 */
export const BuildLayer: React.FC<{
  cards: BuildShow[];
  offset?: number;
  palette: Palette;
  family: string;
  look: Look;
  /** Where the pictures may go (fitted inside, keeping their shape). Default: the whole frame. */
  box?: Rect;
  /** The tinted picture glowing under the glyphs once built, 0..1. */
  glow?: number;
  hiddenAt?: (seconds: number) => boolean;
}> = ({ cards, offset = 0, palette, family, look, box, glow = 0.22, hiddenAt }) => {
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const area = box ?? { x: 0, y: 0, w: width, h: height };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {[...cards]
        .sort((a, b) => a.at - b.at)
        .map((c) => {
          const from = Math.round(c.at * fps) - offset;
          const frames = Math.max(1, Math.round((c.seconds + BUILD_TAIL + 0.5) * fps));
          if (from + frames <= 0 || from >= durationInFrames) return null;
          return (
            <Sequence key={c.id} from={from} durationInFrames={frames} layout="none">
              <OneBuild card={c} palette={palette} family={family} look={look} box={area} glow={glow} hiddenAt={hiddenAt} />
            </Sequence>
          );
        })}
    </AbsoluteFill>
  );
};

// ── words built out of glyphs ──

/** Text as glyphs, on its own clock (frame 0 of where it's placed). `font` is the CSS font it's set in before it turns to glyphs. */
export const TextBuild: React.FC<{
  text: string;
  font: string;
  /** How wide the type may set before wrapping, px at the font's size. */
  maxWidth?: number;
  box: Rect;
  look: Look;
  cols: number;
  seed: number;
  timing: BuildTiming;
  palette: Palette;
  family: string;
  arrival?: Arrival;
  order?: Order;
  glow?: number;
}> = ({ text, font, maxWidth = 2600, box, look, cols, seed, timing, palette, family, arrival, order, glow = 0.18 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ready = useLoaded(`glyph text ${text}`, () => Promise.all([document.fonts.load(font), document.fonts.load(`700 20px ${family}`)]).then(() => true), [font, family]);
  const ink = useMemo(() => (ready && text.trim() ? inkFromText(text.trim(), font, maxWidth) : null), [ready, text, font, maxWidth]);
  const tl = useMemo(() => textLook(look, cols), [look, cols]);
  return <BuildCanvas ink={ink} seed={seed} look={tl} box={box} timing={timing} t={frame / fps} palette={palette} family={family} glow={glow} arrival={arrival} order={order} />;
};

/** Typed out at `cps` characters a second from `from`. */
const typed = (text: string, from: number, t: number, cps = 26) => text.slice(0, Math.max(0, Math.floor((t - from) * cps)));

/**
 * A chapter: the screen is clear, the name builds out of glyphs large in
 * the middle, holds, and rains away into the next picture. No "CHAPTER
 * TWO" above it: the opening chapter sits under the title, so the first
 * one anyone sees would say two. CHAPTER_CARD seconds; frame 0 is its start.
 */
export const ChapterCard: React.FC<{ name: string; palette: Palette; family: string; nameFont: string; look: Look; seed: number }> = ({ name, palette, family, nameFont, look, seed }) => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <TextBuild
        text={name}
        font={nameFont}
        maxWidth={1800}
        box={{ x: width * 0.1, y: height * 0.33, w: width * 0.8, h: height * 0.34 }}
        look={look}
        cols={190}
        seed={seed}
        timing={{ start: 0.35, end: 0.8, exit: { start: CHAPTER_CARD - 0.65, end: CHAPTER_CARD + 0.4 } }}
        palette={palette}
        family={family}
        arrival="decode"
      />
    </AbsoluteFill>
  );
};

// ── the end card ──

/** The end card's phases, seconds from its start. */
const REEL = 6;
const MOSAIC = { from: REEL, to: REEL + 1.6 };
const NAME = { from: REEL + 2.1, to: REEL + 3.5 };

/** The reel: each picture's slot, faster and faster but never under 0.4s, so each one still reads (each cross-dissolves into the next, so it never strobes). */
const reelSlots = (n: number): { i: number; from: number; to: number }[] => {
  const out: { i: number; from: number; to: number }[] = [];
  let at = 0;
  for (let k = 0; at < REEL && n; k++) {
    const d = Math.max(0.4, 1.1 * 0.85 ** k);
    out.push({ i: k, from: at, to: Math.min(REEL, at + d) });
    at += d;
  }
  // Spread the pictures across the slots in the video's order.
  return out.map((s, k) => ({ ...s, i: Math.min(n - 1, Math.floor((k * n) / out.length)) }));
};

/** The mosaic's grid: as many columns as make the tiles biggest. */
const grid = (n: number, w: number, h: number, aspect: number) => {
  let best = { cols: 1, rows: n, tw: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const tw = Math.min(w / cols, (h / rows) * aspect);
    if (tw > best.tw) best = { cols, rows, tw };
  }
  return best;
};

/**
 * The end: every picture of the video again, a short reel getting faster;
 * they land as a mosaic, every tile still glyphs; the tiles rain away and
 * the channel name builds out of the glyphs, the sign-off types under it;
 * then it holds to END_CARD with the lower part clear for YouTube's
 * end-screen elements (they cover the last 5–20 seconds). Frame 0 is its start.
 */
export const EndCard: React.FC<{ pictures: string[]; channel: string; line: string; palette: Palette; family: string; nameFont: string; look: Look }> = ({ pictures, channel, line, palette, family, nameFont, look }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const inks = useLoaded(
    `end card pictures`,
    async () => {
      await document.fonts.load(`700 20px ${family}`).catch(() => []);
      return Promise.all(pictures.map((p) => loadImage(p).then((img) => inkFromImage(img, "light", 384, "auto")).catch(() => null)));
    },
    [pictures.join("|"), family],
  );
  const reel = useMemo(() => reelSlots(pictures.length), [pictures.length]);
  // The reel's pictures, built (finished) once each.
  const reelBuilds = useMemo(() => {
    if (!inks) return new Map<number, Build>();
    const m = new Map<number, Build>();
    for (const s of reel) {
      const ink = inks[s.i];
      if (ink && !m.has(s.i)) m.set(s.i, planBuild({ ink, look, box: { x: 0, y: height * 0.04, w: width, h: height * 0.92 }, frame: { w: width, h: height }, start: -2, end: -1.9, seed: 7 + s.i, arrival: "fade", order: "random" }));
    }
    return m;
  }, [inks, reel, look, width, height]);
  // The mosaic: every picture a tile, popping in, then raining away as the name comes.
  const tiles = useMemo(() => {
    if (!inks) return [] as Build[];
    const n = inks.length;
    const area = { x: width * 0.05, y: height * 0.06, w: width * 0.9, h: height * 0.86 };
    const g = grid(n, area.w, area.h, 1.5);
    const tw = g.tw;
    const th = tw / 1.5;
    const ox = area.x + (area.w - g.cols * tw) / 2;
    const oy = area.y + (area.h - g.rows * th) / 2;
    return inks.flatMap((ink, i) => {
      if (!ink) return [];
      const cx = i % g.cols;
      const cy = Math.floor(i / g.cols);
      const start = MOSAIC.from + hash(i * 3 + 1) * 0.7;
      const leave = NAME.from - 0.5 + hash(i * 5 + 2) * 0.4;
      // A glyph about every 2px, so a small tile still shows what it is.
      return [planBuild({ ink, look: { ...look, cols: Math.max(90, Math.round(tw / 2)) }, box: { x: ox + cx * tw + 3, y: oy + cy * th + 3, w: tw - 6, h: th - 6 }, frame: { w: width, h: height }, start, end: start + 0.45, seed: 11 + i, arrival: "pop", order: "random", exit: { start: leave, end: leave + 1.4 } })];
    });
  }, [inks, look, width, height]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const caches = useRef(new Map<Build, BuildCache>());
  const cacheOf = (b: Build) => {
    let c = caches.current.get(b);
    if (!c) caches.current.set(b, (c = newCache()));
    return c;
  };
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (t < REEL) {
      // Each slot's picture, dissolving into the next over the last part of its slot.
      const k = reel.findIndex((s) => t >= s.from && t < s.to);
      const slot = reel[Math.max(0, k)];
      if (slot) {
        const next = reel[k + 1];
        const fade = Math.min(0.2, (slot.to - slot.from) * 0.4);
        const mix = next ? smooth(clamp((t - (slot.to - fade)) / fade, 0, 1)) : 0;
        const a = reelBuilds.get(slot.i);
        const b = next ? reelBuilds.get(next.i) : undefined;
        if (a) {
          ctx.globalAlpha = 1 - mix;
          drawBuild(ctx, a, 10, { palette, family, glow: 0.22, glowFrom: 0, cache: cacheOf(a) });
        }
        if (b && mix > 0) {
          ctx.globalAlpha = mix;
          drawBuild(ctx, b, 10, { palette, family, glow: 0.22, glowFrom: 0, cache: cacheOf(b) });
        }
        ctx.globalAlpha = 1;
      }
    }
    // The tinted picture glows faintly under each tile, as in the reel, so the shapes read.
    if (t >= MOSAIC.from - 0.1 && t < NAME.to + 1.5) for (const b of tiles) drawBuild(ctx, b, t, { palette, family, glow: 0.22, glowFrom: MOSAIC.from, cache: cacheOf(b) });
  }, [t, width, height, reel, reelBuilds, tiles, palette, family]);
  const lineFrom = NAME.to + 0.3;
  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg, pointerEvents: "none" }}>
      <canvas ref={canvas} width={width} height={height} style={{ position: "absolute", inset: 0 }} />
      {t >= NAME.from - 0.2 ? (
        <Sequence from={Math.round((NAME.from - 0.2) * fps)} layout="none">
          <TextBuild
            text={channel}
            font={nameFont}
            maxWidth={2400}
            box={{ x: width * 0.1, y: height * 0.12, w: width * 0.8, h: height * 0.32 }}
            look={look}
            cols={190}
            seed={404}
            timing={{ start: 0.2, end: NAME.to - NAME.from }}
            palette={palette}
            family={family}
            arrival="converge"
            order="centre"
            glow={0.25}
          />
        </Sequence>
      ) : null}
      <div style={{ position: "absolute", top: height * 0.48, left: width * 0.1, right: width * 0.1, textAlign: "center", fontFamily: family, fontWeight: 700, fontSize: Math.round(height * 0.03), color: rgba(palette.ink, 0.78), whiteSpace: "pre-wrap" }}>
        {typed(line, lineFrom, t, 30)}
        {t >= lineFrom && Math.floor(t * 2.2) % 2 === 0 ? <span style={{ color: rgba(palette.ink, 0.9) }}>█</span> : null}
      </div>
    </AbsoluteFill>
  );
};

// ── terminal captions ──

export type SpokenWord = { text: string; start: number; end: number };
export type TerminalLine = { words: SpokenWord[]; start: number; end: number };

/** Seconds early a word starts decoding before it's said. */
const LEAD = 0.14;
/** Seconds a word takes to settle into its letters once it's said. */
const SETTLE = 0.16;
/** A pause this long starts a fresh line. */
const BREAK = 1.1;
/** A line left this long after its last word fades away (the cursor stays). */
const LINGER = 2.6;
const SCRAMBLE = "#%&@$*+=<>/\\|{}[]01";

/**
 * The words as terminal lines: a line takes words until the next would run
 * past `cols` characters or comes after a pause. Pure, for the tests.
 */
export const terminalLines = (words: SpokenWord[], cols: number): TerminalLine[] => {
  const lines: TerminalLine[] = [];
  let cur: TerminalLine | null = null;
  let chars = 0;
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const word = { ...w, text };
    const fits = cur && chars + 1 + text.length <= cols && word.start - cur.end < BREAK;
    if (cur && fits) {
      cur.words.push(word);
      cur.end = word.end;
      chars += 1 + text.length;
    } else {
      cur = { words: [word], start: word.start, end: word.end };
      chars = text.length;
      lines.push(cur);
    }
  }
  return lines;
};

/** The line on screen at `t`: the last one that has begun. */
const lineAt = (lines: TerminalLine[], t: number): number => {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (lines[m]!.start - LEAD <= t) lo = m + 1;
    else hi = m;
  }
  return lo - 1;
};

/** A word at `t`: scrambled glyphs before it's said, settling left to right as it is. */
const wordAt = (w: SpokenWord, t: number, salt: number): { text: string; settled: number } => {
  const k = clamp((t - w.start) / SETTLE, 0, 1);
  const n = Math.round(k * w.text.length);
  const tick = Math.floor(t * 18);
  let out = w.text.slice(0, n);
  for (let i = n; i < w.text.length; i++) out += /\s/.test(w.text[i]!) ? " " : SCRAMBLE[Math.floor(hash(salt * 31 + i * 7 + tick) * SCRAMBLE.length)];
  return { text: out, settled: k };
};

export const TerminalCaptions: React.FC<{
  /** Every word heard, in video seconds. */
  words: SpokenWord[];
  palette: Palette;
  family: string;
  /** Type size, px. */
  size: number;
  /** The block: its left edge, width and bottom edge (px from the bottom of the frame). */
  left: number;
  width: number;
  bottom: number;
  /** The prompt before each line. */
  prompt?: string;
  /** Times (video seconds) the line stays off, e.g. while a chapter card has the screen. */
  clearAt?: (seconds: number) => boolean;
}> = ({ words, palette, family, size, left, width, bottom, prompt = "> ", clearAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const clear = clearAt?.(t) ?? false;
  const cols = Math.max(12, Math.floor(width / (size * 0.6)) - prompt.length - 1);
  const lines = useMemo(() => terminalLines(words, cols), [words, cols]);
  const i = lineAt(lines, t);
  if (i < 0 || clear) return null;
  const line = lines[i]!;
  const prev = i > 0 && lines[i - 1]!.end > line.start - LINGER ? lines[i - 1] : undefined;
  // The new line pushes the last one up over a few frames.
  const lineH = size * 1.35;
  const scroll = 1 - clamp((t - (line.start - LEAD)) / 0.18, 0, 1);
  const idle = t - line.end;
  const fade = 1 - clamp((idle - LINGER) / 0.5, 0, 1);
  const shown = line.words.filter((w) => w.start - LEAD <= t);
  const lastSaid = shown.at(-1);
  const blink = !lastSaid || t > lastSaid.end + 0.35 ? Math.floor(t * 2.2) % 2 === 0 : true;
  const ink = (a: number) => rgba(palette.ink, a);
  const row = (y: number, children: React.ReactNode, opacity = 1): React.ReactNode => (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: y, whiteSpace: "pre", opacity }}>
      <span style={{ color: rgba(palette.trail, 0.8) }}>{prompt}</span>
      {children}
    </div>
  );
  const base = (i * 977) % 10000;
  return (
    <div style={{ position: "absolute", left, width, bottom, height: lineH * 2.2, fontFamily: family, fontWeight: 700, fontSize: size, lineHeight: `${lineH}px`, pointerEvents: "none", overflow: "hidden" }}>
      {prev && fade > 0 ? row(lineH * (1 - scroll), <span style={{ color: ink(0.38) }}>{prev.words.map((w) => w.text).join(" ")}</span>, fade) : null}
      {row(
        -lineH * scroll,
        <>
          {fade > 0
            ? shown.map((w, k) => {
                const { text, settled } = wordAt(w, t, base + k);
                const now = t >= w.start - LEAD && t <= w.end + 0.12;
                const colour = settled < 1 ? rgba(palette.trail, 0.9) : now ? palette.head : ink(0.82);
                return (
                  <span key={k} style={{ color: colour, opacity: fade }}>
                    {k ? " " : ""}
                    {text}
                  </span>
                );
              })
            : null}
          <span style={{ color: ink(0.9), opacity: blink ? 1 : 0 }}>{shown.length && fade > 0 ? " █" : "█"}</span>
        </>,
      )}
    </div>
  );
};
