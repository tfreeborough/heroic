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
  // Sidecar: `fightStartsAt` (auto captures — the template cuts in 0.8s
  // before it) and/or `clipSeconds` (hand-edited clips: run the whole thing).
  let fightStartsAt = PRE_FIGHT_LEAD;
  let clipSeconds = CLIP_SECONDS;
  const extra: Record<string, unknown> = {};
  try {
    const side = JSON.parse(readFileSync(join(clipsDir, `${kind}-${id}.json`), "utf8")) as {
      fightStartsAt?: number;
      clipSeconds?: number;
      cropTop?: number;
      cropBottom?: number;
      muted?: boolean;
    };
    fightStartsAt = side.fightStartsAt ?? fightStartsAt;
    clipSeconds = side.clipSeconds ?? clipSeconds;
    for (const k of ["cropTop", "cropBottom", "muted"] as const) if (side[k] !== undefined) extra[k] = side[k];
  } catch {}
  return { clip: file, clipSeconds, clipStartFrom: Math.max(0, fightStartsAt - PRE_FIGHT_LEAD), ...extra, ...(music ? { music } : {}) };
};

/** `--music bed.mp3` lays a track from public/music/ under every video. */
const musicArg = process.argv.indexOf("--music");
const music = musicArg >= 0 ? process.argv[musicArg + 1] : undefined;
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
