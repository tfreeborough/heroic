import type { LibrarySave } from "../scripts/sync-library";
import library from "./data/library.json";
import type { SaveProps } from "./Save";

// Typed by hand: an empty library would otherwise infer never[].
const first = (library.saves as LibrarySave[])[0];

/** A fresh save: the first picture in the library, shuffled look, 16s (15 + the hold on the finished save).
 * (The Desk rerolls the seed for every new form.) */
export const SAVE_DEFAULTS: SaveProps = {
  image: first?.file ?? "",
  memory: first?.memory ?? "",
  tagline: first?.tagline ?? "",
  title: first?.title ?? "",
  journal: first?.journal ?? "",
  // The Desk fills these from the Hints tab's queue.
  hint1: "",
  hint2: "",
  // The Desk fills the next free slot from the ledger (public/slots.json).
  slot: 1,
  playtimeFrom: -1,
  egg: "auto",
  seed: 1,
  arrival: "shuffle",
  order: "shuffle",
  tone: "light",
  palette: "matrix",
  seconds: 16,
  // This save's own generated tune (src/music/), from its slot.
  music: "@tune",
  tuneTake: 0,
  tuneStyle: "auto",
  musicFile: "",
  musicFrom: 0,
  musicVolume: 0.7,
  ticksVolume: 0.9,
  burst: true,
  glitch: true,
  rain: 0.5,
};
