/**
 * Print a showcase script's beat sheet without the simulator — every hp
 * change, cast, shot, death and the round end, stamped in seconds since
 * FIGHT. Same seed and staging as the capture, so it IS the take.
 *
 *   bun scripts/dry-run.ts --kind weapon --id staff [--seconds 12]
 */
import { simulateShowcase } from "./lib/showcaseTimeline";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const kind = flag("kind");
const id = flag("id");
if ((kind !== "weapon" && kind !== "ability") || !id) {
  console.error("usage: dry-run --kind weapon|ability --id <id> [--seconds N]");
  process.exit(2);
}
const tl = simulateShowcase(kind, id, Number(flag("seconds") ?? 12));
const name = (seat: number) => `${seat === 0 ? "STAR" : "foe"}#${seat}`;
console.log(`${kind}/${id}: ${tl.seats.map((s) => `${name(s.seat)}=${s.weapon}[${s.abilities.join(",")}] hp${s.hp}`).join("  ")}`);
const lines: { t: number; text: string }[] = tl.cues.map((c) => {
  switch (c.kind) {
    case "cast":
      return { t: c.t, text: `${name(c.seat)} casts ${c.ability}` };
    case "fire":
      return { t: c.t, text: `${name(c.seat)} fires ${c.weapon}` };
    case "hit":
      return { t: c.t, text: `${name(c.seat)} hit by ${c.weapon} (-${c.amount})` };
    case "death":
      return { t: c.t, text: `${name(c.seat)} DEAD${c.byStar ? " — the star's kill" : ""}` };
    case "roundEnd":
      return { t: c.t, text: `ROUND ${c.starWon ? "WON" : "LOST"}` };
  }
});
for (const tr of tl.trace) {
  lines.push({ t: tr.t, text: `  ${tr.pos.map((p) => `${name(p.seat)}(${p.x},${p.y})`).join(" ")} shots=${tr.shots}` });
}
lines.sort((a, b) => a.t - b.t);
for (const l of lines) console.log(`t=${l.t.toFixed(2)}  ${l.text}`);
console.log(`END t=${tl.end.toFixed(2)}`);
