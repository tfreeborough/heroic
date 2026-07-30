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
  crowd_cheer: "a bloodthirsty arena crowd erupting at a kill — a short sharp roar and cheer that swells then falls, rowdy and dry, shouts and claps mixed, no music (forge ~6 varied takes for a randomised bank)",
  crowd_jeer: "an arena crowd's disappointed groan when a fighter they favour falls — a low collective 'ooohh' and dismayed grumble that sinks, deflated, dry and rowdy, no cheering and no music (forge a few varied takes for a randomised bank)",
  crowd_ambience: "a constant low arena-crowd ambience bed — a distant restless gladiator-pit crowd murmuring, shifting chatter and shuffles and the odd muffled shout, no distinct cheers or words, no music, EVEN and steady so it loops seamlessly under the action (forge ONE long take, 30s+ if the tool allows — it becomes the crossfade-looped background bed)",
  blood_squelch: "a bare foot stepping through a fresh pool of blood on sand — one short wet squelch with a sticky peel as the foot lifts, subtle, no splash",
  // ── Abilities ─────────────────────────────────────────────────────────────
  cast_generic: "a short ability activation whoosh — dry, physical, a quick surge of intent",
  cast_sandtrap: "burying and arming a spiked powder charge in sand — a muffled shuffle then a metal click-latch",
  cast_tremor: "a heavy stomp splitting the ground open — a sharp rock-crack transient over a deep bassy boom, short and punchy",
  cast_warding_shout: "a gladiator's massive warding bellow — a huge chesty war-shout with a bassy air-punch whoosh, no words",
  quake_rumble: "a rolling earthquake shaking an arena for four seconds — loud cracking rock and grinding gravel up front (it must read on a small phone speaker), a deep bass rumble underneath, a dusty settling tail",
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
  title_gust: "a brief dry desert wind gust sweeping through a stone arena — a rising sandy hiss with grit ticking off stone, tailing away, no voices",
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
  "warding-shout": "a helmeted gladiator head mid-roar in profile, concentric shout rings bursting from the open mouth",
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
  /** Generation canvas — icons are square emblems, square canvas fits. */
  size: "1024x1024";
  /** Repo-relative destination folder. */
  destination: string;
  /** Prefix of the require() path handed back after save (consumer-module relative). */
  manifestDir: string;
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
  size: "1024x1024",
  destination: "apps/blood-in-the-sand/assets/icons",
  manifestDir: "../../assets/icons",
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

// ── Blood in the Sand sprites ──────────────────────────────────────────────
// Full-figure scene art (title screen first; splashes later) — the same
// woodcut world as the icons, but FIGURE language instead of emblem language:
// whole body in frame, a baked facing direction, lit for the sunlit High Sun
// scene. Two deliberate differences from the icon template: no die-cut bone
// outline (sprites sit ON painted scenes, not near-black UI cards), and no
// ground/cast shadow (the scene draws its own contact shadows, so the figure
// must arrive clean to place).

/**
 * Art subjects per sprite id. The `title-<weaponId>` ids derive from the
 * sim's WEAPONS table at panel runtime (src/forge/spriteSet.ts — the iconSet
 * pattern: a new weapon appears as a flagged row until its subject line is
 * written here); ids outside that convention are static extras. ALL title
 * fighters are generated FACING RIGHT on purpose — the home screen mirrors
 * whoever takes the right-hand slot, so one sprite covers both sides of the
 * duel. Subjects share one structural skeleton (profile, stance, gear list)
 * so the four generations come out as siblings, not strangers.
 */
export const SPRITE_SUBJECTS: Record<string, string> = {
  "title-blade":
    "a lean fast gladiator in full side profile facing right, coiled low in a duelling " +
    "crouch, a short gladius sword held ready at hip height with the blade angled up, a " +
    "small round buckler on the rear arm, light cracked-leather armor, crested open-face " +
    "galea helmet, studded leather pteruges skirt, wrapped shins — built for speed",
  "title-bow":
    "an archer gladiator in full side profile facing right, leaning into a full draw with " +
    "the weight settled on the back foot, a recurve war bow drawn with a nocked arrow aimed " +
    "level ahead, a quiver of arrows on the hip, a leather bracer on the draw arm, " +
    "leather-and-bronze armor, light open helmet, studded pteruges skirt",
  "title-staff":
    "a war-mage gladiator in full side profile facing right, braced in a casting stance, a " +
    "gnarled wooden staff crowned with a faintly glowing violet orb thrust forward in both " +
    "hands, tattered layered robes over bronze-trimmed leather, a ridged helm, studded " +
    "pteruges skirt, trailing cloth wrappings",
  "title-hammer":
    "a hulking heavyweight gladiator in full side profile facing right, a massive " +
    "square-headed warhammer hefted across the shoulder in both hands, heavy " +
    "hammered-bronze armor with thick pauldrons, a full-face crested galea helmet, studded " +
    "pteruges skirt, broad bronze greaves, planted wide in an immovable stance",
};

export interface SpriteSpec {
  id: "sprite-bits";
  label: string;
  provider: "openai-image";
  candidates: number;
  /** Saved size — title figures render ~180px on a 3× screen; 512 leaves reuse headroom. */
  savedSize: number;
  /** Generation canvas: PORTRAIT — a standing figure fits it natively, where a
   * square canvas pressured the model into edge-to-edge crops (the bow/hammer
   * first-generation lesson). Saves still letterbox into a square PNG. */
  size: "1024x1536";
  destination: string;
  /** Prefix of the require() path handed back after save (consumer-module relative). */
  manifestDir: string;
  template: (subject: string) => string;
}

export const SPRITE: SpriteSpec = {
  id: "sprite-bits",
  label: "Sprite (Blood in the Sand)",
  provider: "openai-image",
  candidates: 2,
  savedSize: 512,
  size: "1024x1536",
  destination: "apps/blood-in-the-sand/assets/sprites",
  manifestDir: "../../assets/sprites",
  // Same brand language as the icon template (attributes, not the game's
  // name), same isolation lesson (state what surrounds the subject — the
  // model paints grounds if merely allowed alpha). Differences are scene-fit:
  // full figure with margin, high-sun rim light, no die-cut, no shadow.
  // v2 (Tom, first generations): figures came out polished-bronze-statue —
  // the value structure must be ANCHORED IN BLACK like the icons ("reads as
  // dark inked woodcut, never a bronze statue"); and the ground smudge
  // survived the "no cast shadow" negation — isolation now borrows the
  // die-cut CUT-OUT framing (cut line = the silhouette, transparent starts
  // at the soles) without asking for the icons' visible pale outline.
  template: (subject) =>
    `${subject}. A full-figure character sprite for a grim dark-fantasy gladiator arena game ` +
    "set in a scorched desert. Hand-inked woodcut illustration: heavy black ink linework, " +
    "rough expressive hatching, and deep pooled black shadows anchor the form — the figure " +
    "reads as dark inked woodcut, never a polished bronze statue. Sun-bleached bone " +
    "(#f0e8d8) highlights carve the shape out of the dark; scorched sand-ochre (#b39763) " +
    "midtones like heat-baked dust settled on every surface. Gladiatorial desert materials: " +
    "hammered bronze trim, cracked leather wraps, sun-split wood, rust and dried blood. Lit " +
    "by a harsh high desert sun — a warm rim light burns along the helmet crest and upper " +
    "shoulders. The ENTIRE figure stands about 80% of the frame tall, centered, with empty " +
    "transparent margin visible on all four sides — above the helmet crest, below the feet, " +
    "and past every weapon tip; nothing touches or crosses the frame edge. Grim, weighty, " +
    "battle-scarred — never cute, never " +
    "photorealistic, never a clean flat vector. The figure is a clean die-cut cut-out: the " +
    "cut line follows the figure's own silhouette exactly, and every pixel outside it is " +
    "fully transparent — including directly beneath the boots, where bare transparent pixels " +
    "begin at the soles. The figure touches nothing and stands on nothing: no ground, no " +
    "cast shadow, no dust at the feet, no backdrop, no glow. No text.",
};

// ── Blood in the Sand mode cards ───────────────────────────────────────────
// Full-bleed landscape scene art for the mode select's stacked cards
// (bits-mode-select.md): the same woodcut world as the icons/sprites, but
// SCENE language — a painted place, not a cut-out subject. Two hard layout
// facts drive the template: the card lays its title/pitch/status over the
// LEFT third behind a dark scrim (so that third must stay quiet), and the
// save cover-crops the 1536×1024 canvas to a 5:2 letterbox (so the top and
// bottom quarters are sacrificial).

/** The mode-select cards in screen order, then the ranked screen's bracket
 * cards (bits-ranked.md § the ranked screen — same 900×360 scene pipeline,
 * different paste target: BRACKET_ART in RankedScreen.tsx). modeSet.ts
 * derives the checklist from this — a future mode or bracket appears there
 * by adding a key + subject. */
export const MODE_KEYS = ["ranked", "skirmish", "practice", "story", "bracket-1v1", "bracket-2v2"] as const;

/**
 * Art subjects per mode card. Each brief owns the PLACE and the LIGHT (the
 * template owns brand + composition): ranked burns at high sun, skirmish glows
 * at dusk, practice waits at dawn, story broods under storm light — four
 * times of day so the stack reads as four different promises at a glance.
 */
export const MODE_SUBJECTS: Record<string, string> = {
  ranked:
    "the packed heart of a colosseum at brutal high sun — tiers of roaring crowd rising on " +
    "the right, tattered blood-red banners streaming, heat-haze over raked fighting sand, " +
    "a lone armoured gladiator small at the arena's centre-right with arms spread to the " +
    "mob; the left side is empty scorched sky above a quiet sun-bleached arena wall",
  skirmish:
    "a gladiators' camp at dusk outside the arena walls — fighters at ease around a " +
    "crackling campfire on the right, one pair lazily sparring behind them, weapon racks " +
    "and drink, warm orange firelight against deep blue evening; the left side is a quiet " +
    "twilight sky over a low shadowed wall",
  practice:
    "an empty training yard at pale dawn — a row of straw target dummies on sun-split " +
    "wooden posts standing on the right in freshly raked sand, practice weapons leaning on " +
    "a rack, long soft morning shadows, cool bone-pale light; the left side is a quiet " +
    "empty dawn sky over a low adobe wall",
  story:
    "a lone cloaked gladiator seen from behind, walking away into a vast storm-lit desert " +
    "on the right toward a colossal ruined arena on the far horizon, wind dragging sand off " +
    "the dune crests; the left side is a quiet dark brooding sky",
  // The ranked screen's bracket cards. 1v1 must read differently from the
  // ranked MODE card above (that one sells the crowd/occasion; this one sells
  // THE DUEL): two fighters, nobody else on the sand.
  "bracket-1v1":
    "two lone gladiators circling each other at high sun in an empty arena, weapons drawn " +
    "and low, coiled an instant before the clash, long hard shadows on raked sand, heat " +
    "haze — both figures in the right two thirds; the left side is quiet scorched sky over " +
    "a sun-bleached arena wall",
  "bracket-2v2":
    "two gladiators standing back to back on empty arena sand at dusk, weapons ready, " +
    "waiting for opponents who have not yet stepped from the shadowed gate on the far " +
    "right, cool blue evening light with a torch-lit gate glow; the left side is a quiet " +
    "darkening sky over a low wall",
};

export interface ModeSpec {
  id: "mode-bits";
  label: string;
  provider: "openai-image";
  candidates: number;
  /** Saved frame — the 5:2 card crop, cover-cropped from the 3:2 canvas,
   * never letterboxed. 900 wide ≈ 2.2× density at the biggest phone render
   * (card height ~162pt × 2.5 aspect ≈ 405pt): deliberately shy of full 3×
   * — this is background art under a scrim, and the woodcut hatching hides
   * the softness, so pixel-perfect wasn't worth ~80% more bytes (Tom,
   * 2026-07-28). Bump toward 1200 if a surface ever shows the art bare. */
  savedWidth: number;
  savedHeight: number;
  /** Generation canvas: LANDSCAPE, the widest gpt-image-1 offers. 3:2 is
   * taller than the card — the save keeps the middle band, so the template
   * declares the top/bottom quarters sacrificial. */
  size: "1536x1024";
  /** Full-bleed scenes are opaque — asking for alpha invites holes in the sky. */
  background: "opaque";
  destination: string;
  /** Prefix of the require() path handed back after save (consumer-module relative). */
  manifestDir: string;
  /** The paste line targets MODE_ART in ModeSelectScreen.tsx (an `image:`
   * field per mode key), not a `"id": require(...)` manifest map. */
  manifestLine: (id: string, file: string) => string;
  template: (subject: string) => string;
}

export const MODE: ModeSpec = {
  id: "mode-bits",
  label: "Mode card (Blood in the Sand)",
  provider: "openai-image",
  candidates: 2,
  savedWidth: 900,
  savedHeight: 360,
  size: "1536x1024",
  background: "opaque",
  destination: "apps/blood-in-the-sand/assets/modes",
  manifestDir: "../../assets/modes",
  manifestLine: (id, file) =>
    id.startsWith("bracket-")
      ? `  "${id.slice("bracket-".length)}": require("../../assets/modes/${file}"), // → BRACKET_ART in RankedScreen.tsx, replacing null`
      : `  image: require("../../assets/modes/${file}"), // → MODE_ART.${id}, replacing image: null`,
  // Same brand attributes as the icon/sprite templates (never the game's
  // name); differences are all scene-fit: painted full-bleed ground instead
  // of a cut-out, composition stated as thirds (the scrim lesson: say where
  // the QUIET is, not just where the subject is), and the letterbox crop
  // declared so nothing vital lives in the top/bottom quarters.
  template: (subject) =>
    `${subject}. A wide painted scene for a grim dark-fantasy gladiator arena game set in a ` +
    "scorched desert. Hand-inked woodcut illustration: heavy black ink linework, rough " +
    "expressive hatching, deep pooled black shadows anchoring every form — it reads as dark " +
    "inked woodcut, never photorealistic, never a clean flat vector. Sun-bleached bone " +
    "(#f0e8d8) highlights carve shapes out of the dark; scorched sand-ochre (#b39763) " +
    "midtones like heat-baked dust; dried-blood red (#a32c22) rationed to banners, cloth " +
    "and wounds; a burnt-gold (#e8c87a) glow only where the light source earns it. " +
    "Composition is strict: all focal detail and figures sit in the RIGHT two thirds of the " +
    "frame; the LEFT third is quiet, low-detail atmosphere (sky, wall, drifting dust) with " +
    "no figures and no focal shapes — interface text will sit over it. The horizon and all " +
    "key elements sit in the vertical middle of the frame: the top quarter is only sky and " +
    "the bottom quarter only ground, both safe to crop away. The paint fills the whole " +
    "frame edge-to-edge with no border, no vignette, no frame line. Grim, sun-scoured, " +
    "blood-and-sand mood. No text, no lettering, no banners with writing.",
};

// ── Blood in the Sand rank badges ──────────────────────────────────────────
// The ranked ladder's tier badges (bits-ranked.md § tiers): square emblem
// cut-outs in the icon family — same die-cut bone outline, they sit on the
// same near-black UI — but HERALDIC language: a medallion crest per tier,
// material grandeur escalating up the ladder. Division numerals (III/II/I)
// composite client-side, so badges carry no numbers and no text.

/**
 * One badge per tier — a hand-mirror of TIERS in
 * packages/blood-in-the-sand-persistence/src/elo.ts (a product decision that
 * changes about as often as the mode list; 8→6 re-cut 2026-07-30). Keys are
 * the kebab-case tier names — the client derives its lookup the same way.
 */
export const BADGE_KEYS = [
  "initiate",
  "pit-fighter",
  "gladiator",
  "champion",
  "warlord",
  "immortal",
] as const;

/** Art subjects per badge — each brief owns the emblem + its material rung
 * on the ladder (rough wood → iron → bronze → gilded → dread → radiant). */
export const BADGE_SUBJECTS: Record<string, string> = {
  initiate:
    "a rough-hewn wooden practice shield on a frayed rope loop, one fresh sword notch " +
    "scarring its face — humble, unproven, still sap-pale at the cut",
  "pit-fighter":
    "a battered iron buckler crossed behind two chipped gladius swords, dented and " +
    "rivet-studded, wrapped at the grips with cracked leather",
  gladiator:
    "a proud bronze galea helmet with a horsehair crest, small laurel sprigs crossed " +
    "beneath its chin guard — the arena's true rank, earned",
  champion:
    "a gilded laurel wreath ringing a rising bronze sun disc, rays hammered and sharp, " +
    "a single drop of dried blood at the wreath's tie",
  warlord:
    "a horned bronze war-helm above two crossed blood-red war banners, torn cloth and " +
    "notched hafts, dreadful and commanding",
  immortal:
    "an upright golden gladius blazing inside a sunburst halo, ray tips drawn like " +
    "spearpoints, deathless radiance breaking through black",
};

export interface BadgeSpec {
  id: "badge-bits";
  label: string;
  provider: "openai-image";
  candidates: number;
  /** Saved size — the standing panel renders ~56pt → 168px at 3×; 256 covers. */
  savedSize: number;
  size: "1024x1024";
  destination: string;
  /** Prefix of the require() path handed back after save (consumer-module relative). */
  manifestDir: string;
  manifestLine: (id: string, file: string) => string;
  template: (subject: string) => string;
}

export const BADGE: BadgeSpec = {
  id: "badge-bits",
  label: "Rank badge (Blood in the Sand)",
  provider: "openai-image",
  candidates: 2,
  savedSize: 256,
  size: "1024x1024",
  destination: "apps/blood-in-the-sand/assets/ranks",
  manifestDir: "../../assets/ranks",
  manifestLine: (id, file) =>
    `  "${id}": require("../../assets/ranks/${file}"), // → RANK_BADGES in RankedScreen.tsx, replacing null`,
  // The icon template's brand + isolation lessons verbatim (die-cut bone
  // outline, carve-in-bone-not-black, state what surrounds the subject);
  // differences are emblem-craft: heraldic medallion composition, burnt-gold
  // accent fixed across the set (rank is the gold system), and an explicit
  // no-numerals line — the game composites III/II/I itself.
  template: (subject) =>
    `${subject}. A rank badge emblem for a brutal gladiator arena game set in a scorched ` +
    "desert — a compact heraldic medallion crest, the mark of a ladder rank. Hand-inked " +
    "woodcut illustration: one bold central emblem filling about 80% of the frame, heavy " +
    "black ink, rough expressive hatching, sun-bleached bone (#f0e8d8) highlights carving " +
    "the shape out of the dark, scorched sand-ochre (#b39763) midtones like heat-baked dust " +
    "settled on every surface, and a burnt-gold (#e8c87a) accent burning on the focal " +
    "element. Gladiatorial desert materials: hammered bronze, cracked leather, sun-split " +
    "wood, rust and dried blood. A rough aged-bone die-cut outline traces the whole " +
    "silhouette, like a woodcut poster cut from pale paper — it separates the shape from a " +
    "near-black UI. Grim, sun-scoured, blood-and-sand mood — never cute, never " +
    "photorealistic, never a clean flat vector. Chunky shapes that stay readable at 32 " +
    "pixels. The cut-out floats alone on a fully transparent background — no backdrop, no " +
    "glow, no vignette; every pixel outside the cut line is transparent. No text, no " +
    "letters, no numerals — the emblem carries no writing of any kind.",
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
