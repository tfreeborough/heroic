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
 * PERF — the mob is drawn with drawAtlas, NOT one draw per body. Recording ~700
 * visible bodies as individual drawOval/drawCircle calls cost ~25ms of picture-
 * record time (each call is a JSI hop that records geometry). Instead a tiny
 * 2-cell atlas (a white torso oval + a white head circle) is baked ONCE, and
 * each frame the whole visible strip is emitted as just TWO drawAtlas calls
 * (torso layer + head layer): one SkRSXform per body carries its position and
 * wave-lift, one SkColor per body carries its static tint. Record cost collapses
 * from ~1500 draws to 2. The wave is a PHYSICAL travelling bump (bodies rise as
 * a tight crest passes), never a brightness sweep — a wide bright band read as
 * an ugly white streak. Colours are parsed to SkColor ONCE at build; the seating
 * is a handful of rects; the crowd is thinned with clustered gaps (fewer bodies
 * = lower record cost); spectators fitting the whole bowl fall to a single baked
 * still (per-body motion is sub-pixel there).
 */
import {
  BlendMode,
  FilterMode,
  MipmapMode,
  Skia,
  type SkCanvas,
  type SkColor,
  type SkImage,
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
// Implied terrace steps: darker shadow lines banded back through the seating.
const TIERS = 5;

// Below this camera zoom (spectators fitting the whole bowl) a single body is
// barely a pixel and its bob is sub-pixel — so we swap the live mob for ONE
// baked still image (built once, drawn as a quad). This is the whole-crowd-
// visible worst case, and the swap collapses ~thousands of sprites to one quad.
const LOD_ZOOM = 0.42;
// The still is baked at half world-resolution: at spectator zoom it upscales to
// ~a fifth of a pixel per body, so half-res is indistinguishable and a quarter
// the texture memory (~4MB vs ~16MB for the full-res ring).
const BAKE_SCALE = 0.5;

// Grid the mob is seeded on (world px). Wider spacing = fewer, chunkier bodies,
// which is also the main `rec`-time lever (fewer RSXform builds per frame).
const SEAT_SP = 26;
const SEAT_JITTER = 6;
// Clustered gaps so the stands read as a REAL crowd — empty patches, aisles,
// thin spots — not a uniform fill. A coarse value-noise (patches ~GAP_CELL wide)
// carves seats out, blended with a little per-seat randomness for ragged edges.
// The cutoff RAMPS with depth: the front row fills solid (people clamber for the
// pit rail) and every row behind it gets progressively gappier — front-full at
// the barrier, up to GAP_CUTOFF carved at the very back row.
const GAP_CELL = 95;
const GAP_CUTOFF = 0.7;
// World-px past the sand edge kept 100% full — the front couple of rows, before
// gaps start opening up and ramping toward the sparse back.
const FRONT_FULL = 80;

// Idle bob + the travelling Mexican wave.
const BOB_AMP = 1.0;
// The wave is a PHYSICAL bump lapping the bowl — a TIGHT crest of bodies rising
// then sitting. It is lift ONLY: an earlier version also brightened the crest,
// which read as an ugly wide white streak. Narrow WIDTH keeps it a localised
// bump you can watch travel; SPEED sets how fast it laps; LIFT is how far bodies
// stand up.
const WAVE_SPEED = 0.00018; // rad/ms the crest sweeps around the bowl
const WAVE_WIDTH = 0.22; // rad — a tight crest, not a broad band
const WAVE_LIFT = 20; // world-px a body at the crest rises

// The atlas cell (px). Two cells side by side: [0] a torso oval, [1] a head
// circle, each positioned inside its cell so ONE RSXform (anchored on the torso
// centre) places BOTH layers — the head cell's higher placement becomes the
// head's offset above the body for free. Baked supersampled, drawn downscaled.
const CELL = 40;
const OVAL_FRAC = 0.82; // torso oval width as a fraction of the cell
const OVAL_ASPECT = 1.6 / 1.9; // height/width — matches the old drawOval look
const TORSO_CY = 0.625; // torso-centre y within the cell = the placement anchor
const HEAD_CY = 0.286; // head-centre y within its cell (higher → sits above)
const HEAD_R = CELL * 0.22;
const SRC_TORSO = Skia.XYWHRect(0, 0, CELL, CELL);
const SRC_HEAD = Skia.XYWHRect(CELL, 0, CELL, CELL);

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

/** Parse "#rrggbb" once and return its channels dimmed by `f` (tier shading). */
const shade = (hex: string, f: number): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [
    Math.round(((n >> 16) & 0xff) * f),
    Math.round(((n >> 8) & 0xff) * f),
    Math.round((n & 0xff) * f),
  ];
};
const rgb = (c: [number, number, number]): SkColor => Skia.Color(`rgb(${c[0]}, ${c[1]}, ${c[2]})`);

// A muted arena-mob wardrobe: linen, ochre, terracotta, dun, dull red, olive.
const CLOTH = ["#c8b487", "#a9713f", "#8f4a32", "#6f5637", "#8a8276", "#6e2f2a", "#7d7a53", "#b8a06a", "#5c4632", "#9c9488"];
// Heads: skin tones plus dark hair/hoods so the rows don't read uniform.
const HEADS = ["#c9a074", "#b07f52", "#8a5a38", "#d8b48a", "#3a2c22", "#4a3320", "#2f2620"];

interface Seat {
  x: number;
  /** Torso-baseline world y (bob/wave lift are subtracted at draw time). */
  y: number;
  /** RSXform uniform scale mapping the atlas cell to this body's world size. */
  scale: number;
  cloth: SkColor;
  hair: SkColor;
  phase: number;
  bobSpeed: number;
  /** Angle around the bowl centre — drives which bodies the wave lifts. */
  angle: number;
}

// Stone palette, parsed once. Barrier cap reuses the floor-wall highlight so the
// rim reads as the same material as any authored wall.
const C_STANDS = Skia.Color("#332a20");
const C_ROOF = Skia.Color("rgba(0, 0, 0, 0.5)");
const C_STEP = Skia.Color("rgba(0, 0, 0, 0.22)");
// The wall reads as a TALL vertical face: a dark shadowed base down by the pit
// floor, a lighter upper course, and a lit parapet cap at the top (the rail the
// front row leans over).
const C_WALL_LO = Skia.Color("#191510");
const C_WALL_HI = Skia.Color("#302619");
const C_BARRIER_CAP = Skia.Color("#5d4c38");
const C_PIT_SHADOW = Skia.Color("rgba(8, 6, 4, 0.38)");
const C_WHITE = Skia.Color("#ffffff");

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
  const seats: Seat[] = [];

  // Seed a jittered grid over the whole outer rect, then keep only the cells
  // that land in the stands ring (outside the sand, past the barrier). Distance
  // to the nearest sand edge = how far back the seat sits = its tier, which
  // shades it (front rows in the barrier's shadow, back rows catch the light).
  const seatBand = DEPTH - WALL;
  for (let gy = -DEPTH; gy <= worldH + DEPTH; gy += SEAT_SP) {
    for (let gx = -DEPTH; gx <= worldW + DEPTH; gx += SEAT_SP) {
      const x = gx + (rng() - 0.5) * 2 * SEAT_JITTER;
      const y = gy + (rng() - 0.5) * 2 * SEAT_JITTER;
      const dx = Math.max(0 - x, x - worldW, 0);
      const dy = Math.max(0 - y, y - worldH, 0);
      const back = Math.hypot(dx, dy); // 0 on the sand, grows into the stands
      if (back <= WALL * 0.9 || back > DEPTH) continue; // clear the barrier; cap the bowl
      // Clustered gaps, but ONLY past the front-full band: the cutoff ramps 0 →
      // GAP_CUTOFF with depth, so front rows pack solid and the back thins out.
      const past = back - FRONT_FULL;
      if (past > 0) {
        const cutoff = GAP_CUTOFF * (past / (DEPTH - FRONT_FULL));
        if (hashNoise(Math.floor(x / GAP_CELL), Math.floor(y / GAP_CELL)) * 0.7 + rng() * 0.3 < cutoff) continue;
      }
      const tier = Math.min(1, (back - WALL) / seatBand); // 0 front → 1 back
      const dim = 0.5 + 0.5 * tier; // front rows sit in the pit's shadow
      const size = 13 + rng() * 5; // near the player-dot size (a touch smaller)
      const cloth = shade(CLOTH[(rng() * CLOTH.length) | 0]!, dim * (0.85 + rng() * 0.15));
      const hair = shade(HEADS[(rng() * HEADS.length) | 0]!, dim);
      seats.push({
        x,
        y,
        scale: (size * 1.9) / (CELL * OVAL_FRAC),
        cloth: rgb(cloth),
        hair: rgb(hair),
        phase: rng() * Math.PI * 2,
        bobSpeed: 0.003 + rng() * 0.0035,
        angle: Math.atan2(y - bcy, x - bcx),
      });
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

  // The seating, barrier and roof-shadow — the static bowl BEHIND the mob.
  const standsBack = (canvas: SkCanvas): void => {
    // 1) Terrace stone filling the whole ring (four side-bands; top/bottom
    //    span the corners, left/right fill the vertical gap between them).
    paint.setColor(C_STANDS);
    canvas.drawRect(Skia.XYWHRect(oL, oT, ringW, DEPTH), paint);
    canvas.drawRect(Skia.XYWHRect(oL, worldH, ringW, DEPTH), paint);
    canvas.drawRect(Skia.XYWHRect(oL, 0, DEPTH, worldH), paint);
    canvas.drawRect(Skia.XYWHRect(worldW, 0, DEPTH, worldH), paint);

    // 2) Step shadows banded back through the seating — implied terraces.
    paint.setColor(C_STEP);
    for (let i = 1; i <= TIERS; i++) {
      const d = WALL + (seatBand * i) / (TIERS + 1);
      canvas.drawRect(Skia.XYWHRect(-d, -d, worldW + d * 2, 2), paint);
      canvas.drawRect(Skia.XYWHRect(-d, worldH + d - 2, worldW + d * 2, 2), paint);
      canvas.drawRect(Skia.XYWHRect(-d, 0, 2, worldH), paint);
      canvas.drawRect(Skia.XYWHRect(worldW + d - 2, 0, 2, worldH), paint);
    }

    // 3) Outer rim sinks into shadow (the stands climb up out of frame).
    paint.setColor(C_ROOF);
    canvas.drawRect(Skia.XYWHRect(oL, oT, ringW, ROOF), paint);
    canvas.drawRect(Skia.XYWHRect(oL, oT + ringH - ROOF, ringW, ROOF), paint);
    canvas.drawRect(Skia.XYWHRect(oL, 0, ROOF, worldH), paint);
    canvas.drawRect(Skia.XYWHRect(oL + ringW - ROOF, 0, ROOF, worldH), paint);

    // 4) The tall pit wall, a vertical face under the mob. Two courses sell the
    //    height: the lighter upper course fills the whole band, then the darker
    //    base is painted back over the inner (near-sand) portion — so each side
    //    reads light at the top (crowd) and shadowed at the bottom (pit floor).
    //    The lit parapet cap + pit shadow land in standsFront, over the mob.
    const wLo = WALL * 0.55; // shadowed base depth (near the sand)
    paint.setColor(C_WALL_HI);
    canvas.drawRect(Skia.XYWHRect(-WALL, -WALL, worldW + WALL * 2, WALL), paint);
    canvas.drawRect(Skia.XYWHRect(-WALL, worldH, worldW + WALL * 2, WALL), paint);
    canvas.drawRect(Skia.XYWHRect(-WALL, 0, WALL, worldH), paint);
    canvas.drawRect(Skia.XYWHRect(worldW, 0, WALL, worldH), paint);
    paint.setColor(C_WALL_LO);
    canvas.drawRect(Skia.XYWHRect(-WALL, -wLo, worldW + WALL * 2, wLo), paint);
    canvas.drawRect(Skia.XYWHRect(-WALL, worldH, worldW + WALL * 2, wLo), paint);
    canvas.drawRect(Skia.XYWHRect(-wLo, 0, wLo, worldH), paint);
    canvas.drawRect(Skia.XYWHRect(worldW, 0, wLo, worldH), paint);
  };

  // The lit pit rim + the shadow the barrier throws onto the sand — over the
  // mob so the front rail stays crisp against the floor.
  const standsFront = (canvas: SkCanvas): void => {
    // The lit parapet cap at the TOP of the wall (crowd side) — the rail the
    // front row leans over; over the mob so their feet tuck behind it.
    const CAP = 5;
    paint.setColor(C_BARRIER_CAP);
    canvas.drawRect(Skia.XYWHRect(-WALL, -WALL, worldW + WALL * 2, CAP), paint);
    canvas.drawRect(Skia.XYWHRect(-WALL, worldH + WALL - CAP, worldW + WALL * 2, CAP), paint);
    canvas.drawRect(Skia.XYWHRect(-WALL, 0, CAP, worldH), paint);
    canvas.drawRect(Skia.XYWHRect(worldW + WALL - CAP, 0, CAP, worldH), paint);
    paint.setColor(C_PIT_SHADOW);
    canvas.drawRect(Skia.XYWHRect(0, 0, worldW, 14), paint);
    canvas.drawRect(Skia.XYWHRect(0, worldH - 14, worldW, 14), paint);
    canvas.drawRect(Skia.XYWHRect(0, 0, 14, worldH), paint);
    canvas.drawRect(Skia.XYWHRect(worldW - 14, 0, 14, worldH), paint);
    canvas.drawRect(Skia.XYWHRect(0, 0, worldW, 6), paint);
    canvas.drawRect(Skia.XYWHRect(0, worldH - 6, worldW, 6), paint);
    canvas.drawRect(Skia.XYWHRect(0, 0, 6, worldH), paint);
    canvas.drawRect(Skia.XYWHRect(worldW - 6, 0, 6, worldH), paint);
  };

  // The 2-cell body atlas — a white torso oval + a white head circle, baked
  // ONCE (null until a surface is available; the mob just skips a frame or two).
  let atlas: SkImage | null = null;
  let atlasTried = false;
  const ensureAtlas = (): SkImage | null => {
    if (atlas || atlasTried) return atlas;
    atlasTried = true;
    const surface = Skia.Surface.Make(CELL * 2, CELL);
    if (!surface) {
      atlasTried = false; // retry next frame
      return null;
    }
    const c = surface.getCanvas();
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setColor(C_WHITE);
    const ow = CELL * OVAL_FRAC;
    const oh = ow * OVAL_ASPECT;
    c.drawOval(Skia.XYWHRect(CELL / 2 - ow / 2, CELL * TORSO_CY - oh / 2, ow, oh), p);
    c.drawCircle(CELL + CELL / 2, CELL * HEAD_CY, HEAD_R, p);
    atlas = surface.makeImageSnapshot();
    return atlas;
  };

  // The animated mob → two drawAtlas calls. One RSXform per visible body carries
  // its position + the wave-lift (a physical rise as the crest passes); both
  // layers (torso, head) share it — the head cell is baked higher, so the same
  // transform places the head above the body. Colours are the static per-body
  // tints (no per-frame recolour — the wave is motion, not brightness). Reached
  // only at pit zoom, so the visible strip is a few hundred bodies.
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
    const margin = 12 + BOB_AMP + WAVE_LIFT;
    const dsts: SkRSXform[] = [];
    const srcsTorso: (typeof SRC_TORSO)[] = [];
    const srcsHead: (typeof SRC_HEAD)[] = [];
    const clothCols: SkColor[] = [];
    const hairCols: SkColor[] = [];
    for (const s of seats) {
      if (s.x < left - margin || s.x > right + margin || s.y < top - margin || s.y > bottom + margin) continue;
      let delta = s.angle - crest;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      // A tight crest bump (Gaussian) travelling by angle around the bowl.
      const rise = Math.exp(-((delta / WAVE_WIDTH) ** 2));
      const bob = Math.sin(nowMs * s.bobSpeed + s.phase) * BOB_AMP;
      const yAnim = s.y - bob - rise * WAVE_LIFT;
      // RSXform anchored on the torso centre (CELL/2, CELL*TORSO_CY) → (x, yAnim).
      dsts.push(Skia.RSXform(s.scale, 0, s.x - s.scale * (CELL / 2), yAnim - s.scale * (CELL * TORSO_CY)));
      srcsTorso.push(SRC_TORSO);
      srcsHead.push(SRC_HEAD);
      clothCols.push(s.cloth);
      hairCols.push(s.hair);
    }
    if (dsts.length === 0) return;
    // Modulate = multiply: the white sprite × the per-body colour = a tinted
    // body with the sprite's soft anti-aliased edge preserved.
    canvas.drawAtlas(img, srcsTorso, dsts, atlasPaint, BlendMode.Modulate, clothCols);
    canvas.drawAtlas(img, srcsHead, dsts, atlasPaint, BlendMode.Modulate, hairCols);
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
    standsBack(c);
    drawMob(c, oL, oT, oL + ringW, oT + ringH, 0); // full ring, frozen pose
    standsFront(c);
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
      standsBack(canvas);
      drawMob(canvas, left, top, right, bottom, nowMs);
      standsFront(canvas);
    },
  };
};
