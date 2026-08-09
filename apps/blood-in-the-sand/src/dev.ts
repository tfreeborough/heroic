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
  /** Pin EVERY practice bot to one archetype regardless of its loadout —
   * matchup testing (bot-brains.md step 5). null = derive from loadout. */
  botArchetype: null as ArchetypeId | null,
  /** Override the practice-lobby difficulty pick for every bot this session.
   * null = whatever the lobby picked. */
  botDifficulty: null as DifficultyId | null,
  /** Deed Map preview (achievements.md): fake the unlock state client-side
   * so the board is testable without grinding matches. null = real
   * /achievements/me data · "some" = root + every chain's first tier
   * unlocked (frontier ghosts + hidden tails on show) · "all" = everything.
   * Read on DeedsScreen mount; never touches the server. */
  deedsPreview: null as null | "some" | "all",
  /** Grant every GATED item this session (bits-secret-items.md) — the
   * wizard shows the trident etc. without winning the deeds. Session-only
   * OVERLAY on getEntitlements(): the persisted cache is never touched.
   * Works in practice/skirmish (client-trusted); RANKED still validates
   * against the DB, so an un-earned gated pick is ignored there — by
   * design, this switch can't defeat it. */
  grantAllItems: false,
};
