#!/usr/bin/env bun
/**
 * Writes a journey (src/journey.ts): a plan in, a WAV out. The Desk runs
 * this in its own process (minutes of maths would freeze its server).
 *
 *   bun scripts/journey.ts --plan plan.json --seed 7 --out score.wav
 *
 * Prints the score's one-line label, then how long it took.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { type JourneyPlan, journey, render, wav } from "../src/index";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
const planFile = args.get("plan");
const out = args.get("out");
if (!planFile || !out) {
  console.error("usage: bun scripts/journey.ts --plan plan.json --seed N --out score.wav");
  process.exit(1);
}
const plan = JSON.parse(readFileSync(planFile, "utf8")) as JourneyPlan;
const seed = Number(args.get("seed")) || 1;
const t0 = performance.now();
const score = journey(seed, plan);
console.log(score.label);
writeFileSync(out, wav(render(score, seed)));
console.log(`${plan.seconds.toFixed(0)}s of music in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
