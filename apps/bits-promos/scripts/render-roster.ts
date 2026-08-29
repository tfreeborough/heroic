/**
 * Batch-render a spotlight video for every weapon and ability into out/.
 * ~23 videos; grab a coffee. Filter with e.g. `--only sinkhole,harpoon`.
 */
import roster from "../src/data/roster.json";

const onlyArg = process.argv.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? new Set((onlyArg.split("=")[1] ?? process.argv[process.argv.indexOf(onlyArg) + 1] ?? "").split(","))
  : null;

const jobs: { comp: string; kind: string; id: string }[] = [
  ...roster.weapons.map((w) => ({ comp: "WeaponSpotlight", kind: "weapon", id: w.id })),
  ...roster.abilities.map((a) => ({ comp: "AbilitySpotlight", kind: "ability", id: a.id })),
].filter((j) => !only || only.has(j.id));

for (const { comp, kind, id } of jobs) {
  const out = `out/${kind}-${id}.mp4`;
  console.log(`\n▶ ${out}`);
  const proc = Bun.spawnSync(
    [
      "bunx",
      "remotion",
      "render",
      comp,
      out,
      `--props=${JSON.stringify({ kind, id })}`,
    ],
    { cwd: `${import.meta.dir}/..`, stdout: "inherit", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) {
    console.error(`render failed for ${id}`);
    process.exit(proc.exitCode ?? 1);
  }
}
console.log(`\n✔ rendered ${jobs.length} videos into out/`);
