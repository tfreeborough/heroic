/**
 * Render the store listing stills into out/store/: the 1024×500 feature
 * graphic and one 1080×1920 screenshot per entry in src/data/store.ts.
 * `--only 03-crowd,feature,dev-note` to re-render a subset.
 */
import { mkdirSync } from "node:fs";
import { STORE_SHOTS } from "../src/data/store";

const onlyArg = process.argv.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? new Set((onlyArg.split("=")[1] ?? process.argv[process.argv.indexOf(onlyArg) + 1] ?? "").split(","))
  : null;

mkdirSync("out/store", { recursive: true });

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

if (!only || only.has("feature")) still("FeatureGraphic", "out/store/feature-graphic-1024x500.png");
for (const shot of STORE_SHOTS) {
  if (only && !only.has(shot.slug)) continue;
  still("StoreShot", `out/store/${shot.slug}.png`, shot);
}
if (!only || only.has("dev-note")) still("DevNote", "out/store/07-dev-note.png");
console.log("\n✓ out/store/");
