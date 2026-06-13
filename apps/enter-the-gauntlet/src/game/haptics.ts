import * as Haptics from "expo-haptics";

/**
 * Perceived heft of an attack, mapped to an impact strength. "heavy" is
 * deliberately unused by the current weapons — the top of the range is
 * reserved for warhammer-class gear and player-side events (taking damage)
 * so the strongest pulse stays rare and meaningful.
 */
export type HapticWeight = "soft" | "light" | "medium" | "heavy";

const IMPACT: Record<HapticWeight, Haptics.ImpactFeedbackStyle> = {
  soft: Haptics.ImpactFeedbackStyle.Soft,
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};

/**
 * Combat fires in bursts (multi-target cleaves, pierce volleys, fast attack
 * cycles); a global floor between pulses keeps bursts from melting into one
 * long buzz. Habituation kills the haptic channel faster than silence does.
 */
const MIN_GAP_MS = 90;
/** Crit second-pulse delay — close enough to read as a single "da-DUM". */
const CRIT_PULSE_DELAY_MS = 60;

let lastPlayed = 0;

/** Fire-and-forget; haptics silently no-op where unsupported (web/desktop). */
const fire = (style: Haptics.ImpactFeedbackStyle): void => {
  Haptics.impactAsync(style).catch(() => {});
};

/**
 * One tactile event for an attack: melee plays it on connect, ranged on
 * release (recoil). A null weight means the weapon is silent and the crit
 * pulse is the only thing it ever says — which is the point: on light fast
 * weapons a crit stands out *because* the baseline is nothing.
 */
export const playStrikeHaptic = (weight: HapticWeight | null, crit = false): void => {
  if (weight === null && !crit) return;
  const now = Date.now();
  if (now - lastPlayed < MIN_GAP_MS) return;

  if (weight === null) {
    // Crit on a silent weapon: the sharp pulse alone.
    lastPlayed = now;
    fire(Haptics.ImpactFeedbackStyle.Rigid);
    return;
  }
  fire(IMPACT[weight]);
  if (crit) {
    // Layer a sharp second pulse over the weapon's base thud.
    lastPlayed = now + CRIT_PULSE_DELAY_MS;
    setTimeout(() => fire(Haptics.ImpactFeedbackStyle.Rigid), CRIT_PULSE_DELAY_MS);
  } else {
    lastPlayed = now;
  }
};
