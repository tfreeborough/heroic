/**
 * Beat builds: a sketch assembles itself while the beat is spoken.
 *   rain  — ASCII glyphs fall Matrix-style and stack up from the ground.
 *   words — each spoken word peels off the caption and a swarm of copies
 *           flies into a text portrait of the sketch.
 * Everything is a pure function of the beat clock, so scrubbing works.
 */
import { ARRIVALS, ORDERS, PALETTES as BASE, clamp, drawBuild, inkFromImage, lerp, mulberry, newCache, planBuild, rgba, sampleGrid } from "@heroic/ascii-build";
import { BEATS } from "./beats.js";

const W = 1920, H = 1080;
const ART = { x: (W - 860) / 2, y: 40, size: 860 };
const CAP = { y: 1000, size: 46 };
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SANS = 'Inter, system-ui, sans-serif';
const LEAD = 0.6, HOLD = 2.8;

// The engine's palettes plus the colours only the (parked) word build uses.
const PALETTES = {
  sand: { ...BASE.sand, word: "#d9a441", ghost: [140, 125, 102] },
  matrix: { ...BASE.matrix, word: "#7dff9c", ghost: [40, 110, 60] },
};

const PREP = {
  line: { gain: 2.4, gamma: 0.8, pool: 0.6, levels: 5, tone: "dark" },
  tonal: { gain: 1.1, gamma: 1.0, pool: 0.0, levels: 6, tone: "light" },
};

const state = {
  // Tom's locked look (2026-10-09): tonal source, light = glyphs, matrix green, 120 cols.
  effect: "rain", beat: 1, source: "tonal", palette: "matrix", arrival: "rain", order: "ground",
  wpm: 165, cols: 120, fontPx: 10, ghost: true, ambient: true, glow: 0.25, caps: false,
  shuffle: true, edge: "dither", edgeZone: 0.12, exit: false,
  ...PREP.tonal,
  t: 0, playing: false,
};

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
/* ---------- images → ink maps ---------- */

const images = {};
const loadImage = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
const look = () => ({ cols: state.cols, gain: state.gain, gamma: state.gamma, pool: state.pool, levels: state.levels, edge: state.edge, edgeZone: state.edgeZone });

/* ---------- narration clock + captions ---------- */

const buildSpeech = (text) => {
  const words = text.split(/\s+/).filter(Boolean);
  const base = 60 / state.wpm;
  let t = LEAD;
  const timed = words.map((w) => {
    const len = w.replace(/[^\w]/g, "").length;
    const dur = base * clamp(0.7 + len * 0.06, 0.7, 1.5);
    const at = t;
    t += dur + (/[.?!]$/.test(w) ? 0.42 : /[,;:]$/.test(w) ? 0.18 : 0);
    return { w, at, dur };
  });
  // Caption chunks: ≤6 words, breaking after punctuation.
  const chunks = [];
  let cur = [];
  timed.forEach((tw, i) => { cur.push(i); if (cur.length >= 6 || /[.,?!;:]$/.test(tw.w)) { chunks.push(cur); cur = []; } });
  if (cur.length) chunks.push(cur);
  ctx.font = `800 ${CAP.size}px ${SANS}`;
  const space = ctx.measureText(" ").width;
  chunks.forEach((ids, ci) => {
    const widths = ids.map((i) => ctx.measureText(timed[i].w).width);
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + space * (ids.length - 1)) / 2;
    ids.forEach((i, k) => { timed[i].chunk = ci; timed[i].x = x; timed[i].wpx = widths[k]; timed[i].cx = x + widths[k] / 2; x += widths[k] + space; });
  });
  const end = t;
  return { words: timed, chunks, end, total: end + HOLD };
};

const drawCaption = (sp, t) => {
  let cur = sp.words.findIndex((w) => t >= w.at && t < w.at + w.dur + 0.5);
  if (cur < 0) cur = t < LEAD ? 0 : sp.words.length - 1;
  if (t > sp.end + 0.6) return;
  const chunk = sp.chunks[sp.words[cur].chunk];
  ctx.font = `800 ${CAP.size}px ${SANS}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const pal = PALETTES[state.palette];
  for (const i of chunk) {
    const w = sp.words[i];
    const said = t >= w.at, now = said && t < w.at + w.dur;
    // A spoken word has "left" for the picture: it stays as a dim husk.
    const a = now ? 1 : said ? (state.effect === "words" ? 0.28 : 0.55) : 0.85;
    const pop = now ? 1 + 0.08 * Math.sin(Math.min(1, (t - w.at) / w.dur) * Math.PI) : 1;
    ctx.save();
    ctx.translate(w.cx, CAP.y);
    ctx.scale(pop, pop);
    ctx.fillStyle = now ? pal.word : `rgba(255,255,255,${a})`;
    ctx.fillText(w.w, -w.wpx / 2, 0);
    ctx.restore();
  }
};

/* ---------- effect A: ASCII rain (the engine: packages/ascii-build) ---------- */

const EDGES = { hard: "Hard", dither: "Dither", ragged: "Ragged", soft: "Soft" };
const cache = newCache();

/** The loop exit: the picture drops away as rain after a short hold. */
const exitOf = (sp) => (state.exit ? { start: sp.end + 1.8, end: sp.end + 3.6 } : undefined);

const buildRain = (ink, sp) => planBuild({
  ink, look: look(), box: { x: ART.x, y: ART.y, w: ART.size, h: ART.size }, frame: { w: W, h: H },
  start: LEAD, end: sp.end, seed: 7 + state.beat, arrival: state.arrival, order: state.order, exit: exitOf(sp),
});

const drawRain = (b, t) => drawBuild(ctx, b, t, {
  palette: PALETTES[state.palette], ambient: state.ambient, glow: state.glow, glowFrom: speech.end + 0.3, cache,
});

/* ---------- effect B: words fly into a text portrait ---------- */

const buildWords = (ink, sp) => {
  ctx.font = `700 ${state.fontPx}px ${MONO}`;
  const cw = ctx.measureText("M").width, lh = state.fontPx * 1.08;
  const cols = Math.floor(ART.size / cw), rows = Math.floor(ART.size / lh);
  const grid = sampleGrid(ink, cols, rows, look());
  const vocab = sp.words.map((w) => (state.caps ? w.w.toUpperCase() : w.w));
  const rnd = mulberry(11 + state.beat);
  const tokens = [];
  let k = 0;
  for (let gy = 0; gy < rows; gy++) {
    let gx = 0;
    while (true) {
      const wi = k % vocab.length, word = vocab[wi];
      if (gx + word.length > cols) break;
      const vs = [];
      for (let j = 0; j < word.length; j++) vs.push(grid[gy * cols + gx + j]);
      const tok = { wi, word, gx, gy, vs, max: Math.max(...vs) };
      tok.tx = ART.x + gx * cw;
      tok.ty = ART.y + gy * lh;
      const w = sp.words[wi];
      tok.launch = w.at + 0.04 + rnd() * 0.5;
      tok.dur = 0.75 + rnd() * 0.45;
      tok.land = tok.launch + tok.dur;
      tok.bend = (rnd() - 0.5) * 700;
      tok.lift = 150 + rnd() * 350;
      tok.src = { x: w.x, y: CAP.y };
      tokens.push(tok);
      gx += word.length + 1;
      k++;
    }
  }
  const live = tokens.filter((t) => t.max > 0);
  const ghosts = tokens.filter((t) => t.max <= 0);
  const byLand = [...live].sort((a, b) => a.land - b.land);
  return { live, ghosts, byLand, cw, lh, baked: null, bakedTo: -1, bakedIdx: 0 };
};

const drawWords = (B, t, sp) => {
  const pal = PALETTES[state.palette];
  const font = `700 ${state.fontPx}px ${MONO}`;
  if (!B.baked) B.baked = new OffscreenCanvas(W, H);
  const g = B.baked.getContext("2d");
  if (t < B.bakedTo) { g.clearRect(0, 0, W, H); B.bakedIdx = 0; }
  g.font = font;
  g.textBaseline = "top";
  while (B.bakedIdx < B.byLand.length && B.byLand[B.bakedIdx].land + 0.25 <= t) {
    const tok = B.byLand[B.bakedIdx++];
    for (let j = 0; j < tok.word.length; j++) {
      const v = tok.vs[j];
      g.fillStyle = v > 0 ? rgba(pal.ink, 0.2 + 0.8 * v) : rgba(pal.ghost, state.ghost ? 0.1 : 0);
      g.fillText(tok.word[j], tok.tx + j * B.cw, tok.ty);
    }
  }
  B.bakedTo = t;

  // The page of text the picture is printed on: faint, there from the start.
  if (state.ghost) {
    ctx.font = font;
    ctx.textBaseline = "top";
    ctx.fillStyle = rgba(pal.ghost, 0.1);
    for (const tok of B.ghosts) ctx.fillText(tok.word, tok.tx, tok.ty);
  }
  ctx.drawImage(B.baked, 0, 0);

  ctx.textBaseline = "top";
  for (const tok of B.live) {
    if (t < tok.launch || t >= tok.land + 0.25) continue;
    if (t >= tok.land) {
      const k = (t - tok.land) / 0.25;
      ctx.font = font;
      for (let j = 0; j < tok.word.length; j++) {
        const v = tok.vs[j];
        ctx.fillStyle = v > 0 ? rgba(pal.ink, lerp(1, 0.2 + 0.8 * v, k)) : rgba(pal.ghost, lerp(0.6, 0.1, k));
        ctx.fillText(tok.word[j], tok.tx + j * B.cw, tok.ty);
      }
      continue;
    }
    const k = easeInOut((t - tok.launch) / tok.dur);
    // Quadratic arc: up out of the caption, swinging sideways, down into place.
    const mx = (tok.src.x + tok.tx) / 2 + tok.bend, my = Math.min(tok.src.y, tok.ty) - tok.lift;
    const x = (1 - k) * (1 - k) * tok.src.x + 2 * (1 - k) * k * mx + k * k * tok.tx;
    const y = (1 - k) * (1 - k) * (tok.src.y - CAP.size / 2) + 2 * (1 - k) * k * my + k * k * tok.ty;
    const size = lerp(CAP.size * 0.9, state.fontPx, Math.min(1, k * 1.6));
    ctx.font = `700 ${size}px ${MONO}`;
    ctx.fillStyle = k < 0.5 ? pal.word : rgba(pal.ink, 1);
    ctx.globalAlpha = Math.min(1, (t - tok.launch) / 0.08);
    ctx.fillText(tok.word, x, y);
    ctx.globalAlpha = 1;
  }
};

/* ---------- build + frame ---------- */

let speech, scene, inkCache = {};

const rebuild = () => {
  const b = BEATS[state.beat];
  const img = images[`${b.id}-${state.source}`];
  if (!img) return;
  const key = `${b.id}-${state.source}-${state.tone}`;
  inkCache[key] ??= inkFromImage(img, state.tone, 512);
  speech = buildSpeech(b.text);
  if (state.exit && state.effect === "rain") speech.total = speech.end + 4;
  scene = state.effect === "rain" ? buildRain(inkCache[key], speech) : buildWords(inkCache[key], speech);
  scrub.max = speech.total.toFixed(2);
  state.t = Math.min(state.t, speech.total);
};

const frame = () => {
  const pal = PALETTES[state.palette];
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  if (!scene) return;
  const t = state.t;
  if (state.effect === "rain") drawRain(scene, t); else drawWords(scene, t, speech);
  drawCaption(speech, t);
};

let last = performance.now();
const loop = (now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.playing) {
    state.t += dt;
    if (state.t >= speech.total) { state.t = speech.total; setPlaying(false); recorder?.stop(); }
    scrub.value = state.t;
  }
  frame();
  requestAnimationFrame(loop);
};

/* ---------- controls ---------- */

const scrub = document.getElementById("scrub");
const playBtn = document.getElementById("play");
const setPlaying = (p) => { state.playing = p; playBtn.textContent = p ? "Pause" : "Play"; };

const seg = (id, options, key, after) => {
  const el = document.getElementById(id);
  const render = () => {
    el.innerHTML = "";
    options.forEach(([value, label]) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = state[key] === value ? "on" : "";
      b.onclick = () => { state[key] = value; after?.(value); render(); rebuild(); };
      el.append(b);
    });
  };
  render();
  return render;
};

const sliders = [];
const slider = (key, label, min, max, step, rebuildOnChange = true) => {
  const row = document.createElement("label");
  row.className = "row";
  row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
  const input = row.querySelector("input"), out = row.querySelector("output");
  const sync = () => { input.value = state[key]; out.textContent = state[key]; };
  input.oninput = () => { state[key] = Number(input.value); out.textContent = input.value; if (rebuildOnChange) rebuild(); };
  sync();
  sliders.push(sync);
  document.getElementById("sliders").append(row);
};

const toggle = (key, label, rebuildOnChange = false) => {
  const row = document.createElement("label");
  row.className = "check";
  row.innerHTML = `<input type="checkbox"> ${label}`;
  const input = row.querySelector("input");
  input.checked = state[key];
  input.onchange = () => { state[key] = input.checked; if (rebuildOnChange) rebuild(); };
  document.getElementById("toggles").append(row);
};

seg("effect", [["rain", "ASCII rain"], ["words", "Word build"]], "effect");
// Shuffle: every new beat (and every restart) gets a random arrival + fill order.
const shuffleLook = () => {
  if (!state.shuffle) return;
  const pick = (o) => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
  state.arrival = pick(ARRIVALS);
  state.order = pick(ORDERS);
  arrivalSeg?.();
  orderSeg?.();
};
seg("beat", BEATS.map((b, i) => [i, b.label]), "beat", () => { state.t = 0; shuffleLook(); });
seg("source", [["line", "Line art (existing)"], ["tonal", "Bold tonal"]], "source", (v) => { Object.assign(state, PREP[v]); sliders.forEach((s) => s()); toneSeg(); });
const toneSeg = seg("tone", [["light", "Light = glyphs"], ["dark", "Dark = glyphs"]], "tone");
var orderSeg = seg("order", Object.entries(ORDERS), "order");
var arrivalSeg = seg("arrival", Object.entries(ARRIVALS).map(([k, a]) => [k, a.label]), "arrival", (v) => { state.order = ARRIVALS[v].order; orderSeg(); });
seg("palette", [["sand", "Sand"], ["matrix", "Matrix green"]], "palette");

slider("wpm", "Pace (wpm)", 120, 220, 5);
slider("gain", "Gain", 0.5, 5, 0.1);
slider("gamma", "Gamma", 0.3, 2, 0.05);
slider("pool", "Line boost", 0, 1, 0.05);
slider("levels", "Colours", 2, 10, 1);
slider("cols", "ASCII cols", 60, 320, 4);
slider("glow", "End glow", 0, 0.8, 0.05, false);
slider("edgeZone", "Edge width", 0, 0.3, 0.01);
seg("edge", Object.entries(EDGES), "edge");
slider("fontPx", "Word px", 8, 22, 1);
toggle("shuffle", "Shuffle arrival + order per beat");
toggle("ambient", "Background rain (ASCII)");
toggle("exit", "Loop exit: drop away as rain at the end", true);
toggle("ghost", "Ghost page of text (words)");
toggle("caps", "Upper-case words", true);

scrub.oninput = () => { state.t = Number(scrub.value); setPlaying(false); };
playBtn.onclick = () => { if (state.t >= speech.total) state.t = 0; setPlaying(!state.playing); };
document.getElementById("restart").onclick = () => { state.t = 0; shuffleLook(); rebuild(); setPlaying(true); };
document.addEventListener("keydown", (e) => { if (e.code === "Space" && e.target.tagName !== "INPUT") { e.preventDefault(); playBtn.click(); } });

let recorder = null;
const recBtn = document.getElementById("rec");
recBtn.onclick = () => {
  const chunks = [];
  const mime = ["video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  recorder = new MediaRecorder(canvas.captureStream(60), { mimeType: mime, videoBitsPerSecond: 16e6 });
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
    a.download = `${state.effect}-${BEATS[state.beat].id}-${state.source}.webm`;
    a.click();
    recorder = null;
    recBtn.disabled = false;
  };
  recBtn.disabled = true;
  state.t = 0;
  recorder.start();
  setPlaying(true);
};

/* ---------- boot ---------- */

await document.fonts.load(`700 13px "JetBrains Mono"`);
await document.fonts.load(`800 46px Inter`);
await Promise.all(BEATS.flatMap((b) => ["line", "tonal"].map(async (s) => {
  try { images[`${b.id}-${s}`] = await loadImage(`img/${b.id}-${s}.png`); } catch { /* tonal not generated yet */ }
})));
// ?effect=words&beat=1&source=tonal&t=6.5&bare — a still for checking frames headless.
const q = new URLSearchParams(location.search);
for (const k of ["effect", "source", "palette", "tone", "arrival", "order", "edge"]) if (q.has(k)) state[k] = q.get(k);
if (q.has("source")) Object.assign(state, PREP[state.source], q.has("tone") ? { tone: q.get("tone") } : {});
if (q.has("arrival") && !q.has("order")) state.order = ARRIVALS[state.arrival].order;
if (q.has("zone")) state.edgeZone = Number(q.get("zone"));
if (q.has("cols")) state.cols = Number(q.get("cols"));
if (q.has("px")) state.fontPx = Number(q.get("px"));
if (q.has("beat")) state.beat = Number(q.get("beat"));
if (q.has("bare")) document.body.classList.add("bare");
if (q.has("exit")) state.exit = true;
if (!q.has("arrival")) shuffleLook();
rebuild();
if (q.has("t")) { state.t = Number(q.get("t")); frame(); } else setPlaying(true);
requestAnimationFrame(loop);
