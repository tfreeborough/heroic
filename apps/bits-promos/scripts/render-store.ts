/**
 * Render the store listing stills into out/store/: the 1024×500 feature
 * graphic and one 1080×1920 screenshot per entry in src/data/store.ts.
 * `--only 03-crowd,feature,dev-note` to re-render a subset.
 * `--apple` renders the screenshots at 1284×2778 (App Store Connect's
 * 6.5" iPhone slot) into out/store/apple/ — no feature graphic there.
 */
import { mkdirSync } from "node:fs";
import { STORE_SHOTS } from "../src/data/store";

const onlyArg = process.argv.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? new Set((onlyArg.split("=")[1] ?? process.argv[process.argv.indexOf(onlyArg) + 1] ?? "").split(","))
  : null;

const apple = process.argv.includes("--apple");
const dir = apple ? "out/store/apple" : "out/store";
const suffix = apple ? "Apple" : "";
mkdirSync(dir, { recursive: true });

const still = (comp: string, out: string, props?: Record<string, unknown>) => {
  console.log(`\n▶ ${out}`);
  const proc = Bun.spawnSync(
    ["bunx", "remotion", "still", comp, out, "--frame=0", ...(props ? [`--props=${JSON.stringify(props)}`] : [])],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) {
    console.error(`✗ ${out} failed (exit ${proc.exitCode})`);
    process.exit(proc.exitCode ?? 1);
  }
};

if (!apple && (!only || only.has("feature"))) still("FeatureGraphic", `${dir}/feature-graphic-1024x500.png`);
for (const shot of STORE_SHOTS) {
  if (only && !only.has(shot.slug)) continue;
  still(`StoreShot${suffix}`, `${dir}/${shot.slug}.png`, shot);
}
if (!only || only.has("dev-note")) still(`DevNote${suffix}`, `${dir}/07-dev-note.png`);
console.log(`\n✓ ${dir}/`);
