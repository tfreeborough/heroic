/**
 * The Desk without the page.
 *
 *   bun cli.ts sync <game> [--offline] [--add <file>…]   # Drive → footage dir, probe, sidecars
 *   bun cli.ts games                                       # what's registered
 *   bun cli.ts audition <game> <script id> [--seeds 6 | --seeds 5,77,901] [--from 60] [--for 45]
 *                                                          # the same edit scored for several seeds, a window of each (desk-score-variety.md)
 */
import { audition, auditionSeeds } from "./lib/audition";
import { GAMES, gameById } from "./games";
import { syncFootage } from "./lib/footage";
import { readScript } from "./lib/scriptsStore";

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "games" || !cmd) {
  for (const g of GAMES) console.log(`${g.id.padEnd(10)} ${g.name}  (${g.root})`);
} else if (cmd === "sync") {
  const g = gameById(rest[0] ?? "");
  if (!g) {
    console.error(`unknown game "${rest[0]}" — one of: ${GAMES.map((x) => x.id).join(", ")}`);
    process.exit(1);
  }
  const addAt = rest.indexOf("--add");
  const r = await syncFootage(g, { offline: rest.includes("--offline"), add: addAt >= 0 ? rest.slice(addAt + 1).filter((a) => !a.startsWith("--")) : [] });
  console.log(r.log);
  process.exit(r.ok ? 0 : 1);
} else if (cmd === "audition") {
  const g = gameById(rest[0] ?? "");
  const id = rest[1] ?? "";
  if (!g || !id) {
    console.error(`usage: bun cli.ts audition <game> <script id> [--seeds 6] [--from 60] [--for 45]  (games: ${GAMES.map((x) => x.id).join(", ")})`);
    process.exit(1);
  }
  const opt = (name: string, fallback: string) => {
    const at = rest.indexOf(`--${name}`);
    return at >= 0 ? (rest[at + 1] ?? fallback) : fallback;
  };
  const seedsArg = opt("seeds", "6");
  const seeds = seedsArg.includes(",") ? seedsArg.split(",").map((x) => Number(x.trim())).filter((x) => x > 0) : auditionSeeds(readScript(g, id)?.scoreSeed, Math.max(1, Number(seedsArg) || 6));
  const { dir } = audition(g, id, { seeds, from: Number(opt("from", "60")) || 0, seconds: Number(opt("for", "45")) || 45 }, (line) => console.log(line));
  console.log(`\n${dir}/labels.txt`);
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(1);
}
