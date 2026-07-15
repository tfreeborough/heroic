/**
 * The Blood in the Sand sound manifest — the audio twin of iconSet.ts. The
 * weapon/ability banks derive straight from the sim's WEAPONS/ABILITIES tables,
 * so a new roster entry adds its `hit_*` / `cast_*` rows here automatically
 * (flagged until a sound brief is written in SOUND_SUBJECTS); the combat, match
 * flow and UI banks are a static list, since they aren't tied to a table row.
 *
 * Bank ids match the game's catalogue clip bases
 * (apps/blood-in-the-sand/src/audio/catalogue.ts) BY CONSTRUCTION — same naming
 * convention on both sides — so a bank forged here fills the matching catalogue
 * slot with no lookup table between them.
 *
 * Browser-side ONLY (like iconSet.ts): imports the sim package, which must never
 * reach forge/plugin.ts (bundled into vite.config, where the workspace TS chain
 * doesn't reliably resolve).
 */
import {
  ABILITIES,
  ABILITY_IDS,
  WEAPONS,
  WEAPON_IDS,
  type AbilityId,
} from "@heroic/blood-in-the-sand-sim";
import { SOUND_SUBJECTS } from "../../forge/styleBible";

/** Display grouping in the panel (not saved anywhere — purely how rows cluster). */
export type SoundCategory = "combat" | "ability" | "flow" | "ui";

export interface SoundSetEntry {
  /** Bank base name — files save as `<id>_1.mp3`, `<id>_2.mp3`, … */
  id: string;
  /** Human label for the chip. */
  label: string;
  category: SoundCategory;
  /** Seed brief for the prompt box (from SOUND_SUBJECTS, or a plain fallback). */
  subject: string;
  /** No hand-written brief yet — the panel flags it and uses the fallback. */
  missingSubject: boolean;
}

/** kebab AbilityId → snake bank suffix ("mirror-guard" → "mirror_guard"). */
const snake = (id: string): string => id.replace(/-/g, "_");

const entry = (id: string, label: string, category: SoundCategory): SoundSetEntry => {
  const subject = SOUND_SUBJECTS[id];
  return {
    id,
    label,
    category,
    subject: subject ?? `the sound of "${label.toLowerCase()}"`,
    missingSubject: subject === undefined,
  };
};

/** Abilities that spawn a deployable which later detonates — gets a `detonate_*` bank. */
const DETONATING: readonly AbilityId[] = ["sandtrap"];

/** Combat / flow / UI banks that aren't derived from a roster table. */
const STATIC: ReadonlyArray<{ id: string; label: string; category: SoundCategory }> = [
  // combat (roster-independent)
  { id: "hit_generic", label: "Impact — generic", category: "combat" },
  { id: "player_hurt", label: "You take a hit", category: "combat" },
  { id: "death", label: "Death", category: "combat" },
  { id: "cast_generic", label: "Cast — generic", category: "ability" },
  { id: "harpoon_whip", label: "Harpoon — chain whip", category: "ability" },
  { id: "heal_tick", label: "Blood Font — heal tick", category: "ability" },
  // match flow
  { id: "countdown_tick", label: "Countdown tick", category: "flow" },
  { id: "round_start", label: "Round start", category: "flow" },
  { id: "fight_start", label: "FIGHT!", category: "flow" },
  { id: "round_win", label: "Round won", category: "flow" },
  { id: "round_loss", label: "Round lost", category: "flow" },
  { id: "round_draw", label: "Round draw", category: "flow" },
  { id: "match_win", label: "Match won", category: "flow" },
  { id: "match_loss", label: "Match lost", category: "flow" },
  // UI
  { id: "ui_tap", label: "UI tap", category: "ui" },
  { id: "ui_confirm", label: "UI confirm", category: "ui" },
  { id: "ui_back", label: "UI back", category: "ui" },
  { id: "ui_error", label: "UI error", category: "ui" },
];

/** Combat first, then abilities (derived), then the flow/UI statics. */
export const buildSoundSet = (): SoundSetEntry[] => {
  const weaponHits = WEAPON_IDS.map((id) =>
    entry(`hit_${id}`, `${WEAPONS[id].name} — impact`, "combat"),
  );
  const casts = ABILITY_IDS.map((id) =>
    entry(`cast_${snake(id)}`, `${ABILITIES[id].name} — cast`, "ability"),
  );
  const detonates = DETONATING.map((id) =>
    entry(`detonate_${snake(id)}`, `${ABILITIES[id].name} — detonate`, "ability"),
  );
  const statics = STATIC.map((s) => entry(s.id, s.label, s.category));
  // Interleave so combat rows (weapon hits + static combat) sit together, etc.
  const all = [...weaponHits, ...casts, ...detonates, ...statics];
  const order: SoundCategory[] = ["combat", "ability", "flow", "ui"];
  return order.flatMap((cat) => all.filter((e) => e.category === cat));
};
