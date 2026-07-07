# SFX clips

One-shot sound effects, `.mp3` (see `docs/design/audio.md` § Assets — mp3 is the
cross-platform safe format; normalise levels and leave headroom under the music).

## Adding a sound

1. Drop the `.mp3` here, e.g. `sword_hit_1.mp3`.
2. Add a line in `src/game/audio/manifest.ts`:
   `sword_hit_1: require("../../../assets/audio/sfx/sword_hit_1.mp3"),`
   — the key is the **clip name** the catalogue refers to.
3. Reference that name in `src/game/audio/sounds.ts` (a `clips: [...]` array).
   Put several clips in one bank for variation — one is picked at random per play.

A clip name used in the catalogue with no manifest entry warns once and stays
silent, so the catalogue can be authored before the files exist.

## Qualifiers (variants)

Creature deaths and footsteps vary by *qualifier* (creature kind / floor surface):
group those clips under `variants` in `sounds.ts`, e.g. `creatureDeath.variants.goblin`
or `footstep.variants.stone`. Names are otherwise free-form; a `_1/_2/_3` suffix
convention for variation banks keeps the manifest readable.
