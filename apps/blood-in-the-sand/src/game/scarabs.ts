/**
 * SCARABS — the body is stripped to the bone (bits-cosmetics.md § Shelf row
 * two). The INWARD finisher: everything else we sell bursts out, strikes
 * down, rises or holds; this one closes in.
 *
 * ONE MOTION, a whirlpool (v2 — Tom, 2026-09-20, on v1's straight rush:
 * "a little bit underwhelming… they could swarm around in a spiral"). Every
 * beetle turns the same way all show long; the way is rolled per kill.
 *
 *   0.00s  THEY SURFACE   the sand spits beetles along three SPIRAL ARMS
 *                         round the body (so never a clean ring — circles
 *                         on this floor mean danger), each out of its own
 *                         puff of dust, the inner ends first
 *   0.06s  THE SPIRAL     they wind inward like water down a drain — the
 *                         nearer the body, the faster round (ease-in)
 *   0.45s  THE MOUND      the first ones reach it and the corpse is TAKEN
 *                         (`hidesBodyFromMs`): the show draws the body under
 *                         a heap that keeps CHURNING the same way round and
 *                         sinks as there's less to eat
 *   1.00s  THE SCATTER    the whirlpool unwinds: they spin off outward
 *                         (ease-out) and BURROW — shrinking into a puff,
 *                         never fading — and what they leave is a skeleton,
 *                         picked clean. One straggler is late.
 *
 * All of it is on the FLOOR, under every living body: it's the one finisher
 * that can't hide a fight. (It bends "air belongs to the killer" the way
 * Medusa's dark does — the victim's blood still lands, and the bones lie in
 * it.) Sibling of Butterflies in technique only: opposite motion, opposite
 * palette, opposite layer.
 *
 * On the sand (#b39763) cold and dark reads: shells are near-black teal and
 * indigo with one cold glint each. The bones are the only pale thing, and
 * they wear a dark rim.
 *
 * PERF: beetles AND dust are one atlas baked once → ONE drawAtlas a frame
 * (~65 sprites, the Butterflies order). Motion is a pure function of age;
 * every roll is frozen at spawn. Two circles and four prebuilt paths beside
 * it. No blur, no saveLayer, nothing built per frame.
 */
import {
  BlendMode,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  vec,
  type SkCanvas,
  type SkColor,
  type SkImage,
  type SkPath,
  type SkRect,
  type SkRSXform,
} from "@shopify/react-native-skia";

const COUNT = 60;
/** First arrivals — the corpse is theirs from here. */
const TAKEN_MS = 450;
const LAST_ARRIVAL_MS = 640;
const SCATTER_MS = 1000;
const STRAGGLER_LEAVES_MS = 1100;
export const SCARABS_LIFE_MS = 1500;

const BODY_R = 19;
/** Where they surface: along spiral ARMS — each arm runs from the inner
 *  radius out to the outer as it sweeps a third of the way round. */
const ARMS = 3;
const RING_MIN = 95;
const RING_SPREAD = 120;
const MOUND_R = 31;
const PUFF_MS = 230;
/** How far round a beetle winds on its way in (turns): outer ones further. */
const TURNS_IN = 0.55;
const TURNS_IN_SPREAD = 0.5;
/** The heap's churn, turns per second at its rim; the middle goes quicker. */
const CHURN_HZ = 0.9;
const TAU = Math.PI * 2;

// ── The atlas: two scuttle frames + a puff of dust ──────────────────────────
/** Baked at 2× — a beetle is ~20 world px long and wants crisp legs. */
const K = 2;
const CELL = 28 * K;
const SRC_BEETLE: SkRect[] = [0, 1].map((i) => Skia.XYWHRect(CELL * i, 0, CELL, CELL));
const SRC_PUFF = Skia.XYWHRect(CELL * 2, 0, CELL, CELL);

let atlas: SkImage | null = null;
let atlasFailed = false;
const ensureAtlas = (): SkImage | null => {
  if (atlas || atlasFailed) return atlas;
  const surface = Skia.Surface.Make(CELL * 3, CELL);
  if (!surface) {
    atlasFailed = true; // no atlas → the finisher simply doesn't draw
    return null;
  }
  const c = surface.getCanvas();
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setStrokeCap(StrokeCap.Round);
  const edge = Skia.Color("#05080b");
  for (const frame of [0, 1]) {
    c.save();
    c.translate(CELL * (frame + 0.5), CELL / 2);
    c.scale(K, K);
    // Legs: three a side, the pairs swinging opposite ways between frames.
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(1.5);
    p.setColor(edge);
    for (const sd of [-1, 1]) {
      [4.5, 0, -4.5].forEach((lx, i) => {
        const swing = ((i + frame + (sd > 0 ? 0 : 1)) % 2 === 0 ? 1 : -1) * 2.4;
        c.drawLine(lx, sd * 4, lx + swing * 0.4, sd * 8, p);
        c.drawLine(lx + swing * 0.4, sd * 8, lx + swing - 1.2, sd * 11, p);
      });
    }
    p.setStyle(PaintStyle.Fill);
    // The dark under everything is the outline.
    c.drawOval(Skia.XYWHRect(-10.5, -7.6, 17, 15.2), p);
    c.drawOval(Skia.XYWHRect(2, -6.4, 8.6, 12.8), p);
    c.drawOval(Skia.XYWHRect(8, -3.8, 5, 7.6), p);
    // Wing cases: near-black teal, lit cold from the upper left.
    p.setShader(
      Skia.Shader.MakeRadialGradient(
        vec(-5.5, -3.2),
        11,
        [Skia.Color("#5fd6d8"), Skia.Color("#1c7f8c"), Skia.Color("#0d3d4a"), Skia.Color("#08242f")],
        [0, 0.22, 0.6, 1],
        TileMode.Clamp,
      ),
    );
    c.drawOval(Skia.XYWHRect(-9.3, -6.4, 14.6, 12.8), p);
    // Thorax: indigo, so the beetle is two masses, not one bean.
    p.setShader(
      Skia.Shader.MakeRadialGradient(
        vec(5, -2.4),
        6,
        [Skia.Color("#6f7fe0"), Skia.Color("#2a3478"), Skia.Color("#161b44")],
        [0, 0.4, 1],
        TileMode.Clamp,
      ),
    );
    c.drawOval(Skia.XYWHRect(3.1, -5.2, 6.4, 10.4), p);
    p.setShader(null);
    // The seam down the wing cases, and the one glint.
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(0.9);
    p.setColor(edge);
    c.drawLine(-9, 0, 3.4, 0, p);
    p.setStyle(PaintStyle.Fill);
    p.setColor(Skia.Color("#c9fbff"));
    c.drawOval(Skia.XYWHRect(-6.6, -4.4, 3.4, 1.7), p);
    c.restore();
  }
  // Dust: DARK (pale dust is the sand's own value) and soft — the gradient
  // is paid for here, not per frame.
  p.setShader(
    Skia.Shader.MakeRadialGradient(
      vec(CELL * 2.5, CELL / 2),
      CELL / 2,
      [Skia.Color("rgba(255, 255, 255, 0.9)"), Skia.Color("rgba(255, 255, 255, 0.4)"), Skia.Color("rgba(255, 255, 255, 0)")],
      [0, 0.5, 1],
      TileMode.Clamp,
    ),
  );
  c.drawCircle(CELL * 2.5, CELL / 2, CELL / 2, p);
  atlas = surface.makeImageSnapshot();
  return atlas;
};

const atlasPaint = Skia.Paint();
atlasPaint.setAntiAlias(true);
// drawAtlas scratch — persistent, truncated per call (the crowd.ts diet).
const dsts: SkRSXform[] = [];
const srcs: SkRect[] = [];
const cols: SkColor[] = [];

/** Shell tints (Modulate only darkens): teal as baked, bluer, greener. */
const TINTS: readonly [number, number, number][] = [
  [1, 1, 1],
  [0.74, 0.84, 1],
  [0.86, 1, 0.84],
];
const DUST_RGB: readonly [number, number, number] = [0.27, 0.22, 0.16];

const fill = Skia.Paint();
fill.setAntiAlias(true);
const stroke = Skia.Paint();
stroke.setAntiAlias(true);
stroke.setStyle(PaintStyle.Stroke);
stroke.setStrokeCap(StrokeCap.Round);
stroke.setStrokeJoin(StrokeJoin.Round);
/** The dark the heap sits in — a gap between beetles is more beetle, not sand. */
const pit = Skia.Paint();
pit.setAntiAlias(true);
pit.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(10, 12, 16, 0.9)"), Skia.Color("rgba(10, 12, 16, 0.72)"), Skia.Color("rgba(10, 12, 16, 0)")],
    [0, 0.62, 1],
    TileMode.Clamp,
  ),
);

const C_CORPSE = Skia.Color("rgba(90, 84, 76, 0.55)");
const C_BONE = Skia.Color("#ece4d0");
const C_BONE_RIM = Skia.Color("#231a12");

// ── The skeleton ────────────────────────────────────────────────────────────
// v2 (Tom: "the skeleton needs to look a bit better" — v1 was a stick man
// with a ball for a head). Bones have MASS now: a skull with a jaw, sockets,
// a nose and teeth; a ribcage; limbs as proper long bones with a knob at each
// end. Local coords, skull up (−y), built once. Three paths: long bones
// (stroked), solid bones (filled), and the holes cut back into them.
const BONE_SCALE = 0.9;
const BONE_LINES = (() => {
  const b = Skia.PathBuilder.Make();
  b.moveTo(0, -8).lineTo(0, 17); // spine
  b.moveTo(-11, -5).quadTo(0, -8, 11, -5); // collar bones
  const ribs: readonly [number, number][] = [
    [-2.4, 12.5],
    [2.2, 13.2],
    [6.8, 12],
    [11.2, 9.6],
  ];
  for (const [y, w] of ribs) {
    for (const sd of [-1, 1]) b.moveTo(0, y).quadTo(sd * w * 1.05, y - 2.2, sd * w * 0.86, y + 3.6);
  }
  // Sprawled: one arm flung out and bent back up, one lying by the side;
  // one leg straight, one knee out.
  b.moveTo(-11, -5).lineTo(-20, 3).lineTo(-25, -7);
  b.moveTo(11, -5).lineTo(17, 6).lineTo(14.5, 17);
  b.moveTo(-4, 21).lineTo(-7, 34).lineTo(-5.5, 46);
  b.moveTo(4, 21).lineTo(15, 30).lineTo(9.5, 41);
  return b.detach();
})();
/** Every joint gets a knob — it's the knobs that make a line a BONE. */
const KNOBS: readonly [number, number][] = [
  [-11, -5], [-20, 3], [-25, -7], [11, -5], [17, 6], [14.5, 17],
  [-4, 21], [-7, 34], [-5.5, 46], [4, 21], [15, 30], [9.5, 41],
];
const BONE_SOLIDS = (() => {
  const b = Skia.PathBuilder.Make();
  // The skull, tipped a little to one side: a wide cranium over a narrow jaw.
  // (Set clear of the collar bones — jammed against them the jaw vanished
  // and the skull was a ball again.)
  b.addCircle(1.5, -23, 9);
  b.addRRect(Skia.RRectXY(Skia.XYWHRect(-4, -17.5, 11, 9.6), 2.6, 2.6));
  // Pelvis: two wings and the base of the spine.
  b.addOval(Skia.XYWHRect(-9.5, 16.5, 10, 7.5));
  b.addOval(Skia.XYWHRect(-0.5, 16.5, 10, 7.5));
  for (const [kx, ky] of KNOBS) b.addCircle(kx, ky, 2.5);
  return b.detach();
})();
const BONE_HOLES = (() => {
  const b = Skia.PathBuilder.Make();
  b.addOval(Skia.XYWHRect(-3.8, -26, 4.8, 5.8)); // sockets
  b.addOval(Skia.XYWHRect(2.2, -26, 4.8, 5.8));
  b.moveTo(1.5, -19.4).lineTo(0, -16.4).lineTo(3, -16.4).close(); // nose
  return b.detach();
})();
/** Teeth: short dark ticks up into the jaw. */
const BONE_TEETH = Skia.PathBuilder.Make()
  .moveTo(-1.2, -8.2).lineTo(-1.2, -11.2)
  .moveTo(1.5, -8.2).lineTo(1.5, -11.2)
  .moveTo(4.2, -8.2).lineTo(4.2, -11.2)
  .detach();

interface Beetle {
  /** Where it surfaces, polar. */
  a0: number;
  r0: number;
  /** Its orbit in the heap, how far round it winds to get there, its fidget. */
  mr: number;
  turns: number;
  jitHz: number;
  /** When it surfaces, when it arrives. */
  bornMs: number;
  arriveMs: number;
  /** Scatter: when it bolts, for how long, how far out and how far round. */
  leaveMs: number;
  runMs: number;
  outDist: number;
  outTurns: number;
  size: number;
  phase: number;
  /** Mutated in place each frame (alpha only) — no per-frame colour allocs. */
  tint: Float32Array;
  puff: Float32Array;
}

/** Scratch for `place` — one beetle at a time, no per-frame allocs. */
const spot = { x: 0, y: 0 };

export class Scarabs {
  readonly hidesBodyFromMs = TAKEN_MS;
  private readonly beetles: Beetle[] = [];
  private readonly boneRot = Math.random() * 360;
  /** Which way the whirlpool turns — all of it, all show. */
  private readonly spin = Math.random() < 0.5 ? -1 : 1;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {
    const twist = Math.random() * TAU;
    for (let i = 0; i < COUNT; i++) {
      const straggler = i === COUNT - 1;
      // Stratified round the body, and the radius is a SAWTOOTH of the angle:
      // that lays them out along spiral arms, trailing the way they'll turn.
      const around = (i + Math.random()) / COUNT;
      const along = (around * ARMS) % 1; // 0 at an arm's inner end → 1 at its tip
      // Roughed up across the arm — dead on the line they march nose to
      // tail and an arm reads as one long caterpillar (headless preview).
      const r0 = RING_MIN + RING_SPREAD * along + (Math.random() - 0.5) * 56;
      const tint = TINTS[i % TINTS.length]!;
      this.beetles.push({
        a0: twist - this.spin * around * TAU,
        r0,
        // Heap orbits: sqrt for an even fill (dealt out of order so an arm
        // doesn't own a ring of the heap).
        mr: Math.sqrt((((i * 37) % COUNT) + 0.5) / COUNT) * MOUND_R,
        turns: TURNS_IN + TURNS_IN_SPREAD * along + Math.random() * 0.12,
        jitHz: 9 + Math.random() * 6,
        // Inner ends surface first and land first: the arms FEED the heap.
        bornMs: along * 90 + Math.random() * 40,
        arriveMs: TAKEN_MS + along * (LAST_ARRIVAL_MS - TAKEN_MS - 30) + Math.random() * 30,
        leaveMs: straggler ? STRAGGLER_LEAVES_MS : SCATTER_MS + Math.random() * 90,
        runMs: straggler ? 390 : 270 + Math.random() * 100,
        outDist: 105 + Math.random() * 95,
        outTurns: 0.3 + Math.random() * 0.3,
        size: 0.85 + Math.random() * 0.4,
        phase: Math.random() * TAU,
        tint: Float32Array.of(tint[0], tint[1], tint[2], 1),
        puff: Float32Array.of(DUST_RGB[0], DUST_RGB[1], DUST_RGB[2], 0),
      });
    }
  }

  /** Everything: it all happens on the sand, under the living. */
  drawGround(canvas: SkCanvas, age: number): void {
    const { x, y } = this;
    if (age >= TAKEN_MS) {
      // Bones first — they're under it all, and only show once it clears.
      if (age >= LAST_ARRIVAL_MS + 60) this.drawBones(canvas);
      // The corpse, ours to draw now: it's there until the heap has closed
      // over it, and gone by the time anyone can see under them again.
      if (age < LAST_ARRIVAL_MS + 60) {
        fill.setColor(C_CORPSE);
        canvas.drawCircle(x, y, BODY_R, fill);
      }
      // The dark of the heap: gathers with the arrivals, sinks with the
      // meal, breaks up as they bolt.
      const gather = Math.min(1, (age - TAKEN_MS) / (LAST_ARRIVAL_MS - TAKEN_MS));
      const gone = Math.min(1, Math.max(0, (age - SCATTER_MS) / 150));
      if (gone < 1) {
        const r = (MOUND_R + 10) * this.sink(age);
        canvas.save();
        canvas.translate(x, y);
        canvas.scale(r, r);
        pit.setAlphaf(gather * (1 - gone));
        canvas.drawCircle(0, 0, 1, pit);
        canvas.restore();
      }
    }
    this.drawSwarm(canvas, age);
  }

  drawAir(): void {
    // Nothing: scarabs never leave the floor.
  }

  /** The heap settles as the body goes: 1 → 0.74 over the meal (ease-out). */
  private sink(age: number): number {
    const u = Math.min(1, Math.max(0, (age - LAST_ARRIVAL_MS) / (SCATTER_MS - LAST_ARRIVAL_MS)));
    return 1 - 0.26 * (1 - (1 - u) * (1 - u));
  }

  /** How far round the heap beetle `b` has churned by `age` (rad, unsigned):
   *  the middle of a whirlpool turns faster than its rim. */
  private churn(b: Beetle, age: number): number {
    return (Math.max(0, age - b.arriveMs) / 1000) * CHURN_HZ * TAU * (1.7 - b.mr / MOUND_R);
  }

  /** Where beetle `b` is at `age`, relative to the body → `spot`. One closed
   *  form for the whole show, so a heading is just two samples of it. */
  private place(b: Beetle, age: number): void {
    let r: number;
    let ang: number;
    if (age < b.arriveMs) {
      // THE SPIRAL. Ease-in on both: it creeps off the mark, and is going
      // round fastest as it hits the heap — water down a drain.
      const u = Math.max(0, (age - b.bornMs) / (b.arriveMs - b.bornMs));
      r = b.r0 + (b.mr - b.r0) * Math.pow(u, 1.7);
      ang = b.turns * TAU * Math.pow(u, 2.1);
    } else if (age < b.leaveMs) {
      // THE MOUND. Still going round — the heap churns as one.
      r = b.mr * this.sink(age);
      ang = b.turns * TAU + this.churn(b, age);
    } else {
      // THE SCATTER. The whirlpool unwinds: out and round, ease-out.
      const u = Math.min(1, (age - b.leaveMs) / b.runMs);
      const e = 1 - (1 - u) * (1 - u);
      r = b.mr * 0.74 + b.outDist * e;
      ang = b.turns * TAU + this.churn(b, b.leaveMs) + b.outTurns * TAU * e;
    }
    const at = b.a0 + this.spin * ang;
    spot.x = Math.cos(at) * r;
    spot.y = Math.sin(at) * r;
  }

  private drawSwarm(canvas: SkCanvas, age: number): void {
    const img = ensureAtlas();
    if (!img) return;
    dsts.length = srcs.length = cols.length = 0;
    const sec = age / 1000;
    const puff = (b: Beetle, at: number, since: number): void => {
      if (since < 0 || since >= PUFF_MS) return;
      this.place(b, at);
      const t = since / PUFF_MS;
      const s = (b.size * (9 + 17 * (1 - (1 - t) * (1 - t)))) / (CELL / 2);
      dsts.push(Skia.RSXform(s, 0, this.x + spot.x - s * (CELL / 2), this.y + spot.y - s * (CELL / 2)));
      srcs.push(SRC_PUFF);
      b.puff[3] = 0.7 * (1 - t);
      cols.push(b.puff);
    };
    // Dust under beetles: two passes over 60 is nothing, and it keeps the
    // whole swarm in the one call. One puff where it surfaces, one where it
    // goes back down.
    for (const b of this.beetles) {
      puff(b, b.bornMs, age - b.bornMs);
      puff(b, b.leaveMs + b.runMs, age - (b.leaveMs + b.runMs * 0.8));
    }
    for (const b of this.beetles) {
      const since = age - b.bornMs;
      if (since < 0 || age >= b.leaveMs + b.runMs) continue;
      // Surfacing takes 80ms (it grows out of its puff); burrowing, the last
      // 28% of its run — it SHRINKS away (a fading beetle is a ghost).
      let scale = b.size * Math.min(1, since / 80);
      const run = (age - b.leaveMs) / b.runMs;
      if (run > 0.72) scale *= 1 - (run - 0.72) / 0.28;
      // Nose along its line of travel: two samples of the same closed form.
      this.place(b, age + 12);
      const nx = spot.x;
      const ny = spot.y;
      this.place(b, age);
      let px = spot.x;
      let py = spot.y;
      const heading = Math.atan2(ny - py, nx - px) + Math.sin(sec * 38 + b.phase) * 0.16;
      if (age >= b.arriveMs && age < b.leaveMs) {
        // In the heap they clamber as well as circle.
        const j = sec * b.jitHz + b.phase;
        px += Math.cos(j * 2.3) * 2.4;
        py += Math.sin(j * 1.7) * 2.4;
      }
      dsts.push(Skia.RSXformFromRadians(scale / K, heading, this.x + px, this.y + py, CELL / 2, CELL / 2));
      // Legs swap ~14 times a second.
      srcs.push(SRC_BEETLE[Math.floor(sec * 28 + b.phase) % 2]!);
      cols.push(b.tint);
    }
    if (dsts.length === 0) return;
    canvas.drawAtlas(img, srcs, dsts, atlasPaint, BlendMode.Modulate, cols);
  }

  /** Picked clean: pale bones inside a dark rim (pale alone vanishes here). */
  private drawBones(canvas: SkCanvas): void {
    canvas.save();
    canvas.translate(this.x, this.y);
    canvas.rotate(this.boneRot, 0, 0);
    canvas.scale(BONE_SCALE, BONE_SCALE);
    // Centred on where the body lay (the art runs −32 … +48 down its spine).
    canvas.translate(0, -7);
    stroke.setColor(C_BONE_RIM);
    stroke.setStrokeWidth(5.8);
    canvas.drawPath(BONE_LINES, stroke);
    stroke.setStrokeWidth(3);
    canvas.drawPath(BONE_SOLIDS, stroke);
    stroke.setColor(C_BONE);
    stroke.setStrokeWidth(2.9);
    canvas.drawPath(BONE_LINES, stroke);
    fill.setColor(C_BONE);
    canvas.drawPath(BONE_SOLIDS, fill);
    fill.setColor(C_BONE_RIM);
    canvas.drawPath(BONE_HOLES, fill);
    stroke.setColor(C_BONE_RIM);
    stroke.setStrokeWidth(1.1);
    canvas.drawPath(BONE_TEETH, stroke);
    canvas.restore();
  }

  /** The show draws its own bones while it runs; the mark takes over,
   *  identical, when it's done (Medusa's rubble handoff). */
  markAlpha(): number {
    return 0;
  }

  stampMark(canvas: SkCanvas, alpha: number): void {
    if (alpha <= 0) return;
    this.drawBones(canvas);
  }
}
