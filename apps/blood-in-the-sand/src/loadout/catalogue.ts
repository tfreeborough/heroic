/**
 * Codex copy + derived stats for the loadout sheet. The RULE (Tom, 2026-07-12):
 * no superlatives, no cross-roster comparisons, no counterplay prose — nothing
 * that rots as the roster grows. Numbers are DERIVED from the sim config at
 * render time wherever they exist there (weapons fully; abilities carry their
 * doc numbers here until each one's effect lands in the sim, at which point
 * its chips should switch to reading the real config).
 */
import {
  ABILITIES,
  ABILITY_IDS,
  PLAYER_STATS,
  WEAPONS,
  WEAPON_IDS,
  type AbilityCategory,
  type AbilityId,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";

// The arena palette (render.ts precedent — parsed there, plain strings here).
export const C_GOLD = "#d99a41";
export const C_BONE = "#f0e8d8";
export const C_MUTED = "#8a7f70";
export const C_CARD = "#1d1915";
export const C_CARD_HI = "#26201a";
export const C_LINE = "#2e2820";

export const CATEGORY_META: Record<AbilityCategory, { label: string; color: string }> = {
  offensive: { label: "OFFENSIVE", color: "#d94141" },
  defensive: { label: "DEFENSIVE", color: "#4da3d9" },
  support: { label: "SUPPORT", color: "#5fc75f" },
};

export interface CodexChip {
  label: string;
  value: string;
}

export interface StatBar {
  label: string;
  /** 0..1, normalised across the roster so the bars compare honestly. */
  frac: number;
  display: string;
}

// ── Weapons ────────────────────────────────────────────────────────────────

export const WEAPON_CODEX: Record<WeaponId, { hint: string; quote: string; desc: string }> = {
  blade: {
    hint: "fast swings, stacks bleeds — stay close",
    quote: "Quick as a whisper, and it leaves the wound talking.",
    desc: "Quick arcing swings in a thin cone. Hits can open a bleed that keeps ticking while you reposition.",
  },
  bow: {
    hint: "long-range poke with a fast arrow",
    quote: "One breath to draw. Make it count.",
    desc: "A drawn shot at long range. The draw is the tell — once loosed, the arrow flies fast and hits hard.",
  },
  staff: {
    hint: "a slow orb that hunts you down",
    quote: "You can run from the orb. The orb does not mind.",
    desc: "Looses a seeking orb that steers toward its mark until it connects or expires.",
  },
  hammer: {
    hint: "slow, crushing, and it SLOWS them",
    quote: "The first blow is a promise. The slow is how it’s kept.",
    desc: "A wide, heavy sweep. Anyone caught is slowed — lining them up for the next one.",
  },
};

const weaponDamage = (id: WeaponId): number => WEAPONS[id].stats.attack ?? PLAYER_STATS.attack;
const weaponCycle = (id: WeaponId): number => WEAPONS[id].attack.windup + WEAPONS[id].attack.recovery;
const weaponReach = (id: WeaponId): number => WEAPONS[id].attack.reach;

const maxDamage = Math.max(...WEAPON_IDS.map(weaponDamage));
const minCycle = Math.min(...WEAPON_IDS.map(weaponCycle));
const maxReach = Math.max(...WEAPON_IDS.map(weaponReach));

/** Damage / speed / reach, straight from WEAPONS — the codex can never drift. */
export const weaponBars = (id: WeaponId): StatBar[] => [
  { label: "DAMAGE", frac: weaponDamage(id) / maxDamage, display: String(weaponDamage(id)) },
  { label: "SPEED", frac: minCycle / weaponCycle(id), display: `${weaponCycle(id).toFixed(1)}s cycle` },
  { label: "REACH", frac: weaponReach(id) / maxReach, display: `${weaponReach(id)}px` },
];

const deg = (rad: number): number => Math.round((rad * 180) / Math.PI);

/** Effect chips derived from the weapon's actual config entries. */
export const weaponChips = (id: WeaponId): CodexChip[] => {
  const cfg = WEAPONS[id];
  const chips: CodexChip[] = [];
  if (cfg.bleed) {
    chips.push({
      label: "BLEED",
      value: `${Math.round(cfg.bleed.chance * 100)}% · ${cfg.bleed.ticks} × ${cfg.bleed.damage}dmg · ${cfg.bleed.interval}s`,
    });
  }
  if (cfg.slow) chips.push({ label: "SLOW", value: `${cfg.slow.duration}s · ×${cfg.slow.factor} speed` });
  if (cfg.attack.shape === "arc") chips.push({ label: "ARC", value: `${deg(cfg.attack.arcWidth ?? 0)}°` });
  if (cfg.attack.shape === "projectile" && cfg.attack.projectileSpeed) {
    chips.push({ label: id === "staff" ? "ORB" : "ARROW", value: `${cfg.attack.projectileSpeed} px/s` });
  }
  if (cfg.projectile?.homingTurnRate) {
    chips.push({ label: "HOMING", value: `${cfg.projectile.homingTurnRate} rad/s` });
  }
  chips.push({ label: "WINDUP", value: `${cfg.attack.windup}s` });
  if (cfg.attack.knockback) chips.push({ label: "KNOCKBACK", value: String(cfg.attack.knockback) });
  return chips;
};

// ── Abilities ──────────────────────────────────────────────────────────────
// Chips carry the design-doc numbers until each ability's effect is built in
// the sim — then its chip values move into (and read from) config, like weapons.

export const ABILITY_CODEX: Record<AbilityId, { hint: string; quote: string; desc: string; chips: CodexChip[] }> = {
  sandtrap: {
    hint: "bury a mine — 2s to arm, then it bites",
    quote: "Bury a blade beneath the sand. Two breaths to arm — then the first fool to step close eats it.",
    desc: "Drops a visible mine at your feet. It arms over 2 seconds, then detonates on the first enemy in range. One live mine at a time — placing a new one fizzles the old.",
    chips: [
      { label: "ARM", value: "2s" },
      { label: "DAMAGE", value: "30" },
      { label: "BLAST", value: "90px" },
      { label: "TRIGGER", value: "40px" },
    ],
  },
  tremor: {
    hint: "instant slam — throws everyone off you",
    quote: "Slam the ground and send everyone around you sprawling. Best served surrounded.",
    desc: "Instantly slams the ground: every enemy in the circle takes damage and is hurled outward.",
    chips: [
      { label: "RADIUS", value: "110px" },
      { label: "DAMAGE", value: "12" },
      { label: "WINDUP", value: "none" },
    ],
  },
  harpoon: {
    hint: "fast hook — drags your mark to you",
    quote: "Hurl a barbed harpoon at your mark. It flies fast, it rarely misses, and it drags them straight to you.",
    desc: "Fires at your current target — no target, no cast. On hit, drags them to just outside your reach.",
    chips: [
      { label: "SPEED", value: "950 px/s" },
      { label: "RANGE", value: "300px" },
      { label: "DAMAGE", value: "8" },
    ],
  },
  dash: {
    hint: "the classic — short hop, brief invulnerability",
    quote: "A short, sharp burst of speed — and a heartbeat where nothing can touch you.",
    desc: "A short hop with a moment of invulnerability — attacks and projectiles pass through you if timed right. Barges anyone in your path.",
    chips: [
      { label: "DISTANCE", value: "75px" },
      { label: "I-FRAMES", value: "0.2s" },
      { label: "SHOVE", value: "46px sweep" },
    ],
  },
  "mirror-guard": {
    hint: "projectiles bounce back — swords don’t",
    quote: "Raise a polished shield. Arrows and orbs fly back where they came from. Swords, sadly, do not.",
    desc: "While raised, projectiles that hit you become yours and fly back at the shooter. Melee passes straight through it.",
    chips: [
      { label: "DURATION", value: "2s" },
      { label: "REFLECT", value: "full damage" },
    ],
  },
  ironhide: {
    hint: "become iron — tank hits, move like iron",
    quote: "Turn your flesh to iron. Shrug off blows, slows and shoves — but iron is heavy, and you’ll move like it.",
    desc: "Hardens you: incoming damage is cut and slows, shoves and pulls don’t take — but your own speed is halved while it lasts.",
    chips: [
      { label: "DURATION", value: "2.5s" },
      { label: "DAMAGE TAKEN", value: "×0.3" },
      { label: "SELF-SLOW", value: "×0.5" },
    ],
  },
  "straw-man": {
    hint: "a decoy that steals their targeting",
    quote: "Plant a convincing stand-in. Enemy eyes — and blades — snap to it while you slip away.",
    desc: "Drops a dummy where you stand. Enemy targeting treats it as a real mark until it breaks or expires.",
    chips: [
      { label: "DUMMY HP", value: "30" },
      { label: "LIFETIME", value: "4s" },
    ],
  },
  "war-drums": {
    hint: "a moving circle of speed for your team",
    quote: "Beat the drums. You and every ally in the circle surge while the rhythm lasts.",
    desc: "A circle of speed that moves with you. Allies inside surge; step out and it’s gone. The beat plays for as long as the drums do.",
    chips: [
      { label: "RADIUS", value: "130px" },
      { label: "DURATION", value: "3s" },
      { label: "SPEED", value: "×1.35" },
    ],
  },
  "blood-font": {
    hint: "a healing circle — hold it or lose it",
    quote: "Raise a font of lifeblood. Allies standing in its circle knit their wounds shut.",
    desc: "Pours a stationary healing circle at your feet. Allies standing inside recover health while it lasts.",
    chips: [
      { label: "RADIUS", value: "100px" },
      { label: "DURATION", value: "4s" },
      { label: "HEALING", value: "4hp / 0.5s" },
    ],
  },
  sandstorm: {
    hint: "a blinding cloud — no one inside can be marked",
    quote: "Kick up a blinding whirl of sand. Nothing inside it can be marked — friend or foe.",
    desc: "Kicks up a cloud at your feet. Anyone inside can’t be targeted — existing locks break, new ones won’t take. Friend and foe alike.",
    chips: [
      { label: "RADIUS", value: "120px" },
      { label: "DURATION", value: "3s" },
      { label: "EFFECT", value: "untargetable inside" },
    ],
  },
};

export const categoryOf = (id: AbilityId): AbilityCategory => ABILITIES[id].category;

/** Ability ids grouped by category, in catalogue order — the sheet's sections. */
export const abilitiesByCategory = (category: AbilityCategory): AbilityId[] =>
  ABILITY_IDS.filter((id) => categoryOf(id) === category);
