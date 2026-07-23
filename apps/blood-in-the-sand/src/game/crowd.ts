/**
 * The pit crowd — a procedural, animated amphitheatre ring drawn OUTSIDE the
 * sand floor to sell "you're fighting down in a pit while a mob watches".
 *
 * Everything here is pure client decoration: never networked, never touches the
 * sim (same rule as the blood decals). The arena boundary is really just an
 * invisible bounds-clamp at the sand edge (core physics clampCircleToBounds);
 * this module paints a stone barrier + tiered stands + a mob of bobbing bodies
 * in the region beyond that edge, and render.ts relaxes the camera clamp by
 * CROWD_REVEAL so a band of it slides into view whenever you fight near a wall.
 *
 * PERSPECTIVE — the camera is top-down looking into the pit, so seating that
 * climbs UP away from the sand gets CLOSER to the camera: every row back is
 * drawn larger (SCALE_FRONT → SCALE_BACK), rows and terrace steps spread
 * further apart, and the wave lifts bigger bodies further. That ramp is the
 * whole height illusion; the bodies also sit in discrete rows along concentric
 * rings (not a flat grid), one row per terrace slab, so the stands read as
 * stepped seating rather than a mob standing on flat ground.
 *
 * PERF — the mob is drawn with drawAtlas, NOT one draw per body. Recording ~700
 * visible bodies as individual drawOval/drawCircle calls cost ~25ms of picture-
 * record time (each call is a JSI hop that records geometry). Instead a small
 * atlas of white body parts (three torso builds, a head, four hair styles) is
 * baked ONCE, and each frame the whole visible strip is emitted as just THREE
 * drawAtlas calls (torso + head + hair layers) — drawAtlas takes a src rect per
 * sprite, so body-shape and hairstyle diversity are a free per-seat cell pick,
 * not extra draws: one SkRSXform per body carries its position and
 * wave-lift, one SkColor per body carries its static tint. Record cost collapses
 * from ~1500 draws to 2. The wave is a PHYSICAL travelling bump (bodies rise as
 * a tight crest passes), never a brightness sweep — a wide bright band read as
 * an ugly white streak. Colours are parsed to SkColor ONCE at build; the static
 * bowl (slabs, risers, wall courses, rim shadow) is a prebuilt band list culled
 * to the viewport per frame — mid-arena frames record ZERO bowl rects; the crowd
 * is thinned with clustered gaps (fewer bodies = lower record cost); spectators
 * fitting the whole bowl fall to a single baked still (per-body motion is
 * sub-pixel there).
 *
 * PERF v2 (2026-07-23, old-device rec pass) — drawAtlas fixed the DRAW count,
 * but building fresh Skia.RSXform host objects for every visible body every
 * frame (torso + head + hair ≈ ~1000+ JSI constructions) was still most of
 * the crowd's record cost. Now every seat prebuilds its at-rest transforms at
 * build time and pushes them BY REFERENCE; the ±1px idle bob was cut (frozen
 * into the layout as POSE_JITTER — imperceptible live at these sizes) so
 * "at rest" is exact, and only the wave crest's bodies allocate fresh lifted
 * transforms per frame. The ring was also thinned ~25% (SEAT_SP, GAP_CUTOFF,
 * FRONT_FULL), weighted into the back rows.
 */
import {
  BlendMode,
  FilterMode,
  MipmapMode,
  Skia,
  type SkCanvas,
  type SkColor,
  type SkImage,
  type SkRect,
  type SkRSXform,
} from "@shopify/react-native-skia";

/** World px of stands revealed past the sand edge when you're pinned to a wall.
 *  render.ts widens the camera clamp by this so the mob slides into frame. */
export const CROWD_REVEAL = 235;

// The stands are drawn a little deeper than we ever reveal, so the outer rim
// (and the void behind it) can never peek into frame at the reveal limit.
const DEPTH = 220;
// The pit wall's HEIGHT — a tall vertical stone face between the sand and the
// crowd, so the stands read as raised up looking DOWN into the pit (a thin lip
// made the crowd look perched on the edge of a drop). Also the crowd's clearance
// from the sand: the front row sits at the top of this wall.
const WALL = 52;
// The last slice of stands sinks into roof/canopy shadow (fake height cue).
const ROOF = 46;

// The perspective ramp: body scale at the front row vs the back row. Higher
// rows are nearer the top-down camera, so the back of the bowl draws ~1.5x the
// front. Row gaps, seat spacing and wave-lift all follow the same ramp.
const SCALE_FRONT = 0.85;
const SCALE_BACK = 1.47;
// Terrace row pitch (world px between row centres) at the front, and how much
// extra pitch the ramp adds by the back (rows spread as the stands climb).
const ROW_PITCH = 17;
const ROW_PITCH_RAMP = 14;

// Below this camera zoom (spectators fitting the whole bowl) a single body is
// barely a pixel and its bob is sub-pixel — so we swap the live mob for ONE
// baked still image (built once, drawn as a quad). This is the whole-crowd-
// visible worst case, and the swap collapses ~thousands of sprites to one quad.
const LOD_ZOOM = 0.42;
// The still is baked at half world-resolution: at spectator zoom it upscales to
// ~a fifth of a pixel per body, so half-res is indistinguishable and a quarter
// the texture memory (~4MB vs ~16MB for the full-res ring).
const BAKE_SCALE = 0.5;

// Base seat spacing ALONG a row at the front (world px). Wider spacing = fewer
// bodies, which is also the main `rec`-time lever (fewer transforms per
// frame). Spacing opens up toward the back with the scale ramp.
// (24 → 27 in the 2026-07-23 perf thin: ~12% fewer seats everywhere.)
const SEAT_SP = 27;
// Clustered gaps so the stands read as a REAL crowd — empty patches, aisles,
// thin spots — not a uniform fill. A coarse value-noise (patches ~GAP_CELL wide)
// carves seats out, blended with a little per-seat randomness for ragged edges.
// The cutoff RAMPS with depth: the front row fills solid (people clamber for the
// pit rail) and every row behind it gets progressively gappier — front-full at
// the barrier, up to GAP_CUTOFF carved at the very back row.
// (0.72 → 0.85 cutoff + front band 80 → 70 in the perf thin — the cuts land
// in the back rows where the mob was densest and least individually read;
// all told the ring holds ~25% fewer bodies than v1.)
const GAP_CELL = 95;
const GAP_CUTOFF = 0.85;
// World-px past the sand edge kept 100% full — the front rows, before gaps
// start opening up and ramping toward the sparse back.
const FRONT_FULL = 70;

// Per-body FROZEN pose scatter (world px, folded into the seat y at build).
// v2: the live idle bob (a ±1px sinusoid per body) was cut — at these body
// sizes it was imperceptible, but carrying it meant re-deriving EVERY visible
// body's transforms every frame, which was most of the crowd's `rec` cost.
// The frozen scatter keeps rows ragged so the stillness doesn't read uniform.
const POSE_JITTER = 1.6;
// The wave is a PHYSICAL bump lapping the bowl — a TIGHT crest of bodies rising
// then sitting. It is lift ONLY: an earlier version also brightened the crest,
// which read as an ugly wide white streak. Narrow WIDTH keeps it a localised
// bump you can watch travel; SPEED sets how fast it laps; LIFT is how far bodies
// stand up (scaled per body by the perspective ramp — big back rows rise more).
const WAVE_SPEED = 0.00018; // rad/ms the crest sweeps around the bowl
const WAVE_WIDTH = 0.22; // rad — a tight crest, not a broad band
const WAVE_LIFT = 20; // world-px a front-row body at the crest rises

// The atlas cell (px). Cells left→right: three torso BUILDS, one head, then
// the hair styles. Every part is positioned inside its cell relative to the
// same torso-centre anchor. The torso is stamped with the body's RSXform; the
// head (and the hair riding on it) gets its OWN RSXform at the seat's
// headScale — head size varies far less than body size, so a heavyset giant
// must NOT get a giant head — placed so the chin still meets this body's
// torso top. RSXform can only uniform-scale, so body-shape diversity comes
// from PICKING a different src cell per body, not stretching. Baked
// supersampled, drawn downscaled.
const CELL = 40;
const TORSO_CY = 0.625; // torso-centre y within the cell = the placement anchor
const HEAD_CY = 0.26; // head-centre y within its cell (higher → sits above)
const HEAD_R = CELL * 0.17;
// [torso width as a fraction of the cell, height/width aspect] per build —
// similar heights, very different silhouettes: slim, average, heavyset.
const BUILDS: Array<[number, number]> = [
  [0.48, 1.35],
  [0.6, 1.12],
  [0.74, 0.92],
];
// World body height ≈ size × BODY_SCALE × (build height fraction, ~0.67).
const BODY_SCALE = 2.46;
const cellSrc = (i: number) => Skia.XYWHRect(CELL * i, 0, CELL, CELL);
const SRC_TORSOS = BUILDS.map((_, i) => cellSrc(i));
const SRC_HEAD = cellSrc(3);
// Hair style cells: short crop, bushy mop, long over the shoulders, hood.
const SRC_HAIR = [cellSrc(4), cellSrc(5), cellSrc(6), cellSrc(7)];
const ATLAS_CELLS = 8;

// Deterministic so the crowd layout is stable across hot-reloads and frames —
// a per-frame reseed would make the mob teleport every tick.
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Cheap 2D value-noise for clustered gaps: same coarse cell → same value, so
// neighbouring seats share a "patch" and empties clump instead of speckling.
const hashNoise = (ix: number, iy: number): number => {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Parse "#rrggbb" once and return its channels scaled by `f` (tier shading). */
const shade = (hex: string, f: number): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [
    Math.min(255, Math.round(((n >> 16) & 0xff) * f)),
    Math.min(255, Math.round(((n >> 8) & 0xff) * f)),
    Math.min(255, Math.round((n & 0xff) * f)),
  ];
};
const rgb = (c: [number, number, number]): SkColor => Skia.Color(`rgb(${c[0]}, ${c[1]}, ${c[2]})`);

// A muted arena-mob wardrobe: linen, ochre, terracotta, dun, dull red, olive.
const CLOTH = ["#c8b487", "#a9713f", "#8f4a32", "#6f5637", "#8a8276", "#6e2f2a", "#7d7a53", "#b8a06a", "#5c4632", "#9c9488"];
// Heads are all SKIN now — hair/hoods are their own atlas layer on top.
const SKIN = ["#c9a074", "#b07f52", "#8a5a38", "#d8b48a", "#e2bd92", "#7a4e30", "#6b442a"];
// Hair: blacks and browns dominate, with blond, auburn and grey outliers.
const HAIR = ["#171310", "#2a2118", "#3d2c1c", "#57402a", "#6b5334", "#8a7a4a", "#5e2b1e", "#8a8578", "#a8a396"];

interface Seat {
  x: number;
  /** Torso-baseline world y, frozen pose scatter included (the wave lift is
   * subtracted at draw time for crest bodies only). */
  y: number;
  /** RSXform uniform scale mapping the atlas cell to this body's world size. */
  scale: number;
  /** The head layer's own scale — a much tighter spread than the body's. */
  headScale: number;
  /** Perspective ramp factor for this seat's row — scales the wave lift. */
  lift: number;
  /** This body's build — which torso cell of the atlas to stamp. */
  torso: SkRect;
  cloth: SkColor;
  skin: SkColor;
  /** Hair style cell, or null for bald (the hair layer just skips them). */
  mane: SkRect | null;
  maneCol: SkColor | null;
  /** Angle around the bowl centre — drives which bodies the wave lifts. */
  angle: number;
  /** At-rest transforms, built ONCE — pushed by reference every frame. Only
   * bodies inside the wave crest allocate fresh lifted transforms; this cache
   * is the crowd v2 perf fix (per-frame Skia.RSXform construction for every
   * visible body — ~1000+ JSI host objects a frame — was the `rec` cost). */
  restDst: SkRSXform;
  restHeadDst: SkRSXform;
}

/** The torso + head RSXforms for a body at (x, y) — the head anchored so the
 * chin meets THIS body's torso top whatever their relative scales (RSXform
 * can only uniform-scale, so the neck offset rides the BODY scale). */
const bodyXforms = (
  scale: number,
  headScale: number,
  x: number,
  y: number,
): [SkRSXform, SkRSXform] => {
  const dst = Skia.RSXform(scale, 0, x - scale * (CELL / 2), y - scale * (CELL * TORSO_CY));
  const neckY = y - scale * CELL * (TORSO_CY - HEAD_CY);
  const head = Skia.RSXform(
    headScale,
    0,
    x - headScale * (CELL / 2),
    neckY - headScale * (CELL * HEAD_CY),
  );
  return [dst, head];
};

// Stone palette, parsed once.
const C_STEP_SHADOW = Skia.Color("rgba(0, 0, 0, 0.3)");
const C_STEP_NOSING = Skia.Color("rgba(255, 255, 255, 0.05)");
const C_ROOF = Skia.Color("rgba(0, 0, 0, 0.5)");
const C_ROOF_SOFT = Skia.Color("rgba(0, 0, 0, 0.18)");
// The wall reads as a TALL vertical face: shaded courses climbing from a near-
// black base down by the pit floor up to a lit top course — a fake vertical
// gradient that stays corner-correct because every course is a concentric
// frame. The lit parapet cap (the rail the front row leans over) sits on top.
const C_WALL_COURSES = ["#151009", "#1d150d", "#251b11", "#2d2115", "#372a19"];
const C_BARRIER_CAP = Skia.Color("#5d4c38");
const C_CAP_LIT = Skia.Color("#746043");
const C_CAP_SEAM = Skia.Color("rgba(0, 0, 0, 0.45)");
const C_WHITE = Skia.Color("#ffffff");
// The wall's shadow falls onto the sand as a smooth multi-band fade (the old
// two hard-edged strips read as a bad outline around the arena).
const PIT_SHADOW_BANDS: Array<[number, number, number]> = [
  [0, 4, 0.3],
  [4, 9, 0.22],
  [9, 15, 0.14],
  [15, 22, 0.07],
];

/** One prebuilt rect of the static bowl (slab, riser, wall course, shadow…). */
interface Band {
  rect: SkRect;
  color: SkColor;
}

/** A built crowd, bound to one world size. Cheap to draw; the heavy state (the
 *  mob) lives in `seats`, generated once. */
export interface Crowd {
  /**
   * Draw the whole crowd for this frame, under the camera transform. LOD is
   * picked from `zoom`:
   *   • down in the pit (follow cam) → the live animated mob as two drawAtlas
   *     calls, culled to the visible strip (~hundreds of bodies);
   *   • zoomed out to spectate → ONE baked still (per-body motion is sub-pixel
   *     there, so the swap is invisible and collapses the mob to one quad).
   * The crowd does NOT react to kills — the roar SFX carries that; a bodily
   * lurch on every death read badly.
   */
  draw(
    canvas: SkCanvas,
    left: number,
    top: number,
    right: number,
    bottom: number,
    nowMs: number,
    zoom: number,
  ): void;
}

export const buildCrowd = (worldW: number, worldH: number): Crowd => {
  const bcx = worldW / 2;
  const bcy = worldH / 2;
  const rng = mulberry32(0x51a9d);
  const seatBand = DEPTH - WALL;

  // The terrace rows: centre-depths past the sand edge, with the gap between
  // rows widening as the stands climb (higher = nearer the camera = bigger).
  const rowDepths: number[] = [];
  for (let d = WALL + 12; d <= DEPTH - 8; ) {
    rowDepths.push(d);
    const t = (d - WALL) / seatBand;
    d += ROW_PITCH + ROW_PITCH_RAMP * t;
  }

  // ---- The mob: one seated row per terrace, walked along the concentric
  // rectangle ring at that row's depth (corners turn sharply, matching the
  // rectangular slabs). Discrete rows are what make the stands read as SEATING
  // rather than a mob standing on a flat plain.
  const seats: Seat[] = [];
  for (const d of rowDepths) {
    const tier = Math.min(1, (d - WALL) / seatBand); // 0 front → 1 back
    const f = SCALE_FRONT + (SCALE_BACK - SCALE_FRONT) * tier;
    const dim = 0.5 + 0.5 * tier; // front rows sit in the pit's shadow
    const sp = SEAT_SP * (0.88 + 0.4 * tier); // spacing opens with body size
    // The ring at this depth: 4 edges of the sand rect inflated by d. Ends are
    // inset by ~¾ spacing so the two edges meeting at a corner don't stack
    // seats on the same spot.
    const edges: Array<[number, number, number, number, number]> = [
      [-d, -d, 1, 0, worldW + d * 2], // top
      [-d, worldH + d, 1, 0, worldW + d * 2], // bottom
      [-d, -d, 0, 1, worldH + d * 2], // left
      [worldW + d, -d, 0, 1, worldH + d * 2], // right
    ];
    for (const [sx, sy, dx, dy, len] of edges) {
      const n = Math.floor((len - sp * 1.5) / sp) + 1;
      for (let i = 0; i < n; i++) {
        const along = sp * 0.75 + i * sp + (rng() - 0.5) * sp * 0.5;
        const cross = (rng() - 0.5) * 6; // small: rows must stay crisp
        const x = sx + dx * along + dy * cross;
        const y = sy + dy * along + dx * cross;
        // Clustered gaps, but ONLY past the front-full band: the cutoff ramps
        // 0 → GAP_CUTOFF with depth, so front rows pack solid (people clamber
        // for the pit rail) and the back thins out.
        const past = d - FRONT_FULL;
        if (past > 0) {
          const cutoff = GAP_CUTOFF * (past / (DEPTH - FRONT_FULL));
          if (hashNoise(Math.floor(x / GAP_CELL), Math.floor(y / GAP_CELL)) * 0.7 + rng() * 0.3 < cutoff) continue;
        }
        // A diverse mob: a wide spread of statures (× the perspective ramp),
        // a random build (40% slim / 40% average / 20% heavyset), and a hair
        // roll — 15% bald, then crop / bushy / long / hood. Hoods tint from
        // the CLOTH wardrobe (they're clothing); hair from the HAIR palette.
        const size = (11.5 + rng() * 7.5) * f;
        // Heads vary far less than bodies (only the perspective ramp and a
        // little jitter) — tying them to stature made the big folk bobbleheads.
        const headSize = (13.8 + rng() * 2.6) * f;
        const buildRoll = rng();
        const build = buildRoll < 0.4 ? 0 : buildRoll < 0.8 ? 1 : 2;
        const hairRoll = rng();
        const mane = hairRoll < 0.15 ? null : hairRoll < 0.5 ? SRC_HAIR[0]! : hairRoll < 0.75 ? SRC_HAIR[1]! : hairRoll < 0.9 ? SRC_HAIR[2]! : SRC_HAIR[3]!;
        const manePick = mane === SRC_HAIR[3] ? CLOTH : HAIR;
        const cloth = shade(CLOTH[(rng() * CLOTH.length) | 0]!, dim * (0.85 + rng() * 0.15));
        const skin = shade(SKIN[(rng() * SKIN.length) | 0]!, dim);
        const maneCol = shade(manePick[(rng() * manePick.length) | 0]!, dim);
        // The frozen pose: what used to be this body's live bob, baked in.
        const jy = y - rng() * POSE_JITTER * f;
        const scale = (size * BODY_SCALE) / CELL;
        const headScale = (headSize * BODY_SCALE) / CELL;
        const [restDst, restHeadDst] = bodyXforms(scale, headScale, x, jy);
        seats.push({
          x,
          y: jy,
          scale,
          headScale,
          lift: f,
          torso: SRC_TORSOS[build]!,
          cloth: rgb(cloth),
          skin: rgb(skin),
          mane,
          maneCol: mane ? rgb(maneCol) : null,
          angle: Math.atan2(jy - bcy, x - bcx),
          restDst,
          restHeadDst,
        });
      }
    }
  }
  // Painter's order: lower-on-screen bodies (larger y) draw last, so a bobbing
  // body correctly overlaps the row behind-and-above it — the same feet-y rule
  // the game uses for players and props. drawAtlas draws in array order, so the
  // per-frame arrays inherit this by iterating seats in place.
  seats.sort((a, b) => a.y - b.y);

  const oL = -DEPTH;
  const oT = -DEPTH;
  const ringW = worldW + DEPTH * 2;
  const ringH = worldH + DEPTH * 2;
  const paint = Skia.Paint();
  const atlasPaint = Skia.Paint();
  atlasPaint.setAntiAlias(true);

  // ---- The static bowl, prebuilt as flat band lists (rect + colour) and
  // culled to the viewport at draw time. Every ring is FOUR rects forming a
  // concentric frame, so shading always follows distance-to-sand and the
  // corners stay seamless (per-side gradients would seam at the corner joins).

  /** The 4 rects of the frame between distances d1 < d2 OUTSIDE the sand. */
  const frame = (d1: number, d2: number): SkRect[] => [
    Skia.XYWHRect(-d2, -d2, worldW + d2 * 2, d2 - d1),
    Skia.XYWHRect(-d2, worldH + d1, worldW + d2 * 2, d2 - d1),
    Skia.XYWHRect(-d2, -d1, d2 - d1, worldH + d1 * 2),
    Skia.XYWHRect(worldW + d1, -d1, d2 - d1, worldH + d1 * 2),
  ];
  /** The 4 rects of the frame between insets i1 < i2 INSIDE the sand edge. */
  const insetFrame = (i1: number, i2: number): SkRect[] => [
    Skia.XYWHRect(i1, i1, worldW - i1 * 2, i2 - i1),
    Skia.XYWHRect(i1, worldH - i2, worldW - i1 * 2, i2 - i1),
    Skia.XYWHRect(i1, i2, i2 - i1, worldH - i2 * 2),
    Skia.XYWHRect(worldW - i2, i2, i2 - i1, worldH - i2 * 2),
  ];
  const push = (arr: Band[], rects: SkRect[], color: SkColor): void => {
    for (const rect of rects) arr.push({ rect, color });
  };

  // Behind the mob: terrace slabs + risers, roof shadow, the wall face.
  const bowlBack: Band[] = [];
  {
    // Slab boundaries: midway between row centres; slab i is the tread row i
    // sits on. Slabs lighten as they climb (the front sits in the pit's shadow,
    // matching the body dim ramp), and their widening spread IS the height cue.
    const bounds = [WALL];
    for (let i = 1; i < rowDepths.length; i++) bounds.push((rowDepths[i - 1]! + rowDepths[i]!) / 2);
    bounds.push(DEPTH);
    for (let i = 0; i < rowDepths.length; i++) {
      const t = Math.min(1, (rowDepths[i]! - WALL) / seatBand);
      push(bowlBack, frame(bounds[i]!, bounds[i + 1]!), rgb(shade("#332a20", 0.78 + 0.6 * t)));
    }
    // Risers: a dark drop-shadow line at each slab boundary plus a thin lit
    // nosing on its high side — the step edge the row above stands on.
    for (let i = 1; i < rowDepths.length; i++) {
      const b = bounds[i]!;
      push(bowlBack, frame(b - 1.5, b + 1.5), C_STEP_SHADOW);
      push(bowlBack, frame(b + 1.5, b + 2.75), C_STEP_NOSING);
    }
    // Outer rim sinks into roof/canopy shadow (the stands climb out of frame),
    // with a soft leading band so it fades in rather than starting on a line.
    push(bowlBack, frame(DEPTH - ROOF - 20, DEPTH - ROOF), C_ROOF_SOFT);
    push(bowlBack, frame(DEPTH - ROOF, DEPTH), C_ROOF);
    // The tall pit wall: shaded courses from a near-black base at the sand up
    // to the lit top course under the parapet.
    const course = WALL / C_WALL_COURSES.length;
    for (let i = 0; i < C_WALL_COURSES.length; i++) {
      push(bowlBack, frame(course * i, course * (i + 1)), Skia.Color(C_WALL_COURSES[i]!));
    }
  }

  // Over the mob: the parapet rail (so front-row feet tuck behind it) and the
  // wall's shadow fading onto the sand. EXCEPT the bottom edge's rail: sprites
  // are upright, so a bottom-edge body's head reaches UP-screen into the rail
  // band — the front row leans over the rail into the pit, and their heads
  // must render on top. That side's rail joins bowlBack (behind the mob); on
  // the other three sides the mob only ever meets the rail feet/edge-first,
  // so tucking behind stays correct. frame() returns [top, bottom, left,
  // right], so index 1 is the bottom band.
  const bowlFront: Band[] = [];
  {
    const rail: Array<[SkRect[], SkColor]> = [
      [frame(WALL - 8, WALL - 6.5), C_CAP_SEAM], // under-rail seam
      [frame(WALL - 6.5, WALL), C_BARRIER_CAP], // the rail itself
      [frame(WALL - 6.5, WALL - 5), C_CAP_LIT], // lit front edge
    ];
    for (const [rects, color] of rail) {
      push(bowlBack, [rects[1]!], color);
      push(bowlFront, [rects[0]!, rects[2]!, rects[3]!], color);
    }
    for (const [i1, i2, a] of PIT_SHADOW_BANDS) {
      push(bowlFront, insetFrame(i1, i2), Skia.Color(`rgba(8, 6, 4, ${a})`));
    }
  }

  const drawBands = (
    canvas: SkCanvas,
    bands: Band[],
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): void => {
    for (const b of bands) {
      const r = b.rect;
      if (r.x >= right || r.x + r.width <= left || r.y >= bottom || r.y + r.height <= top) continue;
      paint.setColor(b.color);
      canvas.drawRect(r, paint);
    }
  };

  // The body-part atlas — all-white shapes (tinted per body at draw time),
  // baked ONCE (null until a surface is available; the mob just skips a frame
  // or two). Hair caps are carved as crescents/rings with BlendMode.Clear so
  // the skin head shows through under a crop or around a mop of hair.
  let atlas: SkImage | null = null;
  let atlasTried = false;
  const ensureAtlas = (): SkImage | null => {
    if (atlas || atlasTried) return atlas;
    atlasTried = true;
    const surface = Skia.Surface.Make(CELL * ATLAS_CELLS, CELL);
    if (!surface) {
      atlasTried = false; // retry next frame
      return null;
    }
    const c = surface.getCanvas();
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setColor(C_WHITE);
    // Cells 0..2: the torso builds.
    for (let i = 0; i < BUILDS.length; i++) {
      const [wf, aspect] = BUILDS[i]!;
      const ow = CELL * wf;
      const oh = ow * aspect;
      c.drawOval(Skia.XYWHRect(CELL * i + CELL / 2 - ow / 2, CELL * TORSO_CY - oh / 2, ow, oh), p);
    }
    // Cell 3: the head.
    c.drawCircle(CELL * 3.5, CELL * HEAD_CY, HEAD_R, p);
    // Hair cells, each drawn around a phantom head at the same in-cell
    // position. `punch` (BlendMode.Clear) erases the lower face back out of a
    // cap so it reads as hair sitting ON a skin head, not a coloured ball.
    const cx = (cell: number): number => CELL * (cell + 0.5);
    const punch = (x: number, cy: number, r: number): void => {
      p.setBlendMode(BlendMode.Clear);
      c.drawCircle(x, CELL * cy, r, p);
      p.setBlendMode(BlendMode.SrcOver);
    };
    // Cell 4: short crop — a thin crescent hugging the crown.
    c.drawCircle(cx(4), CELL * 0.245, CELL * 0.19, p);
    punch(cx(4), 0.33, CELL * 0.18);
    // Cell 5: bushy mop — a thick ring over the top and sides.
    c.drawCircle(cx(5), CELL * 0.24, CELL * 0.215, p);
    punch(cx(5), 0.345, CELL * 0.16);
    // Cell 6: long hair — spills past the head onto the shoulders.
    c.drawOval(Skia.XYWHRect(cx(6) - CELL * 0.26, CELL * 0.09, CELL * 0.52, CELL * 0.42), p);
    // Cell 7: hood — swallows the head entirely (no skin shows).
    c.drawCircle(cx(7), CELL * HEAD_CY, CELL * 0.205, p);
    atlas = surface.makeImageSnapshot();
    return atlas;
  };

  // The animated mob → three drawAtlas calls (torso / head / hair, the hair
  // layer sharing the head's transform). Crowd v2: nearly every visible body
  // pushes its PREBUILT at-rest transforms by reference — no math, no JSI
  // host-object construction (building fresh Skia.RSXforms for the whole
  // strip, ~1000+ a frame, was the crowd's `rec` cost). Only bodies inside
  // the wave crest — a tight angular window, often empty in frame — allocate
  // fresh lifted transforms; the crest's physical rise is the one animation
  // kept, and the one that reads. Colours are the static per-body tints (no
  // per-frame recolour — the wave is motion, not brightness). Reached only
  // at pit zoom, so the visible strip is a few hundred bodies.
  const drawMob = (
    canvas: SkCanvas,
    left: number,
    top: number,
    right: number,
    bottom: number,
    nowMs: number,
  ): void => {
    const img = ensureAtlas();
    if (!img) return;
    const crest = ((nowMs * WAVE_SPEED) % (Math.PI * 2)) - Math.PI;
    const margin = 12 + WAVE_LIFT * SCALE_BACK;
    // Past this angular distance the Gaussian rise is < 0.2% of the lift —
    // sub-pixel — so the body is honestly at rest and the cache serves.
    const CREST_NEAR = WAVE_WIDTH * 2.5;
    const dsts: SkRSXform[] = [];
    const headDsts: SkRSXform[] = [];
    const srcsTorso: SkRect[] = [];
    const srcsHead: SkRect[] = [];
    const clothCols: SkColor[] = [];
    const skinCols: SkColor[] = [];
    // The hair layer is a sparser pass — bald bodies simply have no entry.
    const hairDsts: SkRSXform[] = [];
    const srcsHair: SkRect[] = [];
    const hairCols: SkColor[] = [];
    for (const s of seats) {
      if (s.x < left - margin || s.x > right + margin || s.y < top - margin || s.y > bottom + margin) continue;
      let delta = s.angle - crest;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      let headDst: SkRSXform;
      if (Math.abs(delta) < CREST_NEAR) {
        // A tight crest bump (Gaussian) travelling by angle around the bowl.
        // Lift rides the perspective ramp: big back-row bodies rise further.
        const rise = Math.exp(-((delta / WAVE_WIDTH) ** 2));
        const yAnim = s.y - rise * WAVE_LIFT * s.lift;
        const [dst, head] = bodyXforms(s.scale, s.headScale, s.x, yAnim);
        dsts.push(dst);
        headDst = head;
      } else {
        // At rest: the prebuilt transforms, by reference — no math, no
        // allocation. This branch is ~all of the visible strip, ~all frames.
        dsts.push(s.restDst);
        headDst = s.restHeadDst;
      }
      headDsts.push(headDst);
      srcsTorso.push(s.torso);
      srcsHead.push(SRC_HEAD);
      clothCols.push(s.cloth);
      skinCols.push(s.skin);
      if (s.mane && s.maneCol) {
        hairDsts.push(headDst);
        srcsHair.push(s.mane);
        hairCols.push(s.maneCol);
      }
    }
    if (dsts.length === 0) return;
    // Modulate = multiply: the white sprite × the per-body colour = a tinted
    // body with the sprite's soft anti-aliased edge preserved.
    canvas.drawAtlas(img, srcsTorso, dsts, atlasPaint, BlendMode.Modulate, clothCols);
    canvas.drawAtlas(img, srcsHead, headDsts, atlasPaint, BlendMode.Modulate, skinCols);
    if (hairDsts.length > 0) {
      canvas.drawAtlas(img, srcsHair, hairDsts, atlasPaint, BlendMode.Modulate, hairCols);
    }
  };

  // The zoomed-out still: seating + the whole mob at rest, rasterized ONCE into
  // a half-res image (built lazily; null until its surface — and the atlas — are
  // ready, so the first spectator frame or two fall back to the live path).
  // Drawn as a single quad thereafter — the whole-bowl case at one textured quad.
  let still: SkImage | null = null;
  let stillTried = false;
  const bakeStill = (): SkImage | null => {
    if (still || stillTried) return still;
    if (!ensureAtlas()) return null; // need the body atlas before we can bake
    stillTried = true;
    const surface = Skia.Surface.Make(Math.ceil(ringW * BAKE_SCALE), Math.ceil(ringH * BAKE_SCALE));
    if (!surface) {
      stillTried = false;
      return null;
    }
    const c = surface.getCanvas();
    c.scale(BAKE_SCALE, BAKE_SCALE);
    c.translate(-oL, -oT); // ring-space → world-space so the draw fns line up
    drawBands(c, bowlBack, oL, oT, oL + ringW, oT + ringH);
    drawMob(c, oL, oT, oL + ringW, oT + ringH, 0); // full ring, frozen pose
    drawBands(c, bowlFront, oL, oT, oL + ringW, oT + ringH);
    still = surface.makeImageSnapshot();
    return still;
  };
  const STILL_DST = Skia.XYWHRect(oL, oT, ringW, ringH);

  return {
    draw(canvas, left, top, right, bottom, nowMs, zoom): void {
      // Zoomed out to spectate: one baked quad, motion is sub-pixel anyway.
      if (zoom < LOD_ZOOM) {
        const img = bakeStill();
        if (img) {
          const src = Skia.XYWHRect(0, 0, img.width(), img.height());
          canvas.drawImageRectOptions(img, src, STILL_DST, FilterMode.Linear, MipmapMode.None, paint);
          return;
        }
        // No surface yet — fall through to the live path this frame.
      }
      drawBands(canvas, bowlBack, left, top, right, bottom);
      drawMob(canvas, left, top, right, bottom, nowMs);
      drawBands(canvas, bowlFront, left, top, right, bottom);
    },
  };
};
