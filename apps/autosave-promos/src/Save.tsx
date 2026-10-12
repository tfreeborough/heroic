/**
 * The Autosave video: a picture builds itself out of glyphs while a game
 * saves your progress (docs/design/save-point-channel.md).
 *
 *   0s       "Please wait while we save your progress." Glyphs already moving.
 *   build    the save bar fills as glyphs land; two hints type out; MEMORY scrambles
 *   ~99%     the bar sticks for a beat
 *   saved    "Save complete." chime, MEMORY resolves, the glow fades up
 *   exit     the picture drops away as rain; the opening line comes back,
 *            so the last frame meets the first (it's made to loop)
 *
 * Everything on screen sits above the bottom ~20% and clear of the right
 * edge, where TikTok draws its caption and buttons.
 */
import { loadFont } from "@remotion/google-fonts/JetBrainsMono";
import { ARRIVALS, type Arrival, type Build, NOISE, ORDERS, type Order, type Palette, PALETTES, drawBuild, hash, inkFromImage, landedCount, mulberry, newCache, planBuild, rgba } from "@heroic/ascii-build";
import { AUTOSAVE_LOOK } from "./look";
import type { Ink } from "@heroic/ascii-build";
import * as React from "react";
import { AbsoluteFill, Audio, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { EMPTY_LEDGER, type Ledger, clock, playtimeFor, resolveEgg } from "./eggs";
import { TUNE, chimeFile, tuneFor } from "./music/tune";

const { fontFamily } = loadFont("normal", { weights: ["400", "700"], subsets: ["latin"] });
const FAMILY = `"${fontFamily}", ui-monospace, monospace`;

const arrivals = Object.keys(ARRIVALS) as Arrival[];
const orders = Object.keys(ORDERS) as Order[];

export const saveSchema = z.object({
  /** Under public/, e.g. "saves/castle-on-the-hill.png". */
  image: z.string(),
  /** What the picture turns out to be, as long and descriptive as you like
   * (up to about three lines); scrambled until the save completes. */
  memory: z.string(),
  /** The post's words (not drawn): the line under the video, and the save's
   * name for "Save 07: <title>". From the picture's sidecar; yours to change. */
  tagline: z.string(),
  title: z.string(),
  /** The long one, behind TikTok's "more": as much as you like, yours to write. Not drawn. */
  journal: z.string(),
  slot: z.number().int().min(1),
  /** PLAYTIME at the first frame, in seconds. -1 = from the ledger: every earlier save's length added up. */
  playtimeFrom: z.number().int().min(-1),
  /** "auto" (pinned slot, else the rare roll), "none", or an egg id from src/eggs.ts. */
  egg: z.string(),
  /** The two loading-screen hints under the bar, one after the other. A fresh
   * form in the Desk takes the top two of the Hints tab's queue; blank = none. */
  hint1: z.string().default(""),
  hint2: z.string().default(""),
  /** Picks the shuffle and the playtime. Same seed, same video. */
  seed: z.number().int(),
  arrival: z.enum(["shuffle", ...arrivals] as [string, ...string[]]),
  order: z.enum(["shuffle", ...orders] as [string, ...string[]]),
  tone: z.enum(["light", "dark"]),
  palette: z.enum(["matrix", "sand"]),
  seconds: z.number().min(10).max(30),
  /** "@tune" = this save's own generated music (src/music/), else a file under
   * public/music, or "" for none. */
  music: z.string(),
  /** Generated music: 0 = the slot's own tune, 1, 2… = another for the same
   * slot; the style, or "auto" for the one the slot picks. */
  tuneTake: z.number().int().min(0).default(0),
  tuneStyle: z.string().default("auto"),
  /** Set by the Desk once it has made the tune (under public/music); the video
   * plays it only while it matches these props. */
  musicFile: z.string().default(""),
  musicFrom: z.number().min(0),
  musicVolume: z.number().min(0).max(1),
  ticksVolume: z.number().min(0).max(1),
  /** The first-second hook (10-12, after 31.9% stayed to watch): `burst` sends
   * a flurry of glyphs in up front, `glitch` flickers the finished picture
   * like a bad CRT on the first frames (and the last, so the loop meets). */
  burst: z.boolean().default(true),
  glitch: z.boolean().default(true),
  /** Faint Matrix rain behind everything; 0 = none. */
  rain: z.number().min(0).max(1).default(0.5),
});
export type SaveProps = z.infer<typeof saveSchema>;

export const saveSeconds = (p: Pick<SaveProps, "seconds">) => p.seconds;

export { HOLD, readingTime, timeline } from "./timeline";
import { timeline } from "./timeline";

/** The shuffle, resolved from the seed. */
export const lookFor = (p: Pick<SaveProps, "seed" | "arrival" | "order">) => {
  const r = mulberry(p.seed * 31 + 5);
  const arrival = (p.arrival === "shuffle" ? arrivals[Math.floor(r() * arrivals.length)] : p.arrival) as Arrival;
  const order = (p.order === "shuffle" ? orders[Math.floor(r() * orders.length)] : p.order) as Order;
  return { arrival, order };
};

// Layout, for 1080×1920.
/** Everything sits this far lower than it first did: TikTok's top bar still clipped "Please wait…" at 178 (Tom, 10-10). */
const DROP = 80;
const STATUS_Y = 178 + DROP;
const PIC = { x: 60, y: 320 + DROP, w: 960, h: 860 };
const LEFT = 72;
const BAR_Y = 1214 + DROP, ROW = 48;
/** The memory wraps under its label: monospace 30px is 18px a character. */
const MEMORY_LABEL = "MEMORY    ";
const MEMORY_COLS = 36;
/** Where SLOT starts on the PLAYTIME row: x ≈ 500, ending well short of the rail (~x 930). */
const SLOT_COL = 24;
export const MEMORY_MAX_LINES = 3;

/** The memory, word-wrapped to the panel. */
export const memoryLines = (text: string): string[] => {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= MEMORY_COLS) line += ` ${word}`;
    else { lines.push(line); line = word; }
    while (line.length > MEMORY_COLS) { lines.push(line.slice(0, MEMORY_COLS)); line = line.slice(MEMORY_COLS); }
  }
  if (line) lines.push(line);
  return lines;
};
const SCRAMBLE = "#%&@$*+=<>/\\|{}[]01";
const SPINNER = "|/-\\";

/** The picture's ink, loaded once per image + tone; holds the render until it's ready. */
const useInk = (image: string, tone: "light" | "dark") => {
  const [ink, setInk] = React.useState<Ink | null>(null);
  React.useEffect(() => {
    const handle = delayRender(`save picture ${image}`);
    let live = true;
    const img = new Image();
    img.onload = () => {
      void document.fonts.load(`700 20px "${fontFamily}"`).then(() => {
        if (live) setInk(inkFromImage(img, tone, 512, "auto"));
        continueRender(handle);
      });
    };
    img.onerror = () => continueRender(handle);
    img.src = staticFile(image);
    return () => { live = false; continueRender(handle); };
  }, [image, tone]);
  return ink;
};

/** The slot ledger (public/slots.json), read live so a render always sees the latest. */
const useLedger = () => {
  const [ledger, setLedger] = React.useState<Ledger | null>(null);
  React.useEffect(() => {
    const handle = delayRender("slot ledger");
    let live = true;
    fetch(staticFile("slots.json"), { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Ledger>) : EMPTY_LEDGER))
      .catch(() => EMPTY_LEDGER)
      .then((l) => live && setLedger(l))
      .finally(() => continueRender(handle));
    return () => {
      live = false;
      continueRender(handle);
    };
  }, []);
  return ledger;
};

/** How many of the sorted `times` are at or before `x`. */
const below = (times: Float64Array, x: number) => {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (times[m]! <= x) lo = m + 1; else hi = m;
  }
  return lo;
};

/** The burst: this share of the glyphs set off in the first this-many seconds. */
const BURST = { share: 0.3, seconds: 1.5 };

/** Matrix rain behind everything. Each stream goes round a whole number of
 * times in the video, so the last frame meets the first. */
const RAIN = { cw: 27, ch: 36, trail: 16, px: 26 };
const drawRain = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, seconds: number, strength: number, pal: Palette, seed: number) => {
  ctx.font = `400 ${RAIN.px}px ${FAMILY}`;
  ctx.textBaseline = "top";
  const lap = h + RAIN.trail * RAIN.ch;
  for (let k = 0; k < Math.floor(w / RAIN.cw); k++) for (let d = 0; d < 2; d++) {
    const n = k * 2 + d + seed * 101;
    if (hash(n) < 0.4) continue;
    const laps = 1 + Math.floor(hash(n + 17) * 3);
    // Snapped to the row grid, so a stream steps down like the real thing.
    const row = Math.floor((((t / seconds) * laps + hash(n + 33)) % 1) * lap / RAIN.ch);
    for (let j = 0; j < RAIN.trail; j++) {
      const y = (row - j) * RAIN.ch;
      if (y < -RAIN.ch || y > h) continue;
      const a = strength * (j === 0 ? 0.32 : 0.16 * (1 - j / RAIN.trail));
      ctx.fillStyle = rgba(j === 0 ? pal.ink : pal.trail, a);
      const flip = Math.floor(t * (2 + hash(n + row - j) * 6));
      ctx.fillText(NOISE[Math.floor(hash(n * 131 + (row - j) * 7 + flip) * NOISE.length)]!, k * RAIN.cw, y);
    }
  }
};

/** How hard the CRT glitch is at `t`, 0..1: hardest on the first frames,
 * dying out with a couple of dropouts by 0.45s, and back for the last few
 * frames so the loop's seam is a glitch too. */
const glitchAt = (t: number, seconds: number, frame: number) => {
  if (t > seconds - 0.15) return 0.8;
  if (t >= 0.45) return 0;
  if (t > 0.1 && hash(frame * 17 + 5) < 0.3) return 0;
  return 1 - (t / 0.45) ** 1.5;
};

/** Slices of the finished picture, torn sideways, with a ghost and a rolling band. */
const drawGlitch = (ctx: CanvasRenderingContext2D, still: OffscreenCanvas, box: typeof PIC, k: number, frame: number, w: number, pal: Palette) => {
  const r = mulberry(frame * 7 + 3);
  for (let y = box.y; y < box.y + box.h;) {
    const bh = 6 + Math.floor(r() * 54);
    if (r() < 0.3 + 0.4 * k) {
      const dx = (r() - 0.5) * 160 * k;
      const a = (0.35 + r() * 0.6) * k;
      ctx.globalAlpha = a;
      ctx.drawImage(still, 0, y, w, bh, dx, y, w, bh);
      if (r() < 0.35) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a * 0.5;
        ctx.drawImage(still, 0, y, w, bh, dx + 12, y, w, bh);
        ctx.globalCompositeOperation = "source-over";
      }
    }
    y += bh;
  }
  ctx.globalAlpha = 0.2 * k;
  ctx.fillStyle = rgba(pal.ink, 1);
  ctx.fillRect(0, box.y + r() * box.h, w, 4 + r() * 10);
  ctx.globalAlpha = 1;
};

const typed = (text: string, since: number, t: number, cps = 40) => text.slice(0, Math.max(0, Math.floor((t - since) * cps)));

export const Save: React.FC<SaveProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const tl = timeline(p.seconds, p.memory);
  const pal = PALETTES[p.palette];
  const ink = useInk(p.image, p.tone);
  const ledger = useLedger() ?? EMPTY_LEDGER;
  const effect = resolveEgg(p.egg ?? "auto", p.slot, p.seed, ledger).egg?.effect;
  const { arrival, order } = lookFor(p);
  const build = React.useMemo<Build | null>(
    () => ink && planBuild({
      ink, look: AUTOSAVE_LOOK, box: PIC, frame: { w: width, h: height },
      // A burst starts straight away: glyphs are already falling on the first frame after the glitch.
      start: p.burst ? 0.05 : tl.buildStart, end: tl.buildEnd, seed: p.seed, arrival, order, exit: tl.exit,
      burst: p.burst ? BURST : undefined,
    }),
    [ink, width, height, tl.buildStart, tl.buildEnd, tl.exit.start, tl.exit.end, p.seed, arrival, order, p.burst],
  );
  // The finished picture, for the glitch to tear up.
  const still = React.useMemo(() => {
    if (!build || !p.glitch) return null;
    const c = new OffscreenCanvas(width, height);
    drawBuild(c.getContext("2d")!, build, tl.exit.start - 0.01, { palette: pal, family: FAMILY });
    return c;
  }, [build, p.glitch, width, height, pal, tl.exit.start]);
  const glitch = p.glitch ? glitchAt(t, p.seconds, frame) : 0;
  const leaveTimes = React.useMemo(() => (build ? Float64Array.from(build.cells.map((c) => c.leave)).sort() : new Float64Array()), [build]);

  const canvas = React.useRef<HTMLCanvasElement>(null);
  const cache = React.useRef(newCache());
  React.useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (p.rain > 0) drawRain(ctx, width, height, t, p.seconds, p.rain, pal, p.seed);
    if (build) drawBuild(ctx, build, t, { palette: pal, family: FAMILY, glow: 0.25, glowFrom: tl.buildEnd + 0.3, cache: cache.current });
    if (still && glitch > 0) drawGlitch(ctx, still, PIC, glitch, frame, width, pal);
  }, [build, t, width, height, pal, tl.buildEnd, p.rain, p.seconds, p.seed, still, glitch, frame]);

  const ink1 = rgba(pal.ink, 1), dim = rgba(pal.ink, 0.45), faint = rgba(pal.ink, 0.28);

  // The save bar: follows the glyphs, sticks at 99%, then 100.
  const landed = build ? landedCount(build, t) / Math.max(1, build.landTimes.length) : 0;
  // At the rewind it empties again, so the last frame meets the first.
  const pct = t >= tl.rewind ? 0 : t >= tl.full ? 100 : Math.min(99, Math.floor(landed * 100));
  const CELLS = 24, filled = Math.round((pct / 100) * CELLS);
  const bar = `[${"█".repeat(filled)}${"░".repeat(CELLS - filled)}] ${String(pct).padStart(3, " ")}%`;

  // The status lines: saving → saved → (for the loop) saving again.
  const saving = t < tl.saved || t >= tl.rewind;
  const spin = SPINNER[Math.floor(frame / 4) % SPINNER.length];
  const line1 = saving ? "Please wait while we save your progress." : typed("Save complete.", tl.saved, t, 30);
  const line2 = saving
    ? (t < 0.9 || t >= tl.rewind ? "Checking save data…" : `${spin} Do not turn off your phone.`)
    : typed("You may now continue scrolling.", tl.saved + 0.5, t, 34);
  const statusFade = t >= tl.rewind ? interpolate(t, [tl.rewind, tl.rewind + 0.3], [0, 1], { extrapolateRight: "clamp" }) : 1;

  // The panel. MEMORY is the reveal: it scrambles until the save is done,
  // then each character settles in a ragged left-to-right wave over ~1.2s.
  const lines = memoryLines(p.memory);
  const total = lines.reduce((n, l) => n + l.length, 0);
  const tick = Math.floor(t * 14);
  const hidden = t < tl.saved || t >= tl.rewind;
  let at = 0;
  const memoryRows = lines.map((l) => [...l].map((ch) => {
    const i = at++;
    if (ch === " ") return { ch, done: true };
    const settles = tl.saved + 0.2 + (i / Math.max(1, total)) * 0.9 + hash(i * 13 + p.seed) * 0.3;
    return hidden || t < settles ? { ch: SCRAMBLE[(i * 7 + tick * 3 + p.seed) % SCRAMBLE.length]!, done: false } : { ch, done: true };
  }));
  // PLAYTIME is real: where the last save's clock stopped, then this video's
  // own seconds, reaching exactly from + length on the last frame (which is
  // the next save's first). The eggs bend it.
  const from = (p.playtimeFrom ?? -1) >= 0 ? p.playtimeFrom : playtimeFor(ledger, p.slot);
  const frames = Math.round(p.seconds * fps);
  const clockAt = (f: number) => from + Math.floor((f * p.seconds) / Math.max(1, frames - 1));
  let playtime = clock(clockAt(frame));
  if (effect === "playtime-freeze") playtime = "99:59:59";
  else if (effect === "playtime-dashes" && (t < tl.saved || t >= tl.rewind)) playtime = "--:--:--";
  else if (effect === "playtime-unknown") playtime = `??${playtime.slice(playtime.indexOf(":"))}`;
  else if (effect === "playtime-backwards") {
    // About a second of the clock unwinding, mid-build, then it snaps back.
    const back = tl.buildStart + (tl.buildEnd - tl.buildStart) * 0.45;
    if (t >= back && t < back + 1.1) playtime = clock(Math.max(0, clockAt(Math.round(back * fps)) - Math.floor((t - back) * 7)));
  }

  // Two hints while it saves (an older render's props may have none).
  const hint1 = p.hint1 ?? "", hint2 = p.hint2 ?? "";
  const tipSwap = tl.buildStart + (tl.buildEnd - tl.buildStart) * 0.5;
  const tip = t < 1.2 || t >= tl.saved ? "" : t < tipSwap || !hint2 ? typed(hint1, 1.2, t, 32) : typed(hint2, tipSwap + 0.2, t, 32);

  const achievement = effect === "achievement";
  const eggIn = interpolate(t, [tl.saved + 0.5, tl.saved + 0.8, tl.exit.start - 0.2, tl.exit.start + 0.1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Ticks follow how many glyphs are landing (or leaving) right now.
  const rate = (s: number) => (build ? landedCount(build, s) - landedCount(build, s - 0.1) + below(leaveTimes, s) - below(leaveTimes, s - 0.1) : 0);
  const peak = build ? Math.max(1, build.cells.length / ((tl.buildEnd - tl.buildStart) * 10)) : 1;

  const text: React.CSSProperties = { position: "absolute", left: LEFT, fontFamily: FAMILY, whiteSpace: "pre" };
  // Generated music: the score is cheap to work out here (for the chime's key);
  // the sound itself is the file the Desk made for exactly these props.
  const tune = React.useMemo(
    () => (p.music === TUNE ? tuneFor(p) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.music, p.slot, p.tuneTake, p.tuneStyle, p.seconds, p.memory, p.title, p.tagline, p.journal],
  );
  const tuneReady = !!tune && p.musicFile === tune.file;
  const loopEdges = (f: number) => interpolate(f, [0, 3, p.seconds * fps - 5, p.seconds * fps], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: pal.bg }}>
      <canvas ref={canvas} width={width} height={height} style={{ position: "absolute", inset: 0 }} />

      {/* The words jump sideways with the glitch. */}
      <div style={{ position: "absolute", inset: 0, transform: `translateX(${glitch > 0 ? (hash(frame * 3 + 1) - 0.5) * 28 * glitch : 0}px)` }}>
      {/* Nothing above the status lines: TikTok's top bar (LIVE · For You · search) covers the top of the frame. */}
      <div style={{ ...text, top: STATUS_Y, fontSize: 38, fontWeight: 700, color: ink1, opacity: statusFade }}>{line1}</div>
      <div style={{ ...text, top: STATUS_Y + 58, fontSize: 30, color: dim, opacity: statusFade }}>{line2}</div>

      <div style={{ ...text, top: BAR_Y, fontSize: 40, fontWeight: 700, color: ink1 }}>{bar}</div>
      {/* SLOT shares PLAYTIME's row, short of the button rail down TikTok's right edge. */}
      <div style={{ ...text, top: BAR_Y + 80, fontSize: 30, color: dim }}>
        {`${"PLAYTIME".padEnd(MEMORY_LABEL.length)}${playtime.padEnd(SLOT_COL - MEMORY_LABEL.length)}SLOT `}
        <span style={{ color: ink1 }}>{String(p.slot).padStart(2, "0")}</span>
      </div>
      <div style={{ ...text, top: BAR_Y + 80 + ROW, fontSize: 30, lineHeight: "40px", color: dim }}>
        {memoryRows.map((row, y) => (
          <div key={y}>
            {y === 0 ? MEMORY_LABEL : " ".repeat(MEMORY_LABEL.length)}
            {row.map((c, x) => <span key={x} style={{ color: c.done ? ink1 : faint }}>{c.ch}</span>)}
          </div>
        ))}
      </div>
      <div style={{ ...text, top: BAR_Y + 80 + ROW + Math.max(1, lines.length) * 40 + 30, fontSize: 28, color: dim, width: 840, whiteSpace: "normal" }}>{tip}</div>

      </div>

      {achievement && eggIn > 0 && (
        <div style={{ position: "absolute", left: "50%", top: 300 + DROP, transform: `translate(-50%, ${(1 - eggIn) * -30}px)`, opacity: eggIn, fontFamily: FAMILY, fontSize: 28, color: ink1, border: `2px solid ${dim}`, background: pal.bg, padding: "18px 28px", whiteSpace: "pre" }}>
          {"[*] Achievement unlocked\n    Watched one to the end"}
        </div>
      )}

      {/* CRT dressing: scanlines and a soft vignette. */}
      <AbsoluteFill style={{ background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 2px, transparent 2px, transparent 4px)", pointerEvents: "none" }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)", pointerEvents: "none" }} />

      <Audio src={staticFile("sfx/hum.mp3")} loop volume={(f) => 0.12 * loopEdges(f)} />
      {p.glitch && (
        <>
          <Sequence durationInFrames={Math.round(0.5 * fps)}><Audio src={staticFile("sfx/glitch.wav")} volume={0.5} /></Sequence>
          <Sequence from={Math.round((p.seconds - 0.15) * fps)}><Audio src={staticFile("sfx/glitch.wav")} volume={0.35} /></Sequence>
        </>
      )}
      <Audio src={staticFile("sfx/ticks.mp3")} loop volume={(f) => p.ticksVolume * Math.min(1, rate(f / fps) / peak) ** 0.7} />
      <Sequence from={Math.round(tl.saved * fps)} durationInFrames={Math.round(2.5 * fps)}>
        {/* In the generated tune's key, so they agree. */}
        <Audio src={staticFile(chimeFile(tune?.score.chimeShift ?? 0))} volume={0.8} />
      </Sequence>
      {tune ? (
        // Made to fit this video exactly (it starts at frame 0 and its end swells
        // into its start), so it only needs a frame of fade against clicks.
        tuneReady && <Audio src={staticFile(`music/${p.musicFile}`)} volume={(f) => p.musicVolume * interpolate(f, [0, 1, p.seconds * fps - 2, p.seconds * fps], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      ) : (
        p.music && <Audio src={staticFile(`music/${p.music}`)} startFrom={Math.round(p.musicFrom * fps)} loop volume={(f) => p.musicVolume * loopEdges(f)} />
      )}
    </AbsoluteFill>
  );
};
