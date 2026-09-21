#!/usr/bin/env python3
"""Repack a purchased tileset's source sheets into one gapless grid atlas — and
extract its terrain brushes (autotile tables) when the pack ships Tiled metadata.

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

Terrain brushes (tilesets.md § Terrain brushes): a sheet may carry a Tiled
`.tsx` whose <wangsets> tag each tile with the corners it covers, plus Tiled
automapping `.tmx` rule maps. Those are translated — local tile ids rebased to
atlas ids — into a generated TypeScript table for Realmsmith, so nobody ever
hand-types a 16-entry corner map or a 200-strip rule set.

Sheets stack top-to-bottom; a *band* (a list of specs) lays several narrow sheets
side by side in one row band so a 16-column wall sheet doesn't cost a full atlas
row. A spec's `names` renames the pack's wangsets to what the palette should say.

Packs only ship TRANSITION sets ("grass to sand": grass inside, sand outside) —
the plain ground underneath is a base layer in Tiled, never a brush. So a spec's
`fills` synthesises plain FILL brushes ("sand") from a set's full-interior
variants, and `outside` names, per transition set, the fill a cell blends back
into when it leaves the set (instead of a hole).

Add a tileset by extending PACKS, then:  python3 scripts/repack-tileset.py ancient
"""

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def _wall(pack: str, short: str, wangset: str, name: str) -> dict:
    """A raised-platform sheet: its .tsx wangset plus the pack's three rule maps
    (reset generated tiles → place faces → variations)."""
    d = f"apps/realmsmith/tilesets/{pack}"
    return {
        "png": f"{d}/{short}.png",
        "tsx": f"{d}/tiled/{short}.tsx",
        "rules": {wangset: [f"{d}/tiled/{short}-rule{n}.tmx" for n in range(3)]},
        "names": {wangset: name},
    }


PACKS = {
    "desert": {
        # Stacked top-to-bottom, in order. Paintable tile sheets (ground, wall)
        # come before the props sheet so `tileRows` covers them contiguously —
        # wall tiles are painted as floor/decor for Pokémon-style visual height
        # (real blocking stays the procedural collision tools; tilesets.md).
        "sheets": [
            {"png": "apps/realmsmith/tilesets/desert/ground_tile.png"},
            {"png": "apps/realmsmith/tilesets/desert/wall_tile.png"},
            {"png": "apps/realmsmith/tilesets/desert/props.png"},
        ],
        "cell": 16,
        "out": "apps/blood-in-the-sand/assets/tilesets/desert.png",
    },
    "ancient": {
        # "Ancient Ruins" pack (32px). Terrain = grass tones + transitions + stone
        # ground; wall9 = the arched parapet wall (top edge is a corner Wang set,
        # the two face rows beneath come from its automapping rules); props last.
        "sheets": [
            {
                "png": "apps/realmsmith/tilesets/ancient/terrain.png",
                "tsx": "apps/realmsmith/tilesets/ancient/tiled/terrain.tsx",
                "fills": {
                    "light grass": "light grass to transparency",
                    "mid tone grass": "mid tone grass to transparency",
                    "dark grass": "dark grass to transparency",
                    "extra dark grass": "extra dark to transparency",
                    "stone ground": "stone ground to transparency",
                },
                "outside": {
                    "light grass to mid tone grass": "mid tone grass",
                    "mid tone grass to light grass": "light grass",
                    "mid tone grass to dark grass": "dark grass",
                    "dark grass to mid tone grass": "mid tone grass",
                    "extra dark grass to dark grass": "dark grass",
                    "dark grass to extra dark grass": "extra dark grass",
                },
            },
            {
                "png": "apps/realmsmith/tilesets/ancient/wall9.png",
                "tsx": "apps/realmsmith/tilesets/ancient/tiled/wall9.tsx",
                # Rule maps per terrain (wangset) name, applied in this order after
                # every stroke: reset generated tiles → place faces → variations.
                "rules": {
                    "wall-9": [
                        "apps/realmsmith/tilesets/ancient/tiled/wall9-rule0.tmx",
                        "apps/realmsmith/tilesets/ancient/tiled/wall9-rule1.tmx",
                        "apps/realmsmith/tilesets/ancient/tiled/wall9-rule2.tmx",
                    ],
                },
            },
            {"png": "apps/realmsmith/tilesets/ancient/props.png"},
        ],
        "cell": 32,
        "out": "apps/blood-in-the-sand/assets/tilesets/ancient.png",
        "terrainsOut": "apps/realmsmith/src/terrains/ancient.ts",
    },
    "dunes": {
        # "Epic RPG World — Desert" pack (32px; same creator as ancient). Named
        # `dunes` because `desert` is the live 16px pack under arena-00. Terrain
        # sheet = sand/dirt/grass/rocky/stone transitions + a 1-tall cliff set
        # + platform + carpet; the 2- and 3-tall cliff sheets share one band;
        # props + props2 last. Left out: the oasis water sheets (animated —
        # tilesets.md keeps animated tiles out of scope) and the tents/houses
        # sheet (55 rows of buildings; add `props/props-tents-houses.png` here
        # if an arena wants a town wall).
        "sheets": [
            {
                "png": "apps/realmsmith/tilesets/dunes/terrain.png",
                "tsx": "apps/realmsmith/tilesets/dunes/tiled/terrain.tsx",
                "rules": {"Cliff1-1T": ["apps/realmsmith/tilesets/dunes/tiled/cliff1-rule0.tmx"]},
                # Fill brushes: the plain grounds, taken from the set whose
                # interior is that ground. Order = palette order.
                "fills": {
                    "sand": "sand to transparency",
                    "dirt": "dirt to sand",
                    "rocky ground": "rocky ground to sand",
                    "grass": "grass to transparency",
                    "stone ground": "stone ground to transparency",
                },
                # What each transition blends back into when erased.
                "outside": {
                    "rocky ground to sand": "sand",
                    "dirt to sand": "sand",
                    "grass to sand": "sand",
                    "stone ground to sand": "sand",
                    "grass to rocky ground": "rocky ground",
                    "grass to dirt": "dirt",
                    "rocky ground to rocky ground": "rocky ground",
                },
                "names": {
                    "Cliff1-1T": "cliff 1 tall",
                    "Cliff1-1T-transparency-CTRL+M on walls layer to make it transparent ": "cliff 1 tall (transparent)",
                    "Rocky ground-to-sand": "rocky ground to sand",
                    "dirt-to-sand": "dirt to sand",
                    "grass-to-sand": "grass to sand",
                    "grass-to-rocky-ground": "grass to rocky ground",
                    "grass-to-dirt": "grass to dirt",
                    "stone ground-to-sand": "stone ground to sand",
                    "rocky ground-to-rocky-ground": "rocky ground to rocky ground",
                    "sand-to-transparency": "sand to transparency",
                    "grass-to-transparency": "grass to transparency",
                    "stone ground-to-transparency": "stone ground to transparency",
                },
            },
            [
                {
                    "png": "apps/realmsmith/tilesets/dunes/cliff2.png",
                    "tsx": "apps/realmsmith/tilesets/dunes/tiled/cliff2.tsx",
                    "rules": {"Cliff1-2T": [f"apps/realmsmith/tilesets/dunes/tiled/cliff2-rule{n}.tmx" for n in range(3)]},
                    "names": {"Cliff1-2T": "cliff 2 tall"},
                },
                {
                    "png": "apps/realmsmith/tilesets/dunes/cliff3.png",
                    "tsx": "apps/realmsmith/tilesets/dunes/tiled/cliff3.tsx",
                    "rules": {"Cliff1-3T": [f"apps/realmsmith/tilesets/dunes/tiled/cliff3-rule{n}.tmx" for n in range(3)]},
                    "names": {"Cliff1-3T": "cliff 3 tall"},
                },
            ],
            {"png": "apps/realmsmith/tilesets/dunes/props.png"},
            {"png": "apps/realmsmith/tilesets/dunes/props2.png"},
        ],
        "cell": 32,
        "out": "apps/blood-in-the-sand/assets/tilesets/dunes.png",
        "terrainsOut": "apps/realmsmith/src/terrains/dunes.ts",
    },
    "highlands": {
        # "Epic RPG World — Highlands" pack (32px). Terrain sheet = snow, two
        # leaf-litter grounds, frozen lake, 1-tall platforms; eight raised
        # platform/fortress sheets (2- and 3-tall, snowy V1–V3 + raw) packed
        # three per band; props last.
        "sheets": [
            {
                "png": "apps/realmsmith/tilesets/highlands/terrain.png",
                "tsx": "apps/realmsmith/tilesets/highlands/tiled/terrain.tsx",
                "fills": {"snow": "snow-ground"},
                "names": {
                    "snow-ground-platformV1": "snow ground (platform V1)",
                    "terrain1": "terrain 1",
                    "terrain2": "terrain 2",
                    "snow-ground": "snow ground",
                    "frozen-lake": "frozen lake",
                    "platformV2-1tile tall": "platform V2 1 tall",
                    "platform-raw-1tile tall": "platform raw 1 tall",
                },
            },
            [
                _wall("highlands", "fortress", "fortress", "fortress 3 tall"),
                _wall("highlands", "v2-3", "platformV2-3tiles tall", "platform V2 3 tall"),
                _wall("highlands", "v1-3", "platformV1-3tiles tall", "platform V1 3 tall"),
            ],
            [
                _wall("highlands", "raw3", "platform-raw-3tiles tall", "platform raw 3 tall"),
                _wall("highlands", "raw2", "platform-raw-2tiles tall", "platform raw 2 tall"),
                _wall("highlands", "v1-2", "platformV1-2tiles tall", "platform V1 2 tall"),
            ],
            [
                _wall("highlands", "v2-2", "platformV2-2tiles", "platform V2 2 tall"),
                _wall("highlands", "v3-2", "platformV3-2tiles tall", "platform V3 2 tall"),
            ],
            {"png": "apps/realmsmith/tilesets/highlands/props.png"},
        ],
        "cell": 32,
        "out": "apps/blood-in-the-sand/assets/tilesets/highlands.png",
        "terrainsOut": "apps/realmsmith/src/terrains/highlands.ts",
    },
}

# Tiled's built-in `:/automap-tiles.tsx` (src/tiled/resources): id → MatchType.
AUTOMAP = {0: "Negate", 1: "Ignore", 2: "NonEmpty", 3: "Empty", 4: "Other"}
# Mirrors MATCH / OUT in packages/core/src/zone/terrain.ts.
MATCH = {"Ignore": 0, "Empty": -1, "NonEmpty": -2, "Other": -3}
OUT_EMPTY = -1
# Tiled wangid slots: [top, TR, right, BR, bottom, BL, left, TL]; corner sets use the odd ones.
CORNER_BITS = {1: 2, 3: 4, 5: 8, 7: 1}  # slot → CORNER.{tr,br,bl,tl}


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


# ───────────────────────────── Tiled metadata → terrain tables ─────────────────────────────


class Rebase:
    """Local sheet tile id → atlas tile id (1-based), given where the sheet landed."""

    def __init__(self, local_cols: int, row_offset: int, atlas_cols: int, col_offset: int = 0):
        self.local_cols, self.row_offset, self.atlas_cols = local_cols, row_offset, atlas_cols
        self.col_offset = col_offset

    def __call__(self, local: int) -> int:
        row = self.row_offset + local // self.local_cols
        return row * self.atlas_cols + self.col_offset + (local % self.local_cols) + 1


def read_wangsets(tsx_path: Path, rebase: Rebase):
    """Every corner-type wangset in a .tsx → {name: {"icon", "corners"}} with atlas ids."""
    root = ET.parse(tsx_path).getroot()
    if int(root.get("columns")) != rebase.local_cols:
        sys.exit(f"{tsx_path}: tsx says {root.get('columns')} columns, sheet has {rebase.local_cols}")
    weight = {int(t.get("id")): float(t.get("probability", "1")) for t in root.findall("tile")}
    out = {}
    for ws in root.findall("wangsets/wangset"):
        if ws.get("type") != "corner":
            print(f"  skipping wangset {ws.get('name')!r}: type {ws.get('type')} (only corner sets are supported)")
            continue
        corners: dict[int, list] = {}
        for wt in ws.findall("wangtile"):
            slots = [int(s) for s in wt.get("wangid").split(",")]
            mask = sum(bit for slot, bit in CORNER_BITS.items() if slots[slot] != 0)
            if mask == 0:
                continue
            local = int(wt.get("tileid"))
            corners.setdefault(mask, []).append((rebase(local), weight.get(local, 1.0)))
        for mask, variants in corners.items():
            # Tiles weighted 0 are "never auto-pick" (templates, rule-only variants);
            # keep them only if nothing else can represent the mask.
            live = [v for v in variants if v[1] > 0]
            corners[mask] = sorted(live if live else [(i, 1.0) for i, _ in variants])
        out[ws.get("name")] = {"icon": rebase(int(ws.get("tile", "0"))), "corners": dict(sorted(corners.items()))}
    return out


def read_rule_map(tmx_path: Path, rebase: Rebase):
    """One Tiled automapping map → a rule pass (see core terrain.ts for the semantics)."""
    root = ET.parse(tmx_path).getroot()
    W, H, tw, th = (int(root.get(k)) for k in ("width", "height", "tilewidth", "tileheight"))
    sheet_gid, auto_gid = None, None
    for ts in root.findall("tileset"):
        if "automap-tiles" in ts.get("source", ""):
            auto_gid = int(ts.get("firstgid"))
        else:
            if sheet_gid is not None:
                sys.exit(f"{tmx_path}: rule maps must reference exactly one art tileset")
            sheet_gid = int(ts.get("firstgid"))
    in_order = any(
        p.get("name") == "MatchInOrder" and p.get("value") == "true" for p in root.findall("properties/property")
    )
    layers = {}
    for L in root.findall("layer"):
        data = L.find("data")
        if data.get("encoding") != "csv":
            sys.exit(f"{tmx_path}: layer {L.get('name')} must be CSV-encoded")
        layers[L.get("name")] = [int(x) for x in data.text.replace("\n", "").split(",")]
    inputs = [v for k, v in layers.items() if k.startswith("input_")]
    outputs = [v for k, v in layers.items() if k.startswith("output_")]
    if len(inputs) != 1 or len(outputs) != 1:
        sys.exit(f"{tmx_path}: expected one input_* and one output_* layer, got {list(layers)}")
    inp, out = inputs[0], outputs[0]

    # Tiled orders the map's tilesets by first use, so the automap tileset may
    # come FIRST (then every art gid is above it) — classify by range, never by
    # "gid ≥ automap firstgid".
    def classify(gid: int):
        if auto_gid is not None and auto_gid <= gid < auto_gid + len(AUTOMAP):
            return AUTOMAP[gid - auto_gid]
        return gid - sheet_gid  # local tile id

    # Rule options: rectangles (map px) carrying Probability / Disabled for the rules they touch.
    options = []
    for og in root.findall("objectgroup"):
        if og.get("name") != "rule_options":
            continue
        for o in og.findall("object"):
            props = {p.get("name"): p.get("value") for p in o.findall("properties/property")}
            options.append(
                (
                    float(o.get("x")) / tw,
                    float(o.get("y")) / th,
                    (float(o.get("x")) + float(o.get("width"))) / tw,
                    (float(o.get("y")) + float(o.get("height"))) / th,
                    props,
                )
            )

    # Rules = 8-connected blobs of non-empty cells across input ∪ output.
    seen = [False] * (W * H)
    rules = []
    for start in range(W * H):
        if seen[start] or (inp[start] == 0 and out[start] == 0):
            continue
        stack, blob = [start], []
        seen[start] = True
        while stack:
            i = stack.pop()
            blob.append(i)
            x, y = i % W, i // W
            for ny in range(max(0, y - 1), min(H, y + 2)):
                for nx in range(max(0, x - 1), min(W, x + 2)):
                    j = ny * W + nx
                    if not seen[j] and (inp[j] or out[j]):
                        seen[j] = True
                        stack.append(j)
        xs, ys = [i % W for i in blob], [i // W for i in blob]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs) + 1, max(ys) + 1
        cells = []
        for i in sorted(blob, key=lambda i: (i // W, i % W)):
            x, y = i % W, i // W
            m = classify(inp[i]) if inp[i] else "Ignore"
            if m == "Negate":
                sys.exit(f"{tmx_path}: Negate tiles are not supported")
            match = MATCH[m] if isinstance(m, str) else rebase(m)
            o = classify(out[i]) if out[i] else None
            if o is None:
                o_val = 0
            elif o == "Empty":
                o_val = OUT_EMPTY
            elif isinstance(o, str):
                sys.exit(f"{tmx_path}: special tile {o} in an output layer")
            else:
                o_val = rebase(o)
            if match != 0 or o_val != 0:
                cells.append([x - x0, y - y0, match, o_val])
        rule = {"cells": cells}
        for ox0, oy0, ox1, oy1, props in options:
            if ox0 < x1 and ox1 > x0 and oy0 < y1 and oy1 > y0:
                if props.get("Disabled") == "true":
                    rule = None
                    break
                if "Probability" in props:
                    rule["probability"] = float(props["Probability"])
        if rule is not None:
            rules.append(((y0, x0), rule))
    # Tiled order: smaller Y first, then smaller X.
    rules.sort(key=lambda r: r[0])
    return {"inOrder": in_order, "rules": [r for _, r in rules]}


def emit_terrains(name: str, terrains: dict, out_path: Path):
    # One line per terrain: compact enough to commit, still diffable per set.
    body = "{\n" + ",\n".join(
        f"  {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))}" for k, v in terrains.items()
    ) + "\n}"
    const = name.upper().replace("-", "_") + "_TERRAINS"
    text = (
        "// GENERATED by scripts/repack-tileset.py — do not edit; re-run the script.\n"
        f"// Terrain brushes for the \"{name}\" tileset (docs/design/tilesets.md § Terrain brushes).\n"
        'import type { TerrainDef } from "@heroic/core";\n\n'
        f"export const {const}: Record<string, TerrainDef> = {body};\n"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text)
    print(f"wrote {out_path.relative_to(ROOT)} ({len(terrains)} terrains)")


# ───────────────────────────── main ─────────────────────────────


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else ""
    if name not in PACKS:
        sys.exit(f"usage: repack-tileset.py <{'|'.join(PACKS)}>")
    pack = PACKS[name]
    cell = pack["cell"]

    # Every entry is a band: one sheet, or a list of sheets laid side by side.
    bands = [spec if isinstance(spec, list) else [spec] for spec in pack["sheets"]]
    images = {}
    for spec in (s for band in bands for s in band):
        im = Image.open(ROOT / spec["png"]).convert("RGBA")
        # Some packs pad a sheet by a few px; crop down to whole cells (never up).
        cw, ch = (im.width // cell) * cell, (im.height // cell) * cell
        if (cw, ch) != im.size:
            print(f"  {spec['png']} is {im.width}x{im.height} — cropping to {cw}x{ch} (whole {cell}px cells)")
            im = im.crop((0, 0, cw, ch))
        images[spec["png"]] = im

    columns = max(sum(images[s["png"]].width for s in band) for band in bands) // cell
    rows = sum(max(images[s["png"]].height for s in band) for band in bands) // cell
    atlas = Image.new("RGBA", (columns * cell, rows * cell), (0, 0, 0, 0))

    report = {"name": name, "cellSize": cell, "columns": columns, "rows": rows, "sheets": []}
    terrains = {}
    outside_requests: list[tuple[str, str]] = []
    row = 0
    for band in bands:
        col = 0
        for spec in band:
            im = images[spec["png"]]
            atlas.paste(im, (col * cell, row * cell))
            report["sheets"].append(
                {
                    "source": spec["png"],
                    "rowOffset": row,
                    "colOffset": col,
                    "cells": [im.width // cell, im.height // cell],
                    "plainFill": plain_fill_candidates(im, cell),
                    "sprites": [
                        {"cells": [x0 + col, y0 + row, x1 - x0, y1 - y0]}
                        for x0, y0, x1, y1 in sprite_boxes(im, cell)
                    ],
                }
            )
            if "tsx" in spec:
                rebase = Rebase(im.width // cell, row, columns, col)
                found = read_wangsets(ROOT / spec["tsx"], rebase)
                for tname, rule_files in spec.get("rules", {}).items():
                    if tname not in found:
                        sys.exit(f"{spec['tsx']}: no wangset named {tname!r} for its rules")
                    found[tname]["passes"] = [read_rule_map(ROOT / f, rebase) for f in rule_files]
                for old, new in spec.get("names", {}).items():
                    if old not in found:
                        sys.exit(f"{spec['tsx']}: no wangset named {old!r} to rename")
                    found[new] = found.pop(old)
                # Fills and outsides name sets by their PALETTE (renamed) names.
                for fname, src_name in spec.get("fills", {}).items():
                    if src_name not in found:
                        sys.exit(f"{spec['tsx']}: no wangset named {src_name!r} to build fill {fname!r} from")
                    full = found[src_name]["corners"].get(15)
                    if not full:
                        sys.exit(f"{spec['tsx']}: {src_name!r} has no full-interior tiles for fill {fname!r}")
                    # icon is patched to the plainest variant once the atlas exists (below).
                    found[fname] = {"icon": full[0][0], "fill": True, "corners": {15: list(full)}}
                outside_requests.extend(spec.get("outside", {}).items())
                for tname in found:
                    if tname in terrains:
                        sys.exit(f"{spec['tsx']}: terrain {tname!r} already defined by an earlier sheet")
                terrains.update(found)
            col += im.width // cell
        row += max(images[s["png"]].height for s in band) // cell

    # Fill brushes lead the palette; their icon (and the id transitions blend
    # back into) is the plainest variant — least colour variance, e.g. bare sand
    # rather than the pebbled one.
    def variance(tile_id: int) -> float:
        k = tile_id - 1
        box = ((k % columns) * cell, (k // columns) * cell, (k % columns + 1) * cell, (k // columns + 1) * cell)
        px = list(atlas.crop(box).getdata())
        n = len(px)
        return sum(sum((p[ch] - sum(q[ch] for q in px) / n) ** 2 for p in px) / n for ch in range(3))
    fills = {k: v for k, v in terrains.items() if v.get("fill")}
    for t in fills.values():
        t["icon"] = min((i for i, _ in t["corners"][15]), key=variance)
    terrains = {**fills, **{k: v for k, v in terrains.items() if not v.get("fill")}}
    for tname, fill in outside_requests:
        if tname not in terrains or fill not in fills:
            sys.exit(f"outside: {tname!r} -> {fill!r}: unknown terrain or fill")
        terrains[tname]["outside"] = fills[fill]["icon"]

    # Overlay or base? A terrain with any see-through piece is a decor-layer
    # brush (the editor keeps it off the floor tool, where the void would show).
    alpha = atlas.getchannel("A")
    def tile_opaque(tile_id: int) -> bool:
        k = tile_id - 1
        box = ((k % columns) * cell, (k // columns) * cell, (k % columns + 1) * cell, (k // columns + 1) * cell)
        return alpha.crop(box).getextrema()[0] == 255
    for t in terrains.values():
        # A stray see-through tile tagged into an otherwise opaque mask (the
        # pack mis-tags one in "extra dark grass to dark grass") would both
        # punch a hole in a floor and demote the whole set to an overlay: where
        # a mask has opaque art, drop its transparent variants.
        for mask, vs in t["corners"].items():
            solid = [v for v in vs if tile_opaque(v[0])]
            if solid and len(solid) < len(vs):
                t["corners"][mask] = solid
        t["opaque"] = all(tile_opaque(i) for vs in t["corners"].values() for i, _ in vs)

    out = ROOT / pack["out"]
    out.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(out)
    print(f"wrote {out.relative_to(ROOT)} ({atlas.width}x{atlas.height}, {columns}x{rows} cells)")
    if "terrainsOut" in pack:
        emit_terrains(name, terrains, ROOT / pack["terrainsOut"])
        for tname, t in terrains.items():
            passes = t.get("passes", [])
            print(
                f"  terrain {tname!r}: {len(t['corners'])}/15 masks, "
                f"{sum(len(v) for v in t['corners'].values())} tiles, {'base' if t['opaque'] else 'OVERLAY'}, "
                f"{'FILL, ' if t.get('fill') else ''}{'outside ' + str(t['outside']) + ', ' if t.get('outside') else ''}"
                f"{[len(p['rules']) for p in passes]} rules/pass"
            )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
