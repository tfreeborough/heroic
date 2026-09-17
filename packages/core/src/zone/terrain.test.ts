import { describe, expect, test } from "bun:test";
import {
  CORNER,
  MATCH,
  OUT,
  applyRulePasses,
  lineCells,
  paintTerrain,
  type TerrainDef,
  type TerrainRulePass,
  type TileGrid,
} from "./terrain";

/** A layer as a plain grid; tile id == corner mask so expectations read directly. */
const makeGrid = (cols: number, rows: number): TileGrid & { cells: number[][] } => {
  const cells = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  return {
    cols,
    rows,
    cells,
    get: (c, r) => cells[r]![c]!,
    set: (c, r, id) => {
      if (cells[r]![c] === id) return false;
      cells[r]![c] = id;
      return true;
    },
  };
};

/** Terrain whose tile for mask m is id m (1–15) — no variants, no rules. */
const MASK_TERRAIN: TerrainDef = {
  icon: 15,
  corners: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, [[i + 1, 1]]])),
};

describe("paintTerrain corner solve", () => {
  test("one cell becomes a full tile ringed by edges and corners", () => {
    const g = makeGrid(5, 5);
    expect(paintTerrain(g, MASK_TERRAIN, [{ col: 2, row: 2 }], true)).toBe(true);
    expect(g.cells[2]![2]).toBe(CORNER.tl | CORNER.tr | CORNER.br | CORNER.bl);
    // Neighbours only see the corner(s) they share with the painted cell.
    expect(g.cells[1]![1]).toBe(CORNER.br);
    expect(g.cells[1]![2]).toBe(CORNER.bl | CORNER.br);
    expect(g.cells[1]![3]).toBe(CORNER.bl);
    expect(g.cells[2]![1]).toBe(CORNER.tr | CORNER.br);
    expect(g.cells[2]![3]).toBe(CORNER.tl | CORNER.bl);
    expect(g.cells[3]![1]).toBe(CORNER.tr);
    expect(g.cells[3]![2]).toBe(CORNER.tl | CORNER.tr);
    expect(g.cells[3]![3]).toBe(CORNER.tl);
    // Nothing further out is touched.
    expect(g.cells[0]!.every((v) => v === 0)).toBe(true);
  });

  test("membership is derived from existing ids, so strokes extend each other", () => {
    const g = makeGrid(6, 4);
    paintTerrain(g, MASK_TERRAIN, [{ col: 1, row: 1 }], true);
    paintTerrain(g, MASK_TERRAIN, [{ col: 2, row: 1 }], true);
    // Two cells side by side: both full, the seam between them is interior.
    expect(g.cells[1]![1]).toBe(15);
    expect(g.cells[1]![2]).toBe(15);
    expect(g.cells[0]![2]).toBe(CORNER.bl | CORNER.br);
    expect(g.cells[0]![3]).toBe(CORNER.bl);
  });

  test("erasing resets cells that leave the terrain and leaves foreign tiles alone", () => {
    const g = makeGrid(6, 6);
    g.cells[0]![0] = 99; // unrelated art far away
    g.cells[4]![4] = 99; // unrelated art inside the re-solve window
    paintTerrain(g, MASK_TERRAIN, [{ col: 2, row: 2 }, { col: 3, row: 2 }], true);
    expect(paintTerrain(g, MASK_TERRAIN, [{ col: 3, row: 2 }], false)).toBe(true);
    expect(g.cells[2]![2]).toBe(15); // the survivor is still whole
    expect(g.cells[2]![3]).toBe(CORNER.tl | CORNER.bl); // …and the erased cell is now its right edge
    expect(g.cells[2]![4]).toBe(0); // the old outer edge is gone — it was ours
    // Exactly what painting the survivor alone produces.
    const solo = makeGrid(6, 6);
    solo.cells[0]![0] = 99;
    solo.cells[4]![4] = 99;
    paintTerrain(solo, MASK_TERRAIN, [{ col: 2, row: 2 }], true);
    expect(g.cells).toEqual(solo.cells);
    expect(g.cells[4]![4]).toBe(99); // never ours, never touched
    expect(g.cells[0]![0]).toBe(99);
  });

  test("solves are idempotent and variant picks are stable per cell", () => {
    const def: TerrainDef = { icon: 1, corners: { 15: [[15, 1], [16, 1], [17, 1]] } };
    const a = makeGrid(8, 8);
    const cells = [{ col: 2, row: 2 }, { col: 3, row: 2 }, { col: 2, row: 3 }, { col: 3, row: 3 }];
    paintTerrain(a, def, cells, true);
    const first = a.cells.map((r) => [...r]);
    expect(paintTerrain(a, def, cells, true)).toBe(false);
    expect(a.cells).toEqual(first);
    // Same cells painted in another order → identical art.
    const b = makeGrid(8, 8);
    paintTerrain(b, def, [...cells].reverse(), true);
    expect(b.cells).toEqual(first);
    // Masks the terrain lacks art for are left as they were (only 15 is defined here).
    expect(a.cells[1]![1]).toBe(0);
  });
});

describe("fill terrains", () => {
  const SAND: TerrainDef = { icon: 50, fill: true, corners: { 15: [[50, 1], [51, 1]] } };
  const GRASS: TerrainDef = { ...MASK_TERRAIN, outside: 50 };

  test("paint touches exactly the stroke with a fill variant; no ring", () => {
    const g = makeGrid(5, 5);
    paintTerrain(g, SAND, [{ col: 2, row: 2 }], true);
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++) expect([50, 51].includes(g.get(c, r)), `${c},${r}`).toBe(c === 2 && r === 2);
  });

  test("erase resets only stroke cells that hold a fill variant", () => {
    const g = makeGrid(5, 5);
    g.set(1, 1, 50);
    g.set(2, 1, 999); // foreign art
    paintTerrain(g, SAND, [{ col: 1, row: 1 }, { col: 2, row: 1 }], false);
    expect(g.get(1, 1)).toBe(0);
    expect(g.get(2, 1)).toBe(999);
  });

  test("a transition whose outside is the fill's plain tile blends back into it", () => {
    const g = makeGrid(7, 7);
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) g.set(c, r, 50);
    paintTerrain(g, GRASS, [{ col: 3, row: 3 }], true);
    expect(g.get(3, 3)).toBe(15);
    expect(g.get(2, 2)).toBe(CORNER.br); // ring cell took an edge tile
    expect(g.get(0, 0)).toBe(50); // untouched sand beyond the ring
    paintTerrain(g, GRASS, [{ col: 3, row: 3 }], false);
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) expect(g.get(c, r), `${c},${r}`).toBe(50);
  });
});

describe("applyRulePasses", () => {
  // The ancient-ruins wall shape: a top-edge tile 66 hangs faces 82/98 below it,
  // unless another wall's top (2) sits two rows down, in which case the lower
  // face is the join tile 88. The specific rule comes later, so it wins.
  const facePass: TerrainRulePass = {
    inOrder: false,
    rules: [
      { cells: [[0, 0, 66, OUT.none], [0, 1, MATCH.empty, 82], [0, 2, MATCH.empty, 98]] },
      { cells: [[0, 0, 66, OUT.none], [0, 1, MATCH.ignore, 82], [0, 2, 2, 88]] },
    ],
  };

  test("later rules override earlier ones and matching sees the pre-pass state", () => {
    const g = makeGrid(3, 6);
    g.cells[1]![1] = 66;
    g.cells[3]![1] = 2;
    expect(applyRulePasses(g, [facePass], { c0: 0, c1: 2, r0: 0, r1: 5 })).toBe(true);
    expect(g.cells[2]![1]).toBe(82);
    expect(g.cells[3]![1]).toBe(88); // the join, not the plain face
    // The plain case elsewhere.
    const h = makeGrid(3, 6);
    h.cells[1]![1] = 66;
    applyRulePasses(h, [facePass], { c0: 0, c1: 2, r0: 0, r1: 5 });
    expect(h.cells[2]![1]).toBe(82);
    expect(h.cells[3]![1]).toBe(98);
  });

  test("Other matches anything the rule doesn't name, including empty unless Empty is used", () => {
    const g = makeGrid(1, 3);
    g.cells[0]![0] = 5;
    const otherPass: TerrainRulePass = { inOrder: true, rules: [{ cells: [[0, 0, 5, OUT.none], [0, 1, MATCH.other, 7]] }] };
    applyRulePasses(g, [otherPass], { c0: 0, c1: 0, r0: 0, r1: 2 });
    expect(g.cells[1]![0]).toBe(7);
    // Now with Empty spelled out elsewhere in the rule, an empty cell is no longer "other".
    const h = makeGrid(1, 3);
    h.cells[0]![0] = 5;
    const strict: TerrainRulePass = {
      inOrder: true,
      rules: [{ cells: [[0, 0, 5, OUT.none], [0, 1, MATCH.other, 7], [0, 2, MATCH.empty, OUT.none]] }],
    };
    applyRulePasses(h, [strict], { c0: 0, c1: 0, r0: 0, r1: 2 });
    expect(h.cells[1]![0]).toBe(0);
  });

  test("in-order passes see earlier outputs; probability 0 never fires", () => {
    const g = makeGrid(1, 3);
    g.cells[0]![0] = 1;
    const chain: TerrainRulePass = {
      inOrder: true,
      rules: [
        { cells: [[0, 0, 1, OUT.none], [0, 1, MATCH.empty, 2]] },
        { cells: [[0, 1, 2, OUT.none], [0, 2, MATCH.empty, 3]] }, // only matchable after rule 1 wrote 2
        { cells: [[0, 2, 3, 4]], probability: 0 },
      ],
    };
    applyRulePasses(g, [chain], { c0: 0, c1: 0, r0: 0, r1: 2 });
    expect(g.cells).toEqual([[1], [2], [3]]);
  });

  test("Empty output erases", () => {
    const g = makeGrid(1, 1);
    g.cells[0]![0] = 9;
    const erase: TerrainRulePass = { inOrder: false, rules: [{ cells: [[0, 0, 9, OUT.empty]] }] };
    applyRulePasses(g, [erase], { c0: 0, c1: 0, r0: 0, r1: 0 });
    expect(g.cells[0]![0]).toBe(0);
  });
});

describe("lineCells", () => {
  test("covers every cell between two points, inclusive", () => {
    expect(lineCells({ col: 0, row: 0 }, { col: 0, row: 0 })).toEqual([{ col: 0, row: 0 }]);
    expect(lineCells({ col: 0, row: 0 }, { col: 3, row: 0 }).map((c) => c.col)).toEqual([0, 1, 2, 3]);
    const diag = lineCells({ col: 5, row: 5 }, { col: 2, row: 2 });
    expect(diag).toHaveLength(4);
    expect(diag[0]).toEqual({ col: 5, row: 5 });
    expect(diag[3]).toEqual({ col: 2, row: 2 });
  });
});
