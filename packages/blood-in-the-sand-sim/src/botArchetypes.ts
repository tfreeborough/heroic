/**
 * Bot archetypes — behaviour presets derived from the bot's own loadout
 * (docs/design/bot-brains.md, rollout step 3). An archetype is DIALS, not a
 * new brain: the same botThink blends the same micro-behaviours (engage /
 * kite / strafe / anchor / disengage / avoid-ground), and the preset says how
 * hard each one pulls. Archetype decides what the bot is TRYING to do;
 * difficulty (step 4) will decide how well it executes.
 *
 * Derivation is a first-match rule chain, not a scorer — cheap to reason
 * about, deterministic, and each rule reads like the doc's table ("melee +
 * support sticks with teammates" was the founding example).
 */
import { ABILITIES, WEAPONS, type AbilityId, type WeaponId } from "./config";
import type { PlayerSnapshot } from "./protocol";

export type ArchetypeId =
  | "brawler"
  | "juggernaut"
  | "duellist"
  | "trapper"
  | "skirmisher"
  | "sniper"
  | "bodyguard"
  | "opportunist";

export const ARCHETYPE_IDS: readonly ArchetypeId[] = [
  "brawler",
  "juggernaut",
  "duellist",
  "trapper",
  "skirmisher",
  "sniper",
  "bodyguard",
  "opportunist",
];

export interface ArchetypePreset {
  name: string;
  /**
   * Preferred fighting distance as fractions of MY weapon's engagement
   * radius (resolved per-match by resolveBand): retreat inside `near`,
   * advance outside `far`, hold and strafe between. `null` = charge to
   * contact — the melee brains.
   */
  band: { near: number; far: number } | null;
  /** Pull toward the target when out of position (0–1). */
  engage: number;
  /** Orbit strength while holding position in the band / at contact. */
  strafe: number;
  /** Retreat once my hp fraction drops below this (0 = never yields). */
  disengageBelow: number;
  /** Stay within this leash (px) of the nearest living teammate; 0 = lone wolf. */
  anchorLeash: number;
  /** Surge in while the target recovers from a swing — the punish window. */
  punishRecovery: boolean;
  /** Spend dash to close big gaps (contact brains); banded brains hop OUT instead. */
  gapCloseDash: boolean;
  /** Who to hunt: nearest body, weakest enemy, or whoever's on the hurt ally. */
  focus: "nearest" | "weakest" | "protect";
  /** Band applies only behind a ranged weapon — a melee build of this
   * archetype fights at contact (a sword held at 150px never lands a hit). */
  bandRangedOnly?: boolean;
  /** Abandon the band and charge once the target's hp fraction drops below
   * this — the opportunist's dive. */
  diveBelow?: number;
}

export const ARCHETYPES: Record<ArchetypeId, ArchetypePreset> = {
  // All-in engage; sticks to its target for the bleed. Never yields.
  brawler: {
    name: "Brawler",
    band: null,
    engage: 1,
    strafe: 0.15,
    disengageBelow: 0,
    anchorLeash: 0,
    punishRecovery: true,
    gapCloseDash: true,
    focus: "nearest",
  },
  // The patient bully: walks you down at its own pace, never wastes the dash
  // on distance (its hand is armour, its reach out-spaces yours anyway).
  juggernaut: {
    name: "Juggernaut",
    band: null,
    engage: 0.8,
    strafe: 0.1,
    disengageBelow: 0,
    anchorLeash: 0,
    punishRecovery: true,
    gapCloseDash: false,
    focus: "nearest",
  },
  // Dances at the edge of its own reach, dodge-first, dives the recovery.
  duellist: {
    name: "Duellist",
    band: { near: 0.25, far: 0.55 },
    engage: 0.7,
    strafe: 0.8,
    disengageBelow: 0.2,
    anchorLeash: 0,
    punishRecovery: true,
    gapCloseDash: false,
    focus: "nearest",
  },
  // Fights on prepared ground: holds mid-range and drifts its retreats back
  // toward its own mine (the mine-anchor in botThink) so you cross the trap.
  trapper: {
    name: "Trapper",
    band: { near: 0.5, far: 0.75 },
    engage: 0.7,
    strafe: 0.4,
    disengageBelow: 0.35,
    anchorLeash: 0,
    punishRecovery: false,
    gapCloseDash: false,
    focus: "nearest",
    // A melee trapper brawls ON its mine instead of holding a range its
    // sword can't threaten; the mine-anchor drift does the zoning.
    bandRangedOnly: true,
  },
  // The kiting shooter: holds the band edge, re-opens gaps the moment you close.
  skirmisher: {
    name: "Skirmisher",
    band: { near: 0.55, far: 0.8 },
    engage: 0.8,
    strafe: 0.5,
    disengageBelow: 0.3,
    anchorLeash: 0,
    punishRecovery: false,
    gapCloseDash: false,
    focus: "nearest",
  },
  // Max-range extremist: thinnest strafe, longest band, avoids damage at all
  // costs — the "defensive abilities" bow player from the design brief.
  sniper: {
    name: "Sniper",
    band: { near: 0.7, far: 0.92 },
    engage: 0.7,
    strafe: 0.25,
    disengageBelow: 0.5,
    anchorLeash: 0,
    punishRecovery: false,
    gapCloseDash: false,
    focus: "nearest",
  },
  // Sticks with the pack, hunts whoever is on the most-hurt teammate.
  bodyguard: {
    name: "Bodyguard",
    band: null,
    engage: 0.85,
    strafe: 0.2,
    disengageBelow: 0.25,
    anchorLeash: 230,
    punishRecovery: false,
    gapCloseDash: false,
    focus: "protect",
  },
  // The target-discipline brain: lurks just outside reach, dives the weak
  // and the recovering (its harpoon rule already drags in the kiters).
  opportunist: {
    name: "Opportunist",
    band: { near: 0.6, far: 0.9 },
    engage: 0.8,
    strafe: 0.45,
    disengageBelow: 0.25,
    anchorLeash: 0,
    punishRecovery: true,
    gapCloseDash: true,
    focus: "weakest",
    // Lurks just outside reach (threatening the harpoon), then commits the
    // moment the mark is weak enough to finish.
    diveBelow: 0.45,
  },
};

const SUPPORT_COUNT = (abilities: readonly AbilityId[]): number =>
  abilities.filter((a) => ABILITIES[a].category === "support").length;

const DEFENSIVE_COUNT = (abilities: readonly AbilityId[]): number =>
  abilities.filter((a) => ABILITIES[a].category === "defensive").length;

/**
 * Loadout → archetype, first match wins:
 *  1. all-support hand → Bodyguard (the kit only works near allies)
 *  2. a trap (sandtrap/tremor) → Trapper (ground is the gameplan)
 *  3. a harpoon → Opportunist (dragging picks IS the gameplan)
 *  4. ranged: dash → Skirmisher (mobility shooter); a defensive hand →
 *     Sniper (bow turtle; the staff needs a full defensive hand to turtle);
 *     else Skirmisher
 *  5. melee: any support → Bodyguard (Tom's founding example); hammer with
 *     armour → Juggernaut; dash + a second defensive → Duellist; else Brawler
 */
export const deriveArchetype = (weapon: WeaponId | null, abilities: readonly AbilityId[]): ArchetypeId => {
  if (weapon === null) return "brawler";
  const sup = SUPPORT_COUNT(abilities);
  const def = DEFENSIVE_COUNT(abilities);
  const hasDash = abilities.includes("dash");
  if (sup >= 2) return "bodyguard";
  if (abilities.includes("sandtrap") || abilities.includes("tremor")) return "trapper";
  if (abilities.includes("harpoon")) return "opportunist";
  if (WEAPONS[weapon].projectile) {
    if (hasDash) return "skirmisher";
    if (def >= (weapon === "bow" ? 1 : 2)) return "sniper";
    return "skirmisher";
  }
  if (sup >= 1) return "bodyguard";
  if (weapon === "hammer" && def >= 1) return "juggernaut";
  if (hasDash && def >= 2) return "duellist";
  return "brawler";
};

/** The preset's band in world px, resolved against my weapon's acquisition
 * edge — so a skirmisher's "80%" means "my shots connect, theirs don't". */
export const resolveBand = (
  preset: ArchetypePreset,
  weapon: WeaponId | null,
): { near: number; far: number } | null => {
  if (!preset.band) return null;
  if (preset.bandRangedOnly && (weapon === null || !WEAPONS[weapon].projectile)) return null;
  const engagement = weapon === null ? 160 : WEAPONS[weapon].engagementRadius;
  return { near: preset.band.near * engagement, far: preset.band.far * engagement };
};

/**
 * Archetype-flavoured target selection. `nearest` is the shared dogpile rule;
 * `weakest` hunts the lowest hp fraction (distance breaks ties); `protect`
 * hunts whoever is closest to my most-hurt living teammate — which, blended
 * with the anchor leash, IS the peel: the bodyguard moves at the diver.
 */
export const focusTarget = (
  preset: ArchetypePreset,
  me: PlayerSnapshot,
  players: PlayerSnapshot[],
): PlayerSnapshot | undefined => {
  const enemies = players.filter((p) => p.team !== me.team && p.alive);
  if (enemies.length === 0) return undefined;
  const distTo = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y);

  if (preset.focus === "weakest") {
    let best = enemies[0]!;
    for (const e of enemies) {
      const eFrac = e.hp / Math.max(1, e.maxHp);
      const bFrac = best.hp / Math.max(1, best.maxHp);
      if (eFrac < bFrac || (eFrac === bFrac && distTo(me, e) < distTo(me, best))) best = e;
    }
    return best;
  }

  if (preset.focus === "protect") {
    let ward: PlayerSnapshot | undefined;
    for (const p of players) {
      if (p.id === me.id || p.team !== me.team || !p.alive) continue;
      if (!ward || p.hp / Math.max(1, p.maxHp) < ward.hp / Math.max(1, ward.maxHp)) ward = p;
    }
    if (ward) {
      let best = enemies[0]!;
      for (const e of enemies) if (distTo(ward, e) < distTo(ward, best)) best = e;
      return best;
    }
    // No living allies — a lone bodyguard fights like anyone else.
  }

  let best = enemies[0]!;
  for (const e of enemies) if (distTo(me, e) < distTo(me, best)) best = e;
  return best;
};
