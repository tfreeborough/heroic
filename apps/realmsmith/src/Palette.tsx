import { useEffect, useRef } from "react";
import { CORNER, tileSourceRect, type TerrainDef, type TilesetDef } from "@heroic/core";
import type { Brush } from "./edit/brush";

/**
 * The tileset palette (docs/design/tilesets.md): pick what the floor/decor brush
 * paints — a terrain (autotile) or one explicit tile — or which standing prop
 * the object tool places. Shown beside the viewport whenever the active tool
 * consumes tileset art. All thumbnails come straight from the same atlas the
 * viewport draws, so what you pick is what paints.
 */

/** A terrain drawn as the 3×3 blob one painted cell produces — the swatch IS
 *  the demo: centre full, edges and corners around it. */
const SWATCH_CELL = 16;
const BLOB: number[][] = [
  [CORNER.br, CORNER.bl | CORNER.br, CORNER.bl],
  [CORNER.tr | CORNER.br, 15, CORNER.tl | CORNER.bl],
  [CORNER.tr, CORNER.tl | CORNER.tr, CORNER.tl],
];

const TerrainSwatch = ({
  def,
  terrain,
  atlas,
}: {
  def: TilesetDef;
  terrain: TerrainDef;
  atlas: HTMLImageElement;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const px = SWATCH_CELL * 3;
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    canvas.style.width = `${px}px`;
    canvas.style.height = `${px}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, px, px);
    BLOB.forEach((row, r) =>
      row.forEach((mask, c) => {
        const id = terrain.corners[mask]?.[0]?.[0] ?? terrain.icon;
        const src = tileSourceRect(def, id);
        if (src) ctx.drawImage(atlas, src.x, src.y, src.w, src.h, c * SWATCH_CELL, r * SWATCH_CELL, SWATCH_CELL, SWATCH_CELL);
      }),
    );
  }, [def, terrain, atlas]);
  return <canvas ref={canvasRef} className="terrain-thumb" />;
};

interface TilesProps {
  def: TilesetDef;
  atlas: HTMLImageElement;
  selected: number;
  onPick: (id: number) => void;
}

/** Atlas cells scaled up to a comfortable click target. */
const CELL_PX = 24;

/** The paintable-tile region of the atlas as one clickable canvas grid. */
const TileGrid = ({ def, atlas, selected, onPick }: TilesProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rows = Math.min(
    def.tileRows ?? Math.ceil(def.tileCount / def.columns),
    Math.ceil(def.tileCount / def.columns),
  );

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = def.columns * CELL_PX * dpr;
    canvas.height = rows * CELL_PX * dpr;
    canvas.style.width = `${def.columns * CELL_PX}px`;
    canvas.style.height = `${rows * CELL_PX}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, def.columns * CELL_PX, rows * CELL_PX);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < def.columns; c++) {
        const id = r * def.columns + c + 1;
        const src = tileSourceRect(def, id);
        if (!src) continue;
        ctx.drawImage(atlas, src.x, src.y, src.w, src.h, c * CELL_PX, r * CELL_PX, CELL_PX, CELL_PX);
      }
    }
    // Faint grid so empty cells are still visible targets.
    ctx.strokeStyle = "rgba(150,170,210,0.15)";
    ctx.lineWidth = 1;
    for (let c = 0; c <= def.columns; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL_PX + 0.5, 0);
      ctx.lineTo(c * CELL_PX + 0.5, rows * CELL_PX);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL_PX + 0.5);
      ctx.lineTo(def.columns * CELL_PX, r * CELL_PX + 0.5);
      ctx.stroke();
    }
    // Selection highlight.
    if (selected >= 1) {
      const sc = (selected - 1) % def.columns;
      const sr = Math.floor((selected - 1) / def.columns);
      if (sr < rows) {
        ctx.strokeStyle = "#5fd0ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(sc * CELL_PX + 1, sr * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2);
      }
    }
  }, [def, atlas, selected, rows]);

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const c = Math.floor((e.clientX - rect.left) / CELL_PX);
        const r = Math.floor((e.clientY - rect.top) / CELL_PX);
        if (c < 0 || c >= def.columns || r < 0 || r >= rows) return;
        onPick(r * def.columns + c + 1);
      }}
    />
  );
};

interface Props {
  /** The zone's tileset name (whatever the file says, resolvable or not). */
  tilesetName: string;
  /** Registry geometry for that name; undefined → unknown set, show the hint. */
  def: TilesetDef | undefined;
  /** The loaded atlas, or null while loading / when the server has no image. */
  atlas: HTMLImageElement | null;
  /** Which picker to show: the paint brush, or the object tool's prop. */
  mode: "tiles" | "props";
  /** Which layer the brush paints — overlay terrains are offered on decor only. */
  layer: "floor" | "decor";
  /** Terrain brushes this tileset offers, if any (editor-side tables). */
  terrains: Record<string, TerrainDef> | undefined;
  brush: Brush;
  onPickBrush: (brush: Brush) => void;
  selectedProp: string;
  onPickProp: (name: string) => void;
}

export const Palette = ({
  tilesetName,
  def,
  atlas,
  mode,
  layer,
  terrains,
  brush,
  onPickBrush,
  selectedProp,
  onPickProp,
}: Props) => {
  if (!def || !atlas) {
    return (
      <div className="palette">
        <div className="palette-head">Tileset</div>
        <div className="muted palette-hint">
          {!def
            ? `No registry entry for tileset "${tilesetName}" — pick one in the Zone panel (click empty space), or add it to TILESETS in @heroic/core.`
            : `Atlas "${tilesetName}.png" not found — run scripts/repack-tileset.py or check the dev server.`}
        </div>
      </div>
    );
  }

  if (mode === "tiles") {
    // Base terrains (every piece opaque) paint on either layer; overlays — a
    // platform's see-through parapets, "to transparency" edges — only on decor,
    // where a painted floor shows through instead of the void.
    const all = Object.entries(terrains ?? {});
    const offered = layer === "floor" ? all.filter(([, t]) => t.opaque !== false) : all;
    const overlays = all.length - all.filter(([, t]) => t.opaque !== false).length;
    return (
      <div className="palette">
        <div className="palette-head">
          {layer === "floor" ? "Floor" : "Decor"} · {tilesetName}
          <span className="muted"> {brush.kind === "tile" ? `id ${brush.id}` : brush.name}</span>
        </div>
        {offered.length > 0 && (
          <div
            className="palette-terrains"
            title="Terrain brushes: paint a region and the edges, corners and wall faces are picked for you. Left paints, right erases."
          >
            {offered.map(([name, t]) => (
              <button
                key={name}
                className={`terrain-swatch ${brush.kind === "terrain" && brush.name === name ? "on" : ""}`}
                title={
                  t.fill
                    ? `${name} — a plain fill: paints just the cells you touch (random plain/detail variants), no edges. Lay it first; the "… to ${name}" brushes blend into it.`
                    : t.opaque === false
                      ? `${name} — an overlay: what you paint becomes the raised top, the ring around it the edges/faces. Paint on decor over a floor.`
                      : `${name} — what you paint becomes the inside, the ring around it blends out.`
                }
                onClick={() => onPickBrush({ kind: "terrain", name })}
              >
                <TerrainSwatch def={def} terrain={terrains![name]!} atlas={atlas} />
                <span className="prop-name">{name}</span>
              </button>
            ))}
          </div>
        )}
        {layer === "floor" && overlays > 0 && (
          <div className="muted palette-note">
            {overlays} overlay terrain{overlays === 1 ? "" : "s"} (walls, platform edges) live on the <b>Decor</b> tool — they have see-through edges, so they sit over a painted floor.
          </div>
        )}
        {layer === "decor" && (
          <div className="muted palette-note">Ground dressing (tufts, flowers, pebbles) is at the bottom of the grid — paint it here. Standing things are the <b>Prop</b> tool.</div>
        )}
        <div className="palette-scroll">
          <TileGrid
            def={def}
            atlas={atlas}
            selected={brush.kind === "tile" ? brush.id : 0}
            onPick={(id) => onPickBrush({ kind: "tile", id })}
          />
        </div>
      </div>
    );
  }

  // Props: one button per PropDef, thumbnailed by CSS-cropping the atlas image
  // (background-position) — no canvas per item, crisp via image-rendering.
  const scale = 2;
  return (
    <div className="palette">
      <div className="palette-head">
        Props · {tilesetName}
        <span className="muted"> {selectedProp}</span>
      </div>
      <div className="palette-scroll palette-props">
        {Object.entries(def.props).map(([name, p]) => {
          const [col, row, cols, rows] = p.cells;
          const cs = def.cellSize;
          return (
            <button
              key={name}
              className={`prop-swatch ${name === selectedProp ? "on" : ""}`}
              title={`${name}${p.footprint ? "" : " (walk-through)"}${p.occludes ? " — blocks sight" : ""}`}
              onClick={() => onPickProp(name)}
            >
              <span
                className="prop-thumb"
                style={{
                  width: cols * cs * scale,
                  height: rows * cs * scale,
                  backgroundImage: `url(${atlas.src})`,
                  backgroundPosition: `${-col * cs * scale}px ${-row * cs * scale}px`,
                  backgroundSize: `${atlas.naturalWidth * scale}px ${atlas.naturalHeight * scale}px`,
                }}
              />
              <span className="prop-name">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
