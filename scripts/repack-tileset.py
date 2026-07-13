#!/usr/bin/env python3
"""Repack a purchased tileset's source sheets into one gapless grid atlas.

The runtime format (docs/design/tilesets.md) is deliberately trivial: ONE image,
uniform cells, tile id N = cell N-1 row-major. Purchased packs arrive as several
role sheets (ground / props / walls), so this script stacks the chosen sheets
vertically into a fixed-column atlas and writes it into a game app's
assets/tilesets/<name>.png. Each source sheet keeps its internal layout, just
offset by whole rows — so cell coordinates from the pack's docs stay easy to
translate (add the sheet's row offset).

It also prints authoring aids for the core registry entry:
  - each sheet's row offset in the atlas,
  - candidate "plain fill" tiles (fully opaque, low colour variance) for base floors,
  - connected-sprite bounding boxes (cell-snapped) per sheet, to seed PropDefs.

Add a tileset by extending PACKS, then:  python3 scripts/repack-tileset.py desert
"""

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

PACKS = {
    "desert": {
        # Stacked top-to-bottom, in order. Paintable tile sheets (ground, wall)
        # come before the props sheet so `tileRows` covers them contiguously —
        # wall tiles are painted as floor/decor for Pokémon-style visual height
        # (real blocking stays the procedural collision tools; tilesets.md).
        "sheets": [
            "apps/realmsmith/tilesets/desert/ground_tile.png",
            "apps/realmsmith/tilesets/desert/wall_tile.png",
            "apps/realmsmith/tilesets/desert/props.png",
        ],
        "cell": 16,
        "out": "apps/blood-in-the-sand/assets/tilesets/desert.png",
    },
}


def sprite_boxes(im: Image.Image, cell: int, merge_dist: int = 2):
    """Bounding boxes of connected sprites, snapped outward to whole cells.

    Pixels within `merge_dist` (Chebyshev) are treated as connected, so a tree's
    near-touching foliage clumps and its trunk resolve to one sprite.
    """
    w, h = im.size
    a = im.getchannel("A").load()
    seen = [[False] * w for _ in range(h)]
    boxes = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or a[sx, sy] == 0:
                continue
            stack = [(sx, sy)]
            seen[sy][sx] = True
            x0, y0, x1, y1 = sx, sy, sx, sy
            while stack:
                x, y = stack.pop()
                x0, y0 = min(x0, x), min(y0, y)
                x1, y1 = max(x1, x), max(y1, y)
                for ny in range(max(0, y - merge_dist), min(h, y + merge_dist + 1)):
                    for nx in range(max(0, x - merge_dist), min(w, x + merge_dist + 1)):
                        if not seen[ny][nx] and a[nx, ny] > 0:
                            seen[ny][nx] = True
                            stack.append((nx, ny))
            boxes.append((x0, y0, x1, y1))
    # Snap outward to cells; drop specks smaller than a quarter-cell.
    cells = set()
    for x0, y0, x1, y1 in boxes:
        if (x1 - x0 + 1) * (y1 - y0 + 1) < (cell * cell) // 4:
            continue
        cells.add((x0 // cell, y0 // cell, x1 // cell + 1, y1 // cell + 1))
    return sorted(cells, key=lambda b: (b[1], b[0]))


def plain_fill_candidates(im: Image.Image, cell: int, top: int = 8):
    """Fully-opaque cells with the lowest colour variance — base-floor candidates."""
    w, h = im.size
    rgba = im.load()
    scored = []
    for cy in range(h // cell):
        for cx in range(w // cell):
            px = [rgba[cx * cell + i, cy * cell + j] for j in range(cell) for i in range(cell)]
            if any(p[3] < 255 for p in px):
                continue
            n = len(px)
            var = 0.0
            for ch in range(3):
                vals = [p[ch] for p in px]
                m = sum(vals) / n
                var += sum((v - m) ** 2 for v in vals) / n
            scored.append((var, cx, cy))
    scored.sort()
    return [(cx, cy) for _, cx, cy in scored[:top]]


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else ""
    if name not in PACKS:
        sys.exit(f"usage: repack-tileset.py <{'|'.join(PACKS)}>")
    pack = PACKS[name]
    cell = pack["cell"]

    sheets = [Image.open(ROOT / p).convert("RGBA") for p in pack["sheets"]]
    for p, im in zip(pack["sheets"], sheets):
        if im.width % cell or im.height % cell:
            sys.exit(f"{p} is {im.width}x{im.height} — not a multiple of cell size {cell}")

    columns = max(im.width for im in sheets) // cell
    rows = sum(im.height // cell for im in sheets)
    atlas = Image.new("RGBA", (columns * cell, rows * cell), (0, 0, 0, 0))

    report = {"name": name, "cellSize": cell, "columns": columns, "rows": rows, "sheets": []}
    row = 0
    for p, im in zip(pack["sheets"], sheets):
        atlas.paste(im, (0, row * cell))
        report["sheets"].append(
            {
                "source": p,
                "rowOffset": row,
                "cells": [im.width // cell, im.height // cell],
                "plainFill": plain_fill_candidates(im, cell),
                "sprites": [
                    {"cells": [x0, y0, x1 - x0, y1 - y0], "atlasRow": y0 + row}
                    for x0, y0, x1, y1 in sprite_boxes(im, cell)
                ],
            }
        )
        row += im.height // cell

    out = ROOT / pack["out"]
    out.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(out)
    print(f"wrote {out.relative_to(ROOT)} ({atlas.width}x{atlas.height}, {columns}x{rows} cells)")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
