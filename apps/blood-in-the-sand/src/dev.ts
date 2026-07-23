/**
 * Session-only dev switches, flipped from the hidden dev menu on the title
 * screen (docs/design/bits-dev-menu.md). A plain module object, not state or
 * storage, on purpose: it resets on every launch (a handed-over phone is
 * always clean) and can be read from hot paths (the game loop) without
 * touching React.
 */
import type { ArchetypeId, DifficultyId } from "@heroic/blood-in-the-sand-sim";

export const devFlags = {
  /** Frame profiler readout in matches: JS fps + sim/record ms per frame. */
  perfOverlay: false,
  /** Perf A/B: silence playSound entirely (no scheduler, no native calls) to
   * test whether per-play audio work is what's costing frames on a device. */
  disableSfx: false,
  /** Perf A/B: skip all strike/cast haptics — iOS builds a fresh
   * UIImpactFeedbackGenerator per pulse, the other per-moment native cost. */
  disableHaptics: false,
  /** Perf A/B (the Android fill-rate test): render the match canvas at this
   * fraction of its layout size and let the compositor upscale — same scene,
   * ~rs² of the pixels for the GPU to fill (0.75 ≈ half the fill cost). If
   * dropping this instantly restores 60fps, the cap is raster fill-rate on
   * the render thread, not the JS loop — and a shipped Android render-scale
   * tier is the fix. 1 = native. */
  renderScale: 1 as 1 | 0.75 | 0.6,
  /** Pin EVERY practice bot to one archetype regardless of its loadout —
   * matchup testing (bot-brains.md step 5). null = derive from loadout. */
  botArchetype: null as ArchetypeId | null,
  /** Override the practice-lobby difficulty pick for every bot this session.
   * null = whatever the lobby picked. */
  botDifficulty: null as DifficultyId | null,
};
