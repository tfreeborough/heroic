import { ZONE_PALETTE, isCheckerDark, type Zone } from "@heroic/core";

/** Camera: the world coordinate under the canvas centre + screen-px-per-world-px. */
export interface View {
  camX: number;
  camY: number;
  zoom: number;
}

// Mirror the game's breakable look (apps/enter-the-gauntlet renderCombat.ts): an
// occluding wall is translucent + cracked; barrels/crates are solid. The colours
// come from the shared ZONE_PALETTE, so they can't drift from the game.
const BREAKABLE_WALL_ALPHA = 0.6;

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

  // Static collision: interior pillars + the greedy-meshed void fence, exactly the
  // set the game draws as pillars (`PILLARS = ZONE.collision`).
  ctx.fillStyle = ZONE_PALETTE.pillar;
  for (const p of zone.collision) ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);

  // Breakables.
  for (const b of zone.breakables) {
    const bx = b.box.x - b.box.w / 2;
    const by = b.box.y - b.box.h / 2;
    const w = b.box.w;
    const h = b.box.h;
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

  // Placed objects: spawn (cyan) and everything else (gold).
  for (const o of zone.objects) {
    ctx.fillStyle = o.kind === "playerSpawn" ? "#5fd0ff" : "#f2c14e";
    ctx.beginPath();
    ctx.arc(o.x, o.y, 8 / view.zoom + 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
};
