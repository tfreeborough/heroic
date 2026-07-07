# Asset Forge — AI asset generation in Realmsmith

Status: **SFX path built (v1)** — plugin + panel + ElevenLabs + trim/normalize verified end-to-end;
image types not started · Applies to: both games (tooling; first consumer: Enter the Gauntlet) ·
Last decided: 2026-07-05

Built: `apps/realmsmith/forge/` (Vite plugin: `/forge/status|expand|generate|save`, style bible,
ElevenLabs + OpenAI calls, ffmpeg-static processing) + the Forge panel (`src/forge/ForgePanel.tsx`,
toolbar toggle). Keys live in `apps/realmsmith/.env.local` (see `.env.example`).

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
box → the style-bible template seeds it from the sentence; the **Expand** button has an LLM
(`/forge/expand`, OpenAI) rewrite the sentence into proper SFX prompt-craft — concrete sources and
textures, an explicit sonic shape, positive phrasing. A prompt-influence slider controls how
literally ElevenLabs follows the text.

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

## Open questions

- Does the paste-a-manifest-line step stay tolerable at volume, or does the Forge eventually need a
  generated (not hand-edited) manifest file it can append to safely?
- Reference-image budget: how many exemplars per request give the best consistency-per-cent?
- ~~Prompt expansion: is the optional LLM enrich step worth it?~~ **Answered 2026-07-05: yes.** The
  first fixed template bolted impact-shaped language ("punchy, fast attack") and a material list onto
  every subject, which fought anything non-impact (a collapsing spider nest) and diluted the user's
  sentence; negations ("no ambience") get ignored. Lesson: the fixed template carries *tone only*;
  per-subject shape/texture comes from the LLM expander or hand-editing the prompt box.
