# Asset Forge — AI asset generation in Realmsmith

Status: **SFX path built (v1); image path built (v1, 2026-07-14; sprites 2026-07-17)** — the `icon-bits` type
generates Blood in the Sand's weapon/ability icons (gpt-image-1, transparent 1024 → sharp
downscale to 256 + libimagequant palette quantization: ~15KB per icon vs ~240KB lossless,
alpha-dithered, verified visually indistinguishable on the game void), verified end-to-end ·
Applies to: both games (tooling; consumers: Enter the Gauntlet SFX, Blood in the Sand icons) ·
Last decided: 2026-07-14

> **Style direction changed 2026-08-06**: Blood in the Sand's visual language moved from
> dark-fantasy woodcut to **pre-rendered pixel art** (the app icon's aesthetic) —
> see [bits-art-style.md](./bits-art-style.md), now the owner doc for the game's brand
> language. The woodcut-era template notes below are kept as history; the save pipeline
> gained a **pixel-grid snap** step (`forge/images.ts`) that bakes every asset onto a true
> per-family pixel grid. All existing BITS image assets are due for regeneration.

Built: `apps/realmsmith/forge/` (Vite plugin: `/forge/status|generate|save`, style bible,
ElevenLabs + OpenAI calls, ffmpeg-static audio + sharp image processing) + the Forge panel
(`src/forge/ForgePanel.tsx`, toolbar toggle). Keys live in `apps/realmsmith/.env.local` (see
`.env.example`).

Image path (2026-07-14): the style bible carries an **ICON spec + checked-in 14-icon manifest**
(ids mirror the sim's WeaponId/AbilityId; subjects from the pvp-abilities identity pass; a
per-category accent — gold/red/steel/green — bakes the game's category-colour system into the
art). The panel gains a manifest picker with done-ticks ("3 of 14"), generates 2 candidates,
previews each **at 32px on the game's void colour** (the roster-row acceptance test), keeps
exactly one, and saves `<id>.png` (+ sidecar; regenerating overwrites). Save hands back the
`icons.tsx` require-map line for when the app switches off the placeholder Skia glyphs.

Sprite path (2026-07-17): the `sprite-bits` type generates **full-figure scene art** (title-screen
gladiators first) through the same gpt-image-1 pipeline, generalized server-side (`imageSpec` routes
both image types through one generate/save path). Differences from icons, all deliberate: saved at
**512px** (title figures render ~180px at 3×; headroom for reuse), and the template speaks **figure
language, not emblem language** — whole body in frame with margin, high-sun rim light on crest and
shoulders, **no die-cut bone outline** (sprites sit on painted scenes, not near-black UI) and **no
ground/cast shadow** (the scene draws its own contact shadows). The panel previews candidates
**on a sand gradient** — the High Sun acceptance test, mirroring the icons' on-void preview.

Title fighters derive from the game (2026-07-17, Tom's call — "characters which use weapons from our
actual game"): the sprite set's `title-<weaponId>` rows come from the sim's WEAPONS table at panel
runtime (`src/forge/spriteSet.ts`, the iconSet pattern — a new weapon auto-appears flagged until its
subject line is written in `SPRITE_SUBJECTS`); non-weapon ids are static extras. All title fighters
are generated **facing right**; the app's HomeScreen picks **two distinct random fighters per mount**
(`src/screens/titleSprites.ts` — a paste-the-require-line manifest like audio, with a per-sprite
scale-nudge map) and mirrors whoever takes the right-hand slot, so one sprite covers both sides of
the duel. Template v2 lesson (first generations): value structure must be **anchored in black ink**
("reads as dark inked woodcut, never a polished bronze statue") and isolation stated as a **die-cut
cut-out with transparency beginning at the soles** — the "no cast shadow" negation alone left a
baked ground smudge.

How we kit out the games with art and sound as a solo developer. The Forge is a panel in Realmsmith:
type a short sentence, pick an **asset type**, and the tool builds a full on-brand prompt, calls the
right provider (OpenAI for images, ElevenLabs for sound), post-processes the result (downscale,
optimize, loudness-normalize), and saves it into the game's assets folder — with a **sidecar** file
recording exactly how it was made, so any asset can be regenerated or iterated later.

> **The loop is the point** (same philosophy as [realmsmith](./realmsmith.md)): sentence → candidates
> → pick → saved game-ready file, in under a minute, without leaving the editor. The alternative —
> hand-crafting prompts in a web UI, downloading, resizing in an image editor, renaming, moving files —
> is minutes of chore per asset, times hundreds of assets.

## Terms (we're new to this)

- **Style bible** — a checked-in file of per-asset-type prompt templates plus a global description of
  each game's visual identity. The user's sentence gets slotted into the template; the template, not
  the model, is what keeps output on-brand.
- **Sidecar** — a small JSON file saved next to an asset (`mage.png` → `mage.forge.json`) recording the
  prompt, provider, parameters, and references that produced it. Provenance + the "regenerate" button.
- **Reference images** — existing approved assets sent along with a generation request ("match this
  style"). OpenAI's image edits endpoint accepts these; the single biggest consistency lever.
- **Loudness normalization** — adjusting a sound file so it plays at a standard perceived volume
  (measured in **LUFS**). Without it, generated SFX arrive at wildly different levels and some clips
  shout over the music. [audio.md](./audio.md) § Assets already asks for this ("normalise levels and
  leave headroom under the music") — the Forge automates it.
- **Variation bank** — the `_1/_2/_3` clip convention from the SFX catalogue: several takes of one
  sound, one picked at random per play so repeats don't sound stamped.

## The problem

Both games need hundreds-to-thousands of assets: item/skill/talent icons, creature and class
portraits, UI art, backgrounds, and a full SFX vocabulary (the catalogue in
`apps/enter-the-gauntlet/src/game/audio/sounds.ts` already names clips that don't exist yet — the
manifest's SFX block is entirely commented-out placeholders). We have an ElevenLabs subscription and
an OpenAI key. The bottlenecks are (a) **consistency** — assets made across weeks must look/sound like
one game — and (b) **throughput** — the manual generate→edit→resize→rename→move loop doesn't scale to
that count.

## Decisions

1. **The Forge lives in Realmsmith, behind a Vite dev-server plugin.** Realmsmith's zone editing stays
   pure-browser (File System Access API, unchanged — see [realmsmith](./realmsmith.md)), but the Forge
   is the editor's **first server-side piece**: a small Vite plugin exposing local-only endpoints.
   Deliberate exception to the no-server rule, for three reasons the browser can't satisfy: API keys
   must stay out of browser code (`.env`, gitignored), post-processing needs Node tools (`sharp` for
   images, `ffmpeg` for audio), and assets are written straight into
   `apps/enter-the-gauntlet/assets/…` with no per-write user gesture. No separate process — it rides
   the dev server Realmsmith already runs.
2. **Consistency comes from the style bible + reference images, not from the model.** Every request is
   `template(assetType) + user sentence + references`. An optional LLM "expand" step may enrich the
   sentence *within* the template, but the template owns all brand language — the LLM can add detail,
   never direction.
3. **Every asset gets a sidecar.** No sidecar-less generated asset enters the repo. This is what makes
   iteration cheap ("same prompt, but angrier"), makes style drift diagnosable, and doubles as our
   provenance record for AI-generated content.
4. **The Forge writes files, never code.** Wiring an asset in (a `manifest.ts` require line, a
   catalogue clip name) stays a manual copy-paste — the Forge *shows* the exact line to paste. The
   audio system was explicitly designed so a missing manifest entry warns-and-stays-silent
   ([audio.md](./audio.md)), so files landing before wiring is safe. Auto-editing TS source from a tool
   is fragile and un-reviewable; revisit only if the paste step proves annoying at volume.
5. **Generate big, save small.** Images are generated at the provider's native resolution (1024–1536px)
   and downscaled to the asset type's target size. Downscaling *hides* AI artifacts — small icons look
   markedly more consistent than their full-size generations — and keeps the app bundle lean.
6. **SFX requests produce a variation bank by default.** One request = 3 generated takes, auditioned in
   the panel, saved as `name_1/_2/_3.mp3` — matching how the catalogue already consumes clips.

## Asset-type taxonomy (the contract)

The asset type is the unit of consistency: it fixes the prompt template, the output spec, and the
destination. Types are data in the style bible, not code — adding one is adding an entry.

| Type | Provider | Generated at | Saved as | Destination |
| --- | --- | --- | --- | --- |
| `icon` (item / skill / talent) | OpenAI, transparent bg | 1024×1024 | 256×256 PNG (alpha) | `assets/icons/<category>/` |
| `class-portrait` | OpenAI | 1024×1536 | 768×1194 PNG | `assets/classes/` |
| `creature-portrait` | OpenAI | 1024×1024 | 512×512 PNG | `assets/creatures/` |
| `ui-background` | OpenAI | 1024×1536 | 1024×1536 PNG | `assets/ui/` |
| `sfx` | ElevenLabs sound-generation | provider default | mp3, normalized, ×3 bank | `assets/audio/sfx/` |

Sizes are per-type defaults in the style bible, editable in one place. `class-portrait` and
`ui-background` specs match the existing hand-made assets (`classes/mage.png` is 768×1194;
`ui/class_selection_background.png` is 1024×1536) so generated assets are drop-in replacements.

**Explicitly out of scope for v1** (each needs its own design pass):

- **Tile atlases** — tiles must align to a grid and seam against neighbours; image models can't do
  that per-tile yet. Tilesets remain hand/tool-made (see [realmsmith](./realmsmith.md) § Tilesets).
- **Animation frames / sprite sheets** — same character pixel-consistent across frames is beyond
  current image models. Budget for hand-touching or a different technique.
- **Music beds** — ElevenLabs Music exists, but seamless *loops* (what beds need) are a separate
  problem; current beds are sourced manually.

**Added 2026-07-23 — `mode-bits` (Blood in the Sand mode cards).** The forge's first FULL-BLEED
SCENE type (bits-mode-select.md): landscape 1536×1024 generation (the first non-square-or-portrait
canvas, and the first `background: "opaque"` — cut-out types stay transparent), saved as an
opaque 900×360 (5:2, ~2.2× density at the largest phone render — scrim-covered background art
doesn't earn full 3×) centre cover-crop via `processScene` (no letterboxing; palette-quantized at
a 90 quality floor because gradient skies band before woodcut linework does). The set is the
checked-in `MODE_KEYS` list (ranked/skirmish/practice/story — no sim derivation; modes are product
decisions), destination `apps/blood-in-the-sand/assets/modes/`. The template bakes in the card's
two layout facts: focal detail in the RIGHT two thirds (the left third sits under the title
scrim), key elements in the vertical middle (the crop discards the top/bottom quarters). The
panel's verify composite wears the card's real scrim gradient plus a stand-in title over the left
third, and the save hands back the `image: require(...)` line for `MODE_ART` in
ModeSelectScreen.tsx.

**Added 2026-07-30 — bracket cards ride `mode-bits`, and `badge-bits` (rank badges).** The ranked
screen's bracket cards (bits-ranked.md) are the same 900×360 scene pipeline, so they're extra
`MODE_KEYS` entries (`bracket-1v1`, `bracket-2v2`) rather than a new type — the save's paste line
branches on the `bracket-` prefix to target `BRACKET_ART` in RankedScreen.tsx (locked brackets
drain forged art to greyscale, the mode-select treatment). `badge-bits` is a new cut-out type in
the icon family (1024² transparent, saved 256px) built around ONE anchor object: every badge is
a round gladiator SHIELD face-on (Tom, 2026-07-31 — helmets were tried and dropped), the anchor
baked into the template itself. **The legibility rule (Tom, same day): rank must read at a
glance at tiny sizes, so each tier owns a DOMINANT COLOUR** (`BADGE_ACCENTS` — tan → iron grey
→ bronze → silver → blood-crimson → radiant gold, chosen to differ in lightness as well as hue
against the near-black UI) that floods the shield face — the template drops the icon family's
fixed ochre-midtone/gold-accent wash for a per-tier accent parameter (the ICON_ACCENTS pattern,
per tier instead of per category) and states the colour must stay pure, never muddied toward
bronze. Decoration still escalates (notched wood → bare rivets → crested-galea boss → gilded
laurel → spiked gold trim → sunburst rays), but colour carries the rank; an explicit
no-numerals line stays — divisions (III/II/I) composite client-side so six badges cover
fourteen rungs. The set is the checked-in `BADGE_KEYS`
list — a hand-mirror of the persistence package's `TIERS` (6 since the 2026-07-30 re-cut) —
destination `apps/blood-in-the-sand/assets/ranks/`, paste target `RANK_BADGES` in
RankedScreen.tsx.

## The style bible

`apps/realmsmith/src/forge/styleBible.ts` — checked in, so brand language is versioned and diffable.

```ts
export interface AssetTypeSpec {
  id: string;                       // "icon", "sfx", ...
  provider: "openai-image" | "elevenlabs-sfx";
  /** Brand-owning template; {subject} is the user's sentence. */
  template: string;
  avoid?: string;                   // negative guidance appended to every prompt
  references?: string[];            // repo-relative paths to approved exemplar assets
  output: ImageSpec | AudioSpec;    // target size/format or duration/LUFS
  destination: string;              // repo-relative folder
}
```

Plus one global `GAME_IDENTITY` paragraph per game (art direction, palette mood, era, what it is
*not*) that every image template embeds. Writing that paragraph well **is** the brand work — it's
authored once, deliberately, not per-asset. First drafts of the identity paragraph and the five v1
templates happen during the build (they need generation results to iterate against).

## Pipeline

```
Realmsmith Forge panel                       Vite plugin (Node, local-only)
─────────────────────                        ──────────────────────────────
sentence + type ──────── POST /forge/generate ──▶ style bible → final prompt
                                                  → provider call (key from .env)
preview grid /  ◀─────── candidates (b64) ──────  (images ×4, sfx ×3)
audio players
pick + name ──────────── POST /forge/save ─────▶  sharp: resize → target, strip
                                                  metadata, palette-quantize PNG
                                                  ffmpeg: trim silence, loudness-
                                                  normalize, encode mp3
                                                  write asset + sidecar
toast: "saved — manifest line: …" ◀──────────────
```

Candidates are generated in small batches (4 images / 3 sounds) because picking from a spread is
faster than iterating prompts one at a time; rejected candidates cost cents.

The panel's **prompt box is the control surface**: whatever is in it goes to the provider verbatim,
and it is refilled with what was actually sent, so iterating means editing text, not guessing. Blank
box → the style-bible template seeds it from the sentence. (An LLM **Expand** button once
rewrote the sentence into ElevenLabs prompt-craft; retired 2026-09-06 with the local Stable Audio
engine — see § Stable Audio.) On ElevenLabs a prompt-influence slider controls how literally it
follows the text; hidden on the local engine.

### The sidecar

```jsonc
// assets/icons/talents/berserker_rage.forge.json
{
  "type": "icon",
  "subject": "a screaming berserker face, red mist",   // what the user typed
  "prompt": "…the full expanded prompt actually sent…",
  "provider": "openai-image",
  "model": "gpt-image-1",
  "params": { "size": "1024x1024", "quality": "high", "background": "transparent" },
  "references": ["assets/icons/talents/heavy_handed.png"],
  "created": "2026-07-05"
}
```

"Open asset → tweak subject → regenerate" reads this file; consistency debugging reads the diffs.
Sidecars are provenance only: the games never read them and Metro never bundles them (only
`require()`d files ship). The panel's **STALE** tick (deeds since 08-25, sounds since 2026-09-06)
diffs a sidecar's `subject` against the live brief — after a brief rewrite that IS the regenerate
list. Never clear a bank by deleting its mp3: the app manifest `require()`s it and the bundle
breaks; save overwrites `<id>_1.mp3` + the sidecar in place. Sound sidecars record the engine that
made the takes (`provider: "stable-audio-3"` / `"elevenlabs-sfx"`).

## Layering

Entirely a **tooling** concern: everything lives in `apps/realmsmith` (panel UI + Vite plugin + style
bible). Zero footprint in `@heroic/core`, `@heroic/engine`, or game code — the games only ever see
ordinary files appearing in `assets/`. Keys live in `apps/realmsmith/.env` (`OPENAI_API_KEY`,
`ELEVENLABS_API_KEY`), gitignored; the plugin refuses to start endpoints if keys are absent, and Vite
already binds to localhost.

## Expectations & costs

- **Strong fits:** icons, portraits, UI art, backgrounds, one-shot SFX. ElevenLabs SFX is genuinely
  good at hits/whooshes/UI blips with a duration parameter — the audio half should feel nearly solved.
- **Weak fits:** the out-of-scope list above. Don't fight the tools there.
- **Cost:** images are cents each (quality-dependent); a 4-candidate spread per asset across hundreds
  of assets is tens of dollars total. SFX comes out of the existing ElevenLabs subscription —
  worth confirming the tier includes commercial use.
- **Format lever held in reserve:** WebP (smaller than PNG, alpha-capable, supported by our Expo
  targets) if bundle size becomes a problem; v1 ships PNG for zero risk.

## Build order

1. **SFX first.** The catalogue is already authored ahead of files — the Forge's first real output is
   filling `assets/audio/sfx/` with the clips `sounds.ts` names. Smallest pipeline (no references, no
   resize matrix) and instantly audible in-game.
2. **Icons.** Lands with the talent-excitement pass ([talent-catalogue](./talent-catalogue.md)) —
   talent/rarity icons are the first big image batch and will pressure-test the style bible +
   reference-image loop.
3. **Portraits & UI art** — replace/extend the hand-made class portraits, creature portraits for new
   roster entries.

## Stable Audio (local sound engine, 2026-09-06)

ElevenLabs SFX never earned Tom's trust on quality, so the Forge grew a second
sound engine: **Stable Audio 3 Small-SFX run locally** — 433M params, CPU
inference on the M3 Pro, open weights under the Stability AI Community License
(free for commercial use under $1M/yr revenue; trained on licensed AudioSparx +
Freesound). Unlimited takes at zero marginal cost, so audition instead of
rationing.

- **Where it lives:** a sibling checkout `~/Documents/GitHub/stable-audio-3`
  (`uv sync` done; `uv` at `~/.local/bin/uv`). `forge/stableAudio.ts` spawns
  its CLI once per generation with the prompt repeated N times, so the model
  loads once and writes `take_0..N-1.wav` (44.1kHz stereo WAV; the save path's
  ffmpeg sniffs the container). `--steps 8 --cfg-scale 1.0`, the model card's
  defaults; `TrackType: SFX.` prepended server-side (the prompting guide's
  AudioSparx tag), briefs stay provider-neutral. Duration: the panel's value,
  else 4s (the model needs a number; ElevenLabs picked its own).
- **Switching:** `FORGE_SFX_PROVIDER` in `apps/realmsmith/.env.local`:
  `stable-audio`, `elevenlabs` (default), or **`both`** (Tom's pick 2026-09-06:
  the local model is better on some sounds, ElevenLabs on others, so `both`
  fans the SAME prompt and duration out to each and returns 3 + 3 takes tagged
  `local` / `11L` in the panel — the better engine is a per-take pick, not a
  config choice; a bank can mix, the sidecar records `takeEngines` per file and
  `provider: "mixed"`; if one engine fails the other's takes still come back
  with a note in the prompt box; the prompt-influence slider stays, ElevenLabs
  side only). Status reports `keys.stableAudio` + what's missing; the
  panel's warnbox lists it and the generate button stays gated until every
  piece is present — checkout, venv, uv, **weights**.
- **Weights are gated.** One-time, by Tom: log in at huggingface.co, accept
  the licence on `stabilityai/stable-audio-3-small-sfx`, make a *read* token,
  paste it as `HF_TOKEN` in `.env.local`. The first generation downloads
  ~1GB into `~/.cache/huggingface`; the ready light needs the cache OR a
  token (a cache-only gate blocked the very generation that fills it — fixed
  same day). Done on Tom's Mac 2026-09-06: a 3-take × 3s bank = ~18s on CPU
  including the model load.
  Overrides: `STABLE_AUDIO_DIR`, `UV_BIN`, `STABLE_AUDIO_DEVICE` (cpu default;
  `mps` worth a try).
- **Prompting differs from ElevenLabs — the briefs were rewritten for it
  (2026-09-06).** The model was trained on library metadata, so it wants the
  source, the action, and the production character ("a low ram's horn blown
  once, a short rough note that swells and cuts off, distant, echoing off
  stone") and a short duration. Tom's test of round_start (gong / horn / gate)
  found all three good and one hard rule: **one sound per brief** — "followed
  by" / "then" is ignored, a sequence comes out as its first half. So every
  non-ability brief in `SOUND_SUBJECTS` (42 of 61) is now a single concrete
  sound; compound moments lost their second half or will become their own
  bank. Ability briefs (19) are untouched pending their own pass — designed
  sounds are where the model is weakest. `SOUND_DURATIONS` gives each bank a
  suggested length; the panel prefills the duration box from it on pick
  (editable). The LLM **Expand** step was REMOVED the same day (panel button,
  `/forge/expand`, the OpenAI chat call, the expander system prompt): the brief
  IS the prompt, and the expander's ElevenLabs-tuned prose only padded it. The
  prompt-influence slider is hidden on this engine too (ElevenLabs-only knob).
  hit_blade note: "blade
  slash into flesh" read as metal-on-object; the model wants the *material*
  named — "knife stabbing into raw meat", "no metal ring".
- **Upgrades if wanted:** a resident Python sidecar (skip the per-generation
  model load), the repo's `optimized/mlx` build (Metal GPU, several× faster),
  LoRA fine-tuning on our kept takes for house style, inpainting/continuation
  for variations of a take we like.

## Sound banks (2026-09-06)

Adding a take used to mean: save in the Forge, paste the `require()` line into
`manifest.ts`, then add the clip name to the catalogue's list — and remember how
many takes the bank already had. Tom called it out as the time sink it was. Now:

- **The manifest is generated.** `apps/blood-in-the-sand/src/audio/sfxManifest.generated.ts`
  holds one `require()` per `<bank>_<n>.mp3` in `assets/audio/sfx/`, rewritten
  by the Forge after every save and remove (`forge/sfxManifest.ts`; manual sync
  `bun run sfx:manifest` in apps/realmsmith after moving files by hand).
  `manifest.ts` spreads it in next to the announcer packs. Stray non-numbered
  mp3s are listed in a header comment rather than silently skipped.
- **The catalogue derives banks.** `catalogue.ts` has `bank("hit_blade")` →
  every `hit_blade_<n>` key in take order; 63 entries switched from explicit
  lists. An unforged bank is `[]` and core's scheduler returns null for it
  (silent, no warning). Announcer lines stay explicit — they're per-pack
  folders, not banks. (One fix fell out: `signetPurchase` had been pointing at
  the `signet_exchange` bank though `signet_purchase_1` existed.)
- **The panel shows the bank.** Picking a sound chip loads
  `GET /forge/bank?type&id`: every take on disk with a player, a count, and a
  Remove button (`POST /forge/bank/remove` → file deleted, sidecar `files`
  trimmed, manifest regenerated; numbering is NOT compacted — stable names keep
  git history and sidecars honest, and the catalogue reads whatever exists).
  Save appends `<id>_<next>` as before and the list refreshes. The
  "paste these lines" box is gone for SFX (still there for images).
- **Workflow now:** pick chip → (edit brief/duration) → Generate → tick keeps →
  Save. Reload the app. That's it. The done-tick and STALE tick read the same
  folder + sidecars.

## Open questions

- Does the paste-a-manifest-line step stay tolerable at volume, or does the Forge eventually need a
  generated (not hand-edited) manifest file it can append to safely?
- Reference-image budget: how many exemplars per request give the best consistency-per-cent?
- ~~Prompt expansion: is the optional LLM enrich step worth it?~~ **Answered 2026-07-05: yes.** The
  first fixed template bolted impact-shaped language ("punchy, fast attack") and a material list onto
  every subject, which fought anything non-impact (a collapsing spider nest) and diluted the user's
  sentence; negations ("no ambience") get ignored. Lesson: the fixed template carries *tone only*;
  per-subject shape/texture comes from the LLM expander or hand-editing the prompt box.
