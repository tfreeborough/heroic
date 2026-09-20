/**
 * Off-device previews of the cosmetic prototypes (bits-cosmetics.md) — runs
 * the REAL game modules (blood.ts, bloodMaterials.ts, finishers.ts,
 * trails.ts) against Skia's CanvasKit build under Bun and writes PNG contact
 * sheets. A first look before the phone, not a substitute for it.
 *
 *   bun run scripts/cosmetics-preview.ts [outDir]
 */
import { plugin } from "bun";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CanvasKitInit = require("canvaskit-wasm/bin/full/canvaskit.js");
const { JsiSkApi } = require("@shopify/react-native-skia/lib/commonjs/skia/web");
const types = require("@shopify/react-native-skia/lib/commonjs/skia/types");

const CK = await CanvasKitInit({});
const Skia = JsiSkApi(CK);
// The game imports the native package; hand it the CanvasKit-backed API.
plugin({
  name: "skia-headless",
  setup(build) {
    build.module("@shopify/react-native-skia", () => ({
      loader: "object",
      exports: {
        ...types,
        Skia,
        vec: (x: number, y: number) => ({ x, y }),
      },
    }));
  },
});

const { BloodField } = await import("../src/game/blood");
const { drawBlood, drawBloomingBlood, drawFlyingBlood } = await import("../src/game/bloodMaterials");
const { FinisherField } = await import("../src/game/finishers");
const { TrailField } = await import("../src/game/trails");

const out = process.argv[2] ?? "cosmetics-preview";
mkdirSync(out, { recursive: true });

const SAND = Skia.Color("#b39763");
/**
 * TRUE PHONE SCALE. The follow camera fits the longest weapon ring across the
 * screen: on a 390pt-wide phone that's zoom ≈ 0.495 (render.ts), at 3 device
 * px per point. The first previews were drawn at 1.6 — over three times too
 * big — and roses that looked lovely there read as "pink blood" on the
 * device. Judge everything at PHONE; the close-ups are for checking the art.
 */
const PHONE = 0.495 * 3;
const ZOOM = PHONE;

const paint = Skia.Paint();
paint.setAntiAlias(true);
const body = (canvas: any, x: number, y: number, colour: string, dead = false): void => {
  paint.setColor(Skia.Color(dead ? "rgba(90, 84, 76, 0.55)" : colour));
  canvas.drawCircle(x, y, 18, paint);
};

/** Render `cells` side by side, each W×H world px, to one PNG. */
const sheet = (
  name: string,
  W: number,
  H: number,
  cells: ((canvas: any) => void)[],
  zoom = ZOOM,
): void => {
  const surface = Skia.Surface.Make(Math.ceil(W * zoom * cells.length), Math.ceil(H * zoom))!;
  const canvas = surface.getCanvas();
  canvas.scale(zoom, zoom);
  cells.forEach((cell, i) => {
    canvas.save();
    canvas.translate(i * W, 0);
    canvas.clipRect(Skia.XYWHRect(0, 0, W, H), types.ClipOp.Intersect, true);
    paint.setColor(SAND);
    canvas.drawRect(Skia.XYWHRect(0, 0, W, H), paint);
    cell(canvas);
    paint.setColor(Skia.Color("rgba(0,0,0,0.35)"));
    canvas.drawRect(Skia.XYWHRect(W - 1, 0, 1, H), paint);
    canvas.restore();
  });
  const png = surface.makeImageSnapshot().encodeToBytes();
  writeFileSync(join(out, `${name}.png`), png);
  console.log("wrote", join(out, `${name}.png`));
};

/** Run `fn` with Math.random replaced by a seeded mulberry32 — finishers roll
 *  their look at spawn, and a strip should show ONE finisher ageing. */
const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
};
const withDice = (seed: number, fn: () => void): void => {
  const real = Math.random;
  Math.random = mulberry(seed);
  try {
    fn();
  } finally {
    Math.random = real;
  }
};
/** The first seed whose FIRST roll lands in quarter `q` — the constellation
 *  picks its figure (of four) with its first roll. */
const diceFor = (q: number): number => {
  for (let seed = 1; ; seed++) if (Math.floor(mulberry(seed)() * 4) === q) return seed;
};

// ── Blood: a wounded walk into a kill, fresh / half-set / dried ─────────────
for (const mat of ["default", "starblood", "roses"] as const) {
  const field = new BloodField();
  field.materialOf = () => mat;
  let now = 1000;
  // A badly wounded fighter walks left → right, dripping.
  for (let x = 40; x < 300; x += 3) {
    now += 16;
    field.update([{ id: 1, x, y: 250 + Math.sin(x / 40) * 18, hp: 18, maxHp: 100, alive: true } as any], now);
  }
  field.splatter(300, 250, 30, false, now, 1, 0, mat);
  field.splatter(330, 235, 40, true, now, 0.8, -0.6, mat);
  field.deathBurst(330, 235, 0.8, -0.6, now, mat);
  const kill = now;
  // Drawn the way the game does it: the cached pass as of its last build,
  // then the per-frame pass for whatever is still opening.
  const at = (age: number, corpse = true) => (canvas: any) => {
    field.update([], kill + age);
    drawBlood(canvas, field.decals, kill + age);
    drawBloomingBlood(canvas, field.decals, kill + age, kill + age);
    drawFlyingBlood(canvas, field.flying, kill + age);
    if (corpse) body(canvas, 330, 235, "#d94141", true);
    body(canvas, 250, 300, "#4d7fd9");
  };
  sheet(`blood-${mat}`, 640, 420, [at(140), at(420), at(1500), at(17_000)]);
  // The kill site up close, no corpse over it — for checking the art only.
  const close = (age: number) => (canvas: any) => {
    canvas.translate(-250, -165);
    drawBlood(canvas, field.decals, kill + age);
    drawBloomingBlood(canvas, field.decals, kill + age, kill + age);
  };
  sheet(`pool-${mat}`, 160, 140, [close(420), close(1500), close(17_000)], 5);
}

// ── Finishers: a strip of moments ───────────────────────────────────────────
for (const [id, times] of [
  ["butterflies", [60, 250, 600, 1100]],
  ["smite", [40, 170, 600, 3200]],
  ["constellation", [90, 260, 450, 700, 950, 1150, 1400]],
  ["medusa", [50, 150, 240, 290, 360, 650, 900, 1000, 1150]],
  ["snuffed", [60, 250, 440, 700, 1100, 1600]],
] as const) {
  sheet(
    `finisher-${id}`,
    520,
    520,
    times.map((age) => (canvas: any) =>
      withDice(diceFor(2), () => {
        const f = new FinisherField();
        f.spawn(id, 260, 300, 0);
        f.update(age);
        f.drawGround(canvas, age);
        body(canvas, 260, 300, "#d94141", true);
        body(canvas, 205, 330, "#4d7fd9");
        f.drawAir(canvas, age);
      }),
    ),
  );
}

// ── The constellation's variety: different dice → different figure + sky ─────
sheet(
  "finisher-constellation-variety",
  420,
  420,
  [0, 1, 2, 3].map((q) => (canvas: any) =>
    withDice(diceFor(q), () => {
      const f = new FinisherField();
      f.spawn("constellation", 210, 215, 0);
      f.update(650);
      f.drawGround(canvas, 650);
      body(canvas, 210, 215, "#d94141", true);
      f.drawAir(canvas, 650);
    }),
  ),
);

// ── Trails: a curving sprint (and the Comet again mid-dash) ─────────────────
const trailCell =
  (id: "your-colours" | "comet", colours: number, stopFor: number, opacity = 0.4, lengthMs = 1300) =>
  (canvas: any) => {
    const trails = new TrailField();
    let now = 0;
    let p = { id: 1, x: 30, y: 60, alive: true, dashing: false };
    const wear = () => ({ id, colours, opacity, lengthMs });
    for (let i = 0; i < 70; i++) {
      now += 16;
      const a = 0.75 - i * 0.02; // a long curve across the cell
      p = { ...p, x: p.x + Math.cos(a) * 4.5, y: p.y + Math.sin(a) * 4.5 };
      trails.update([p as any], now, wear);
    }
    // …then STAND STILL for `stopFor` ms: the wake must linger and dissolve,
    // not blink out (the pass-2 bug).
    for (let t = 0; t < stopFor; t += 16) {
      now += 16;
      trails.update([p as any], now, wear);
    }
    trails.draw(canvas, now);
    body(canvas, p.x, p.y, "#4d7fd9");
  };
// Running · stopped 150ms · stopped 400ms · stopped 700ms — then the Comet.
sheet("trails", 400, 260, [
  trailCell("your-colours", 0, 0),
  trailCell("your-colours", 0, 150),
  trailCell("your-colours", 0, 400),
  trailCell("your-colours", 0, 700),
  trailCell("comet", 0, 0),
  trailCell("comet", 0, 400),
]);
