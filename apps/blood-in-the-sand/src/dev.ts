/**
 * Session-only dev switches, flipped from the hidden dev menu on the title
 * screen (docs/design/bits-dev-menu.md). A plain module object, not state or
 * storage, on purpose: it resets on every launch (a handed-over phone is
 * always clean) and can be read from hot paths (the game loop) without
 * touching React.
 */
/**
 * Is the hidden dev menu reachable in this build? Dev sessions always, plus
 * internal builds that opt in with EXPO_PUBLIC_DEV_MENU=1 (eas.json's
 * `preview` profile) so on-device testing keeps the perf overlay, the bot
 * dials and the ceremony rehearsals.
 *
 * A production build gets neither and has NO way in (2026-09-11). The grant
 * rows are already inert against the production ledger (STORE_DEV_TOOLS
 * unset), but the announcer cycler is purely local: in a shipped build it
 * handed out the paid voices for five taps — guideline 3.1.1, the same rule
 * the redeem codes fell to, and a hidden feature under 2.3.1 besides.
 */
export const DEV_MENU_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_DEV_MENU === "1";

export const devFlags = {
  /** Frame profiler readout in matches: JS fps + sim/record ms per frame. */
  perfOverlay: false,
};
