# Blood in the Sand — the pit crowd: forged-art attempts (post-mortem)

**Status: ABANDONED 2026-09-01 — the procedural crowd (crowd.ts v2, the tinted-blob mob with
the wave) stays. Two forged replacements were built and reverted the same day. This doc exists
so the next "the crowd looks out of place" itch starts from what was learned, not from scratch.**

## What was tried

1. **Forged spectator busts (morning).** A Realmsmith Forge type generating individual
   front-view waist-up characters at a 32px grid (24 colours, saved 128px), a roster of 14,
   a save-step option that trimmed to alpha bounds and bottom-anchored each bust, and a crowd
   renderer that baked sprite + mirror into a runtime atlas and stamped one per seat with the
   existing wave. Seven were generated. **Verdict (Tom): "horrible and creepy."** gpt-image-1
   paints a portrait; the 32× crush melts the face; and at pit zoom a body is a few dozen device
   pixels, so every seat becomes a tiny melted face you can't help looking at.
2. **Forged crowd texture block (afternoon).** Tom's counter-proposal: one generic opaque block
   of packed heads-and-shoulders on stone terraces (1536×1024 → 192×128 grid, 32 colours, saved
   768×512), mirror-tiled across the stands with a Skia image shader (`TileMode.Mirror` on both
   axes is seamless by construction), three depth bands each drawing the block larger and
   lighter for the height illusion, riser lines hiding the scale steps, no animation. Built and
   wired end to end. **Verdict (Tom): "no matter what I do I can't seem to get it to generate
   nicely."** The model would not produce a crowd that reads as a texture — figures came out
   either portrait-sized or as mush, and the tiled result never looked like the stands.

Both were reverted surgically (crowd.ts, the arena render input, both arena screens, the
Forge type, panel, protocol, plugin, CSS, docs). Nothing of either survives in code.

## What was learned

- **Image models don't do crowds at sprite scale.** Whatever the framing (individual or
  texture), gpt-image-1 composes for a portrait's worth of detail and the crush destroys it.
  The asset-forge doc's "explicitly out of scope" list (tile atlases, sprite sheets) should be
  read as including crowd textures.
- **The procedural mob is structurally right.** Rows on concentric rings, perspective ramp,
  clustered gaps, the wave, drawAtlas + cached transforms — all of that survived both attempts
  unchanged and only the *body atlas* was ever in question. If the crowd is revisited, the
  lever is the eight-cell body atlas in `crowd.ts` (`ensureAtlas`): hand-drawn pixel-art cells
  (or a small hand-made atlas PNG) would drop straight in without touching layout or perf.
- Mirror-tiled image shaders in world space are a good, cheap technique for filling a
  concentric frame without corner seams — worth remembering for a hand-made crowd texture or
  any other repeated ground/wall art.
- No blue or red clothing in any crowd art: those are allegiance colours in this game.

## If revisited

Draw the atlas by hand (or commission it), not by generation: three torso silhouettes, a head,
four hair caps — the current cells — in the game's pixel style, white/greyscale so the per-seat
tinting still works. That is a two-hour art task, not a pipeline.
