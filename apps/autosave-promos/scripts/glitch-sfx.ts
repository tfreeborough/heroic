#!/usr/bin/env bun
/**
 * The CRT glitch on a save's first frames (and its last): public/sfx/glitch.wav.
 * Written in code, not forged: a degauss thump, then static chopped into
 * stutters with a mains buzz under it, about 0.45s.
 *
 *   bun scripts/glitch-sfx.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SR, wav } from "@heroic/music";

const n = Math.round(0.45 * SR);
const l = new Float32Array(n), r = new Float32Array(n);
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
// Static on/off in short chops, like the picture's dropouts.
const chops = [[0, 0.09], [0.12, 0.2], [0.24, 0.27], [0.31, 0.42]];
let lp = 0, hp = 0;
for (let i = 0; i < n; i++) {
  const t = i / SR;
  const on = chops.some(([a, b]) => t >= a! && t < b!) ? 1 : 0.08;
  // Band-limited hiss: a soft low-pass, minus a slower one.
  const x = rnd();
  lp += (x - lp) * 0.45;
  hp += (lp - hp) * 0.04;
  const hiss = (lp - hp) * on;
  const thump = Math.sin(2 * Math.PI * 55 * t * (1 - t)) * Math.exp(-t * 28) * 0.9;
  const buzz = Math.sign(Math.sin(2 * Math.PI * 100 * t)) * 0.06 * on;
  const fade = Math.min(1, t / 0.002, (0.45 - t) / 0.04);
  const s = (hiss * 0.8 + thump + buzz) * fade * 0.7;
  l[i] = s;
  r[i] = (hiss * 0.8 * (rnd() > -0.9 ? 1 : 0.5) + thump + buzz) * fade * 0.7;
}
writeFileSync(join(import.meta.dir, "../public/sfx/glitch.wav"), wav({ l, r }));
console.log("sfx/glitch.wav");
