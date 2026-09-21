/**
 * Cosmetic slot ids (bits-cosmetics.md). FINISHERS ship first and are real:
 * their ids live in the sim's items.ts beside the weapon / ability
 * entitlements and ride the wire (§ Finishers v1) — re-exported here so the
 * renderers keep one import. Blood and trails are still the PROTOTYPE
 * roster, worn from the dev menu only; nothing of theirs touches the wire.
 */
import { FINISHER_IDS, type FinisherId } from "@heroic/blood-in-the-sand-sim";

export { FINISHER_IDS, type FinisherId };

export const BLOOD_IDS = ["default", "starblood", "roses"] as const;
export type BloodId = (typeof BLOOD_IDS)[number];

export const TRAIL_IDS = ["none", "your-colours", "comet"] as const;
export type TrailId = (typeof TRAIL_IDS)[number];

/** Your Colours' three bands. The shipped item lets the player pick three
 * swatches from a curated palette; the prototype cycles a few presets. */
export const TRAIL_COLOUR_PRESETS: readonly {
  name: string;
  colours: readonly [string, string, string];
}[] = [
  { name: "IMPERIAL", colours: ["#a8202c", "#e8b93c", "#f4ead2"] },
  { name: "AEGEAN", colours: ["#1f9e9a", "#f2f6f4", "#1d3a6e"] },
  { name: "LAUREL", colours: ["#3f8f4a", "#e8b93c", "#f4ead2"] },
  { name: "DUSK", colours: ["#7b4fc9", "#e86fa8", "#f2a23a"] },
];

/** Trail opacity steps for the dev-menu dial (tuned on device, not in code). */
export const TRAIL_OPACITY_STEPS = [0.2, 0.3, 0.4, 0.55, 0.7] as const;

/** Trail length steps, ms of lingering wake (same dial idea). */
export const TRAIL_LENGTH_STEPS = [500, 800, 1000, 1300] as const;

/** What one fighter is wearing — resolved per player by the caller. */
export interface CosmeticLoadout {
  finisher: FinisherId;
  blood: BloodId;
  trail: TrailId;
  /** Index into TRAIL_COLOUR_PRESETS (Your Colours only). */
  colours: number;
}
