/**
 * The style bible: per-asset-type prompt templates + the game's identity lines
 * (docs/design/asset-forge.md). The template — not the model — owns all brand
 * language; the user's sentence only fills the {subject} slot. It's checked in
 * so brand drift is diffable. Iterate these against real generations.
 *
 * Lesson from the first iteration: shape words ("punchy, fast attack") and
 * material lists in a FIXED suffix fight any subject they don't match (a nest
 * of skittering spiders is not punchy), and negations ("no ambience") are
 * ignored or inverted by audio models. So the fixed template carries tone
 * only, and per-subject shape/texture language comes from the LLM expander
 * below (or the user's own editing — the panel's prompt box sends verbatim).
 *
 * Types: `sfx` (ElevenLabs, Enter the Gauntlet) and `icon-bits` (OpenAI
 * gpt-image-1, Blood in the Sand's weapon/ability icons — the icon pass).
 */

/** Sound identity for Enter the Gauntlet — the tone every SFX prompt carries. */
const SOUND_IDENTITY = "a dark-fantasy dungeon game — gritty and physical, never cartoonish or synthetic";

/** Sound identity for Blood in the Sand — the desert-arena tone (its icons run
 * the same brief on the image side): sun-scoured, brutal, weighty, blood-and-sand. */
const BITS_SOUND_IDENTITY =
  "a brutal gladiator arena in a scorched desert — visceral and physical, sun-baked and " +
  "dusty, weighty and grounded, blood-and-sand, never cartoonish or synthetic";

export interface SfxSpec {
  id: "sfx" | "sfx-bits";
  label: string;
  provider: "elevenlabs-sfx";
  /** The game's sound tone — carried by the template AND the LLM expander. */
  soundIdentity: string;
  /** Repo-relative dir the app's manifest requires clips from — sets the paste line. */
  manifestDir: string;
  /** Takes generated per request — picking from a spread beats iterating prompts. */
  candidates: number;
  /** 0–1: how strictly ElevenLabs follows the prompt vs. improvises (their default 0.3). */
  promptInfluence: number;
  /**
   * Loudness-normalization target. -16 LUFS integrated / -1.5 dB true peak is a
   * common mobile-game level that leaves headroom under the music beds
   * (docs/design/audio.md § Assets).
   */
  loudnessLufs: number;
  truePeakDb: number;
  /** Repo-relative destination folder. */
  destination: string;
  /** Seed prompt when the user generates straight from the sentence. */
  template: (subject: string) => string;
}

export const SFX: SfxSpec = {
  id: "sfx",
  label: "Sound effect — Enter the Gauntlet",
  provider: "elevenlabs-sfx",
  soundIdentity: SOUND_IDENTITY,
  candidates: 3,
  promptInfluence: 0.3,
  loudnessLufs: -16,
  truePeakDb: -1.5,
  destination: "apps/enter-the-gauntlet/assets/audio/sfx",
  manifestDir: "../../../assets/audio/sfx",
  template: (subject) => `${subject}. A single one-shot sound effect for ${SOUND_IDENTITY}.`,
};

/**
 * Blood in the Sand SFX — its own ElevenLabs type so the gauntlet path is
 * untouched (symmetry with `icon-bits` being its own type). Same pipeline
 * (3-take banks, trim, loudness-normalize), different tone + destination + a
 * done-tick sound manifest in the panel (src/forge/soundSet.ts, derived from
 * the sim's roster + a static flow/UI list). The manifest path is `src/audio`
 * (not the gauntlet's `src/game/audio`), hence the shorter relative prefix.
 */
export const SFX_BITS: SfxSpec = {
  id: "sfx-bits",
  label: "Sound (Blood in the Sand)",
  provider: "elevenlabs-sfx",
  soundIdentity: BITS_SOUND_IDENTITY,
  candidates: 3,
  promptInfluence: 0.3,
  loudnessLufs: -16,
  truePeakDb: -1.5,
  destination: "apps/blood-in-the-sand/assets/audio/sfx",
  manifestDir: "../../assets/audio/sfx",
  template: (subject) => `${subject}. A single one-shot sound effect for ${BITS_SOUND_IDENTITY}.`,
};

/**
 * Sound briefs per bank id, the audio twin of ICON_SUBJECTS: the ONLY sound
 * data that lives in the Forge. The bank ids for weapons/abilities derive from
 * the sim at panel runtime (src/forge/soundSet.ts) so a new roster entry appears
 * on its own, flagged until its brief is written here; the flow/UI banks are a
 * static list there. Briefs are sound-design copy, not game data — concrete
 * source + texture + shape, positive phrasing (the model ignores negations); the
 * SFX_BITS identity colours tone. These seed the panel's prompt box; the LLM
 * "Expand" step and hand-editing refine from there. Bank ids match the game's
 * catalogue clip bases (apps/blood-in-the-sand/src/audio/catalogue.ts).
 */
export const SOUND_SUBJECTS: Record<string, string> = {
  // ── Combat ────────────────────────────────────────────────────────────────
  hit_generic: "a short, meaty melee impact — a weapon connecting with a body, dull thud with a wet edge",
  hit_blade: "a fast blade slash biting into flesh — a sharp shnk with a wet cut and a spatter tail",
  hit_bow: "an arrow thudding hard into a body — a deep meaty thwack with a short flesh impact, no bowstring",
  hit_staff: "a magic orb bursting on a body — a dry arcane crackle-thump with a brief low pressure whump",
  hit_hammer: "a massive warhammer slam into a body — a huge blunt crunch with a bassy shockwave",
  fire_bow: "loosing an arrow from a bow — a taut bowstring release SNAP and a quick arrow whoosh, dry and punchy, no impact",
  fire_staff: "casting a magic orb from a staff — a short arcane whoosh-swell with a soft energy hum as it launches, no impact",
  player_hurt: "a single grunt of pain from a gladiator taking a blow — short, breathy, no words",
  death: "a gladiator's final choked gasp collapsing into the sand — a short wet fall, no scream",
  // ── Abilities ─────────────────────────────────────────────────────────────
  cast_generic: "a short ability activation whoosh — dry, physical, a quick surge of intent",
  cast_sandtrap: "burying and arming a spiked powder charge in sand — a muffled shuffle then a metal click-latch",
  cast_tremor: "a heavy stomp shattering the ground — a deep bassy boom with cracking earth and a dust rumble",
  cast_harpoon: "a gladiator hurling a barbed chain — a hard grunt with a metallic chain rattle winding up",
  cast_dash: "a fast dodging dash across sand — a sharp cloth-and-sand whoosh with a grit scuff",
  cast_mirror_guard: "a polished shield snapping up to guard — a bright metallic ring shimmer, defensive",
  cast_ironhide: "flesh hardening to iron — a low grinding stone-and-metal groan, bracing and heavy",
  cast_straw_man: "a straw decoy slamming into the sand on a post — a dry thud with rustling straw",
  cast_war_drums: "war drums starting a driving rhythm — deep taut drum hits with a rallying swell",
  cast_blood_font: "a bronze chalice pouring a healing pool — a rich liquid glug with a warm shimmer",
  cast_sandstorm: "a sudden swirling sandstorm kicking up — a rising sandy wind roar with hissing grit",
  detonate_sandtrap: "a buried powder charge blowing up — a sharp cracking blast with a sand-and-gravel spray",
  harpoon_whip: "a barbed chain snapping taut across the arena — a fast metallic whip-crack and rattle",
  heal_tick: "a small warm healing pulse — a soft chime with a brief liquid shimmer, gentle",
  // ── Match flow ────────────────────────────────────────────────────────────
  countdown_tick: "a single dry pre-fight countdown tick — a taut wooden clack, tense",
  round_start: "a round beginning in the arena — a short low horn or gong swell with a dusty air",
  fight_start: "the FIGHT signal — a big brassy gong hit with a roaring crowd surge",
  round_win: "a short victorious sting — a bright rising brass flourish with a crowd cheer",
  round_loss: "a short defeat sting — a low falling brass note with a disappointed crowd murmur",
  round_draw: "a neutral round-over sting — a flat gong tap with an ambiguous crowd hum",
  match_win: "a triumphant match-won fanfare — a full brass flourish and a roaring victorious crowd",
  match_loss: "a somber match-lost motif — a low mournful horn fading under a dying crowd",
  // ── UI ────────────────────────────────────────────────────────────────────
  ui_tap: "a soft dry UI tap — a quick muted wooden or leather tick, understated",
  ui_confirm: "a confident UI confirm — a firm metallic clack-thunk with a short bright ring, committing",
  ui_back: "a soft UI back/cancel — a low muted wooden knock, a step backwards",
  ui_error: "a short UI error buzz — a dull dead thunk, a rejected action, not harsh",
};

// ── Blood in the Sand icons ────────────────────────────────────────────────
// The draft-screen icon set (docs/design/pvp-abilities.md identity pass).
// Consistency levers: ONE fixed style paragraph (below) + a per-category
// accent + a checked-in manifest of subjects, so the whole set is generated
// from the same brand language. Acceptance test (the panel shows it): every
// icon must stay readable at 32px — that's roster-row size in the game.

export type IconCategory = "weapon" | "offensive" | "defensive" | "support";

/** Accent colour per category — the game's category-colour system, baked in. */
export const ICON_ACCENTS: Record<IconCategory, { name: string; hex: string }> = {
  weapon: { name: "antique gold", hex: "#d99a41" },
  offensive: { name: "arena red", hex: "#d94141" },
  defensive: { name: "steel blue", hex: "#4da3d9" },
  support: { name: "arena green", hex: "#5fc75f" },
};

/**
 * Art subjects per icon, keyed by the sim's WeaponId/AbilityId. This is the
 * ONLY icon data that lives in the Forge — the id/name/category identity of
 * the set derives from the sim's WEAPONS/ABILITIES tables at panel runtime
 * (src/forge/iconSet.ts), so a new weapon or ability appears here on its own.
 * An entry missing a subject shows flagged in the panel (with a plain
 * fallback) until its line is written here. Subjects are art copy, not game
 * data — that's why they overlay rather than living in the sim config.
 *
 * Kept sim-import-free on purpose: this file is bundled into vite.config
 * (the plugin imports it); the sim only ever loads in the browser bundle.
 */
export const ICON_SUBJECTS: Record<string, string> = {
  blade: "a short gladius sword held at a dynamic diagonal, edge glinting",
  bow: "a recurve bow at full draw with a nocked arrow pointing right",
  staff: "a gnarled wooden staff crowned with a floating violet orb",
  hammer: "a massive square-headed warhammer, head heavy at the top",
  sandtrap: "a spiked iron trap half-buried in a small mound of sand, one blade glinting above the surface",
  tremor: "a boot stamping down with cracked earth and two radiating shockwave rings",
  harpoon: "a barbed iron hook trailing a taut chain, mid-flight",
  dash: "a pair of sandalled feet mid-sprint kicking up dust, with three fading speed chevrons behind them",
  "mirror-guard": "a polished round shield with an arrow ricocheting off it at a sharp angle",
  ironhide: "a flexing forearm and fist turned to cracked dark iron",
  "straw-man": "a straw training dummy on a wooden post with a painted target on its chest",
  "war-drums": "a rope-bound war drum with radiating rhythm rings rising from its skin",
  "blood-font": "a bronze chalice overflowing with deep red droplets",
  sandstorm: "a swirling spiral of sand with a single closed eye barely visible inside it",
};

export interface IconSpec {
  id: "icon-bits";
  label: string;
  provider: "openai-image";
  /** Images are slow + priced per call — a pair to pick from beats a spread. */
  candidates: number;
  /** Saved size (game renders at ≤52px; 512 keeps the bundle light). */
  savedSize: number;
  /** Repo-relative destination folder. */
  destination: string;
  template: (subject: string, category: IconCategory) => string;
}

export const ICON: IconSpec = {
  id: "icon-bits",
  label: "Icon (Blood in the Sand)",
  provider: "openai-image",
  candidates: 2,
  // Largest in-app render is the codex hero at 52pt → 156px on a 3× screen;
  // 256 covers that with margin. Bump only if a bigger surface appears.
  savedSize: 256,
  destination: "apps/blood-in-the-sand/assets/icons",
  // Dark-fantasy direction (Tom, 2026-07-14 — replaced the flat-vector v1):
  // hand-inked, grim, Darkest-Dungeon-adjacent. Described by attributes, not
  // by naming the game — attribute language steers the model more reliably.
  // v2 lessons: "dramatic rim light"/"pooled shadows" made the model paint a
  // backdrop glow (background:"transparent" allows alpha, it doesn't forbid
  // painting a ground) — isolation must be stated as what surrounds the
  // subject. And the icons sit on near-black cards, so the shape must be
  // carved in bone highlights, not silhouetted in black.
  // v3: die-cut aged-bone outline added — black-heavy woodcut art melts into
  // the near-black UI at 32px; the pale cut-line carries the silhouette (and
  // it's an honest woodcut-poster trope besides).
  // v4 (Tom): dark fantasy × DESERT — the game is Blood in the Sand, and the
  // grimness must stay sun-scoured, never gothic-damp: scorched ochre
  // midtones, gladiatorial material language (bronze, leather, sun-split
  // wood), blood-and-sand mood.
  template: (subject, category) => {
    const accent = ICON_ACCENTS[category];
    return (
      `${subject}. A grim dark-fantasy game ability icon for a brutal gladiator arena game set ` +
      "in a scorched desert. Hand-inked woodcut illustration: one bold central silhouette " +
      "filling about 80% of the frame, heavy black ink, rough expressive hatching, sun-bleached " +
      "bone (#f0e8d8) highlights carving the shape out of the dark, scorched sand-ochre " +
      `(#b39763) midtones like heat-baked dust settled on every surface, and a ${accent.name} ` +
      `(${accent.hex}) accent burning on the focal element. Gladiatorial desert materials: ` +
      "hammered bronze, cracked leather wraps, sun-split wood, rust and dried blood. A rough " +
      "aged-bone die-cut outline traces the whole silhouette, like a woodcut poster cut from " +
      "pale paper — it separates the shape from a near-black UI. Grim, sun-scoured, " +
      "blood-and-sand mood — never cute, never photorealistic, never a clean flat vector. " +
      "Chunky shapes that stay readable at 32 pixels. The cut-out floats alone on a fully " +
      "transparent background — no backdrop, no glow, no vignette; every pixel outside the " +
      "cut line is transparent. No text."
    );
  },
};

/**
 * The prompt expander: an LLM rewrites the user's rough sentence into a
 * provider-shaped SFX prompt — concrete sources/textures, an explicit sonic
 * shape, positive phrasing. This is where per-subject craft lives, so the
 * fixed template above can stay minimal.
 */
export const EXPANDER_MODEL = "gpt-5-mini";

/** The expander system prompt, parameterised by the game's sound identity so the
 * same prompt-craft serves both games' SFX types (plugin picks the identity). */
export const expanderSystem = (soundIdentity: string): string =>
  "You write prompts for ElevenLabs' sound-effects model. The user gives a rough description of a " +
  "game sound; you reply with ONE refined prompt and nothing else — no quotes, no preamble.\n" +
  "Rules:\n" +
  "- Describe the sound itself, concretely: the sources (creatures, materials, surfaces), the " +
  "actions, and the sonic texture (e.g. chitinous skittering, wet crunch, hollow thud, metallic ring).\n" +
  "- Give it a shape: how it starts, peaks, and ends, and roughly how long " +
  '("a short dry burst", "a two-second swell that dies quickly").\n' +
  "- Say what should be heard, never what should not — the model ignores negations.\n" +
  "- Audio vocabulary works: impact, whoosh, layered, close-mic'd, dry, one-shot.\n" +
  `- The sound is for ${soundIdentity}. Let that colour material and tone choices only where it fits the subject.\n` +
  "- At most 40 words. It is a single sound effect, not music and not speech.";
