import {
  ZONE_DEPTH,
  ZONE_PALETTE,
  creatureLabel,
  extrudeRect,
  isCheckerDark,
  isKeyColor,
  keyColorDef,
  parseSpawnerConfig,
  SPAWNER_NEST_TILES,
  voidRimBands,
  wallLeanVector,
  type Aabb,
  type Zone,
} from "@heroic/core";
import type { Selection } from "../edit/types";

/** Camera: the world coordinate under the canvas centre + screen-px-per-world-px. */
export interface View {
  camX: number;
  camY: number;
  zoom: number;
}

/** Editor overlays shown over the map. */
export interface EditOverlay {
  /** Draw the per-cell tile grid. */
  grid?: boolean;
  /** Highlight the cell under the cursor (in tile coords), if any. */
  hover?: { col: number; row: number } | null;
  /** When false, the hover cell is tinted red (the current action would conflict). */
  hoverValid?: boolean;
  /** The selected breakable/object, outlined so it reads as picked. */
  selection?: Selection | null;
  /** A collision rect being dragged out (free-rect tool); `valid` red-tints it. */
  pending?: { box: Aabb; valid: boolean } | null;
  /** The selected breakable's box — draws corner resize handles on it. */
  resize?: Aabb | null;
}

// Mirror the game's breakable look (apps/enter-the-gauntlet renderCombat.ts): an
// occluding wall is translucent + cracked; barrels/crates are solid. The colours
// come from the shared ZONE_PALETTE, so they can't drift from the game.
const BREAKABLE_WALL_ALPHA = 0.6;

// Individual placed creatures get their own marker hue — a violet dot, distinct
// from the cyan player spawn, gold POI, and crimson spawner nest — plus a name
// label, so a hand-placed enemy reads at a glance and never blurs into a spawner.
const CREATURE_MARKER_FILL = "#b388ff";
const CREATURE_MARKER_EDGE = "rgba(20,12,40,0.85)";
const CREATURE_LABEL_FILL = "#e9ddff";

const breakableFill = (kind: string): string => {
  switch (kind) {
    case "wood-wall":
      return ZONE_PALETTE.breakableWood;
    case "barrel":
      return ZONE_PALETTE.breakableBarrel;
    default:
      return ZONE_PALETTE.breakableCrate;
  }
};

/** "#rrggbb" → "r,g,b" for building rgba() strings. */
const hexRgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};
const VOID_MIST_RGB = hexRgb(ZONE_PALETTE.voidMist);
const VOID_WALL_RGB = hexRgb(ZONE_PALETTE.voidWall);
const VOID_LIP_RGB = hexRgb(ZONE_PALETTE.voidLip);

/** Deterministic 32-bit hash → [0,1): stable per-position jitter, so the pit looks
 *  the same on every redraw (no `Math.random`, which would shimmer between frames). */
const hash01 = (x: number, y: number): number => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Realmsmith's *static* stand-in for the game's animated void-pit mist (the editor
 * canvas can't run the Skia shader and doesn't run an animation loop). For each void
 * region: a deep void base — covering any floor beneath, so void-over-floor reads as
 * a pit, not an invisible wall — then soft puffs of `voidMist` on a jittered grid,
 * all clipped to the void. Conveys "dark foggy chasm" without animation.
 */
const drawVoidPits = (
  ctx: CanvasRenderingContext2D,
  voids: readonly Aabb[],
  t: number,
  camX: number,
  camY: number,
): void => {
  if (voids.length === 0) return;
  ctx.save();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ctx.beginPath();
  for (const v of voids) {
    const x = v.x - v.w / 2;
    const y = v.y - v.h / 2;
    ctx.rect(x, y, v.w, v.h);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + v.w);
    maxY = Math.max(maxY, y + v.h);
  }
  ctx.clip();

  ctx.fillStyle = ZONE_PALETTE.void;
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

  // Drifting-cloud puffs: one soft radial blob per jittered grid cell. Clipped to the
  // void, so blobs straddling the edge simply get cut — no per-rect seams.
  const step = 2.4 * t;
  for (let gy = Math.floor(minY / step); gy <= Math.ceil(maxY / step); gy++) {
    for (let gx = Math.floor(minX / step); gx <= Math.ceil(maxX / step); gx++) {
      const cx = (gx + hash01(gx, gy) - 0.5) * step;
      const cy = (gy + hash01(gx + 99, gy - 17) - 0.5) * step;
      const r = step * (0.7 + 0.6 * hash01(gx + 5, gy + 7));
      const a = 0.1 + 0.12 * hash01(gx - 3, gy + 11);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${VOID_MIST_RGB},${a.toFixed(3)})`);
      g.addColorStop(1, `rgba(${VOID_MIST_RGB},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }

  // Pit depth (matches the game): each rim is a piece of cliff — a lit ground lip,
  // then a wall surface descending into the fog, fullest on the edges facing AWAY from
  // the camera. The "away" side is camera-relative, so panning glides the lit wall
  // round the pit. Still clipped to the void, so cliffs never spill onto the floor.
  for (const v of voids) {
    for (const b of voidRimBands(v, voids, camX, camY)) {
      if (b.intensity > 0.01) {
        const g = ctx.createLinearGradient(b.x0, b.y0, b.x1, b.y1);
        const solid = `rgba(${VOID_WALL_RGB},${(ZONE_DEPTH.voidWallAlpha * b.intensity).toFixed(3)})`;
        g.addColorStop(0, solid); // solid wall from the rim…
        g.addColorStop(ZONE_DEPTH.voidWallSolid, solid); // …down through voidWallSolid…
        g.addColorStop(1, `rgba(${VOID_WALL_RGB},0)`); // …then feather into the fog.
        ctx.fillStyle = g;
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
      ctx.fillStyle = `rgba(${VOID_LIP_RGB},${ZONE_DEPTH.lipAlpha})`;
      ctx.fillRect(b.lipX, b.lipY, b.lipW, b.lipH);
    }
  }

  ctx.restore();
};

/**
 * Draw a loaded zone exactly as the game depicts it — floor checker, static
 * collision, breakables — plus editor-only overlays (bounds, object markers) on
 * top. Everything below the overlays uses the same `@heroic/core` data + shared
 * palette the game does, so the layout and colours match by construction.
 *
 * `cssW/cssH` are the canvas's logical (CSS) size; the caller has already scaled
 * the context for devicePixelRatio, so we draw in CSS pixels.
 */
export const drawZone = (
  ctx: CanvasRenderingContext2D,
  zone: Zone,
  view: View,
  cssW: number,
  cssH: number,
  overlay: EditOverlay = {},
): void => {
  // Void backdrop (shows through the zone's void cells, as in-game).
  ctx.fillStyle = ZONE_PALETTE.void;
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.save();
  // world → screen: centre the canvas, scale by zoom, offset by the camera.
  ctx.translate(cssW / 2, cssH / 2);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-view.camX, -view.camY);

  const t = zone.tileSize;
  const ct = zone.chunkTiles;

  // Floor: the light base + dark checker the game bakes (placeholder tiles). Void
  // cells (id 0) are skipped, so an irregular/L-shaped zone reads as its shape.
  for (const chunk of zone.chunks) {
    for (let ly = 0; ly < ct; ly++) {
      for (let lx = 0; lx < ct; lx++) {
        if (chunk.floor[ly * ct + lx] === 0) continue;
        const gx = chunk.cx * ct + lx;
        const gy = chunk.cy * ct + ly;
        ctx.fillStyle = isCheckerDark(gx, gy) ? ZONE_PALETTE.tileDark : ZONE_PALETTE.tileLight;
        ctx.fillRect(gx * t, gy * t, t, t);
      }
    }
  }

  // Void pits: the swirling dark chasm, drawn between floor and walls exactly as the
  // game layers it (a static stand-in for the game's animated mist — see drawVoidPits).
  drawVoidPits(ctx, zone.voids, t, view.camX, view.camY);

  // Interior walls as raised blocks, matching the game's camera-relative depth: each
  // wall's side face leans TOWARD the camera focus and lengthens with distance from
  // it, then the lit cap sits over the skirt. `zone.walls` is the `"wall"` collision
  // the game draws as pillars; drawn over the pit so a wall at a chasm edge sits on top.
  ctx.fillStyle = ZONE_PALETTE.pillarShadow;
  ctx.beginPath();
  for (const p of zone.walls) {
    const lean = wallLeanVector(p, view.camX, view.camY);
    for (const q of extrudeRect(p, lean.x, lean.y)) {
      ctx.moveTo(q[0]!, q[1]!);
      ctx.lineTo(q[2]!, q[3]!);
      ctx.lineTo(q[4]!, q[5]!);
      ctx.lineTo(q[6]!, q[7]!);
      ctx.closePath();
    }
  }
  ctx.fill();
  ctx.fillStyle = ZONE_PALETTE.pillar;
  for (const p of zone.walls) ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);

  // Breakables.
  for (const b of zone.breakables) {
    const bx = b.box.x - b.box.w / 2;
    const by = b.box.y - b.box.h / 2;
    const w = b.box.w;
    const h = b.box.h;
    if (b.lock) {
      // A locked door: its key's colour + a keyhole, mirroring the game's look.
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = isKeyColor(b.lock.color) ? keyColorDef(b.lock.color).hex : "#888888";
      ctx.fillRect(bx, by, w, h);
      ctx.globalAlpha = 1;
      const inset = Math.min(w, h) * 0.14;
      ctx.strokeStyle = "rgba(12,14,18,0.5)";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + inset, by + inset, w - 2 * inset, h - 2 * inset);
      const kx = bx + w / 2;
      const ky = by + h / 2;
      const r = Math.min(w, h) * 0.13;
      ctx.fillStyle = "rgba(12,14,18,0.72)";
      ctx.beginPath();
      ctx.arc(kx, ky - r * 0.25, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(kx - r * 0.5, ky);
      ctx.lineTo(kx + r * 0.5, ky);
      ctx.lineTo(kx + r * 0.95, ky + r * 1.5);
      ctx.lineTo(kx - r * 0.95, ky + r * 1.5);
      ctx.closePath();
      ctx.fill();
      continue;
    }
    ctx.globalAlpha = b.occludes ? BREAKABLE_WALL_ALPHA : 1;
    ctx.fillStyle = breakableFill(b.kind);
    ctx.fillRect(bx, by, w, h);
    ctx.globalAlpha = 1;
    if (b.occludes) {
      ctx.strokeStyle = ZONE_PALETTE.breakableEdge;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx + 0.5 * w, by);
      ctx.lineTo(bx + 0.35 * w, by + 0.28 * h);
      ctx.lineTo(bx + 0.6 * w, by + 0.52 * h);
      ctx.lineTo(bx + 0.42 * w, by + 0.76 * h);
      ctx.lineTo(bx + 0.55 * w, by + h);
      ctx.moveTo(bx + 0.35 * w, by + 0.28 * h);
      ctx.lineTo(bx + 0.12 * w, by + 0.36 * h);
      ctx.moveTo(bx + 0.6 * w, by + 0.52 * h);
      ctx.lineTo(bx + 0.86 * w, by + 0.6 * h);
      ctx.stroke();
    }
  }

  // --- Editor overlays (NOT part of the game's depiction) -------------------
  // Zone bounds (kept ~1px on screen by dividing by zoom).
  ctx.lineWidth = 1 / view.zoom;
  ctx.strokeStyle = "rgba(120,140,180,0.5)";
  ctx.strokeRect(0, 0, zone.size.x, zone.size.y);

  // Placed objects: player spawn (cyan), spawners (crimson, with their activation
  // radius drawn), everything else (gold).
  for (const o of zone.objects) {
    if (o.kind === "spawner") {
      const cfg = parseSpawnerConfig(o.props);
      // Activation radius — the dormant→active trigger. Dashed (and in world px, so
      // it scales with zoom) so it reads as a trigger zone, not solid geometry.
      ctx.lineWidth = 1.5 / view.zoom;
      ctx.strokeStyle = "rgba(224,85,107,0.45)";
      ctx.setLineDash([8 / view.zoom, 6 / view.zoom]);
      ctx.beginPath();
      ctx.arc(o.x, o.y, cfg.activationRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // The nest at its TRUE in-game footprint (SPAWNER_NEST_TILES), so what you place
      // is the size that blocks/spawns in game — same crimson the game's renderer uses.
      const size = SPAWNER_NEST_TILES * t;
      const half = size / 2;
      ctx.fillStyle = ZONE_PALETTE.spawnerNest;
      ctx.fillRect(o.x - half, o.y - half, size, size);
      ctx.strokeStyle = ZONE_PALETTE.spawnerNestEdge;
      ctx.lineWidth = 1.5 / view.zoom;
      ctx.strokeRect(o.x - half, o.y - half, size, size);
      // What it spawns, labelled beneath — screen-constant size, dark halo for legibility.
      const fontPx = 12 / view.zoom;
      ctx.font = `${fontPx}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = creatureLabel(cfg.creature);
      const ly = o.y + half + 4 / view.zoom;
      ctx.lineWidth = 3 / view.zoom;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(label, o.x, ly);
      ctx.fillStyle = "#ffd7de";
      ctx.fillText(label, o.x, ly);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      continue;
    }
    if (o.kind === "creature") {
      // A single placed enemy: a violet dot at the creature's footprint size, with
      // its name labelled beneath (same dark-halo label the spawner uses).
      const r = Math.max(10, 0.28 * t);
      ctx.fillStyle = CREATURE_MARKER_FILL;
      ctx.beginPath();
      ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5 / view.zoom;
      ctx.strokeStyle = CREATURE_MARKER_EDGE;
      ctx.stroke();
      const fontPx = 12 / view.zoom;
      ctx.font = `${fontPx}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = creatureLabel(String(o.props.creature ?? ""));
      const ly = o.y + r + 4 / view.zoom;
      ctx.lineWidth = 3 / view.zoom;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(label, o.x, ly);
      ctx.fillStyle = CREATURE_LABEL_FILL;
      ctx.fillText(label, o.x, ly);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      continue;
    }
    if (o.kind === "key") {
      // A key pickup in its colour: bow ring + shaft + teeth, drawn dark-then-colour
      // for a crisp outline on any floor (mirrors the game's floor glyph).
      const col = isKeyColor(o.props.color) ? keyColorDef(o.props.color).hex : "#888888";
      const len = 22;
      const bowR = 6;
      const bowX = o.x - len * 0.32;
      const tipX = o.x + len * 0.46;
      ctx.lineCap = "round";
      for (const pass of [
        { c: "#13151a", line: 6, ring: 5.5 },
        { c: col, line: 3, ring: 3 },
      ]) {
        ctx.strokeStyle = pass.c;
        ctx.lineWidth = pass.line;
        ctx.beginPath();
        ctx.moveTo(bowX, o.y);
        ctx.lineTo(tipX, o.y);
        ctx.moveTo(tipX - 5, o.y);
        ctx.lineTo(tipX - 5, o.y + 5);
        ctx.moveTo(tipX, o.y);
        ctx.lineTo(tipX, o.y + 7);
        ctx.stroke();
        ctx.lineWidth = pass.ring;
        ctx.beginPath();
        ctx.arc(bowX, o.y, bowR, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.lineCap = "butt";
      continue;
    }
    ctx.fillStyle = o.kind === "playerSpawn" ? "#5fd0ff" : "#f2c14e";
    ctx.beginPath();
    ctx.arc(o.x, o.y, 8 / view.zoom + 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Paint-mode aids: the tile grid + the hovered cell. Editor-only.
  const cols = Math.round(zone.size.x / t);
  const rows = Math.round(zone.size.y / t);
  if (overlay.grid) {
    ctx.lineWidth = 1 / view.zoom;
    ctx.strokeStyle = "rgba(150,170,210,0.14)";
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      ctx.moveTo(c * t, 0);
      ctx.lineTo(c * t, zone.size.y);
    }
    for (let r = 0; r <= rows; r++) {
      ctx.moveTo(0, r * t);
      ctx.lineTo(zone.size.x, r * t);
    }
    ctx.stroke();
  }
  const h = overlay.hover;
  if (h && h.col >= 0 && h.col < cols && h.row >= 0 && h.row < rows) {
    const valid = overlay.hoverValid !== false;
    ctx.fillStyle = valid ? "rgba(255,255,255,0.18)" : "rgba(255,90,90,0.28)";
    ctx.fillRect(h.col * t, h.row * t, t, t);
    ctx.lineWidth = 2 / view.zoom;
    ctx.strokeStyle = valid ? "rgba(255,255,255,0.7)" : "rgba(255,90,90,0.95)";
    ctx.strokeRect(h.col * t, h.row * t, t, t);
  }

  // Selection: a bright outline around the picked breakable/object.
  const sel = overlay.selection;
  if (sel) {
    ctx.lineWidth = 2 / view.zoom;
    ctx.strokeStyle = "#5fd0ff";
    if (sel.type === "breakable") {
      const b = zone.breakables.find((b) => b.id === sel.id);
      if (b) {
        const pad = 3 / view.zoom;
        ctx.strokeRect(b.box.x - b.box.w / 2 - pad, b.box.y - b.box.h / 2 - pad, b.box.w + pad * 2, b.box.h + pad * 2);
      }
    } else {
      const o = zone.objects.find((o) => o.id === sel.id);
      if (o) {
        ctx.beginPath();
        ctx.arc(o.x, o.y, 12 / view.zoom + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // Resize handles: small squares at the selected breakable's corners (drag to resize).
  const rz = overlay.resize;
  if (rz) {
    const hs = 5 / view.zoom;
    ctx.fillStyle = "#5fd0ff";
    const xs = [rz.x - rz.w / 2, rz.x + rz.w / 2];
    const ys = [rz.y - rz.h / 2, rz.y + rz.h / 2];
    for (const hx of xs) for (const hy of ys) ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
  }

  // Free-rect being dragged out: a dashed box, red if it would cover a breakable/object.
  const p = overlay.pending;
  if (p && (p.box.w > 0 || p.box.h > 0)) {
    ctx.lineWidth = 2 / view.zoom;
    ctx.strokeStyle = p.valid ? "#5fd0ff" : "rgba(255,90,90,0.95)";
    ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
    ctx.strokeRect(p.box.x - p.box.w / 2, p.box.y - p.box.h / 2, p.box.w, p.box.h);
    ctx.setLineDash([]);
  }

  ctx.restore();
};
