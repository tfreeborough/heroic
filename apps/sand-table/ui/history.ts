/** Undo for the elements list: whole snapshots (they're small; arrays share untouched elements). */
import type { Element } from "../lib/scene";

export class History {
  private past: Element[][] = [];
  private future: Element[][] = [];
  push(before: Element[]) {
    this.past.push(before);
    if (this.past.length > 300) this.past.shift();
    this.future = [];
  }
  undo(current: Element[]): Element[] | undefined {
    const prev = this.past.pop();
    if (!prev) return undefined;
    this.future.push(current);
    return prev;
  }
  redo(current: Element[]): Element[] | undefined {
    const next = this.future.pop();
    if (!next) return undefined;
    this.past.push(current);
    return next;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
