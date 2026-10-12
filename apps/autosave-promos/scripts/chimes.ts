#!/usr/bin/env bun
/**
 * The save chime moved up and down a couple of semitones, so it sits in a
 * generated tune's key (src/music/tune.ts chimeFile): public/sfx/chime-down2.wav
 * … chime-up2.wav. Pitched by resampling (slower = lower), not time-stretched:
 * Remotion's playbackRate keeps pitch in a render, so it can't do this.
 *
 *   bun scripts/chimes.ts
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { SR, wav } from "@heroic/music";
import { chimeFile } from "../src/music/tune";

const pub = join(import.meta.dir, "../public");
const r = spawnSync(ffmpegPath!, ["-v", "error", "-i", join(pub, "sfx/chime.mp3"), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 26 });
const chime = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);

for (const shift of [-2, -1, 1, 2]) {
  const rate = 2 ** (shift / 12);
  const n = Math.floor((chime.length - 1) / rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * rate;
    const a = Math.floor(p);
    out[i] = chime[a]! + (chime[a + 1]! - chime[a]!) * (p - a);
  }
  writeFileSync(join(pub, chimeFile(shift)), wav({ l: out, r: out }));
  console.log(chimeFile(shift));
}
