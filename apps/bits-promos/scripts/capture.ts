/**
 * Hands-free gameplay capture for the spotlights.
 *
 *   bun scripts/capture.ts --kind ability --id sinkhole [--seconds 20]
 *   bun scripts/capture.ts --all                       # every weapon + ability
 *
 * Needs: a booted iOS Simulator with the dev app installed
 * (`bun run --cwd apps/blood-in-the-sand ios` once) and Metro running with
 * the showcase link enabled:
 *
 *   EXPO_PUBLIC_SHOWCASE=1 bun run --cwd apps/blood-in-the-sand start
 *
 * Each capture opens `bloodinthesand://showcase?...` (src/net/showcase.ts):
 * an offline match where every seat plays the item's choreographed script
 * (src/net/showcaseScripts.ts — no bot brains), then records the simulator
 * screen into public/clips/<kind>-<id>.mp4 plus a sidecar .json noting when
 * the fight starts, which render-roster uses to trim the lobby beat.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import roster from "../src/data/roster.json";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq?.split("=")[1];
};
const has = (name: string) => args.includes(`--${name}`);

const seconds = Number(flag("seconds") ?? 20);
const clipsDir = join(import.meta.dir, "../public/clips");

/** Lobby clamp (1s) + the 3-2-1 countdown + app/link latency, in seconds. */
const FIGHT_STARTS_AT = 4.8;

const sh = (cmd: string[], opts: { quiet?: boolean } = {}) => {
  const p = Bun.spawnSync(cmd, { stdout: opts.quiet ? "pipe" : "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")} → exit ${p.exitCode}`);
  return p.stdout?.toString() ?? "";
};

const bootedUdid = (): string => {
  const out = sh(["xcrun", "simctl", "list", "devices", "booted", "-j"], { quiet: true });
  const json = JSON.parse(out) as { devices: Record<string, { udid: string; state: string; name: string }[]> };
  const booted = Object.values(json.devices).flat().find((d) => d.state === "Booted");
  if (!booted) {
    throw new Error("no booted simulator — open Simulator.app (or `xcrun simctl boot <name>`) and launch the dev app first");
  }
  console.log(`simulator: ${booted.name}`);
  return booted.udid;
};

/** The item's script decides every seat's kit and blocking — the link just
 * names the item. */
const showcaseUrl = (kind: "weapon" | "ability", id: string): string =>
  `bloodinthesand://showcase?${kind === "weapon" ? "weapon" : "feature"}=${encodeURIComponent(id)}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * iOS confirms custom-scheme links opened from outside the app ("Open in
 * Blood (Dev)?"). Return on the hardware keyboard accepts it; when no prompt
 * is up the keystroke lands on the app, which has no text field — harmless.
 * Needs Accessibility permission for your terminal (System Settings →
 * Privacy & Security → Accessibility); without it, tap Open by hand.
 */
const acceptOpenPrompt = (): void => {
  const p = Bun.spawnSync(
    ["osascript", "-e", 'tell application "Simulator" to activate', "-e", 'tell application "System Events" to keystroke return'],
    { stdout: "ignore", stderr: "pipe" },
  );
  if (p.exitCode !== 0) console.warn("  (couldn't auto-accept the Open prompt — tap Open in the simulator)");
};

const capture = async (udid: string, kind: "weapon" | "ability", id: string): Promise<void> => {
  const out = join(clipsDir, `${kind}-${id}.mp4`);
  console.log(`\n▶ ${kind}/${id} → ${out}`);
  sh(["xcrun", "simctl", "openurl", udid, showcaseUrl(kind, id)]);
  await sleep(700);
  acceptOpenPrompt();
  const rec = Bun.spawn(
    ["xcrun", "simctl", "io", udid, "recordVideo", "--codec", "h264", "--force", out],
    { stdout: "ignore", stderr: "inherit" },
  );
  await sleep(seconds * 1000);
  rec.kill("SIGINT"); // simctl finalises the file on SIGINT
  await rec.exited;
  if (!existsSync(out)) throw new Error(`recording missing: ${out}`);
  writeFileSync(
    join(clipsDir, `${kind}-${id}.json`),
    JSON.stringify({ fightStartsAt: FIGHT_STARTS_AT, seconds }, null, 2) + "\n",
  );
};

const jobs: { kind: "weapon" | "ability"; id: string }[] = has("all")
  ? [
      ...roster.weapons.map((w) => ({ kind: "weapon" as const, id: w.id })),
      ...roster.abilities.map((a) => ({ kind: "ability" as const, id: a.id })),
    ]
  : (() => {
      const kind = flag("kind");
      const id = flag("id");
      if ((kind !== "weapon" && kind !== "ability") || !id) {
        console.error(
          "usage: capture --kind weapon|ability --id <id> [--seconds N] | --all",
        );
        process.exit(2);
      }
      return [{ kind, id }];
    })();

const udid = bootedUdid();
// A clean status bar for every clip (9:41, full battery — Apple's own convention).
sh(["xcrun", "simctl", "status_bar", udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--wifiBars", "3", "--cellularBars", "4"]);
for (const job of jobs) await capture(udid, job.kind, job.id);
console.log(`\n✔ captured ${jobs.length} clip(s) into public/clips/ — now \`bun run render:roster\``);
