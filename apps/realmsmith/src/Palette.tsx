import { useEffect, useRef } from "react";
import { tileSourceRect, type TilesetDef } from "@heroic/core";

/**
 * The tileset palette (docs/design/tilesets.md): pick what the floor/decor brush
 * paints, or which standing prop the object tool places. Shown beside the
 * viewport whenever the active tool consumes tileset art. All thumbnails come
 * straight from the same atlas the viewport draws, so what you pick is what
 * paints.
 */

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
  /** Which picker to show: the paint brush's tile, or the object tool's prop. */
  mode: "tiles" | "props";
  selectedTile: number;
  onPickTile: (id: number) => void;
  selectedProp: string;
  onPickProp: (name: string) => void;
}

export const Palette = ({
  tilesetName,
  def,
  atlas,
  mode,
  selectedTile,
  onPickTile,
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
    return (
      <div className="palette">
        <div className="palette-head">
          Tiles · {tilesetName}
          <span className="muted"> id {selectedTile}</span>
        </div>
        <div className="palette-scroll">
          <TileGrid def={def} atlas={atlas} selected={selectedTile} onPick={onPickTile} />
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
