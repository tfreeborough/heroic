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
 * only, and per-subject shape/texture language lives in each brief (or the
 * user's own editing — the panel's prompt box sends verbatim).
 *
 * Types: `sfx` (ElevenLabs, Enter the Gauntlet) and `icon-bits` (OpenAI
 * gpt-image-1, Blood in the Sand's weapon/ability icons — the icon pass).
 */

/** Sound identity for Enter the Gauntlet — the tone every SFX prompt carries. */
const SOUND_IDENTITY = "a dark-fantasy dungeon game — gritty and physical, never cartoonish or synthetic";

// (Blood in the Sand's sound identity clause was RETIRED 2026-08-10 — see
// SFX_BITS below. Its icon-side twin lives on in the image templates; sound
// tone now lives in each SOUND_SUBJECTS brief's own words.)

export interface SfxSpec {
  id: "sfx" | "sfx-bits";
  label: string;
  provider: "elevenlabs-sfx";
  /** The game's sound tone, carried by the template.
   * OPTIONAL since 2026-08-10 (Tom): the BITS type dropped it — a ~30-word
   * brand clause was drowning the ~25-word subject in every generation
   * ("sun-baked and dusty" pulled wind textures into knife nicks, and
   * "never cartoonish" is a negation the model ignores). Absent = the
   * subject prompt IS the prompt; tone lives in each subject's own words. */
  soundIdentity?: string;
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
  // No soundIdentity (Tom, 2026-08-10): generations kept needing many takes
  // to land near the brief — the appended brand clause was out-shouting the
  // subject. The subject briefs in SOUND_SUBJECTS carry their own tone now;
  // only the one-shot format clause survives (it's what stops ElevenLabs
  // drifting into music beds and ambient loops, not brand styling).
  candidates: 3,
  promptInfluence: 0.3,
  loudnessLufs: -16,
  truePeakDb: -1.5,
  destination: "apps/blood-in-the-sand/assets/audio/sfx",
  manifestDir: "../../assets/audio/sfx",
  template: (subject) => `${subject}. A single one-shot sound effect, not music.`,
};

/**
 * Sound briefs per bank id, the audio twin of ICON_SUBJECTS: the ONLY sound
 * data that lives in the Forge. The bank ids for weapons/abilities derive from
 * the sim at panel runtime (src/forge/soundSet.ts) so a new roster entry appears
 * on its own, flagged until its brief is written here; the flow/UI banks are a
 * static list there. Briefs are sound-design copy, not game data — concrete
 * source + texture + shape, positive phrasing (the model ignores negations); the
 * SFX_BITS identity colours tone. These seed the panel's prompt box and go out
 * verbatim; hand-editing refines from there. Bank ids match the game's
 * catalogue clip bases (apps/blood-in-the-sand/src/audio/catalogue.ts).
 */
// Register (rewritten 2026-09-06 for Stable Audio 3, asset-forge.md § Stable
// Audio): ONE sound per brief — the model ignores "followed by"/"then", so a
// sequence comes out as its first half. Source, action, production ("a low
// ram's horn blown once, a short rough note that swells and cuts off,
// distant, echoing off stone"); concrete over evocative; no tone adjectives.
// Ability briefs kept in the old register pending their own pass.
export const SOUND_SUBJECTS: Record<string, string> = {
  // ── Combat ────────────────────────────────────────────────────────────────
  hit_generic: "a blunt weapon striking a human body, one dull heavy thud with a soft wet edge, close-miked, dead room",
  hit_blade: "a sharp knife stabbing into raw meat, one fast wet puncture with a squelch, no metal ring, close-miked, dead room",
  hit_bow: "an arrow striking a body at speed, one deep meaty thwack, close-miked, dead room",
  hit_staff: "a ball of energy bursting against a body, one dry crackling pop with a low pressure thump, close-miked",
  hit_hammer: "a huge warhammer smashing into a body, one massive blunt crunch with a deep bass thump, close-miked",
  hit_trident: "a spear tip punching into raw meat, one sharp wet stab, short and pointed, close-miked, dead room",
  hit_fang: "a small dagger nicking flesh, one thin quick wet cut, very light and short, close-miked",
  hit_scorpion: "a small crossbow bolt striking a body, one short hard thock with a wet edge, tight, no tail, close-miked",
  fire_scorpion: "a crossbow firing one bolt, one dry mechanical clack with a short sharp whoosh, tight, no tail, close-miked",
  fire_bombard: "a hand mortar firing a shell, one deep hollow thoomp with a smoky huff, no explosion, close-miked",
  cast_sinkhole: "the ground collapsing into a spiralling sink of sand — a deep grinding pour of grain sliding inward, swelling over a second then settling to a low hungry churn",
  cast_tar_pit: "thick tar glugging out onto sand — a viscous heavy pour with fat sticky bubbles popping and a wet spatter tail, oozing not splashing",
  // "bassy" cut from this brief (2026-08-14): sub-heavy takes vanish on
  // phone speakers — the growth must live in MIDRANGE grit (creak, pop,
  // crack) that a small driver can actually reproduce.
  cast_titans_draught: "a deep greedy gulp from a horn then a bodily SWELL told through gritty midrange texture — leather creaking hard, joints cracking and popping as a body grows a size, ending on a heavy planted stomp with a dry sandy slap",
  hit_bombard: "a blast wave hitting a body, one short bassy whump with a spray of grit, close-miked",
  fire_bow: "a longbow loosing an arrow, one taut string snap with a quick whoosh, dry, no impact, close-miked",
  fire_staff: "a ball of magic launched from a staff, one short rising whoosh with a soft energy hum, no impact",
  player_hurt: "a man grunting in pain from a heavy blow, one short breathy grunt, no words, close-miked",
  death: "a man's final choked gasp as he collapses onto sand, short and wet, no scream, close-miked",
  crowd_cheer: "a large crowd in an open stone arena erupting into a roar with shouts and claps, swelling then falling, recorded from the centre of the arena",
  crowd_jeer: "a large crowd in an open stone arena groaning in disappointment, a low collective ooh that sinks into grumbling, recorded from the centre of the arena",
  crowd_ambience: "a distant restless crowd murmuring in an open stone arena, steady chatter and shuffling with no distinct words or cheers, even and constant, recorded from the arena floor",
  blood_squelch: "a bare foot stepping into a pool of thick blood on sand, one short wet squelch with a sticky peel, subtle, close-miked",
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
  countdown_tick: "a wooden clapper striking once, a single dry taut clack, close-miked, dead room",
  round_start: "a low ram's horn blown once, a short rough breathy note that swells and cuts off, distant, echoing off the stone walls of an open-air arena",
  fight_start: "a huge bronze gong struck hard once, a bright crashing hit with a long shimmering decay, recorded in a wide open stone arena",
  sands_close: "a deep war horn blown long and hard, one low rough sustained blast, ominous, loud and midrange-forward, distant across a stone arena",
  // The round/match-end stings double as the battle music's BUTTON
  // (docs/design/bits-music.md): the score cuts hard the instant they land,
  // so each is one struck hit with a low male choir tail that resolves the
  // cut. Choir in unison / open fifths only — the songs are in every key.
  round_win: "a deep bronze gong struck once with a low male choir swelling underneath into one bright held open chord, resolved, long reverb tail",
  round_loss: "a deep muffled bass drum struck once with a low male choir sinking onto one dark held note and fading, heavy, long tail",
  round_draw: "a flat gong tapped once, a dull short tone with little decay, distant in a stone arena",
  match_win: "a great bronze gong struck once with a full low male choir swelling into a bright sustained open chord, vast, very long reverb tail",
  match_loss: "a slow single bass drum hit under a low male choir holding one dark note and sinking into silence, a dirge",
  // ── Ranked ────────────────────────────────────────────────────────────────
  queue_match_found: "a metal gong struck sharply once, one clang with a fast rising snap, short, close-miked",
  rank_up: "a struck bronze shield ringing under a short bright horn flourish, proud, about two seconds",
  rank_down: "a low muted drum struck once, one soft thud with a short falling breath of air, quiet",
  glory_earned: "a low wordless male choir hum swelling warm and reverent then fading, no words, no melody",
  deed_unlock: "a heavy wax seal stamped onto parchment, one thunk with a short bright metallic shimmer",
  signet_exchange: "a heavy seal press slamming down once, a deep stamp with a bright metal ring and a soft hiss of hot wax",
  signet_unlock: "a thick disc of brittle wax snapping in half, one sharp dry crack like ceramic breaking, close-miked",
  signet_purchase: "a small stack of stiff parchment dropped onto a wooden counter, a few quick heavy paper thumps, close-miked",
  reflect: "a projectile ricocheting off a mirror shield, one bright glassy metallic ting with a fast whip away, sharp, very short",
  // ── UI ────────────────────────────────────────────────────────────────────
  ui_tap: "a fingertip tapping the cover of a leather-bound book, one quick muted tick, close-miked, no reverb",
  ui_confirm: "a heavy iron latch dropping into a stone slot, one clean short clunk, close-miked, no reverb",
  ui_back: "a knuckle knocking once on a thick wooden door, one low muted knock, close-miked",
  ui_error: "a heavy wooden bar refusing to move, one dull dead thunk, short, close-miked, no reverb",
  title_gust: "a dry desert wind gusting through a stone arena, a rising sandy hiss with grit ticking off stone, tailing away",
};

/**
 * Suggested clip length per bank (seconds) — the panel prefills its duration
 * box from this on bank pick (still editable). Stable Audio needs a number
 * (ElevenLabs picked its own), and the prompting guide's SFX rule is "set a
 * short duration": one-shots ≤1s, swells 2–4s, stings 4–6s, the ambience bed
 * the panel's 30s cap.
 */
export const SOUND_DURATIONS: Record<string, number> = {
  hit_generic: 1,
  hit_blade: 1,
  hit_bow: 1,
  hit_staff: 1,
  hit_hammer: 1,
  hit_trident: 1,
  hit_fang: 0.5,
  hit_scorpion: 0.5,
  fire_scorpion: 0.5,
  fire_bombard: 1,
  cast_sinkhole: 2,
  cast_tar_pit: 2,
  cast_titans_draught: 2.5,
  hit_bombard: 1,
  fire_bow: 1,
  fire_staff: 1,
  player_hurt: 1,
  death: 1.5,
  crowd_cheer: 3,
  crowd_jeer: 3,
  crowd_ambience: 30,
  blood_squelch: 0.5,
  cast_generic: 1,
  cast_sandtrap: 1.5,
  cast_tremor: 1.5,
  cast_warding_shout: 1.5,
  quake_rumble: 4,
  cast_harpoon: 1.5,
  cast_dash: 1,
  cast_mirror_guard: 1,
  cast_ironhide: 1.5,
  cast_straw_man: 1,
  cast_war_drums: 2,
  cast_blood_font: 1.5,
  cast_sandstorm: 2,
  detonate_sandtrap: 1.5,
  harpoon_whip: 1,
  heal_tick: 0.5,
  countdown_tick: 0.5,
  round_start: 3,
  fight_start: 3,
  sands_close: 3,
  round_win: 4,
  round_loss: 4,
  round_draw: 2,
  match_win: 6,
  match_loss: 6,
  queue_match_found: 1,
  rank_up: 2,
  rank_down: 1,
  glory_earned: 1.5,
  deed_unlock: 1,
  signet_exchange: 1,
  signet_unlock: 1,
  signet_purchase: 1,
  reflect: 0.5,
  ui_tap: 0.5,
  ui_confirm: 0.5,
  ui_back: 0.5,
  ui_error: 0.5,
  title_gust: 3,
};

// ── Blood in the Sand icons ────────────────────────────────────────────────
// The draft-screen icon set (docs/design/pvp-abilities.md identity pass).
// Consistency levers: ONE fixed style paragraph (below) + a per-category
// accent + a checked-in manifest of subjects, so the whole set is generated
// from the same brand language. Acceptance test (the panel shows it): every
// icon must stay readable at 32px — that's roster-row size in the game.

export type IconCategory = "weapon" | "offensive" | "defensive" | "support" | "currency";

/** Accent colour per category — the game's category-colour system, baked in.
 * `currency` is the store's Signet (bits-store.md): not a roster row, so its
 * icon is a STATIC entry in iconSet.ts rather than a derived one. */
export const ICON_ACCENTS: Record<IconCategory, { name: string; hex: string }> = {
  weapon: { name: "antique gold", hex: "#d99a41" },
  offensive: { name: "arena red", hex: "#d94141" },
  defensive: { name: "steel blue", hex: "#4da3d9" },
  support: { name: "arena green", hex: "#5fc75f" },
  currency: { name: "sealing-wax red", hex: "#a03030" },
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
  trident: "a three-pronged iron trident held at a dynamic diagonal, long barbed points, the retiarius's fishing spear",
  fang: "a short curved dagger held at a dynamic diagonal, a sickly green venom sheen along the edge and one drop falling from the tip",
  scorpion: "a compact repeating crossbow with a top-mounted bolt magazine, held at a dynamic diagonal, three short iron bolts fanned beside it",
  bombard: "a squat bronze hand-mortar with a flared muzzle held at a dynamic diagonal, a round black shell arcing above it trailing a thin smoke line",
  // Subject rule learned here (Tom, 2026-08-10): the icon template demands
  // ONE BOLD CENTRAL SUBJECT — a pure-scene brief makes the model invent
  // an object (it kept planting weapons mid-swirl). Zone abilities anchor
  // on a concrete object instead (tremor's boot, sandstorm's eye).
  sinkhole:
    "a whirlpool of collapsing golden sand seen from above, spiral ridges streaming down into a dark central throat, a cracked clay pot tipping half-swallowed into the centre",
  "tar-pit":
    "a toppled iron cauldron pouring thick black tar across sand, the spill spreading into a glossy splattered pool with fat sticky drips",
  "titans-draught":
    "a rough-hewn stone drinking horn overflowing with golden liquid, oversized fists' worth of cracks glowing up the horn from a giant's grip",
  // Call the Tide (bits-sands-deeds.md) — the deed-gated horn that raises
  // the Blood Tide. The object is a war-horn; the tide is the tell.
  "call-the-tide":
    "a great curved bronze war-horn with a dark red tide of blood surging up and over its bell, the wave curling inward, droplets flung from the crest",
  // Re-briefed 2026-08-14 (Tom: the reliquary-CANNON read as artillery,
  // not aid) — the anchor object is now unambiguously a healer's tool:
  // lantern body, linen wrap, radiance. The thread stays (it IS the
  // weapon's in-game silhouette).
  lifeline:
    "an ornate bronze healer's lantern wound with white linen bandage, held aloft at a dynamic diagonal, a taut golden thread of mending light streaming from its glowing heart",
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
  // The premium currency (bits-store.md § the Signet): the subject IS a
  // round wax seal, which is fine under the no-frames rule — that rule
  // forbids framing AROUND a subject, not round subjects.
  signet:
    "a thick round seal of deep red sealing wax stamped with an embossed gladiator-helmet crest, a heavy molten rim with one cooled drip at the edge, a warm gold glint raking across the impression",
};

export interface IconSpec {
  id: "icon-bits";
  label: string;
  provider: "openai-image";
  /** Images are slow + priced per call — a pair to pick from beats a spread. */
  candidates: number;
  /** Saved size (game renders at ≤52px; 512 keeps the bundle light). */
  savedSize: number;
  /** True pixel grid the save snaps to — the retro pixel-art style's
   * consistency guarantee lives in the pipeline, not the model
   * (bits-art-style.md § pixel grids). */
  pixelGrid: number;
  /** Hard palette budget the save crushes to (median-cut + Bayer ordered
   * dithering in forge/images.ts) — the early-90s VGA crunch (Tom,
   * 2026-08-07: uncapped palettes read "too clean"). */
  paletteColours: number;
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
  pixelGrid: 64,
  paletteColours: 32,
  size: "1024x1024",
  destination: "apps/blood-in-the-sand/assets/icons",
  manifestDir: "../../assets/icons",
  // Pre-rendered pixel-art direction (Tom, 2026-08-06 — replaced the v1–v5
  // dark-fantasy woodcut line; docs/design/bits-art-style.md). The brand
  // anchor is the APP ICON: a pre-rendered pixel helmet half-buried in
  // bloody sand — dimensional light, true full-colour materials, chunky
  // pixels. Still described by attributes, never by naming the game.
  // Woodcut-era lessons that survive the style change:
  // - isolation is stated as what SURROUNDS the subject (merely allowing
  //   alpha makes the model paint grounds);
  // - no frames — separation/framing is the GAME's job (v5, 2026-08-04);
  // - grim stays sun-scoured, never gothic-damp.
  // New rule (Tom, 2026-08-06): cut-outs must be BACKGROUND-AGNOSTIC — the
  // UI is WIP and surfaces will gain/lose backdrops, so nothing bakes
  // outside the silhouette. Sand grounding is fine only INSIDE it (the app
  // icon's half-buried trick), and only where the subject brief asks.
  // The prompt's pixel language is a style cue only — the save pipeline
  // snaps to the true grid (pixelGrid above), so set-wide consistency never
  // depends on the model drawing honest pixels.
  template: (subject, category) => {
    const accent = ICON_ACCENTS[category];
    return (
      `${subject}. A game ability icon for a brutal gladiator arena game set in a scorched ` +
      "desert. Early-1990s retro pixel art in the lineage of VGA DOS and 16-bit Amiga " +
      "games: hand-placed chunky pixels, a strictly limited palette of about 32 colours, " +
      "shading built from hard stepped colour ramps and checkerboard dithering — no smooth " +
      "gradients, no anti-aliasing. The form still reads dimensional: specular glints on " +
      "metal, warm light bounced up from golden sand, deep warm umber shadow in the " +
      "recesses, never pure black — but every transition is a decisive pixel step. True " +
      "materials each in " +
      "their own full colour, no sepia wash: battle-grey steel (#9aa0a6), honey sand-gold " +
      "(#dcb96f), bone-white specular highlights (#f2e9d4), saturated dried-blood crimson " +
      `(#a32c22), cracked leather, sun-split wood. A ${accent.name} (${accent.hex}) accent ` +
      "glows on the focal element. One bold central subject filling about 80% of the frame, " +
      "lit by a low warm desert sun. Grim, sun-scoured, blood-and-sand mood — never cute, " +
      "never cartoonish, never flat vector art, never ink outlines or crosshatching, never " +
      "a photograph. Chunky forms that stay readable at 32 pixels. Draw no frame of any " +
      "kind: no circle, ring, plate, badge backing, or border around the subject — the game " +
      "composites any framing itself. The subject floats alone on a fully transparent " +
      "background — no backdrop, no glow, no vignette, no shadow cast outside the subject; " +
      "every pixel outside the subject is transparent. No text."
    );
  },
};

// ── Blood in the Sand sprites ──────────────────────────────────────────────
// Full-figure scene art (title screen first; splashes later) — the same
// pre-rendered pixel world as the icons, but FIGURE language instead of
// emblem language: whole body in frame, a baked facing direction, lit for
// the sunlit High Sun scene. One deliberate difference from the icon
// template: no ground/cast shadow at all (the scene draws its own contact
// shadows, so the figure must arrive clean to place).

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
  /** True pixel grid the save snaps to (bits-art-style.md § pixel grids). */
  pixelGrid: number;
  /** Hard palette budget (see IconSpec.paletteColours). */
  paletteColours: number;
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
  pixelGrid: 128,
  paletteColours: 48,
  size: "1024x1536",
  destination: "apps/blood-in-the-sand/assets/sprites",
  manifestDir: "../../assets/sprites",
  // Same brand language as the icon template (attributes, not the game's
  // name), same isolation lesson (state what surrounds the subject — the
  // model paints grounds if merely allowed alpha). Differences are scene-fit:
  // full figure with margin, warm rim light, no shadow. The woodcut-era
  // ground-smudge lesson survives restyled: the "no cast shadow" negation
  // alone failed, so isolation keeps the CUT-OUT framing (cut line = the
  // silhouette, transparent starts at the soles).
  template: (subject) =>
    `${subject}. A full-figure character sprite for a brutal gladiator arena game set in a ` +
    "scorched desert. Early-1990s retro pixel art in the lineage of VGA DOS and 16-bit " +
    "Amiga games: hand-placed chunky pixels, a strictly limited palette of about 48 " +
    "colours, shading built from hard stepped colour ramps and checkerboard dithering — " +
    "no smooth gradients, no anti-aliasing. The figure still reads dimensional: specular " +
    "glints on armour, warm light bounced up from golden sand, deep warm umber shadow in " +
    "the recesses, never pure black — but every transition is a decisive pixel step. True " +
    "materials each in their own full colour, no sepia wash: battle-grey steel (#9aa0a6), " +
    "bone-white specular highlights (#f2e9d4), saturated dried-blood crimson (#a32c22), " +
    "cracked leather wraps, hammered bronze trim, sun-split wood. Lit by a low warm desert " +
    "sun — a golden rim light burns along the helmet crest and upper shoulders. The ENTIRE " +
    "figure stands about 80% of the frame tall, centered, with empty transparent margin " +
    "visible on all four sides — above the helmet crest, below the feet, and past every " +
    "weapon tip; nothing touches or crosses the frame edge. Grim, weighty, battle-scarred — " +
    "never cute, never cartoonish, never flat vector art, never ink outlines or " +
    "crosshatching, never a photograph. The figure is a clean cut-out: the cut line follows " +
    "the figure's own silhouette exactly, and every pixel outside it is fully transparent — " +
    "including directly beneath the boots, where bare transparent pixels begin at the " +
    "soles. The figure touches nothing and stands on nothing: no ground, no cast shadow, no " +
    "dust at the feet, no backdrop, no glow. No text.",
};

// ── Blood in the Sand mode cards ───────────────────────────────────────────
// Full-bleed landscape scene art for the mode select's stacked cards
// (bits-mode-select.md): the same pre-rendered pixel world as the icons/sprites, but
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
export const MODE_KEYS = ["ranked", "skirmish", "practice", "story", "deeds", "bracket-1v1", "bracket-2v2"] as const;

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
  deeds:
    "a vast illuminated chronicle unrolled across a stone table by candlelight — aged " +
    "parchment dense with inked deeds on the right, wax seals and small gold-leaf " +
    "medallions linked by drawn lines like a constellation, a quill at rest, warm candle " +
    "glow; the left side is quiet shadowed stone in deep amber dark",
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
   * — this is background art under a scrim, and since the pixel-grid snap
   * the true resolution is the grid anyway (the saved frame just bakes the
   * blocks), so pixel-perfect wasn't worth ~80% more bytes (Tom,
   * 2026-07-28). Bump toward 1200 if a surface ever shows the art bare. */
  savedWidth: number;
  savedHeight: number;
  /** True pixel grid the save snaps to (bits-art-style.md § pixel grids) —
   * scenes get a finer 3px block than the cut-outs' 4px: they're background
   * art under a scrim, and too-chunky blocks destroy painted depth. */
  pixelGridWidth: number;
  pixelGridHeight: number;
  /** Hard palette budget (see IconSpec.paletteColours) — scenes get the
   * biggest budget: gradient skies need more ramp steps than emblems. */
  paletteColours: number;
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
  pixelGridWidth: 300,
  pixelGridHeight: 120,
  paletteColours: 64,
  size: "1536x1024",
  background: "opaque",
  destination: "apps/blood-in-the-sand/assets/modes",
  manifestDir: "../../assets/modes",
  manifestLine: (id, file) =>
    id.startsWith("bracket-")
      ? `  "${id.slice("bracket-".length)}": require("../../assets/modes/${file}"),`
      : `  image: require("../../assets/modes/${file}"),`,
  // Same brand attributes as the icon/sprite templates (never the game's
  // name); differences are all scene-fit: painted full-bleed ground instead
  // of a cut-out, composition stated as thirds (the scrim lesson: say where
  // the QUIET is, not just where the subject is), and the letterbox crop
  // declared so nothing vital lives in the top/bottom quarters.
  template: (subject) =>
    `${subject}. A wide scene for a brutal gladiator arena game set in a scorched ` +
    "desert. Early-1990s retro pixel art in the lineage of VGA DOS and 16-bit Amiga game " +
    "backdrops: hand-placed chunky pixels, a strictly limited palette of about 64 colours, " +
    "skies and light built from hard stepped colour ramps and checkerboard dithering — no " +
    "smooth gradients, no anti-aliasing, never flat vector art, never ink outlines or " +
    "crosshatching, never a photograph. True " +
    "materials and light each in their own full colour, no sepia wash: honey sand-gold " +
    "(#dcb96f) ground and warm ambience, battle-grey steel (#9aa0a6), bone-white highlights " +
    "(#f2e9d4), deep warm umber shadows (#4a3520) never pure black; dried-blood red " +
    "(#a32c22) rationed to banners, cloth and wounds; a burnt-gold (#e8c87a) glow only " +
    "where the light source earns it. " +
    "Composition is strict: all focal detail and figures sit in the RIGHT two thirds of the " +
    "frame; the LEFT third is quiet, low-detail atmosphere (sky, wall, drifting dust) with " +
    "no figures and no focal shapes — interface text will sit over it. The horizon and all " +
    "key elements sit in the vertical middle of the frame: the top quarter is only sky and " +
    "the bottom quarter only ground, both safe to crop away. The paint fills the whole " +
    "frame edge-to-edge with no border, no vignette, no frame line. Grim, sun-scoured, " +
    "blood-and-sand mood. No text, no lettering, no banners with writing.",
};

// ── Blood in the Sand home backdrop ────────────────────────────────────────
// Full-bleed PORTRAIT scene art for the HomeScreen (the front door): the
// generated backdrop replaces the hand-painted Skia High Sun scene
// (src/screens/homeScene.ts) as the screen's ground; UI (title top, menu
// bottom) and the surviving living layers (sprite duel, motes, swallows,
// dust storm) composite on top. Three hard layout facts drive the template:
// the title text sits over the TOP of the frame, the menu buttons AND the
// two duelling title sprites stand on the BOTTOM third, and phones
// cover-crop the 2:3 canvas to ~19.5:9 portrait — keeping full height but
// only the central ~70% of the width, so the outer sixths are sacrificial.

/** The home set — one backdrop today; future splash/loading scenes append
 * here (homeSet.ts derives the checklist from this). */
export const HOME_KEYS = ["home"] as const;

/** Art subjects per home key. The brief owns the PLACE and the LIGHT; the
 * template owns brand + the portrait composition contract. */
export const HOME_SUBJECTS: Record<string, string> = {
  home:
    "standing on the raked sand of a colosseum floor at brutal high sun, looking across " +
    "the empty arena — the far wall rises in the middle of the frame with packed crowd " +
    "tiers above it, tattered blood-red banners hanging in the heat, heat-haze shimmering " +
    "where sand meets wall, a few scattered pebbles and one dark old bloodstain sunk into " +
    "the raked lines of the foreground sand",
};

export interface HomeSpec {
  id: "home-bits";
  label: string;
  provider: "openai-image";
  candidates: number;
  /** Saved frame — the full portrait canvas at generation size (no downscale:
   * this is the one full-screen surface, shown bare with UI over it; phones
   * cover-crop it to their own aspect at runtime via RN Image). */
  savedWidth: number;
  savedHeight: number;
  /** True pixel grid (bits-art-style.md § pixel grids) — 4px blocks like the
   * cut-outs; the backdrop is the style's biggest single statement. */
  pixelGridWidth: number;
  pixelGridHeight: number;
  /** Hard palette budget (see IconSpec.paletteColours) — scene-sized. */
  paletteColours: number;
  /** Generation canvas: PORTRAIT, the tallest gpt-image-1 offers. */
  size: "1024x1536";
  /** Full-bleed scenes are opaque — asking for alpha invites holes in the sky. */
  background: "opaque";
  destination: string;
  /** Prefix of the require() path handed back after save (consumer-module relative). */
  manifestDir: string;
  /** The paste line targets HOME_ART in src/screens/homeArt.ts. */
  manifestLine: (id: string, file: string) => string;
  template: (subject: string) => string;
}

export const HOME: HomeSpec = {
  id: "home-bits",
  label: "Home backdrop (Blood in the Sand)",
  provider: "openai-image",
  candidates: 2,
  savedWidth: 1024,
  savedHeight: 1536,
  pixelGridWidth: 256,
  pixelGridHeight: 384,
  paletteColours: 64,
  size: "1024x1536",
  background: "opaque",
  destination: "apps/blood-in-the-sand/assets/home",
  manifestDir: "../../assets/home",
  manifestLine: (id, file) => `  "${id}": require("../../assets/home/${file}"),`,
  // The mode-card template's brand + scene lessons, rotated to portrait: the
  // quiet zones are stated as WHAT THEY CONTAIN (sky / empty sand), never as
  // "leave space" — the model paints places, not absences. The centre-safe
  // rule mirrors the mode cards' left-third rule for the phone cover-crop.
  template: (subject) =>
    `${subject}. A tall portrait scene for a brutal gladiator arena game set in a scorched ` +
    "desert — a phone game's title screen backdrop. Early-1990s retro pixel art in the " +
    "lineage of VGA DOS and 16-bit Amiga game backdrops: hand-placed chunky pixels, a " +
    "strictly limited palette of about 64 colours, skies and light built from hard stepped " +
    "colour ramps and checkerboard dithering — no smooth gradients, no anti-aliasing, " +
    "never flat vector art, never ink outlines or crosshatching, never a photograph. True " +
    "materials and light each in their own full colour, no sepia wash: honey sand-gold " +
    "(#dcb96f) ground and warm ambience, bone-white highlights (#f2e9d4), deep warm umber " +
    "shadows (#4a3520) never pure black; dried-blood red (#a32c22) rationed to banners and " +
    "old stains. Composition is strict: the TOP third of the frame is only vast quiet " +
    "scorched sky — open, low-detail, no shapes (title lettering will sit over it). The " +
    "BOTTOM third is only open empty raked sand — flat, low-detail, no objects or figures " +
    "(menu buttons and fighters composite over it). All focal detail — the far arena wall, " +
    "crowd tiers, banners, heat haze — lives in the horizontal band between them, and " +
    "every essential shape stays within the central two thirds of the width: phones crop " +
    "the outer sixth on each side away. The paint fills the whole frame edge-to-edge with " +
    "no border, no vignette, no frame line. Grim, sun-scoured, blood-and-sand mood. No " +
    "text, no lettering, no banners with writing.",
};

// ── Blood in the Sand rank badges ──────────────────────────────────────────
// The ranked ladder's tier badges (bits-ranked.md § tiers): square emblem
// cut-outs in the icon family, on the same near-black UI (outline-free
// since 2026-08-04 like every generated cut-out — see the icon template's
// v5 note; separation is the game's job). ONE anchor object across the set: every badge is a
// round gladiator SHIELD shown face-on (Tom, 2026-07-31 — helmets tried and
// dropped; shield chosen for the crest canvas). THE LEGIBILITY RULE (Tom,
// same day): rank must read at a glance when the icon is tiny, so each tier
// owns a DOMINANT COLOUR (BADGE_ACCENTS below) that floods the shield face —
// colour first, decoration second; the all-bronze look is exactly what this
// replaces. Division numerals (III/II/I) composite client-side, so badges
// carry no numbers and no text.

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

export interface BadgeAccent {
  name: string;
  hex: string;
}

/**
 * The tier-colour system — the at-a-glance rank signal. Six hues picked to
 * stay distinct against the near-black UI at ~24px and to differ in
 * lightness as well as hue (squint-test: tan, grey, orange, near-white,
 * red, bright gold). This is the ranked twin of ICON_ACCENTS, but the
 * colour DOMINATES the badge rather than accenting it.
 */
export const BADGE_ACCENTS: Record<string, BadgeAccent> = {
  initiate: { name: "sun-split pale wood tan", hex: "#c9b58a" },
  "pit-fighter": { name: "cold hammered iron grey", hex: "#9aa3ad" },
  gladiator: { name: "warm hammered bronze", hex: "#c9823f" },
  champion: { name: "polished bright silver", hex: "#dfe4ea" },
  warlord: { name: "deep lacquered blood-crimson", hex: "#a32c22" },
  immortal: { name: "blazing radiant gold", hex: "#f5d76e" },
};

/** Art subjects per badge — every brief is the SAME anchor (a round shield
 * face-on); its dominant material-colour (BADGE_ACCENTS) and crest-work
 * climb the ladder together. */
export const BADGE_SUBJECTS: Record<string, string> = {
  initiate:
    "a cracked round wooden practice shield face-on, rough sun-split pale planks, a " +
    "frayed rope rim, one fresh sword notch across the face — humble and unproven",
  "pit-fighter":
    "a dented round iron buckler face-on, bare hammered steel plates and rivets, a " +
    "plain undecorated boss, scuffed battle-worn rim",
  gladiator:
    "a hammered bronze round shield face-on, a horsehair-crested galea embossed proudly " +
    "on the boss, cracked-leather rim wrap — the arena's true rank, earned",
  champion:
    "a polished silver round shield face-on ringed in gilded laurel, a rising sun " +
    "embossed on the boss, mirror-bright and parade-clean",
  warlord:
    "a lacquered blood-crimson round war shield face-on, a spiked gold-trimmed boss, " +
    "gold studs at the rim, battle-notched — dreadful and commanding",
  immortal:
    "a blazing golden sun-shield face-on, rays like spearpoints bursting from its rim, " +
    "a white-hot sunburst boss, deathless radiance breaking through black",
};

export interface BadgeSpec {
  id: "badge-bits";
  label: string;
  provider: "openai-image";
  candidates: number;
  /** Saved size — the standing panel renders ~56pt → 168px at 3×; 256 covers. */
  savedSize: number;
  /** True pixel grid the save snaps to (bits-art-style.md § pixel grids). */
  pixelGrid: number;
  /** Hard palette budget (see IconSpec.paletteColours). */
  paletteColours: number;
  size: "1024x1024";
  destination: string;
  /** Prefix of the require() path handed back after save (consumer-module relative). */
  manifestDir: string;
  manifestLine: (id: string, file: string) => string;
  /** Accent defaults to the Gladiator bronze so the bare-subject curl path
   * still works; the panel always passes the tier's real accent. */
  template: (subject: string, accent?: BadgeAccent) => string;
}

export const BADGE: BadgeSpec = {
  id: "badge-bits",
  label: "Rank badge (Blood in the Sand)",
  provider: "openai-image",
  candidates: 2,
  savedSize: 256,
  pixelGrid: 64,
  paletteColours: 32,
  size: "1024x1024",
  destination: "apps/blood-in-the-sand/assets/ranks",
  manifestDir: "../../assets/ranks",
  // No trailing comment on the line — it's pasted verbatim and a comment
  // would have to be hand-stripped every time (Tom, 2026-08-04); the panel's
  // "Paste into …" label already names the destination.
  manifestLine: (id, file) => `  "${id}": require("../../assets/ranks/${file}"),`,
  // The icon template's brand + isolation lessons verbatim (pre-rendered
  // pixel art, state what surrounds the subject); differences are the rank
  // system: the shield ANCHOR baked in structurally (one object family,
  // face-on — even a hand-edited subject stays on-theme), and the tier's
  // DOMINANT COLOUR replacing the icons' full-material palette — at tiny
  // sizes rank is read by colour before shape, so the colour must own the
  // shield face, not decorate it. No-numerals stays: the game composites
  // III/II/I itself.
  template: (subject, accent = BADGE_ACCENTS["gladiator"]!) =>
    `${subject}. A rank badge emblem for a brutal gladiator arena game set in a scorched ` +
    "desert. The emblem is a single round gladiator shield shown face-on — the ladder's " +
    "one anchor object; no other objects share the frame. The shield's dominant material " +
    `colour is ${accent.name} (${accent.hex}): it floods the whole shield face and rim, ` +
    "unmistakable at a glance — this colour IS the rank, so it must stay pure and " +
    "saturated, never muddied toward brown or bronze by dust or shadow. Early-1990s " +
    "retro pixel art in the lineage of VGA DOS and 16-bit Amiga games: hand-placed " +
    "chunky pixels, a strictly limited palette of about 32 colours, shading built from " +
    "hard stepped colour ramps and checkerboard dithering — no smooth gradients, no " +
    "anti-aliasing. Specular glints on its metal and lacquer, deep warm shadow in the " +
    "embossing, one bold central emblem filling about 80% of the frame, lit by a low " +
    "warm desert sun. " +
    "Grim, sun-scoured, blood-and-sand mood — never cute, never cartoonish, never flat " +
    "vector art, never ink outlines or crosshatching, never a photograph. Chunky forms: " +
    "at 24 pixels the shield must still read, and its colour must still name the rank. " +
    "The shield floats alone on a fully transparent background — no backdrop, no glow, " +
    "no vignette; every pixel outside the shield is transparent. No text, no letters, no " +
    "numerals — the emblem carries no writing of any kind.",
};

// ── Blood in the Sand deed icons (achievements.md § icon art) ──────────────
// The Deed Map's node medallions. Only the deed-SPECIFIC families forge here
// (~10 subjects): the per-ability cast chains and per-weapon round chains
// REUSE the already-forged loadout icons in-game (deedIcons.ts maps them),
// which keeps recognition and saves ~45 generations. Chain tiers share one
// icon — the map composites bronze/silver/gold tier frames itself, so like
// the badges' no-numerals rule, the art carries no tier marking.

// Subjects are written to the CHAIN'S TITLE FANTASY (Tom, 2026-08-04 —
// titles first, image serves the name), aimed at the apex title since all
// tiers share the icon: wins = the serpent ladder ending at The World
// Serpent, glory = the Hercules myth-arc ending at Demigod / A Star Is
// Born, damage = the blood-flood ladder ending at Hemoclysm, and so on.
export const DEED_SUBJECTS: Record<string, string> = {
  // ── Wave-2 feats (2026-08-08) — single bold familiar objects, no scenes ──
  // "By a Thread" — victory hanging by one strand.
  "deed-thread":
    "a heavy bronze gladiator medallion dangling from a single fraying red thread, the last strand " +
    "taut and about to snap",
  // "Return to Sender" — the mirror that turns the shot.
  "deed-reflect":
    "a polished round bronze mirror with an arrow rebounding off its face, the arrow bent back " +
    "the way it came, one bright glint on the mirror",
  // "Still Standing" — the one who never fell.
  "deed-standing":
    "a single intact marble column standing upright among broken column stumps, warm desert light " +
    "on its capital",
  // "Flawless" — the unblemished shield.
  "deed-flawless":
    "a pristine polished steel shield with a perfect mirror finish, not a single dent or scratch, " +
    "one clean specular star of light",
  // "The Old Ways" — bare steel, no sorcery.
  "deed-old-ways":
    "a plain unadorned iron gladius sword driven point-down into sand, stripped of any ornament, " +
    "honest worn steel",
  // "Carnage" — overwhelming damage in one bout.
  "deed-carnage":
    "a heavy cleaver-like blade buried deep in a wooden arena post, the post splitting from the " +
    "force, droplets of crimson on the steel",
  // "Killer Instinct" — the precise repeated strike.
  "deed-crits":
    "a wooden archery target with three arrows clustered dead-centre in the red bullseye, shafts " +
    "almost touching",
  // "Never Doubted" — the comeback from the brink.
  "deed-comeback":
    "a bronze phoenix rising with spread wings from a small pile of grey ash, tail feathers still " +
    "trailing embers",
  // "Christened with blood" — the arena's baptism.
  "deed-first-match":
    "a battered bronze gladiator helm anointed with a fresh blood mark, one bold red line " +
    "running down between the eye-slits — a christening, the arena's baptism",
  // The serpent ladder: Sand Snake → … → The World Serpent.
  "deed-wins":
    "a colossal serpent coiled tight around a cracking marble victory column, crushing it, " +
    "jaws open above the capital — scales like hammered bronze, one slitted eye fixed on " +
    "the viewer",
  // The death ladder: Lights Out → … → The Fourth Horseman.
  "deed-kills":
    "a gaunt pale horse's skull in profile wearing a torn battle-caparison, a scythe " +
    "blade curving behind it like a crescent — the fourth rider come to the sand",
  // The heat ladder: Hot Sand → … → Seas of Molten Glass.
  "deed-win-streak":
    "a heavy iron chain pulled taut on the diagonal, its links glowing hotter toward the " +
    "middle — dark cold iron at the ends, white-molten at the centre link — and still " +
    "UNBROKEN, radiating heat",
  // The burial ladder: Swallowed by the Dunes → … → Fossil Record.
  "deed-loss-streak":
    "a gladiator's skeleton pressed flat into layered stone strata like a fossil, sword " +
    "still clutched in its bony grip — defeat recorded in the rock, worn with dark humour",
  // The myth-arc: Zero to Hero → … → Demigod / A Star Is Born.
  "deed-glory":
    "a laurel-crowned marble hero's bust breaking apart at the crown into a rising " +
    "constellation of stars — a mortal becoming myth, renown outliving the flesh",
  // The blood-flood ladder: Bloodletter → … → Hemoclysm.
  "deed-damage":
    "blood bursting through a stone colosseum gate — torrents forced between the pillars " +
    "and out over the steps, the arch straining — the arena itself overflowing with " +
    "spilled blood",
  // The mercy ladder: Medic → … → Guardian Angel → Panacea.
  "deed-healing":
    "a clay chalice with folded feathered wings wrapped around its bowl, pouring an " +
    "endless stream of glowing liquid that never empties — the cure for everything",
  // "Not a Scratch".
  "deed-untouched":
    "a flawless polished breastplate gleaming bone-white, an incoming arrow shattering " +
    "against it into splinters — not a single mark on the metal",
  // "Lifeblood" — 200 health clawed back in one fight.
  "deed-lifeblood":
    "an anatomical heart bound tight in leather cords, one bright drop falling into it " +
    "from above, a young green vine curling out of its crown — life pulled back from the " +
    "brink",

  // ── Wave-3: the 2v2 board (2026-08-24) — the PAIR is the motif. Two of a
  // thing where the Season I board had one; single bold objects, no scenes.
  // "Two Blades, One Sand" — the board's root.
  "deed-two-blades":
    "two gladiator swords crossed point-up and bound together at the hilts with one red " +
    "cord, driven into a single mound of sand",
  // The pair ladder: Sworn Brothers → The Twin Lions → Blood Brothers → The Dioscuri.
  "deed-duo-wins":
    "two bronze lion heads facing outward from one shared mane, a single star set between " +
    "their brows — Castor and Pollux as beasts of the pit",
  // The assist ladder: Wingman → The Setup Man → The Second Blade.
  "deed-assists":
    "a wooden practice post already studded with one arrow, a second arrow in flight about " +
    "to strike beside it — the first blow that makes the second one count",
  // The vengeance ladder: An Eye for an Eye → Vendetta → Nemesis.
  "deed-revenge":
    "a broken bronze helm on the sand with a single dagger driven down through its crest, " +
    "the blade's pommel wrapped in a fallen comrade's red sash",
  // The clutch ladder: Against the Odds → One Against Two → The Last Man Standing.
  "deed-clutch":
    "one small bronze figure of a lone fighter standing braced at the centre of a ring of " +
    "sand, two enemy spears crossed and planted at its feet — the pair that couldn't take it",
  // The double-kill ladder: Two for One → Reaper's Pair → Both Barrels.
  "deed-double-kill":
    "a single heavy scythe blade with TWO skulls hanging from its haft by one cord, " +
    "swinging together",
  // "In Concert" — two blows landing as one.
  "deed-concert":
    "two bronze war horns crossed bell-to-bell, a single burst of sound lines radiating from " +
    "where they meet",
  // "The Ambush" — the kill before the fight has drawn breath.
  "deed-ambush":
    "an hourglass with only a few grains fallen, a blade already through its upper bulb " +
    "spilling the sand — the fight over before the glass has started",
  // "Swift Vengeance" — the avenging blow in seconds.
  "deed-swift-vengeance":
    "a bronze arrowhead trailing a red ribbon, shot straight down into the sand beside a " +
    "fallen comrade's dropped helm, the ribbon still in the air",
  // "The Last Word" — the decider, won alone against two.
  "deed-last-word":
    "a single raised bronze fist gripping one broken spear shaft, two more broken spears " +
    "lying beneath it in the sand — the last thing said in the argument",
  // "Shieldwall" — neither of the pair fell.
  "deed-shieldwall":
    "two tall bronze tower shields locked edge to edge into one wall, a shower of arrows " +
    "snapped and scattered at their base, not one through",
  // "Matching Set" — the pair with the same steel.
  "deed-matching-set":
    "two identical bronze gladiator swords lying side by side on a leather roll, perfectly " +
    "mirrored, a single tie binding both scabbards",
  // "Selfless" — a partner's health restored.
  "deed-selfless":
    "one clay chalice tipped to pour its glowing liquid into a second empty chalice beside " +
    "it, the giver's cup nearly drained",
  // "Even Split" — the spoils shared exactly.
  "deed-even-split":
    "a bronze balance scale with one skull on each pan, perfectly level, the beam " +
    "dead-horizontal",
  // "The Meat Shield" — three quarters of the blows, and still standing.
  "deed-meat-shield":
    "a battered bronze breastplate absolutely bristling with snapped arrow shafts and dents, " +
    "still buckled, still whole — worn with pride",
  // "Along for the Ride" — the joke: won, contributed nothing.
  "deed-along-for-the-ride":
    "a small wooden cart with a gladiator's helm sitting inside it like a passenger, a single " +
    "rope leading off out of frame — someone else is pulling",
  // "Nobody's Hero" — the joke: out-fought everyone and lost anyway.
  "deed-nobodys-hero":
    "a laurel wreath dropped in the sand beside a broken sword, the leaves still green, " +
    "nobody there to pick it up",
  // ── The Blood Tide chapter (bits-sands-deeds.md, 2026-09-09) — one bold
  // object each; the tide is always BLOOD, never water, never clean rings ──
  "deed-tide-horn": "a bronze war-horn raised skyward with a wave of dark blood cresting behind it",
  "deed-tide-kills": "a gladiator's short sword planted upright in sand as a tide of blood surges around its base",
  "deed-baptism": "a warrior's fist punching up out of a churning blood tide, clutching a broken blade",
  "deed-waist-deep": "a gladiator's greaved legs wading waist-deep through thick dark blood, ripples spreading",
  "deed-tide-decided": "an empty bronze helmet half-sunk in a pool of blood, the surface swirling inward",
  "deed-quicksand": "an hourglass with sand pouring so fast the lower bulb overflows, cracks in the glass",
  "deed-last-grain": "a single grain of sand falling from an empty hourglass onto a drop of blood",
  "deed-undertow": "a harpoon chain dragging a bronze greave down into a curling wave of blood",
  "deed-dry-feet": "a pair of bare sandaled feet on a small island of clean sand ringed by dark blood",
  "deed-taken-by-tide": "a gladiator's outstretched hand sinking beneath a surging blood tide, fingers spread",
  "deed-sand-fall": "an hourglass with the sand almost fully run out, a blood wave rising in the lower bulb",
  "deed-tidecaller": "a horned bronze crown with a great blood wave curling up through its horns, gold trim",
};

export interface DeedSpec {
  id: "deed-bits";
  label: string;
  provider: "openai-image";
  candidates: number;
  /** Saved size — map nodes render ~52pt; 256 covers 3× with room. */
  savedSize: number;
  /** True pixel grid the save snaps to (bits-art-style.md § pixel grids). */
  pixelGrid: number;
  /** Hard palette budget (see IconSpec.paletteColours). */
  paletteColours: number;
  size: "1024x1024";
  destination: string;
  /** Prefix of the require() path handed back after save (consumer-module relative). */
  manifestDir: string;
  manifestLine: (id: string, file: string) => string;
  template: (subject: string) => string;
}

export const DEED: DeedSpec = {
  id: "deed-bits",
  label: "Deed icon (Blood in the Sand)",
  provider: "openai-image",
  candidates: 2,
  savedSize: 256,
  pixelGrid: 64,
  paletteColours: 32,
  size: "1024x1024",
  destination: "apps/blood-in-the-sand/assets/deeds",
  manifestDir: "../../assets/deeds",
  // Comment-free like the badge line — pasted verbatim, never hand-trimmed.
  manifestLine: (id, file) => `  "${id}": require("../../assets/deeds/${file}"),`,
  // The icon template's brand + isolation rules (pre-rendered pixel art,
  // transparent isolation, no outline); the deed rules are: no drawn FRAME
  // of any kind (node framing is the game's, and its shape is undecided —
  // Tom 2026-08-04, don't bake a circle assumption into the art) and no
  // tier marking (the map composites bronze/silver/gold frames itself, the
  // badges' no-numerals rule tiered).
  template: (subject) =>
    `${subject}. An achievement illustration for a brutal gladiator arena game set in a ` +
    "scorched desert. Early-1990s retro pixel art in the lineage of VGA DOS and 16-bit " +
    "Amiga games: hand-placed chunky pixels, a strictly limited palette of about 32 " +
    "colours, shading built from hard stepped colour ramps and checkerboard dithering — " +
    "no smooth gradients, no anti-aliasing. The form still reads dimensional: specular " +
    "glints, warm light bounced up from golden sand, deep warm umber shadow in the " +
    "recesses, never pure black. One bold central subject " +
    "filling about 80% of the frame, lit by a low warm desert sun. Draw NO frame of any " +
    "kind: no circle, no ring, no coin face, no medallion, no shield backing, no border " +
    "or rim around the subject — the subject floats free and the game composites any " +
    "framing itself. True materials each in their own full colour, no sepia wash: " +
    "battle-grey steel (#9aa0a6), honey sand-gold (#dcb96f), bone-white specular " +
    "highlights (#f2e9d4), saturated dried-blood crimson (#a32c22), with one muted gold " +
    "accent where the subject earns it. Grim, sun-scoured, blood-and-sand mood — never " +
    "cute, never cartoonish, never flat vector art, never ink outlines or crosshatching, " +
    "never a photograph. Chunky forms: at 24 pixels the subject must still read. The " +
    "subject floats alone on a fully transparent background — no backdrop, no glow, no " +
    "vignette; every pixel outside the subject is transparent. No text, no letters, no " +
    "numerals — the artwork carries no writing or tier marks of any kind.",
};
