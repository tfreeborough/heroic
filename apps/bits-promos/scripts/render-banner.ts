/**
 * Render the YouTube channel banner into out/banner/: the 2560×1440 upload
 * and a copy with the desktop + phone crops drawn on, for checking only.
 */
import { mkdirSync } from "node:fs";

const dir = "out/banner";
mkdirSync(dir, { recursive: true });

const still = (out: string, props: Record<string, unknown>) => {
  console.log(`\n▶ ${out}`);
  const proc = Bun.spawnSync(
    ["bunx", "remotion", "still", "ChannelBanner", out, "--frame=0", `--props=${JSON.stringify(props)}`],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) {
    console.error(`✗ ${out} failed (exit ${proc.exitCode})`);
    process.exit(proc.exitCode ?? 1);
  }
};

still(`${dir}/youtube-banner-2560x1440.png`, { guides: false });
still(`${dir}/youtube-banner-guides.png`, { guides: true });
console.log(`\n✓ ${dir}/`);
