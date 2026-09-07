/**
 * Team factions (docs/design/bits-bot-backfill.md § team identity). A room's
 * two sides get a NAME the moment the room is created, stable until it closes
 * — a rematch is almost always the same people, so the names shouldn't churn
 * under them. The name is the ABSOLUTE identity (both players agree "team 1
 * is The Scorpions"); COLOUR is the relative allegiance cue (your side blue,
 * the enemy red, in lobby and match alike). So the pool is deliberately
 * COLOUR-NEUTRAL — no crimson/azure/red/blue — or a faction would clash with
 * the side it renders on.
 *
 * Desert-and-arena flavour to sit under Blood in the Sand: fauna of the
 * wastes, the sand and its weather, and the pit's own grim honorifics.
 */
export const TEAM_NAMES: readonly string[] = [
  // ── Beasts of the waste ──
  "The Scorpions",
  "The Vipers",
  "The Asps",
  "The Cobras",
  "The Sidewinders",
  "The Adders",
  "The Serpents",
  "The Basilisks",
  "The Jackals",
  "The Hyenas",
  "The Fennecs",
  "The Desert Wolves",
  "The Vultures",
  "The Buzzards",
  "The Ravens",
  "The Falcons",
  "The Desert Hawks",
  "The Locusts",
  "The Scarabs",
  "The Monitors",
  "The Thornbacks",
  "The Sand-Fleas",
  // ── The sand and its weathers ──
  "Sons of the Dust",
  "The Ash-Walkers",
  "The Sandborn",
  "The Dune-Wraiths",
  "The Duneskippers",
  "The Sand-Reavers",
  "The Mirage",
  "The Sirocco",
  "The Simoom",
  "The Khamsin",
  "The Sunspears",
  "The Sunstruck",
  "The Sunblind",
  "The Scorched",
  "The Parched",
  "The Bone-Dry",
  "The Embers",
  "The Cinders",
  "The Saltborn",
  "The Sandsea",
  "Sons of the Waste",
  "The Quicksands",
  "The Grit",
  "The Wanderers",
  // ── Honorifics of the pit ──
  "The Unbroken",
  "The Undefeated",
  "The Deathless",
  "The Damned",
  "The Doomed",
  "The Fallen",
  "The Chained",
  "The Manacled",
  "The Ironbound",
  "The Branded",
  "The Condemned",
  "The Freedmen",
  "The Nameless",
  "The Scarred",
  "The Maimed",
  "The Shieldless",
  "The Bladeborn",
  "The Netmen",
  "The Butchers",
  "The Reavers",
  "The Marauders",
  "The Relentless",
  "The Merciless",
  "The Savages",
  "The Bloodsworn",
  "The Vanquishers",
  "The Warlords",
  "The Pit-Kings",
  "The Sandkings",
  "The Champions",
];

/**
 * `count` distinct faction names for a room, derived purely from its seed —
 * no draw on the gameplay RNG stream (team-name choice must never perturb
 * spawn coin-flips), and fully reproducible: same seed → same names, so a
 * replay/restore rebuilds them identically. `[team 1, …, team count]`.
 * The first two picks match the historical 2-team pairing exactly; further
 * teams (Brawl's six) walk on from there with a seed-derived stride, skipping
 * anything already taken.
 */
export const pickTeamNames = (seed: number, count = 2): string[] => {
  const n = TEAM_NAMES.length;
  const a = ((seed % n) + n) % n; // normalise negatives
  // A second index off an independent slice of the seed, nudged clear of `a`.
  let b = ((Math.floor(seed / n) % n) + n + 1) % n;
  if (b === a) b = (b + 1) % n;
  const picked = [a, b];
  // Stride ≥ 1 off a MIXED seed (not a plain high-bits slice: small seeds
  // would all stride 1, and adjacent list entries read as lazy) — with the
  // used-skip any stride yields distinct picks.
  const h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const stride = (h % (n - 1)) + 1;
  while (picked.length < Math.min(count, n)) {
    let next = (picked[picked.length - 1]! + stride) % n;
    while (picked.includes(next)) next = (next + 1) % n;
    picked.push(next);
  }
  return picked.slice(0, count).map((i) => TEAM_NAMES[i]!);
};
