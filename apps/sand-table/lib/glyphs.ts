/**
 * The glyph library: simple diagram pictures (a server, a phone, a cloud…)
 * described as primitives in a 100×100 box. The board renders them through
 * the same hand-drawn pen as everything else, in the element's colours, so
 * they always match the drawing around them. Pure data.
 */
export type Prim =
  | { k: "rect"; x: number; y: number; w: number; h: number; fill?: boolean }
  | { k: "ellipse"; cx: number; cy: number; w: number; h: number; fill?: boolean }
  | { k: "line"; pts: [number, number][] }
  | { k: "poly"; pts: [number, number][]; fill?: boolean };

export type Glyph = { id: string; label: string; prims: Prim[]; /** Natural aspect, width / height. */ aspect?: number };

const r = (x: number, y: number, w: number, h: number, fill = false): Prim => ({ k: "rect", x, y, w, h, fill });
const e = (cx: number, cy: number, w: number, h: number, fill = false): Prim => ({ k: "ellipse", cx, cy, w, h, fill });
const l = (...pts: [number, number][]): Prim => ({ k: "line", pts });
const p = (fill: boolean, ...pts: [number, number][]): Prim => ({ k: "poly", pts, fill });

export const GLYPHS: Glyph[] = [
  { id: "server", label: "Server", aspect: 0.7, prims: [r(10, 4, 80, 28), r(10, 36, 80, 28), r(10, 68, 80, 28), e(24, 18, 8, 8, true), e(24, 50, 8, 8, true), e(24, 82, 8, 8, true), l([40, 18], [78, 18]), l([40, 50], [78, 50]), l([40, 82], [78, 82])] },
  { id: "phone", label: "Phone", aspect: 0.5, prims: [r(14, 2, 72, 96), r(22, 12, 56, 70), e(50, 90, 8, 8)] },
  { id: "laptop", label: "Laptop", aspect: 1.4, prims: [r(14, 10, 72, 54), r(20, 16, 60, 42, true), l([4, 72], [96, 72]), l([4, 72], [10, 84], [90, 84], [96, 72])] },
  { id: "cloud", label: "Cloud", aspect: 1.5, prims: [p(false, [20, 75], [10, 65], [12, 50], [25, 45], [28, 30], [45, 22], [60, 28], [75, 25], [88, 38], [85, 52], [95, 62], [88, 76])] },
  { id: "globe", label: "Globe", prims: [e(50, 50, 90, 90), e(50, 50, 40, 90), l([5, 50], [95, 50]), l([12, 28], [88, 28]), l([12, 72], [88, 72])] },
  { id: "bolt", label: "Bolt", aspect: 0.6, prims: [p(true, [58, 2], [20, 55], [46, 55], [38, 98], [80, 40], [54, 40])] },
  { id: "clock", label: "Clock", prims: [e(50, 50, 90, 90), l([50, 50], [50, 18]), l([50, 50], [72, 60])] },
  { id: "hourglass", label: "Hourglass", aspect: 0.7, prims: [l([15, 5], [85, 5]), l([15, 95], [85, 95]), l([20, 5], [20, 20], [50, 50], [20, 80], [20, 95]), l([80, 5], [80, 20], [50, 50], [80, 80], [80, 95]), p(true, [30, 78], [70, 78], [50, 60])] },
  { id: "skull", label: "Skull", prims: [e(50, 42, 70, 64), r(32, 68, 36, 24), e(36, 40, 16, 18, true), e(64, 40, 16, 18, true), p(true, [50, 52], [44, 62], [56, 62]), l([40, 92], [40, 80]), l([50, 92], [50, 80]), l([60, 92], [60, 80])] },
  { id: "swords", label: "Swords", prims: [l([12, 12], [84, 84]), l([88, 12], [16, 84]), l([70, 84], [84, 84], [84, 70]), l([30, 84], [16, 84], [16, 70]), l([12, 20], [20, 12]), l([80, 12], [88, 20])] },
  { id: "shield", label: "Shield", aspect: 0.85, prims: [p(false, [50, 4], [90, 18], [86, 58], [50, 96], [14, 58], [10, 18]), l([50, 14], [50, 86])] },
  { id: "crown", label: "Crown", aspect: 1.3, prims: [p(false, [10, 80], [8, 30], [32, 52], [50, 16], [68, 52], [92, 30], [90, 80]), r(10, 80, 80, 12)] },
  { id: "coin", label: "Coin", prims: [e(50, 50, 88, 88), e(50, 50, 64, 64), l([50, 32], [50, 68]), l([40, 40], [60, 40]), l([40, 60], [60, 60])] },
  { id: "heart", label: "Heart", prims: [p(true, [50, 92], [10, 50], [10, 28], [25, 12], [40, 14], [50, 28], [60, 14], [75, 12], [90, 28], [90, 50])] },
  { id: "eye", label: "Eye", aspect: 1.6, prims: [p(false, [4, 50], [30, 18], [70, 18], [96, 50], [70, 82], [30, 82]), e(50, 50, 32, 32), e(50, 50, 12, 12, true)] },
  { id: "person", label: "Person", aspect: 0.6, prims: [e(50, 20, 32, 32), l([50, 36], [50, 70]), l([18, 50], [82, 50]), l([50, 70], [24, 98]), l([50, 70], [76, 98])] },
  { id: "tick", label: "Tick", prims: [l([12, 55], [40, 84], [90, 18])] },
  { id: "cross", label: "Cross", prims: [l([16, 16], [84, 84]), l([84, 16], [16, 84])] },
  { id: "question", label: "Question", aspect: 0.6, prims: [l([20, 30], [26, 14], [50, 6], [76, 14], [80, 34], [60, 54], [50, 62], [50, 74]), e(50, 90, 10, 10, true)] },
  { id: "bang", label: "Bang", aspect: 0.4, prims: [l([50, 6], [50, 66]), e(50, 88, 12, 12, true)] },
  { id: "loop", label: "Loop", prims: [l([80, 36], [66, 18], [40, 16], [18, 38], [18, 62], [40, 84], [66, 82], [80, 64]), l([80, 20], [80, 40], [60, 40]), l([20, 80], [20, 60], [40, 60])] },
  { id: "lock", label: "Lock", aspect: 0.8, prims: [r(14, 44, 72, 52), l([30, 44], [30, 26], [40, 12], [60, 12], [70, 26], [70, 44]), e(50, 68, 12, 12, true), l([50, 72], [50, 84])] },
  { id: "flag", label: "Flag", aspect: 0.8, prims: [l([16, 4], [16, 98]), p(true, [16, 8], [88, 16], [70, 40], [88, 62], [16, 56])] },
  { id: "bomb", label: "Bomb", prims: [e(44, 62, 68, 68), l([62, 32], [72, 18], [84, 12]), p(true, [84, 4], [92, 8], [88, 18], [78, 14])] },
];

export const glyphById = (id: string): Glyph | undefined => GLYPHS.find((g) => g.id === id);
