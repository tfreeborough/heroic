/**
 * Haptics — borrowed from the Gauntlet's system (apps/enter-the-gauntlet/
 * src/game/haptics.ts): the same weight scale, burst throttle, and crit
 * "da-DUM" double pulse, with an arena-specific weapon→weight map. The rule
 * carried over: "heavy" is reserved for the rare, meaningful moments (a kill,
 * your own death) so the strongest pulse never wears out.
 */
import * as Haptics from "expo-haptics";
import type { WeaponId } from "@heroic/blood-in-the-sand-sim";

export type HapticWeight = "soft" | "light" | "medium" | "heavy";

/** What landing a hit with each weapon feels like in the hand. */
export const WEAPON_HAPTIC: Record<WeaponId, HapticWeight> = {
  blade: "soft",
  bow: "light",
  staff: "light",
  hammer: "medium",
};

const IMPACT: Record<HapticWeight, Haptics.ImpactFeedbackStyle> = {
  soft: Haptics.ImpactFeedbackStyle.Soft,
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};

/**
 * Combat fires in bursts (bleed ticks over melee exchanges, fast cycles); a
 * global floor between pulses keeps bursts from melting into one long buzz.
 * Habituation kills the haptic channel faster than silence does.
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
 * One tactile event for an attack. A null weight means the weapon is silent
 * and the crit pulse is the only thing it ever says — on light fast weapons a
 * crit stands out *because* the baseline is nothing.
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
