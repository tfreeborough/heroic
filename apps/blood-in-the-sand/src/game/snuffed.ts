/**
 * SNUFFED — the earned finisher (bits-cosmetics.md: the Gravedigger deed,
 * "Strike 25 killing blows"). The understated one on purpose: no spectacle,
 * just a life put out like a candle. It has to feel like a reward without
 * upstaging the ones people pay for.
 *
 *   0.00s  THE LIGHT GOES   a pool of shadow drops over the spot and the body
 *                           snaps to a black silhouette
 *   0.05s  THE FLAME        one small flame stands on it, gutters…
 *   0.42s  …AND IS PINCHED OUT — a single ember where it was
 *   0.45s  THE SMOKE        one thin wisp curls away up-screen as the ember
 *                           dies and the shadow lifts
 *
 * Everything here is DARK on the sand (the rule the bloods paid for: cold
 * and dark reads, pale vanishes) — the only light is the flame and ember,
 * and they sit on the black silhouette. No floor mark: snuffed leaves nothing.
 *
 * PERF: two unit radial gradients built once, a flame path built once and
 * scaled, and ONE small path per frame for the smoke wisp (for ~1.3s).
 */
import {
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  vec,
  type SkCanvas,
} from "@shopify/react-native-skia";
import { teardropPath } from "./blood";

const FLAME_OUT_MS = 420;
const SMOKE_MS = 1350;
export const SNUFFED_LIFE_MS = FLAME_OUT_MS + SMOKE_MS;

const BODY_R = 19;
const SHADOW_R = 92;

const shadowPaint = Skia.Paint();
shadowPaint.setAntiAlias(true);
shadowPaint.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(8, 6, 5, 0.66)"), Skia.Color("rgba(8, 6, 5, 0.4)"), Skia.Color("rgba(8, 6, 5, 0)")],
    [0, 0.45, 1],
    TileMode.Clamp,
  ),
);
const emberPaint = Skia.Paint();
emberPaint.setAntiAlias(true);
emberPaint.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(255, 226, 150, 1)"), Skia.Color("rgba(255, 120, 30, 0.85)"), Skia.Color("rgba(200, 40, 10, 0)")],
    [0, 0.4, 1],
    TileMode.Clamp,
  ),
);
const fill = Skia.Paint();
fill.setAntiAlias(true);
const smoke = Skia.Paint();
smoke.setAntiAlias(true);
smoke.setStyle(PaintStyle.Stroke);
smoke.setStrokeCap(StrokeCap.Round);
smoke.setStrokeJoin(StrokeJoin.Round);

const C_SILHOUETTE = Skia.Color("#0b0908");
const C_FLAME_OUT = Skia.Color("#ff8a1e");
const C_FLAME_IN = Skia.Color("#fff0b8");
const C_SMOKE = Skia.Color("#2a2521");
/** A flame, unit-ish: fat base at the origin, the tip 1 up-screen. */
const FLAME = teardropPath(0, 0, 0, -1, 0.34);

export class Snuffed {
  /** The wisp leans one way or the other, frozen at spawn. */
  private readonly lean = Math.random() < 0.5 ? -1 : 1;
  private readonly phase = Math.random() * Math.PI * 2;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  /** Floor pass: the pool of shadow — under the bodies, so a fight over it
   *  stays readable. */
  drawGround(canvas: SkCanvas, age: number): void {
    // Drops in fast, holds while the flame burns, lifts with the smoke.
    const drop = Math.min(1, age / 90);
    const lift = Math.max(0, (age - FLAME_OUT_MS - 200) / (SMOKE_MS - 500));
    const a = drop * (1 - Math.min(1, lift));
    if (a <= 0) return;
    canvas.save();
    canvas.translate(this.x, this.y);
    canvas.scale(SHADOW_R, SHADOW_R);
    shadowPaint.setAlphaf(a);
    canvas.drawCircle(0, 0, 1, shadowPaint);
    canvas.restore();
  }

  /** Air pass: the silhouette, the flame, the ember, the smoke. */
  drawAir(canvas: SkCanvas, age: number): void {
    const { x, y } = this;
    // The silhouette outlasts the flame, then thins away under the smoke.
    const gone = Math.max(0, (age - FLAME_OUT_MS - 350) / (SMOKE_MS - 450));
    const sil = Math.min(1, age / 50) * (1 - Math.min(1, gone));
    if (sil > 0) {
      fill.setColor(C_SILHOUETTE);
      fill.setAlphaf(0.96 * sil);
      canvas.drawCircle(x, y, BODY_R, fill);
    }

    if (age < FLAME_OUT_MS) {
      // Gutters — a fast uneven flicker — then is pinched: the last 90ms it
      // collapses to nothing.
      const t = age / 1000;
      const flick = 0.82 + 0.12 * Math.sin(t * 61 + this.phase) + 0.08 * Math.sin(t * 37);
      const pinch = Math.min(1, (FLAME_OUT_MS - age) / 90);
      const rise = Math.min(1, age / 70);
      const h = 30 * flick * pinch * rise;
      const sway = Math.sin(t * 23 + this.phase) * 4;
      for (const [colour, k] of [[C_FLAME_OUT, 1], [C_FLAME_IN, 0.55]] as const) {
        canvas.save();
        canvas.translate(x, y + 2);
        canvas.skew((sway / 30) * this.lean, 0);
        canvas.scale(h * k * 0.9, h * k);
        fill.setColor(colour);
        fill.setAlphaf(1);
        canvas.drawPath(FLAME, fill);
        canvas.restore();
      }
    }

    // The ember: flares as the flame goes, then dies slowly.
    const e = age - (FLAME_OUT_MS - 60);
    if (e > 0) {
      const glow = Math.max(0, 1 - e / 950);
      if (glow > 0) {
        canvas.save();
        canvas.translate(x, y);
        const r = 5 + 7 * glow * glow;
        canvas.scale(r, r);
        emberPaint.setAlphaf(Math.min(1, glow * 1.3));
        canvas.drawCircle(0, 0, 1, emberPaint);
        canvas.restore();
      }
    }

    // The smoke: one wisp, climbing and curling, thinning as it goes.
    const s = age - FLAME_OUT_MS + 40;
    if (s > 0) {
      const u = Math.min(1, s / SMOKE_MS);
      const height = 150 * (1 - (1 - u) * (1 - u));
      const b = Skia.PathBuilder.Make();
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const v = i / n; // 0 at the body → 1 at the wisp's head
        const py = y - height * v;
        // The curl widens with height and drifts with time.
        const px = x + this.lean * (Math.sin(v * 5.2 + s * 0.0032 + this.phase) * 16 * v + 22 * v * v);
        if (i === 0) b.moveTo(px, py);
        else b.lineTo(px, py);
      }
      const path = b.detach();
      const fade = 1 - u * u;
      smoke.setColor(C_SMOKE);
      smoke.setAlphaf(0.22 * fade);
      smoke.setStrokeWidth(9 + 8 * u);
      canvas.drawPath(path, smoke);
      smoke.setAlphaf(0.62 * fade);
      smoke.setStrokeWidth(3.2);
      canvas.drawPath(path, smoke);
    }
    fill.setAlphaf(1);
  }
}
