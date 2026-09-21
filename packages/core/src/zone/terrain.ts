/**
 * Terrain brushes — autotiling for the tile layers (docs/design/tilesets.md
 * § Terrain brushes).
 *
 * A terrain is a named region-painting brush over a tileset: you paint "this
 * cell is wall", and the tile ids come from a lookup instead of your eyes. Two
 * stages, both pure and both writing ordinary tile ids into the same `floor` /
 * `decor` layers the raw brush writes (the saved format never changes):
 *
 *  1. **Corner solve.** The terrain lives on the grid's *vertices* (Tiled's
 *     "corner" Wang set): painting a cell marks its four corners as inside, and
 *     every tile shows which of its own four corners are inside — a 4-bit mask,
 *     16 combinations, each with weighted art variants. Membership is derived
 *     from the ids already in the layer, so nothing extra is stored and a hand-
 *     painted wall solves just as well as a brushed one.
 *  2. **Rule passes.** Ported straight from Tiled automapping: vertical/box
 *     patterns of "if these tiles sit here, write those tiles there". The
 *     ancient-ruins pack uses them to hang the two rows of wall *face* under
 *     the top edge the corner solve produced, and to sprinkle variants.
 *
 * Everything random is hashed from cell position, so re-solving a region is
 * idempotent — neighbours never reshuffle when you extend a wall.
 *
 * Pure data + math: the editor owns the brush and the generated tables; this
 * module is here so it can be unit-tested with the rest of the zone code.
 */

/** Corner bits of a cell's four vertices. */
export const CORNER = { tl: 1, tr: 2, br: 4, bl: 8 } as const;

/** One weighted candidate for a corner mask: [atlas tile id, weight]. */
export type TerrainVariant = [id: number, weight: number];

/** Rule-cell matchers (Tiled's special automap tiles). Positive = a tile id. */
export const MATCH = { ignore: 0, empty: -1, nonEmpty: -2, other: -3 } as const;
/** Rule-cell outputs. Positive = write that id. */
export const OUT = { none: 0, empty: -1 } as const;

/** One cell of a rule: offset from the rule's top-left, what it must see, what it writes. */
export type RuleCell = [dc: number, dr: number, match: number, out: number];

export interface TerrainRule {
  cells: RuleCell[];
  /** Chance the rule applies where it matches (Tiled `Probability`); default 1. */
  probability?: number;
}

export interface TerrainRulePass {
  /**
   * `false` (Tiled default): every rule is matched against the state *before*
   * the pass, then outputs are written in rule order — later rules win.
   * `true` (Tiled `MatchInOrder`): each rule is matched and applied in turn,
   * so it sees what earlier rules wrote.
   */
  inOrder: boolean;
  rules: TerrainRule[];
}

export interface TerrainDef {
  /** Representative tile id, for the palette swatch. */
  icon: number;
  /**
   * Every tile fully opaque → a base-floor brush (grass tones). `false` = some
   * pieces have transparent backgrounds (a platform's parapets, "to
   * transparency" edges): an OVERLAY that belongs on the decor layer over a
   * painted floor — on the floor layer the void shows through its edges.
   */
  opaque?: boolean;
  /** Corner mask (1–15) → weighted candidates. A missing mask leaves the cell as it was. */
  corners: Partial<Record<number, TerrainVariant[]>>;
  /** What a cell becomes when it leaves the terrain (mask 0). Default 0 = empty. */
  outside?: number;
  /**
   * A plain FILL brush (sand, dirt, a grass tone): no edges, no ring. Paint
   * writes a `corners[15]` variant on exactly the cells you touch; erase
   * writes `outside` on exactly the cells you touch that hold one of its
   * variants. The transition brushes ("grass to sand") name a fill's plain
   * tile as their `outside`, so leaving one blends back into the fill.
   */
  fill?: boolean;
  /** Post-solve rule passes, applied in order after every stroke. */
  passes?: TerrainRulePass[];
}

/** The layer a brush paints — App adapts `floor` / `decor` (with their own rules) to this. */
export interface TileGrid {
  cols: number;
  rows: number;
  get(col: number, row: number): number;
  /** Returns whether the cell actually changed. */
  set(col: number, row: number, id: number): boolean;
}

export interface CellRef {
  col: number;
  row: number;
}

/**
 * How far a stroke's rule passes reach beyond the painted cells. Must be at
 * least twice the tallest/widest rule so the region is self-contained: a
 * face erased near the edge always has its anchor inside the region too.
 */
export const RULE_MARGIN = 8;

// ───────────────────────────── Deterministic random ─────────────────────────────

/** [0,1) hashed from four ints — the only randomness in here, so solves are stable. */
export const hash01 = (a: number, b: number, c: number, d: number): number => {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2246822519) + Math.imul(d, 3266489917)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const weightedPick = (variants: TerrainVariant[], u: number): number => {
  let total = 0;
  for (const v of variants) total += v[1];
  let t = u * total;
  for (const v of variants) {
    t -= v[1];
    if (t < 0) return v[0];
  }
  return variants[variants.length - 1]![0];
};

// ───────────────────────────── Corner solve ─────────────────────────────

const maskIndexCache = new WeakMap<TerrainDef, Map<number, number>>();

/** id → corner mask for every tile the terrain owns (weighted or not). */
export const terrainMaskIndex = (def: TerrainDef): Map<number, number> => {
  let idx = maskIndexCache.get(def);
  if (!idx) {
    idx = new Map();
    for (const [mask, variants] of Object.entries(def.corners)) {
      for (const [id] of variants ?? []) idx.set(id, Number(mask));
    }
    maskIndexCache.set(def, idx);
  }
  return idx;
};

/**
 * Paint (`on`) or erase (`!on`) `cells` as `def`, re-solving their 3×3
 * neighbourhoods and then running the rule passes over the surrounding region.
 * Returns whether anything changed.
 */
export const paintTerrain = (grid: TileGrid, def: TerrainDef, cells: CellRef[], on: boolean): boolean => {
  if (cells.length === 0) return false;
  const idx = terrainMaskIndex(def);
  if (def.fill) {
    // A fill has no edge art to solve: touch exactly the stroke, nothing around it.
    const variants = def.corners[15] ?? [];
    let changed = false;
    for (const { col, row } of cells) {
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
      const cur = grid.get(col, row);
      if (on) {
        if (variants.length === 0) continue;
        const id = weightedPick(variants, hash01(col, row, 15, 0x7e44a1));
        if (id !== cur && grid.set(col, row, id)) changed = true;
      } else if (idx.has(cur) && grid.set(col, row, def.outside ?? 0)) {
        changed = true;
      }
    }
    return changed;
  }
  let c0 = Infinity;
  let c1 = -Infinity;
  let r0 = Infinity;
  let r1 = -Infinity;
  for (const c of cells) {
    c0 = Math.min(c0, c.col);
    c1 = Math.max(c1, c.col);
    r0 = Math.min(r0, c.row);
    r1 = Math.max(r1, c.row);
  }

  // Membership is per CELL (the cell you paint is solid interior; the ring
  // around it becomes edges), derived from the layer: a cell is a member iff it
  // holds this terrain's full-interior tile. That keeps paint and erase
  // symmetric — erasing B after painting A+B leaves exactly what painting A
  // alone would — where Tiled's vertex model would shrink A too.
  const member = (col: number, row: number): boolean => {
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
    return idx.get(grid.get(col, row)) === 15;
  };
  const stroke = new Set<number>();
  for (const c of cells) stroke.add(c.row * grid.cols + c.col);
  const isMember = (col: number, row: number): boolean =>
    stroke.has(row * grid.cols + col) && col >= 0 && row >= 0 && col < grid.cols && row < grid.rows
      ? on
      : member(col, row);
  // Vertex (vx,vy) — the top-left corner of cell (vx,vy) — is inside when any
  // of the four cells meeting there is a member.
  const vx0 = c0 - 1;
  const vx1 = c1 + 2;
  const vy0 = r0 - 1;
  const vy1 = r1 + 2;
  const vw = vx1 - vx0 + 1;
  const verts = new Uint8Array(vw * (vy1 - vy0 + 1));
  const vi = (vx: number, vy: number) => (vy - vy0) * vw + (vx - vx0);
  for (let vy = vy0; vy <= vy1; vy++) {
    for (let vx = vx0; vx <= vx1; vx++) {
      const inside = isMember(vx - 1, vy - 1) || isMember(vx, vy - 1) || isMember(vx - 1, vy) || isMember(vx, vy);
      verts[vi(vx, vy)] = inside ? 1 : 0;
    }
  }

  let changed = false;
  for (let row = Math.max(0, r0 - 1); row <= Math.min(grid.rows - 1, r1 + 1); row++) {
    for (let col = Math.max(0, c0 - 1); col <= Math.min(grid.cols - 1, c1 + 1); col++) {
      const mask =
        (verts[vi(col, row)] ? CORNER.tl : 0) |
        (verts[vi(col + 1, row)] ? CORNER.tr : 0) |
        (verts[vi(col + 1, row + 1)] ? CORNER.br : 0) |
        (verts[vi(col, row + 1)] ? CORNER.bl : 0);
      const cur = grid.get(col, row);
      if (mask === 0) {
        // Left the terrain: only cells that were ours get reset — never touch
        // unrelated art next door.
        if (idx.has(cur) && grid.set(col, row, def.outside ?? 0)) changed = true;
        continue;
      }
      const variants = def.corners[mask];
      if (!variants || variants.length === 0) continue;
      const id = weightedPick(variants, hash01(col, row, mask, 0x7e44a1));
      if (id !== cur && grid.set(col, row, id)) changed = true;
    }
  }

  if (def.passes && def.passes.length > 0) {
    const region = {
      c0: c0 - RULE_MARGIN,
      c1: c1 + RULE_MARGIN,
      r0: r0 - RULE_MARGIN,
      r1: r1 + RULE_MARGIN,
    };
    if (applyRulePasses(grid, def.passes, region)) changed = true;
  }
  return changed;
};

// ───────────────────────────── Rule passes ─────────────────────────────

export interface CellRegion {
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

interface CompiledRule {
  rule: TerrainRule;
  ids: Set<number>;
  usesEmpty: boolean;
  maxDc: number;
  maxDr: number;
}

const compiledCache = new WeakMap<TerrainRule, CompiledRule>();
const compile = (rule: TerrainRule): CompiledRule => {
  let c = compiledCache.get(rule);
  if (!c) {
    const ids = new Set<number>();
    let usesEmpty = false;
    let maxDc = 0;
    let maxDr = 0;
    for (const [dc, dr, match] of rule.cells) {
      if (match > 0) ids.add(match);
      if (match === MATCH.empty) usesEmpty = true;
      maxDc = Math.max(maxDc, dc);
      maxDr = Math.max(maxDr, dr);
    }
    c = { rule, ids, usesEmpty, maxDc, maxDr };
    compiledCache.set(rule, c);
  }
  return c;
};

const matches = (
  c: CompiledRule,
  read: (col: number, row: number) => number,
  cols: number,
  rows: number,
  ac: number,
  ar: number,
): boolean => {
  for (const [dc, dr, match] of c.rule.cells) {
    if (match === MATCH.ignore) continue;
    const col = ac + dc;
    const row = ar + dr;
    if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
    const v = read(col, row);
    if (match > 0) {
      if (v !== match) return false;
    } else if (match === MATCH.empty) {
      if (v !== 0) return false;
    } else if (match === MATCH.nonEmpty) {
      if (v === 0) return false;
    } else if (match === MATCH.other) {
      // Anything the rule doesn't itself name — including empty, unless the
      // rule spells Empty out somewhere (Tiled ≥ 1.10 semantics).
      if (c.ids.has(v)) return false;
      if (v === 0 && c.usesEmpty) return false;
    }
  }
  return true;
};

/**
 * Run rule passes with anchors inside `region` (outputs may land just outside
 * it). Ported Tiled automapping semantics — see `TerrainRulePass.inOrder`.
 */
export const applyRulePasses = (grid: TileGrid, passes: TerrainRulePass[], region: CellRegion): boolean => {
  let changed = false;
  const write = (col: number, row: number, out: number): void => {
    if (out === OUT.none) return;
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return;
    if (grid.set(col, row, out === OUT.empty ? 0 : out)) changed = true;
  };
  passes.forEach((pass, passIdx) => {
    // Non-ordered passes match against a frozen copy of the pre-pass state.
    let read: (col: number, row: number) => number = (col, row) => grid.get(col, row);
    if (!pass.inOrder) {
      const snap = new Int32Array(grid.cols * grid.rows);
      for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) snap[r * grid.cols + c] = grid.get(c, r);
      read = (col, row) => snap[row * grid.cols + col]!;
    }
    const pending: [number, number, number][] = [];
    pass.rules.forEach((rule, ruleIdx) => {
      const c = compile(rule);
      const p = rule.probability ?? 1;
      for (let ar = region.r0 - c.maxDr; ar <= region.r1; ar++) {
        for (let ac = region.c0 - c.maxDc; ac <= region.c1; ac++) {
          if (!matches(c, read, grid.cols, grid.rows, ac, ar)) continue;
          if (p < 1 && hash01(ac, ar, ruleIdx, passIdx + 0x51) >= p) continue;
          for (const [dc, dr, , out] of rule.cells) {
            if (pass.inOrder) write(ac + dc, ar + dr, out);
            else if (out !== OUT.none) pending.push([ac + dc, ar + dr, out]);
          }
        }
      }
    });
    for (const [col, row, out] of pending) write(col, row, out);
  });
  return changed;
};

/** Cells on the straight line from a to b (inclusive) — so a fast drag paints a
 *  continuous stroke instead of one cell per pointer event. */
export const lineCells = (a: CellRef, b: CellRef): CellRef[] => {
  const out: CellRef[] = [];
  let { col: x0, row: y0 } = a;
  const { col: x1, row: y1 } = b;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ col: x0, row: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
};
