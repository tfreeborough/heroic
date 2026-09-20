/**
 * MEDUSA — the finisher with a HELD BEAT (bits-cosmetics.md). The approved
 * ones each move one way: Butterflies burst outward, Smite strikes down, the
 * constellation rises. This one LOOKS at you, and then — uniquely — STOPS.
 *
 *   0.00s  THE DARK       a pool of near-black gathers over the victim
 *   0.06s  THE HEAD       two serpent eyes SNAP open in it, right over the
 *                         body — glaring, heavy-lidded — and her HAIR rears
 *                         up out of the dark round them: a crown of serpents
 *   0.25s  THE LOOK       the pupils snap to slits and every serpent STRIKES
 *                         outward at once — the whole silhouette flares
 *   0.33s  THE TURNING    a judder, a cold flash, and the player's own
 *                         circle is a statue
 *   0.33s  THE HOLD       the eyes and the stone are dead still — and SHE
 *                         DOESN'T LEAVE. Only the hair moves, a slow coiling,
 *                         while cracks snap across the stone in three jolts
 *   0.95s  THE CRUMBLE    the statue breaks apart in a gout of stone dust;
 *                         only now do the serpents recoil into the dark, the
 *                         eyes narrow and shut, and the dark disperses
 *   1.50s  THE RUBBLE     stays — baked into the splat map (the scorch-star
 *                         handoff), so the kill site is marked all match
 *
 * v2 (2026-09-19). v1 opened with seven SNAKES slithering in, and on device
 * "everything looks good except the snakes, they look awful" (Tom). Thin
 * organic squiggles are the worst thing to draw at phone size — uniform
 * strokes are worms, not serpents — and they were only ever Medusa's hair.
 * What turns a man to stone is her GAZE: two eyes are bold geometry, read at
 * a glance, and are the myth's actual mechanism.
 * v3 (same day, Tom's second look): the eyes LUNGE at the victim rather than
 * just hanging there, and v2's patch of cracked slate spreading across the
 * sand is cut — "the player's circle will be good enough". The stone is the
 * body, nothing more; the lunge is where the size comes from now.
 * v4 (Tom's third look): the eyes don't TRAVEL to the victim — they "start
 * right over the statue and just expand towards the player… on an ease-out".
 * So they open centred on the body and come at the CAMERA, fast then slowing.
 * v5 (Tom's fourth look: "we need to make it scarier, the eyes are also
 * growing too much"). What was wrong, and what scary is made of:
 *  - they sloped UP toward the nose (/ \) — that's worried, not angry. Now
 *    the inner corners are pulled DOWN (\ /) and a heavy black upper lid cuts
 *    across each iris: a glare.
 *  - lime-bright and friendly → a darker, sicker iris burning in a much
 *    blacker, bigger pool of dark, with a poisonous glow under each eye.
 *  - smooth and floaty → SNAP open, dead still, pupils SNAP to slits, a
 *    judder at the turning. Stillness and suddenness, not easing.
 *  - they swelled to 2.6× and drifted off → a slow loom, 0.9× to 1.35×,
 *    still on Tom's ease-out.
 *  - they left → they STAY, watching, for the whole hold, and only close
 *    when the statue falls. Being watched is the frightening part.
 *
 * v6 (2026-09-20, Tom: "it really doesn't feel medusa-y and doesn't really
 * earn its place as a premium buy"). He's right, and v2 is why: cutting the
 * snakes cut the one thing that makes her HER. Two green eyes and a grey disc
 * is "an evil eye" — it could be a cat, a demon, anything. So the hair is
 * back, built the opposite way to v1's worms:
 *  - v1's snakes were thin uniform STROKES crawling over the sand. These are
 *    THICK tapered bodies — a chain of overlapping shaded discs, fat at the
 *    root, with a wedge head — i.e. bold masses, the only thing that reads
 *    at phone size. All seven are ONE drawAtlas call.
 *  - they're HAIR, not travellers: rooted on the brow over the eyes, so the
 *    eyes + crown read as one head (the gorgoneion off a Greek shield).
 *  - they give the show its big shape-change (the STRIKE, on the same frame
 *    the pupils slit) and give the hold something alive in it; the eyes and
 *    the stone stay frozen, which is scarier next to movement.
 *  - they're in the GROUND pass with the dark, under the bodies: the crown
 *    is big, and a fight across it must stay readable.
 * Also v6: the crumble throws a gout of slate dust (weight), and the whole
 * show is 1.5s, down from 1.8 — finishers play mid-fight and must be quick.
 *
 * Colour, by the rule the bloods paid for: on this sand COLD and DARK reads,
 * and LIGHT NEEDS DARK. Real stone grey is the sand's own value and would
 * vanish, so the stone is a cold SLATE with pale edges; the eyes are bright,
 * so they open in a veil of dark smoke, never on bare sand.
 *
 * PERF: everything is a path or unit gradient built ONCE (eye almond, statue
 * cracks, shards); a frame is ~10 scaled draws for the gaze, ~20 for the
 * crumble, plus ONE drawAtlas of ~90 sprites for the hair (the butterflies'
 * order). Serpent motion is closed-form — a travelling sine down a fixed
 * spine. No blur, no saveLayer, no per-frame paths.
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

/** The eyes snap open over this window… */
const OPEN_AT_MS = 60;
const OPEN_MS = 80;
/** …the pupils snap to slits here… */
const SLIT_AT_MS = 250;
/** …and this is the turning. */
const GAZE_MS = 330;
/** The loom: how long the (slight) growth toward the camera takes. */
const LOOM_MS = 750;
/** The eyes shut over this long once the statue starts to fall. */
const SHUT_MS = 170;
const CRUMBLE_AT_MS = 950;
const CRUMBLE_MS = 550;
/** The stone dust thrown as the statue goes. */
const DUST_MS = 460;
const DUST_PUFFS = 6;
export const MEDUSA_LIFE_MS = CRUMBLE_AT_MS + CRUMBLE_MS;

const STATUE_R = 20;
/** The eyes at scale 1: half-width / half-height of one, the gap between. */
const EYE_W = 30;
const EYE_H = 13;
const EYE_GAP = 38;
/** The glare: degrees each eye's inner corner is pulled down. */
const EYE_GLARE_DEG = 15;
/** They open over the body this small, and come at the camera until they're
 *  this big — the gap between them widening past the statue as they grow. */
const EYE_START_SCALE = 0.9;
const EYE_END_SCALE = 1.35;
const TAU = Math.PI * 2;

const C_EYE_RIM = Skia.Color("#06100a");
const C_PUPIL = Skia.Color("#020503");
const C_GLINT = Skia.Color("#f6ffd8");
const C_SLATE = Skia.Color("#56606e");
const C_SLATE_DARK = Skia.Color("#2c333d");
const C_SLATE_LIGHT = Skia.Color("#aab6c4");
const C_CRACK = Skia.Color("#12161b");

const fill = Skia.Paint();
fill.setAntiAlias(true);
const stroke = Skia.Paint();
stroke.setAntiAlias(true);
stroke.setStyle(PaintStyle.Stroke);
stroke.setStrokeCap(StrokeCap.Round);
stroke.setStrokeJoin(StrokeJoin.Round);
/** The statue's form: lit from the upper left, like everything in the pit. */
const statuePaint = Skia.Paint();
statuePaint.setAntiAlias(true);
statuePaint.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(-0.35, -0.4),
    1.5,
    [Skia.Color("#b9c4d1"), Skia.Color("#66717f"), Skia.Color("#2f3742")],
    [0, 0.5, 1],
    TileMode.Clamp,
  ),
);
const flashPaint = Skia.Paint();
flashPaint.setAntiAlias(true);
flashPaint.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(223, 234, 245, 0.9)"), Skia.Color("rgba(160, 182, 206, 0.35)"), Skia.Color("rgba(140, 165, 195, 0)")],
    [0, 0.45, 1],
    TileMode.Clamp,
  ),
);

/** The dark the eyes open in — near-black, soft-edged, and BIG: it should
 *  feel like the light has gone out of that patch of the arena. */
const veilPaint = Skia.Paint();
veilPaint.setAntiAlias(true);
veilPaint.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [
      Skia.Color("rgba(1, 3, 2, 0.95)"),
      Skia.Color("rgba(2, 8, 4, 0.86)"),
      Skia.Color("rgba(4, 16, 8, 0.45)"),
      Skia.Color("rgba(6, 22, 10, 0)"),
    ],
    [0, 0.42, 0.74, 1],
    TileMode.Clamp,
  ),
);
/** The iris: a sick yellow-green, hot only in a tight ring round the pupil,
 *  falling away to almost black at the rim. */
const irisPaint = Skia.Paint();
irisPaint.setAntiAlias(true);
irisPaint.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("#f2ff7a"), Skia.Color("#9ccc1c"), Skia.Color("#2c5c12"), Skia.Color("#081406")],
    [0, 0.28, 0.66, 1],
    TileMode.Clamp,
  ),
);
/** A poisonous glow spilling from each eye onto the dark around it. */
const glowPaint = Skia.Paint();
glowPaint.setAntiAlias(true);
glowPaint.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(150, 220, 40, 0.5)"), Skia.Color("rgba(90, 170, 30, 0.16)"), Skia.Color("rgba(60, 140, 20, 0)")],
    [0, 0.5, 1],
    TileMode.Clamp,
  ),
);
/** One eye, unit space (half-width 1, half-height 1): a pointed almond. */
const EYE = Skia.PathBuilder.Make()
  .moveTo(-1, 0)
  .quadTo(0, -1.9, 1, 0)
  .quadTo(0, 1.9, -1, 0)
  .close()
  .detach();
/** The heavy upper lid (same unit space, inner corner at +x): everything
 *  above a chord from a point on the upper curve near the OUTER corner down
 *  to the inner corner — so it bites deepest toward the nose. The curve is
 *  the almond's own top arc from t = 0.22, split exactly. */
const LID = Skia.PathBuilder.Make().moveTo(-0.56, -0.652).quadTo(0.22, -1.482, 1, 0).close().detach();
const C_LID = Skia.Color("#020403");
// ── The hair ────────────────────────────────────────────────────────────────
const SERPENTS = 7;
/** They rear up out of the dark over this long (each on a short stagger)… */
const REAR_MS = 180;
/** …STRIKE outward on THE LOOK — out in the first quarter, settling after… */
const STRIKE_MS = 260;
const STRIKE_REACH = 0.3;
/** …and are dragged back into the dark as the statue falls. */
const RECOIL_MS = 230;
/** The brow they're rooted on: an arc over the eyes, corner to corner. */
const BROW_RX = 80;
const BROW_RY = 40;
const BROW_Y = -6;
const BROW_SPAN = (100 * Math.PI) / 180;

const S_CELL = 48;
const S_DISC_R = 20;
/** The head art points +x; its neck joint sits here in the cell. */
const S_NECK_X = 9;
const S_HEAD_W = 27;
/** The dark edge round a body, world px — constant, so thin necks keep it. */
const S_EDGE = 1.7;
const SRC_EDGE = Skia.XYWHRect(0, 0, S_CELL, S_CELL);
const SRC_DISC = Skia.XYWHRect(S_CELL, 0, S_CELL, S_CELL);
const SRC_HEAD = Skia.XYWHRect(S_CELL * 2, 0, S_CELL, S_CELL);

const C_SERPENT_EDGE = Skia.Color("#03100a");
let serpentAtlas: SkImage | null = null;
let serpentAtlasFailed = false;
/** Body, edge and head, shaded ONCE. A serpent is two chains of discs down
 *  one spine: near-black EDGE discs, then RIM-FREE body discs over them.
 *  (The first cut was one chain of rimmed discs — every rim showed against
 *  the disc before it and the preview was seven CATERPILLARS. Rim-free discs
 *  melt into one smooth tube; the union of the edge discs is its outline.) */
const ensureSerpentAtlas = (): SkImage | null => {
  if (serpentAtlas || serpentAtlasFailed) return serpentAtlas;
  const surface = Skia.Surface.Make(S_CELL * 3, S_CELL);
  if (!surface) {
    serpentAtlasFailed = true; // → she's eyes-only, as v5
    return null;
  }
  const c = surface.getCanvas();
  const p = Skia.Paint();
  p.setAntiAlias(true);
  // Lit from the upper left like everything in the pit: a soft toxic
  // highlight on a flat viridian — NO dark rim (see above).
  const shade = (cx: number, cy: number, r: number): void => {
    p.setShader(
      Skia.Shader.MakeRadialGradient(
        vec(cx - r * 0.3, cy - r * 0.34),
        r * 1.2,
        [Skia.Color("#b4e052"), Skia.Color("#4f9f3a"), Skia.Color("#2a7234"), Skia.Color("#236330")],
        [0, 0.3, 0.7, 1],
        TileMode.Clamp,
      ),
    );
  };
  p.setColor(C_SERPENT_EDGE);
  c.drawCircle(S_CELL / 2, S_CELL / 2, S_DISC_R, p);
  shade(S_CELL * 1.5, S_CELL / 2, S_DISC_R);
  c.drawCircle(S_CELL * 1.5, S_CELL / 2, S_DISC_R, p);
  // A viper's head from above: wide at the jaw, a blunt snout.
  const hx = S_CELL * 2 + S_NECK_X;
  const hy = S_CELL / 2;
  const head = Skia.PathBuilder.Make()
    .moveTo(hx - 3, hy - 7)
    .quadTo(hx + 3, hy - S_HEAD_W / 2 - 4, hx + 12, hy - S_HEAD_W / 2 + 1)
    .quadTo(hx + 26, hy - 8, hx + 36, hy - 1.6)
    .quadTo(hx + 37.5, hy, hx + 36, hy + 1.6)
    .quadTo(hx + 26, hy + 8, hx + 12, hy + S_HEAD_W / 2 - 1)
    .quadTo(hx + 3, hy + S_HEAD_W / 2 + 4, hx - 3, hy + 7)
    .close()
    .detach();
  shade(hx + 14, hy, 22);
  c.drawPath(head, p);
  p.setShader(null);
  p.setColor(C_SERPENT_EDGE);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(3.2);
  p.setStrokeJoin(StrokeJoin.Round);
  c.drawPath(head, p);
  p.setStyle(PaintStyle.Fill);
  // Her hair has eyes too — two hot points are what sells "head" at a glance.
  // Narrow and slanted in toward the snout: round dots (the first cut) are
  // a cartoon worm's; a slit is a viper's.
  p.setColor(Skia.Color("#f6ff8a"));
  for (const side of [-1, 1]) {
    c.save();
    c.translate(hx + 18, hy + side * 7);
    c.rotate(-side * 24, 0, 0);
    c.drawOval(Skia.XYWHRect(-4.6, -1.7, 9.2, 3.4), p);
    c.restore();
  }
  serpentAtlas = surface.makeImageSnapshot();
  return serpentAtlas;
};
const serpentPaint = Skia.Paint();
serpentPaint.setAntiAlias(true);
// drawAtlas scratch — persistent, truncated per call (the crowd.ts diet).
const sSrcs: SkRect[] = [];
const sDsts: SkRSXform[] = [];
const sCols: SkColor[] = [];
/** One serpent's station positions, x,y pairs — reused between its chains. */
const sSpine: number[] = [];

/** Stone dust: cold and mid-dark — pale dust is the sand's own value. */
const dustPaint = Skia.Paint();
dustPaint.setAntiAlias(true);
dustPaint.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(96, 108, 124, 0.7)"), Skia.Color("rgba(120, 134, 152, 0.34)"), Skia.Color("rgba(140, 154, 172, 0)")],
    [0, 0.55, 1],
    TileMode.Clamp,
  ),
);

interface Serpent {
  /** Root on the brow, and the heading it leaves on (rad). */
  x: number;
  y: number;
  dir: number;
  /** How far the spine curls over its length (rad) — the side locks droop
   *  down round the face like hair. */
  bend: number;
  len: number;
  girth: number;
  waves: number;
  amp: number;
  hz: number;
  phase: number;
  delay: number;
  /** Disc stations root → tip (0..1), spaced by the taper so they always
   *  overlap, each with its own tint (built once — no per-frame allocs). */
  at: number[];
  tints: Float32Array[];
}

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const easeOutBack = (t: number): number => {
  const u = clamp01(t) - 1;
  return 1 + 2.4 * u * u * u + 1.4 * u * u;
};
/** Girth at station s: fat at the root, half that at the neck — the taper is
 *  what separates a serpent from a worm. */
const taper = (s: number): number => 1 - 0.5 * s;
const WHITE = Float32Array.of(1, 1, 1, 1);

interface Shard {
  path: SkPath; // local to its own centre
  /** The same outline as points — the rubble path is rebuilt from these. */
  pts: [number, number][];
  cx: number;
  cy: number;
  /** Where it comes to rest, and how far it turns getting there. */
  dx: number;
  dy: number;
  spin: number;
  delay: number;
  light: boolean;
}

export class Medusa {
  private readonly shards: Shard[] = [];
  private readonly cracks: SkPath[] = [];
  /** The rubble at rest, world coords — what's left, and what gets baked. */
  private rubble: SkPath | null = null;
  private rubbleLight: SkPath | null = null;
  private readonly serpents: Serpent[] = [];
  /** Dust puffs: [heading, drift px, size px]. */
  private readonly dust: [number, number, number][] = [];

  constructor(
    readonly x: number,
    readonly y: number,
  ) {
    // The hair: stratified along the brow so the crown is never lopsided,
    // the middle one tallest — a silhouette with a peak.
    for (let i = 0; i < SERPENTS; i++) {
      const u = (i + 0.5 + (Math.random() - 0.5) * 0.5) / SERPENTS; // 0..1 along the brow
      const a = (u * 2 - 1) * BROW_SPAN; // from straight up; ± = right/left
      const mid = 1 - Math.abs(u * 2 - 1);
      const len = 46 + mid * 14 + Math.random() * 14;
      const girth = 11 + Math.random() * 2.5;
      const at: number[] = [];
      for (let s = 0; s < 1; s += (0.72 * girth * taper(s)) / len) at.push(s);
      this.serpents.push({
        x: Math.sin(a) * BROW_RX,
        y: BROW_Y - Math.cos(a) * BROW_RY,
        dir: Math.atan2(-Math.cos(a), Math.sin(a)),
        bend: Math.sin(a) * 0.9 + (Math.random() - 0.5) * 0.5,
        len,
        girth,
        waves: 0.9 + Math.random() * 0.5,
        amp: 9 + Math.random() * 6,
        hz: 0.9 + Math.random() * 0.6,
        phase: Math.random() * TAU,
        delay: Math.random() * 70,
        // Out of the dark: near-black at the root, full colour by the neck.
        at,
        tints: at.map((s) => {
          const k = 0.38 + 0.62 * Math.min(1, s * 1.5);
          return Float32Array.of(k, k, k, 1);
        }),
      });
    }
    for (let i = 0; i < DUST_PUFFS; i++) {
      this.dust.push([((i + Math.random()) / DUST_PUFFS) * TAU, 14 + Math.random() * 22, 20 + Math.random() * 16]);
    }

    // The statue breaks into wedge shards: an inner ring and an outer ring,
    // with jittered cuts so no two are alike.
    const rings: [number, number, number][] = [
      [0, STATUE_R * 0.52, 5],
      [STATUE_R * 0.52, STATUE_R, 8],
    ];
    for (const [r0, r1, n] of rings) {
      const off = Math.random() * TAU;
      for (let i = 0; i < n; i++) {
        const a0 = off + (i / n) * TAU + (Math.random() - 0.5) * 0.25;
        const a1 = off + ((i + 1) / n) * TAU + (Math.random() - 0.5) * 0.25;
        const am = (a0 + a1) / 2;
        const rm = (r0 + r1) / 2;
        const cx = Math.cos(am) * rm;
        const cy = Math.sin(am) * rm;
        const b = Skia.PathBuilder.Make();
        const pts: [number, number][] = [
          [Math.cos(a0) * r0, Math.sin(a0) * r0],
          [Math.cos(a0) * r1, Math.sin(a0) * r1],
          [Math.cos(am) * r1 * 1.04, Math.sin(am) * r1 * 1.04],
          [Math.cos(a1) * r1, Math.sin(a1) * r1],
          [Math.cos(a1) * r0, Math.sin(a1) * r0],
        ];
        const local = pts.map(([px, py]): [number, number] => [px - cx, py - cy]);
        local.forEach(([px, py], k) => (k === 0 ? b.moveTo(px, py) : b.lineTo(px, py)));
        const throwDist = (r1 === STATUE_R ? 16 : 5) + Math.random() * 22;
        this.shards.push({
          path: b.close().detach(),
          pts: local,
          cx,
          cy,
          dx: Math.cos(am) * throwDist + (Math.random() - 0.5) * 8,
          dy: Math.sin(am) * throwDist + (Math.random() - 0.5) * 8,
          spin: (Math.random() - 0.5) * 220,
          delay: Math.random() * 160,
          light: Math.random() < 0.4,
        });
      }
    }

    // Three generations of cracks, each a jagged run across the statue.
    for (let g = 0; g < 3; g++) {
      const b = Skia.PathBuilder.Make();
      for (let c = 0; c < 2 + g; c++) {
        let a = Math.random() * TAU;
        let r = STATUE_R * (0.05 + Math.random() * 0.25);
        b.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        for (let k = 0; k < 4; k++) {
          a += (Math.random() - 0.5) * 0.9;
          r = Math.min(STATUE_R * 0.98, r + STATUE_R * (0.18 + Math.random() * 0.2));
          b.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
      }
      this.cracks.push(b.detach());
    }
  }

  /** The floor mark stays hidden for the whole show — the tumbling shards
   *  END in exactly the rubble's pose, so when the show is over the baked
   *  rubble simply takes their place. */
  markAlpha(): number {
    return 0;
  }

  /** The rubble, world coords — built on first ask (the shards' rest poses). */
  stampMark(canvas: SkCanvas, alpha: number): void {
    if (alpha <= 0) return;
    if (!this.rubble) {
      const dark = Skia.PathBuilder.Make();
      const light = Skia.PathBuilder.Make();
      for (const sh of this.shards) {
        const rad = (sh.spin * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const ox = this.x + sh.cx + sh.dx;
        const oy = this.y + sh.cy + sh.dy;
        const b = sh.light ? light : dark;
        sh.pts.forEach(([px, py], k) => {
          const wx = ox + px * cos - py * sin;
          const wy = oy + px * sin + py * cos;
          if (k === 0) b.moveTo(wx, wy);
          else b.lineTo(wx, wy);
        });
        b.close();
      }
      this.rubble = dark.detach();
      this.rubbleLight = light.detach();
    }
    fill.setColor(C_SLATE);
    fill.setAlphaf(0.92 * alpha);
    canvas.drawPath(this.rubble, fill);
    fill.setColor(C_SLATE_LIGHT);
    canvas.drawPath(this.rubbleLight!, fill);
    stroke.setColor(C_SLATE_DARK);
    stroke.setAlphaf(0.9 * alpha);
    stroke.setStrokeWidth(1.1);
    canvas.drawPath(this.rubble, stroke);
    canvas.drawPath(this.rubbleLight!, stroke);
    fill.setAlphaf(1);
    stroke.setAlphaf(1);
  }

  /** Floor pass: the DARK. It's a big black pool and it lasts 1.5s, so it
   *  goes under the bodies — anyone fighting across it stays readable; only
   *  the eyes and the statue are in the air. (The rubble is the
   *  FinisherField's mark, drawn via stampMark.) */
  drawGround(canvas: SkCanvas, age: number): void {
    canvas.save();
    canvas.translate(this.x, this.y);
    this.drawGaze(canvas, age, "veil");
    canvas.restore();
  }

  /** The eyes. Local coords, centred ON the body. */
  private drawGaze(canvas: SkCanvas, age: number, part: "veil" | "eyes"): void {
    const shut = Math.min(1, Math.max(0, (age - CRUMBLE_AT_MS) / SHUT_MS));
    // The dark outlives the eyes a little, dispersing as the statue falls.
    const dark = Math.min(1, age / 110) * (1 - Math.min(1, Math.max(0, (age - CRUMBLE_AT_MS) / 420)));
    if (dark <= 0) return;
    // The loom — Tom's ease-out, but SLIGHT now: she leans in, she doesn't fly.
    const t = Math.min(1, age / LOOM_MS);
    const ease = 1 - (1 - t) * (1 - t) * (1 - t);
    const scale = EYE_START_SCALE + (EYE_END_SCALE - EYE_START_SCALE) * ease;

    canvas.save();
    canvas.scale(scale, scale);
    if (part === "veil") {
      // Drawn from the GROUND pass: under every body and under the statue —
      // it's what the eyes burn against, it mustn't hide a fight or dim the
      // stone.
      veilPaint.setAlphaf(dark);
      // A second lobe of dark up behind the crown — dark over dark is
      // seamless, so the two melt into one head-shaped pool.
      canvas.save();
      canvas.translate(0, -34);
      canvas.scale(112, 74);
      canvas.drawCircle(0, 0, 1, veilPaint);
      canvas.restore();
      canvas.save();
      canvas.scale(EYE_GAP + EYE_W * 2.5, EYE_H * 6.4);
      canvas.drawCircle(0, 0, 1, veilPaint);
      canvas.restore();
      this.drawSerpents(canvas, age);
      canvas.restore();
      return;
    }

    // Lids: SNAP open (no ease — sudden is the point), and later shut.
    const open = Math.min(1, Math.max(0, (age - OPEN_AT_MS) / OPEN_MS));
    const lids = (1 - (1 - open) * (1 - open)) * (1 - shut * shut);
    if (lids <= 0.02) {
      canvas.restore();
      return;
    }
    // Pupils hold wide, then SNAP to slits in 50ms.
    const slit = 0.46 - 0.34 * Math.min(1, Math.max(0, (age - SLIT_AT_MS) / 50));
    // Through the hold she burns lower — a steady stare, not a flash.
    const after = age - GAZE_MS;
    const stare = after <= 0 ? 1 : 0.72 + 0.28 * Math.max(0, 1 - after / 260);
    const flare = after > 0 ? Math.max(0, 1 - after / 110) : 0;
    // The judder at the turning: a few px, dying fast.
    const shake = after > 0 && after < 150 ? (1 - after / 150) * 3 : 0;
    const jx = Math.sin(age * 0.21) * shake;
    const jy = Math.cos(age * 0.33) * shake;

    for (const side of [-1, 1]) {
      canvas.save();
      canvas.translate(side * (EYE_GAP / 2 + EYE_W) + jx, jy);
      // Mirror the right eye so "inner corner" is always local +x, then pull
      // that corner DOWN: \ / is a glare (/ \ — the first cut — is worry).
      canvas.scale(-side, 1);
      canvas.rotate(EYE_GLARE_DEG, 0, 0);

      canvas.save();
      canvas.scale(EYE_W * 2.1, EYE_H * 3.4);
      glowPaint.setAlphaf(lids * stare);
      canvas.drawCircle(0, 0, 1, glowPaint);
      canvas.restore();

      canvas.scale(EYE_W, EYE_H * lids);
      irisPaint.setAlphaf(stare);
      canvas.drawPath(EYE, irisPaint);
      if (flare > 0) {
        fill.setColor(C_GLINT);
        fill.setAlphaf(flare);
        canvas.drawPath(EYE, fill);
      }
      fill.setColor(C_PUPIL);
      fill.setAlphaf(1);
      canvas.drawOval(Skia.XYWHRect(-slit * 0.5, -1, slit, 2), fill);
      // The brow: a black lid biting down across the iris toward the nose.
      fill.setColor(C_LID);
      canvas.drawPath(LID, fill);
      stroke.setColor(C_EYE_RIM);
      stroke.setAlphaf(1);
      stroke.setStrokeWidth(0.16);
      canvas.drawPath(EYE, stroke);
      canvas.restore();
    }
    fill.setAlphaf(1);
    stroke.setAlphaf(1);
    canvas.restore();
  }

  /** Her hair. Local coords (already under the loom's scale), ONE drawAtlas:
   *  each serpent is a fixed spine — out from the brow, curling by `bend` —
   *  with a sine travelling down it, growing from nothing at the root so the
   *  scalp end stays planted and the head end does the searching. */
  private drawSerpents(canvas: SkCanvas, age: number): void {
    const img = ensureSerpentAtlas();
    if (!img) return;
    const recoil = clamp01((age - CRUMBLE_AT_MS) / RECOIL_MS);
    if (recoil >= 1) return;
    // The STRIKE: out fast (ease-out), back slower — and they go rigid-
    // straight at full reach, the way a striking snake does.
    const st = (age - SLIT_AT_MS) / STRIKE_MS;
    const strike = st <= 0 || st >= 1 ? 0 : st < 0.22 ? 1 - (1 - st / 0.22) ** 2 : 1 - ((st - 0.22) / 0.78) ** 2;
    const sec = age / 1000;
    sSrcs.length = sDsts.length = sCols.length = 0;
    for (const sp of this.serpents) {
      const rear = easeOutBack((age - OPEN_AT_MS - sp.delay) / REAR_MS);
      // Dragged back on an ease-IN: slow to let go, then gone. They never
      // FADE — translucent stacked discs show every overlap — they retract
      // into the dark, which outlasts them.
      const grow = rear * (1 + STRIKE_REACH * strike) * (1 - recoil * recoil);
      if (grow <= 0.05) continue;
      const amp = sp.amp * (1 - 0.75 * strike);
      let px = sp.x;
      let py = sp.y;
      let qx = px;
      let qy = py;
      sSpine.length = 0;
      for (const s of sp.at) {
        const d = sp.len * grow * s;
        const h = sp.dir + sp.bend * s * 0.5;
        const w = Math.sin(sp.waves * TAU * s - sp.hz * TAU * sec + sp.phase) * amp * s;
        qx = px;
        qy = py;
        px = sp.x + Math.cos(h) * d - Math.sin(h) * w;
        py = sp.y + Math.sin(h) * d + Math.cos(h) * w;
        sSrcs.push(SRC_EDGE);
        sDsts.push(
          Skia.RSXformFromRadians((sp.girth * taper(s) + S_EDGE) / S_DISC_R, 0, px, py, S_CELL / 2, S_CELL / 2),
        );
        sCols.push(WHITE);
        sSpine.push(px, py);
      }
      // …then the bodies over this serpent's own edges (but under the next
      // serpent's — where two cross, one is plainly in front).
      sp.at.forEach((s, i) => {
        sSrcs.push(SRC_DISC);
        sDsts.push(
          Skia.RSXformFromRadians(
            (sp.girth * taper(s)) / S_DISC_R,
            0,
            sSpine[i * 2]!,
            sSpine[i * 2 + 1]!,
            S_CELL / 2,
            S_CELL / 2,
          ),
        );
        sCols.push(sp.tints[i]!);
      });
      // The head rides the last station, nose along the way the neck is
      // going — and is properly WIDER than the neck: a viper, not a worm.
      const heading = Math.atan2(py - qy, px - qx);
      sSrcs.push(SRC_HEAD);
      sDsts.push(
        Skia.RSXformFromRadians((sp.girth * taper(1) * 3.3) / S_HEAD_W, heading, px, py, S_NECK_X, S_CELL / 2),
      );
      sCols.push(WHITE);
    }
    if (sDsts.length === 0) return;
    canvas.drawAtlas(img, sSrcs, sDsts, serpentPaint, BlendMode.Modulate, sCols);
  }

  /** Air pass: the gaze, the statue, the cracks, the crumble. */
  drawAir(canvas: SkCanvas, age: number): void {
    const since = age - GAZE_MS;
    canvas.save();
    canvas.translate(this.x, this.y);
    // Before the turning there's only the eyes.
    if (age < GAZE_MS) {
      this.drawGaze(canvas, age, "eyes");
      canvas.restore();
      return;
    }

    // The gaze: one cold flash as they strike.
    if (since < 260) {
      const t = Math.max(0, since) / 260;
      canvas.save();
      const r = 40 + 90 * t;
      canvas.scale(r, r);
      flashPaint.setAlphaf((1 - t) * (1 - t));
      canvas.drawCircle(0, 0, 1, flashPaint);
      canvas.restore();
    }

    if (age < CRUMBLE_AT_MS) {
      // The statue: it lands a touch big and settles (the snap of turning).
      const snap = 1 + 0.16 * Math.max(0, 1 - Math.max(0, since) / 140);
      canvas.save();
      canvas.scale(STATUE_R * snap, STATUE_R * snap);
      canvas.drawCircle(0, 0, 1, statuePaint);
      canvas.restore();
      stroke.setColor(C_SLATE_DARK);
      stroke.setAlphaf(1);
      stroke.setStrokeWidth(1.6);
      canvas.drawCircle(0, 0, STATUE_R * snap, stroke);
      // Cracks arrive in three jolts across the hold — each one snaps in.
      const hold = (age - GAZE_MS - 200) / (CRUMBLE_AT_MS - GAZE_MS - 200);
      stroke.setColor(C_CRACK);
      stroke.setStrokeWidth(1.5);
      this.cracks.forEach((c, g) => {
        const at = [0.18, 0.5, 0.8][g]!;
        if (hold < at) return;
        stroke.setAlphaf(Math.min(1, (hold - at) / 0.04));
        canvas.drawPath(c, stroke);
      });
    } else {
      // A gout of stone dust under the shards — out fast, thinning as it goes.
      const dt = (age - CRUMBLE_AT_MS) / DUST_MS;
      if (dt < 1) {
        const out = 1 - (1 - dt) * (1 - dt) * (1 - dt);
        dustPaint.setAlphaf((1 - dt) * (1 - dt));
        for (const [a, drift, size] of this.dust) {
          canvas.save();
          canvas.translate(Math.cos(a) * drift * out, Math.sin(a) * drift * out);
          canvas.scale(size * (0.5 + 0.9 * out), size * (0.5 + 0.9 * out));
          canvas.drawCircle(0, 0, 1, dustPaint);
          canvas.restore();
        }
      }
      // The crumble: every shard tumbles to its rest, ease-out, on its own
      // short delay — then the baked rubble takes over.
      for (const sh of this.shards) {
        const t = Math.min(1, Math.max(0, (age - CRUMBLE_AT_MS - sh.delay) / (CRUMBLE_MS - 200)));
        const e = 1 - (1 - t) * (1 - t) * (1 - t);
        canvas.save();
        canvas.translate(sh.cx + sh.dx * e, sh.cy + sh.dy * e);
        canvas.rotate(sh.spin * e, 0, 0);
        fill.setColor(sh.light ? C_SLATE_LIGHT : C_SLATE);
        fill.setAlphaf(0.95);
        canvas.drawPath(sh.path, fill);
        stroke.setColor(C_SLATE_DARK);
        stroke.setAlphaf(0.9);
        stroke.setStrokeWidth(1.1);
        canvas.drawPath(sh.path, stroke);
        canvas.restore();
      }
    }
    // The eyes are nearer the camera than the statue — they draw over it,
    // spreading apart past it as they come.
    this.drawGaze(canvas, age, "eyes");
    fill.setAlphaf(1);
    stroke.setAlphaf(1);
    canvas.restore();
  }
}
