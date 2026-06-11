import { cellKey, type Grid, type GridCell } from "./grid";

export interface AStarOptions {
  /** Allow 8-directional movement (with corner-cutting prevention). Default false. */
  diagonal?: boolean;
}

interface HeapNode {
  key: number;
  x: number;
  y: number;
  f: number;
}

/** Tiny binary min-heap keyed on `f`. Keeps A* near O(E log V) on large maps. */
class MinHeap {
  private readonly data: HeapNode[] = [];

  get size(): number {
    return this.data.length;
  }

  push(node: HeapNode): void {
    const d = this.data;
    d.push(node);
    let i = d.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (d[parent]!.f <= d[i]!.f) break;
      [d[parent]!, d[i]!] = [d[i]!, d[parent]!];
      i = parent;
    }
  }

  pop(): HeapNode | undefined {
    const d = this.data;
    const top = d[0];
    const last = d.pop();
    if (d.length > 0 && last) {
      d[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < d.length && d[l]!.f < d[smallest]!.f) smallest = l;
        if (r < d.length && d[r]!.f < d[smallest]!.f) smallest = r;
        if (smallest === i) break;
        [d[smallest]!, d[i]!] = [d[i]!, d[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

const CARDINAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * A* over a uniform grid. Returns the path *including* start and goal, or an
 * empty array when no path exists. Deterministic: same inputs → same path.
 */
export const findPath = (
  grid: Grid,
  start: GridCell,
  goal: GridCell,
  options: AStarOptions = {},
): GridCell[] => {
  if (!grid.isWalkable(start.x, start.y) || !grid.isWalkable(goal.x, goal.y)) {
    return [];
  }

  const dirs = options.diagonal ? [...CARDINAL, ...DIAGONAL] : CARDINAL;
  // Octile heuristic for diagonal movement, Manhattan otherwise.
  const heuristic = (x: number, y: number): number => {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    return options.diagonal
      ? Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
      : dx + dy;
  };

  const open = new MinHeap();
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const coords = new Map<number, GridCell>();

  const startKey = cellKey(start.x, start.y);
  gScore.set(startKey, 0);
  coords.set(startKey, start);
  open.push({ key: startKey, x: start.x, y: start.y, f: heuristic(start.x, start.y) });

  const goalKey = cellKey(goal.x, goal.y);

  while (open.size > 0) {
    const current = open.pop()!;
    if (current.key === goalKey) {
      return reconstruct(cameFrom, coords, goalKey);
    }
    const currentG = gScore.get(current.key)!;

    for (const [dx, dy] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!grid.isWalkable(nx, ny)) continue;
      // Prevent cutting across blocked corners on diagonal moves.
      if (dx !== 0 && dy !== 0) {
        if (!grid.isWalkable(current.x + dx, current.y) || !grid.isWalkable(current.x, current.y + dy)) {
          continue;
        }
      }
      const stepCost = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      const tentativeG = currentG + stepCost;
      const nKey = cellKey(nx, ny);
      const known = gScore.get(nKey);
      if (known === undefined || tentativeG < known) {
        cameFrom.set(nKey, current.key);
        gScore.set(nKey, tentativeG);
        coords.set(nKey, { x: nx, y: ny });
        open.push({ key: nKey, x: nx, y: ny, f: tentativeG + heuristic(nx, ny) });
      }
    }
  }

  return [];
};

const reconstruct = (
  cameFrom: Map<number, number>,
  coords: Map<number, GridCell>,
  goalKey: number,
): GridCell[] => {
  const path: GridCell[] = [];
  let key: number | undefined = goalKey;
  while (key !== undefined) {
    path.push(coords.get(key)!);
    key = cameFrom.get(key);
  }
  return path.reverse();
};
