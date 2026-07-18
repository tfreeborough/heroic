/**
 * The title-screen fighter pool. HomeScreen draws two DISTINCT random entries
 * each time it mounts — a different duel greets most returns to the menu.
 *
 * Manifest pattern (audio manifest.ts): the Forge saves PNGs into
 * assets/sprites/ and hands back the require line to paste below; a fighter
 * joins the pool the moment its line lands. A missing file is a bundler
 * error, so lines only appear once the PNG is on disk.
 *
 * Every sprite is generated FACING RIGHT (the style bible's rule) — the
 * right-hand slot of the duel is mirrored at render, so one sprite covers
 * both sides.
 */
export const TITLE_SPRITES: Record<string, number> = {
  "title-blade": require("../../assets/sprites/title-blade.png"),
  "title-bow": require("../../assets/sprites/title-bow.png"),
  "title-staff": require("../../assets/sprites/title-staff.png"),
  "title-hammer": require("../../assets/sprites/title-hammer.png"),
};

/**
 * Per-sprite size nudge (1 = the standard figure box). Separate generations
 * fill their frame slightly differently — tune feet lines here, not in
 * prompts.
 */
export const TITLE_SPRITE_SCALE: Record<string, number> = {};

export interface TitleDuel {
  left: string;
  right: string;
}

/** Two distinct fighters, random order (pool of 1 duels itself, mirrored). */
export const pickDuel = (): TitleDuel => {
  const ids = Object.keys(TITLE_SPRITES);
  const left = ids[Math.floor(Math.random() * ids.length)]!;
  const rest = ids.filter((id) => id !== left);
  const right = rest.length > 0 ? rest[Math.floor(Math.random() * rest.length)]! : left;
  return { left, right };
};
