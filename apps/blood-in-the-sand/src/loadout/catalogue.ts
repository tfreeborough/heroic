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
  BLOOD_FONT,
  DASH_DISTANCE,
  DASH_IFRAMES,
  DASH_SHOVE_RADIUS,
  HARPOON,
  IRONHIDE,
  MIRROR_GUARD,
  PLAYER_STATS,
  SANDSTORM,
  SANDTRAP,
  SINKHOLE,
  STRAW_MAN,
  TAR_PIT,
  TITANS_DRAUGHT,
  TREMOR,
  WAR_DRUMS,
  WARDING_SHOUT,
  WEAPONS,
  WEAPON_IDS,
  GATED_ABILITIES,
  GATED_WEAPONS,
  WRIT_ABILITIES,
  WRIT_WEAPONS,
  abilityEntitlement,
  weaponEntitlement,
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
    hint: "fast swings with a stacking bleed",
    quote: "Nothing as classic as a keen edged blade",
    desc: "Best used with a gap closing ability, fast to attack and can finish opponents off quickly",
  },
  bow: {
    hint: "Long range and useful for kiting",
    quote: "One breath to draw. Make it count.",
    desc: "A drawn shot at long range, high damage",
  },
  staff: {
    hint: "a slow orb of electricity that hunts you down",
    quote: "You do not seek the orb, for it seeks you.",
    desc: "Looses a seeking orb that steers toward its mark until it connects or expires.",
  },
  trident: {
    hint: "applies a slow and bleed, tricky to master",
    quote: "The fish never learns how long the spear is.",
    desc: "Difficult to master, but when used correctly can be used with devastating effect to control the arena.",
  },
  hammer: {
    hint: "large slow sweeping blows that slow enemies when hit",
    quote: "Break their bones.",
    desc: "A wide, heavy sweep. Anyone caught is slowed, less damage for more crowd control",
  },
  lifeline: {
    hint: "a mending thread to your most wounded ally — no weapon at all",
    quote: "Hold the line. I will hold you together.",
    desc: "Links a mending thread to your most wounded ally: the longer the link holds unbroken, the faster it heals. It never touches an enemy — your abilities and your allies are all that stand between you and a blade. In a lone duel it links nothing: this is a choice, not a gun.",
  },
  fang: {
    hint: "lightning stabs that stack a deadly poison",
    quote: "The bite is nothing. The venom is everything.",
    desc: "The shortest reach in the arena and barely a scratch per stab — but every stab stacks poison, and stacked poison does the killing while you're already gone.",
  },
  scorpion: {
    hint: "a three-bolt volley, each bolt aimed anew",
    quote: "One sting is a warning. Three are a verdict.",
    desc: "Looses three fast bolts in quick succession, each aimed at where you are the instant it leaves. Slow to reload — make the volley count.",
  },
  bombard: {
    hint: "lobs a shell onto marked ground — the blast spares no one",
    quote: "The sky does the killing. I merely point.",
    desc: "Marks the ground beneath your foe and drops a shell on it. The mark is honest — anyone can walk clear — and the blast spares no one who stays: enemy, ally, or you. Useless up close: inside its dead zone it cannot fire at all.",
  },
};

/** Damage per trigger-pull: a burst weapon's honest number is the full
 * volley, not one feeble bolt (the bar would lie against single-hit
 * rosters); a shell weapon's is its fixed blast; a beam deals NOTHING —
 * zero, the honest floor of every damage bar. */
const weaponDamage = (id: WeaponId): number =>
  WEAPONS[id].beam
    ? 0
    : WEAPONS[id].shell?.damage ??
      (WEAPONS[id].stats.attack ?? PLAYER_STATS.attack) * (WEAPONS[id].burst?.count ?? 1);
const weaponCycle = (id: WeaponId): number => WEAPONS[id].attack.windup + WEAPONS[id].attack.recovery;
const weaponReach = (id: WeaponId): number => WEAPONS[id].attack.reach;

/**
 * Roster-normalised bar (Tom 2026-07-15): the roster's best value fills the
 * bar, the worst floors at 20% — never empty, and the scale auto-adjusts as
 * weapons join the roster. Pass negated values for lower-is-better stats.
 */
const barFrac = (value: number, all: number[]): number => {
  const min = Math.min(...all);
  const max = Math.max(...all);
  return max === min ? 1 : 0.2 + 0.8 * ((value - min) / (max - min));
};

/** Damage / speed / reach, straight from WEAPONS — the codex can never drift. */
export const weaponBars = (id: WeaponId): StatBar[] => [
  {
    label: "DAMAGE",
    frac: barFrac(weaponDamage(id), WEAPON_IDS.map(weaponDamage)),
    // A burst shows its arithmetic (3×8) — the total is real but earned;
    // a beam deals nothing and says so.
    display: WEAPONS[id].burst
      ? `${WEAPONS[id].burst!.count}×${WEAPONS[id].stats.attack ?? PLAYER_STATS.attack}`
      : WEAPONS[id].beam
        ? "none"
        : String(weaponDamage(id)),
  },
  {
    label: "SPEED",
    frac: barFrac(-weaponCycle(id), WEAPON_IDS.map((w) => -weaponCycle(w))),
    // A beam has no cycle at all — "continuous" beats a lying "0.0s".
    display: WEAPONS[id].beam ? "continuous" : `${weaponCycle(id).toFixed(1)}s cycle`,
  },
  { label: "REACH", frac: barFrac(weaponReach(id), WEAPON_IDS.map(weaponReach)), display: `${weaponReach(id)}px` },
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
  if (cfg.poison) {
    chips.push({
      label: "POISON",
      value: `stacks ×${cfg.poison.maxStacks} · ${cfg.poison.damagePerStack}dmg/stack · ${cfg.poison.interval}s`,
    });
  }
  if (cfg.slow) chips.push({ label: "SLOW", value: `${cfg.slow.duration}s · ×${cfg.slow.factor} speed` });
  if (cfg.attack.shape === "arc") chips.push({ label: "ARC", value: `${deg(cfg.attack.arcWidth ?? 0)}°` });
  if (cfg.attack.minReach && !cfg.shell) {
    // The floating hit band (the trident head) — only this range bites.
    // (A shell weapon's minReach is its DEAD ZONE chip instead, above.)
    chips.push({ label: "BITE", value: `${cfg.attack.minReach}–${cfg.attack.reach}px` });
  }
  if (cfg.beam) {
    chips.push({
      label: "HEAL",
      value: `${cfg.beam.healPerSecondBase}–${cfg.beam.healPerSecondMax} hp/s · ramps while linked`,
    });
    chips.push({ label: "GRACE", value: `${cfg.beam.graceSeconds}s to relink` });
  }
  if (cfg.burst) {
    chips.push({ label: "VOLLEY", value: `${cfg.burst.count} bolts · ${cfg.burst.interval}s apart` });
  }
  if (cfg.shell) {
    chips.push({ label: "BLAST", value: `${cfg.shell.blastRadius}px` });
    chips.push({ label: "FLIGHT", value: `${cfg.shell.flightMin}–${cfg.shell.flightMax}s by range` });
    // The bombard's minReach is a DEAD ZONE, not a floating band (no swing
    // at all inside it) — its own label, not the trident's BITE.
    if (cfg.attack.minReach) chips.push({ label: "DEAD ZONE", value: `under ${cfg.attack.minReach}px` });
  }
  if (cfg.attack.shape === "projectile" && cfg.attack.projectileSpeed) {
    chips.push({
      label: id === "staff" ? "ORB" : cfg.burst ? "BOLT" : "ARROW",
      value: `${cfg.attack.projectileSpeed} px/s`,
    });
  }
  if (cfg.projectile?.homingTurnRate) {
    chips.push({ label: "HOMING", value: `${cfg.projectile.homingTurnRate} rad/s` });
  }
  if (!cfg.beam) chips.push({ label: "WINDUP", value: `${cfg.attack.windup}s` });
  if (cfg.attack.knockback) chips.push({ label: "KNOCKBACK", value: String(cfg.attack.knockback) });
  return chips;
};

// ── Abilities ──────────────────────────────────────────────────────────────
// Chip values read straight from the sim's per-ability config tables (the
// weapons rule): the codex can never drift from what the arena actually does.

export const ABILITY_CODEX: Record<AbilityId, { hint: string; quote: string; desc: string; chips: CodexChip[] }> = {
  sandtrap: {
    hint: "bury a charge — 2s to arm, then it erupts",
    quote: "Bury a powder charge beneath the sand. Two breaths to arm — then the ground itself turns on them.",
    desc: "Buries an explosive charge at your feet. It arms over 2 seconds, then erupts on the first enemy to step close, throwing everyone caught in the blast. One live charge at a time — placing a new one fizzles the old.",
    chips: [
      { label: "ARM", value: `${SANDTRAP.armSeconds}s` },
      { label: "DAMAGE", value: String(SANDTRAP.damage) },
      { label: "BLAST", value: `${SANDTRAP.blastRadius}px` },
      { label: "TRIGGER", value: `${SANDTRAP.triggerRadius}px` },
    ],
  },
  tremor: {
    hint: "quake a wide circle — chips and slows everyone inside",
    quote: "Split the earth beneath them. The ground gives way — and they are slow to leave it.",
    desc: "Shakes the ground where you stand: enemies inside the circle take steady chip damage and are slowed while they remain. The zone stays put — hold a choke, guard a font, punish a dogpile.",
    chips: [
      { label: "RADIUS", value: `${TREMOR.radius}px` },
      { label: "DAMAGE", value: `${TREMOR.damagePerTick}/s` },
      { label: "SLOW", value: `${Math.round((1 - TREMOR.slowFactor) * 100)}%` },
      { label: "LASTS", value: `${TREMOR.duration}s` },
    ],
  },
  harpoon: {
    hint: "chain a mark, then haul them in — you hold your ground",
    quote: "Hurl a barbed harpoon at your mark. It does not miss — and then you haul, and they come.",
    desc: "Snaps a chain onto a mark in range — no mark, no cast. The chain lands the instant it's thrown, then reels them in against their will. You stand rooted while you haul; moving lets the chain go.",
    chips: [
      { label: "LANDING", value: "instant" },
      { label: "REEL", value: `${HARPOON.reelSpeed} px/s` },
      { label: "RANGE", value: `${HARPOON.maxRange}px` },
      { label: "DAMAGE", value: String(HARPOON.damage) },
    ],
  },
  dash: {
    hint: "the classic — short hop, brief invulnerability",
    quote: "A short, sharp burst of speed — and a heartbeat where nothing can touch you.",
    desc: "A short hop with a moment of invulnerability — attacks and projectiles pass through you if timed right. Barges anyone in your path.",
    chips: [
      { label: "DISTANCE", value: `${DASH_DISTANCE}px` },
      { label: "I-FRAMES", value: `${DASH_IFRAMES}s` },
      { label: "SHOVE", value: `${DASH_SHOVE_RADIUS}px sweep` },
    ],
  },
  "mirror-guard": {
    hint: "projectiles bounce back — swords don’t",
    quote: "Raise a polished shield. Arrows and orbs fly back where they came from. Swords, sadly, do not.",
    desc: "While raised, projectiles that hit you become yours and fly back at the shooter. Melee passes straight through it.",
    chips: [
      { label: "DURATION", value: `${MIRROR_GUARD.duration}s` },
      { label: "REFLECT", value: "full damage" },
    ],
  },
  ironhide: {
    hint: "become iron — tank hits, move like iron",
    quote: "Turn your flesh to iron. Shrug off blows, slows and shoves — but iron is heavy, and you’ll move like it.",
    desc: "Hardens you: incoming damage is cut and slows, shoves and pulls don’t take — but your own speed is halved while it lasts.",
    chips: [
      { label: "DURATION", value: `${IRONHIDE.duration}s` },
      { label: "DAMAGE TAKEN", value: `×${IRONHIDE.damageTakenFactor}` },
      { label: "SELF-SLOW", value: `×${IRONHIDE.selfSlowFactor}` },
    ],
  },
  "straw-man": {
    hint: "a decoy that steals their targeting",
    quote: "Plant a convincing stand-in. Enemy eyes — and blades — snap to it while you slip away.",
    desc: "Drops a dummy where you stand. Enemy targeting treats it as a real mark until it breaks or expires.",
    chips: [
      { label: "DUMMY HP", value: String(STRAW_MAN.hp) },
      { label: "LIFETIME", value: `${STRAW_MAN.lifetime}s` },
    ],
  },
  "warding-shout": {
    hint: "bellow a cone — hurls them back, no damage",
    quote: "Fill your lungs and ROAR. The sand itself flees your voice — and so do they.",
    desc: "An instant bellow in the direction you face: every enemy caught in the cone is hurled away hard. No damage — pure space. A shout you point wrong moves nobody.",
    chips: [
      { label: "RANGE", value: `${WARDING_SHOUT.range}px` },
      { label: "CONE", value: `${Math.round((WARDING_SHOUT.halfAngle * 2 * 180) / Math.PI)}°` },
      { label: "KNOCKBACK", value: String(WARDING_SHOUT.knockback) },
      { label: "WINDUP", value: "none" },
    ],
  },
  "war-drums": {
    hint: "a moving circle of speed for your team",
    quote: "Beat the drums. You and every ally in the circle surge while the rhythm lasts.",
    desc: "A circle of speed that moves with you. Allies inside surge; step out and it’s gone. The beat plays for as long as the drums do.",
    chips: [
      { label: "RADIUS", value: `${WAR_DRUMS.radius}px` },
      { label: "DURATION", value: `${WAR_DRUMS.duration}s` },
      { label: "SPEED", value: `×${WAR_DRUMS.speedFactor}` },
    ],
  },
  "blood-font": {
    hint: "a healing circle — hold it or lose it",
    quote: "Raise a font of lifeblood. Allies standing in its circle knit their wounds shut.",
    desc: "Pours a stationary healing circle at your feet. Allies standing inside recover health while it lasts.",
    chips: [
      { label: "RADIUS", value: `${BLOOD_FONT.radius}px` },
      { label: "DURATION", value: `${BLOOD_FONT.duration}s` },
      { label: "HEALING", value: `${BLOOD_FONT.healPerTick}hp / ${BLOOD_FONT.tickInterval}s` },
    ],
  },
  sandstorm: {
    hint: "a blinding whirl — no marks in, no aim out",
    quote: "Kick up a blinding whirl of sand. Nothing inside it can mark, or be marked — friend or foe.",
    desc: "Kicks up a swirling cloud at your feet. Anyone inside can’t be targeted — and can’t take aim out of it either. Existing locks break both ways. Friend and foe alike.",
    chips: [
      { label: "RADIUS", value: `${SANDSTORM.radius}px` },
      { label: "DURATION", value: `${SANDSTORM.duration}s` },
      { label: "EFFECT", value: "no aim in or out" },
    ],
  },
  "titans-draught": {
    hint: "drink deep — grow huge, hit harder, get hit easier",
    quote: "The titans never died. They are merely thirsty.",
    desc: "Drain the draught and swell to half again your size: your blows land heavier, your arms reach further, and the ground cracks beneath your stride. So does your body grow — a titan is a bigger mark for every arrow, blast and blade in the arena. The trade is the whole drink.",
    chips: [
      { label: "DURATION", value: `${TITANS_DRAUGHT.duration}s` },
      { label: "DAMAGE", value: `×${TITANS_DRAUGHT.damageFactor}` },
      { label: "SIZE", value: `×${TITANS_DRAUGHT.sizeFactor} — hittable too` },
    ],
  },
  "tar-pit": {
    hint: "paint a trail of tar behind you as you run",
    quote: "Let them follow. The road remembers me, and it does not care for them.",
    desc: "Opens a spout of tar at your heels: everywhere you run is left slick and black for the rest of the round, and anyone who wades through it — friend, foe, or you doubling back — is slowed to a trudge. Where the trail goes is wherever you went. The stains never wash out; the grip dies with the round.",
    chips: [
      { label: "LAYS FOR", value: `${TAR_PIT.laySeconds}s of running` },
      { label: "SLOW", value: `${Math.round((1 - TAR_PIT.slowFactor) * 100)}%` },
      { label: "LINGERS", value: "all round" },
    ],
  },
  sinkhole: {
    hint: "throw a hole in the world — it pulls everyone in",
    quote: "Open the ground where they stand. The sand is patient, and it is always hungry.",
    desc: "Hurls a vortex that drags everyone near it toward its centre — friend, foe, and you. The pull deepens the longer it lives; sprinting directly away barely beats it at full strength, and a dash always clears it. No damage — what kills you is where it puts you.",
    chips: [
      { label: "RADIUS", value: `${SINKHOLE.radius}px` },
      { label: "THROW", value: `${SINKHOLE.throwDistance}px · lands in ${SINKHOLE.armSeconds}s` },
      { label: "PULL", value: `${SINKHOLE.pullSpeedMin}–${SINKHOLE.pullSpeedMax} px/s` },
      { label: "LASTS", value: `${SINKHOLE.duration}s` },
    ],
  },
};

// Every ability carries its round budget (the charge economy, Tom 2026-07-15)
// — appended from config once so no hand-written chip can drift.
for (const id of ABILITY_IDS) {
  ABILITY_CODEX[id].chips.push({ label: "CHARGES", value: `${ABILITIES[id].charges} / round` });
}

export const categoryOf = (id: AbilityId): AbilityCategory => ABILITIES[id].category;

/** Ability ids grouped by category, alphabetical (Tom 2026-07-15) — the
 * pick lists' order. Gating mirrors sortedWeaponIds exactly: gated items
 * appear only when entitled — except writ items in PRACTICE, the
 * try-before-buy door (deed secrets stay hidden even there). */
export const abilitiesByCategory = (
  category: AbilityCategory,
  entitled: ReadonlySet<string>,
  practice = false,
): AbilityId[] =>
  ABILITY_IDS.filter(
    (id) =>
      categoryOf(id) === category &&
      (!GATED_ABILITIES.has(id) ||
        entitled.has(abilityEntitlement(id)) ||
        (practice && WRIT_ABILITIES.has(id))),
  ).sort((a, b) => ABILITIES[a].name.localeCompare(ABILITIES[b].name));

/** Weapon ids alphabetical — same ordering rule as abilities. Gated items
 * appear ONLY when entitled: hidden, never greyed — a secret doesn't exist
 * until it's yours (bits-secret-items.md), and the wizard shows what you
 * own, nothing else (bits-store.md). The one exception: PRACTICE unlocks
 * writ-gated items for everyone — free practice use is the store's
 * try-before-buy funnel. Deed items stay hidden even there (secrets rule). */
export const sortedWeaponIds = (entitled: ReadonlySet<string>, practice = false): WeaponId[] =>
  WEAPON_IDS.filter(
    (w) =>
      !GATED_WEAPONS.has(w) ||
      entitled.has(weaponEntitlement(w)) ||
      (practice && WRIT_WEAPONS.has(w)),
  ).sort((a, b) => WEAPONS[a].name.localeCompare(WEAPONS[b].name));
