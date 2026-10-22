/**
 * Render the store listing into out/store/: the 1024×500 feature graphic
 * and one 1080×1920 screenshot per entry in src/data/store.ts, plus the
 * dev-note card.
 * `--only 03-one-life,feature,dev-note` to re-render a subset.
 * `--apple` renders the screenshots at 1284×2778 (App Store Connect's
 * 6.5" iPhone slot) into out/store/apple/ — no feature graphic there.
 * `--video` renders the store preview instead: out/store/video/
 * app-preview-886x1920.mp4 (App Store Connect, every iPhone class) and
 * play-promo-1920x1080.mp4 (upload to YouTube unlisted, paste the link
 * into Play Console). `--video --only apple|play` for one of them.
 * `--assets` renders Apple's Asset Library placements into
 * out/store/apple-assets/: the 21:9 product page header and the 3:2 search
 * results card, each as a still and a looping video. `--assets --only
 * header|search`.
 */
import { mkdirSync } from "node:fs";
import { STORE_SHOTS } from "../src/data/store";

const onlyArg = process.argv.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? new Set((onlyArg.split("=")[1] ?? process.argv[process.argv.indexOf(onlyArg) + 1] ?? "").split(","))
  : null;

const apple = process.argv.includes("--apple");
const video = process.argv.includes("--video");
const assets = process.argv.includes("--assets");

const run = (args: string[], out: string) => {
  console.log(`\n▶ ${out}`);
  const proc = Bun.spawnSync(["bunx", "remotion", ...args], { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) {
    console.error(`✗ ${out} failed (exit ${proc.exitCode})`);
    process.exit(proc.exitCode ?? 1);
  }
};
const still = (comp: string, out: string, props?: Record<string, unknown>) =>
  run(["still", comp, out, "--frame=0", ...(props ? [`--props=${JSON.stringify(props)}`] : [])], out);

if (video) {
  // Apple: H.264, ≤30fps (FPS is 30), 10–12 Mbps target, AAC 256k, ≤500MB.
  // YouTube takes anything; the same settings keep it crisp.
  const dir = "out/store/video";
  mkdirSync(dir, { recursive: true });
  const render = (comp: string, out: string) => run(["render", comp, out, "--codec=h264", "--video-bitrate=10M", "--audio-bitrate=256k", "--audio-codec=aac"], out);
  if (!only || only.has("apple")) render("StorePreviewApple", `${dir}/app-preview-886x1920.mp4`);
  if (!only || only.has("play")) render("StorePreviewPlay", `${dir}/play-promo-1920x1080.mp4`);
  console.log(`\n✓ ${dir}/`);
  process.exit(0);
}

if (assets) {
  // Apple's Asset Library: 30fps H.264 processes fine (tested up to 45 Mbps);
  // these are 3840 wide so the bitrate is double the preview's.
  const dir = "out/store/apple-assets";
  mkdirSync(dir, { recursive: true });
  const render = (comp: string, out: string) => run(["render", comp, out, "--codec=h264", "--video-bitrate=20M", "--audio-bitrate=256k", "--audio-codec=aac"], out);
  if (!only || only.has("header")) {
    still("StoreHeaderStill", `${dir}/header-3840x1646.png`);
    render("StoreHeader", `${dir}/header-3840x1646.mp4`);
  }
  if (!only || only.has("search")) {
    still("StoreSearchStill", `${dir}/search-3840x2560.png`);
    render("StoreSearch", `${dir}/search-3840x2560.mp4`);
  }
  console.log(`\n✓ ${dir}/`);
  process.exit(0);
}

const dir = apple ? "out/store/apple" : "out/store";
const suffix = apple ? "Apple" : "";
mkdirSync(dir, { recursive: true });

if (!apple && (!only || only.has("feature"))) still("FeatureGraphic", `${dir}/feature-graphic-1024x500.png`);
for (const shot of STORE_SHOTS) {
  if (only && !only.has(shot.slug)) continue;
  still(`StoreShot${suffix}`, `${dir}/${shot.slug}.png`, shot);
}
if (!only || only.has("dev-note")) still(`DevNote${suffix}`, `${dir}/09-dev-note.png`);
console.log(`\n✓ ${dir}/`);
