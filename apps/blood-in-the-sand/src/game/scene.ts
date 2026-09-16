/**
 * Everything the renderer derives from an arena's zone, built once per arena
 * id and memoised (docs/design/bits-arenas.md). `render.ts` used to derive all
 * of this at module scope from the one bundled arena; now a room's
 * `welcome.zoneId` picks the scene and `recordArena` installs it for the frame.
 *
 * Per-arena mutable state lives here too (the floor bake cache, prop fade
 * alphas) — it belongs to the map, not the frame, and must not leak between
 * arenas when the next room rolls a different one.
 */
import { Skia, type SkImage, type SkRect } from "@shopify/react-native-skia";
import { loadZone, TILESETS, type TilesetDef, type Zone } from "@heroic/core";
import { arenaById } from "@heroic/blood-in-the-sand-sim";
import { buildCrowd, type Crowd } from "./crowd";

/** A prop pre-resolved for the draw loop: cached src/dst rects + sprite
 *  bounds, sorted by baseline (feet y) once — the per-frame y-sort only
 *  interleaves players between them. `fade` is mutable per-frame state: the
 *  current alpha, eased toward FADE_ALPHA while someone stands behind it. */
export interface PropSprite {
  y: number;
  left: number;
  top: number;
  w: number;
  h: number;
  src: SkRect;
  dst: SkRect;
  fade: number;
}

export interface ArenaScene {
  id: string;
  zone: Zone;
  worldW: number;
  worldH: number;
  tileset: TilesetDef | undefined;
  /** (0,0)–(worldW,worldH): the floor bake's dst, the splat map's src+dst. */
  floorRect: SkRect;
  /** The animated pit crowd — a procedural amphitheatre in the void beyond
   *  the sand, revealed by the relaxed camera clamp. */
  crowd: Crowd;
  propsSorted: PropSprite[];
  /** Wall geometry, pre-allocated (two fresh rects per wall per frame was
   *  free GC food — the allocation diet). */
  wallRects: { body: SkRect; top: SkRect }[];
  /** The floor image bake cache (render.ts floorImage): keyed on the atlas
   *  it was baked from, so an atlas that decodes later rebakes once. */
  bakedAtlas: SkImage | null;
  bakedFloor: SkImage | null;
}

const scenes = new Map<string, ArenaScene>();

/** The scene for an arena id (unknown → the default arena, like arenaById). */
export const arenaScene = (zoneId: string): ArenaScene => {
  const file = arenaById(zoneId);
  let s = scenes.get(file.id);
  if (s) return s;
  const zone = loadZone(file);
  const worldW = zone.size.x;
  const worldH = zone.size.y;
  s = {
    id: file.id,
    zone,
    worldW,
    worldH,
    tileset: TILESETS[zone.tileset],
    floorRect: Skia.XYWHRect(0, 0, worldW, worldH),
    crowd: buildCrowd(worldW, worldH),
    propsSorted: [...zone.props]
      .sort((a, b) => a.y - b.y)
      .map((p) => ({
        y: p.y,
        left: p.x - p.w / 2,
        top: p.y - p.h,
        w: p.w,
        h: p.h,
        src: Skia.XYWHRect(p.src.x, p.src.y, p.src.w, p.src.h),
        dst: Skia.XYWHRect(p.x - p.w / 2, p.y - p.h, p.w, p.h),
        fade: 1,
      })),
    wallRects: zone.walls.map((w) => ({
      body: Skia.XYWHRect(w.x - w.w / 2, w.y - w.h / 2 + 6, w.w, w.h),
      top: Skia.XYWHRect(w.x - w.w / 2, w.y - w.h / 2 - 6, w.w, w.h),
    })),
    bakedAtlas: null,
    bakedFloor: null,
  };
  scenes.set(file.id, s);
  return s;
};
