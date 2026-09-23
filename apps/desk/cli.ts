/**
 * The Desk without the page.
 *
 *   bun cli.ts sync <game> [--offline] [--add <file>…]   # Drive → footage dir, probe, sidecars
 *   bun cli.ts games                                       # what's registered
 */
import { GAMES, gameById } from "./games";
import { syncFootage } from "./lib/footage";

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
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(1);
}
