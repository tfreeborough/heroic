/** What the active tool edits. Left-click applies it; right-click erases/deletes. */
export type Tool = "floor" | "decor" | "collision" | "breakable" | "object";

export type PointerPhase = "down" | "drag" | "up";
export type PointerButton = "left" | "right";

/** A box corner, for resize-handle drags. */
export type Corner = "nw" | "ne" | "sw" | "se";

/** A normalized editing pointer event the viewport emits and App interprets per-tool. */
export interface EditPointer {
  phase: PointerPhase;
  button: PointerButton;
  /** World-space cursor position. */
  wx: number;
  wy: number;
  /** Tile cell under the cursor. */
  col: number;
  row: number;
  /** Set when this drag began on a resize handle of the selected box. */
  handle?: Corner;
}

/** The currently selected entity (for highlight + delete). */
export interface Selection {
  type: "breakable" | "object";
  id: string;
}
