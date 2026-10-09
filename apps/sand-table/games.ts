/**
 * Every game the Sand Table can draw in. A game brings its colours, its
 * title face and the folders of art the stamp drawer offers. Adding one =
 * a block here (the Desk's games.ts does the same with its registry).
 */
import { join } from "node:path";

export type StampGroup = { id: string; label: string; dir: string };
export type GameBrand = {
  id: string;
  name: string;
  /** Shown top-left. */
  icon: string;
  /** The title face, as a .ttf the page loads for the canvas. */
  titleFont: string;
  /** Palette offered as stroke/fill swatches, in order. */
  palette: { name: string; hex: string }[];
  /** The board's backdrop. */
  background: string;
  stamps: StampGroup[];
  /** The Desk's id for this game (its /api/<id>/imports route), if it has one. */
  deskGame?: string;
};

const ROOT = join(import.meta.dir, "..", "..");
const BITS = join(ROOT, "apps", "blood-in-the-sand", "assets");

export const GAMES: GameBrand[] = [
  {
    id: "bits",
    name: "Blood in the Sand",
    icon: join(BITS, "blood-in-the-sand-icon.png"),
    titleFont: join(BITS, "fonts", "Cinzel-Bold.ttf"),
    // The Sun-Forged Relic notes (docs/design/bits-art-style.md), plus two
    // diagram colours that sit with them: a moss for "good" and an ember for "hot".
    palette: [
      { name: "Bone", hex: "#f2e9d4" },
      { name: "Sand", hex: "#dcb96f" },
      { name: "Steel", hex: "#9aa0a6" },
      { name: "Crimson", hex: "#a32c22" },
      { name: "Ember", hex: "#e07a3a" },
      { name: "Moss", hex: "#7a9a5a" },
      { name: "Sky", hex: "#6f9fc4" },
      { name: "Umber", hex: "#4a3520" },
      { name: "Night", hex: "#241708" },
    ],
    background: "#241708",
    stamps: [
      { id: "icons", label: "Weapons & abilities", dir: join(BITS, "icons") },
      { id: "sprites", label: "Weapon titles", dir: join(BITS, "sprites") },
      { id: "ranks", label: "Ranks", dir: join(BITS, "ranks") },
      { id: "modes", label: "Mode cards", dir: join(BITS, "modes") },
      { id: "deeds", label: "Deeds", dir: join(BITS, "deeds") },
      { id: "app", label: "App", dir: BITS },
    ],
    deskGame: "bits",
  },
];

export const gameById = (id: string): GameBrand | undefined => GAMES.find((g) => g.id === id);
