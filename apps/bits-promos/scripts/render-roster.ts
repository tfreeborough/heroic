/**
 * Batch-render a spotlight video for every weapon and ability into out/.
 * ~23 videos; grab a coffee. Filter with e.g. `--only sinkhole,harpoon`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import roster from "../src/data/roster.json";

const clipsDir = join(import.meta.dir, "../public/clips");
/** Seconds of footage per spotlight and how far ahead of the fight to cut in. */
const CLIP_SECONDS = 8;
const PRE_FIGHT_LEAD = 0.8;

/** Captured footage for this item (scripts/capture.ts), if any. */
const clipProps = (kind: string, id: string): Record<string, unknown> => {
  const file = `${kind}-${id}.mp4`;
  if (!existsSync(join(clipsDir, file))) return {};
  let fightStartsAt = 0;
  try {
    fightStartsAt = (JSON.parse(readFileSync(join(clipsDir, `${kind}-${id}.json`), "utf8")) as { fightStartsAt?: number }).fightStartsAt ?? 0;
  } catch {}
  return { clip: file, clipSeconds: CLIP_SECONDS, clipStartFrom: Math.max(0, fightStartsAt - PRE_FIGHT_LEAD) };
};

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
  const props: Record<string, unknown> = { kind, id, ...clipProps(kind, id) };
  console.log(`\n▶ ${out}${props.clip ? " (with footage)" : " (card only — no clip captured)"}`);
  const proc = Bun.spawnSync(
    [
      "bunx",
      "remotion",
      "render",
      comp,
      out,
      `--props=${JSON.stringify(props)}`,
    ],
    { cwd: `${import.meta.dir}/..`, stdout: "inherit", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) {
    console.error(`render failed for ${id}`);
    process.exit(proc.exitCode ?? 1);
  }
}
console.log(`\n✔ rendered ${jobs.length} videos into out/`);
