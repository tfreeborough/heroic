import { LOCKED_LOOK, type Look } from "@heroic/ascii-build";

/** Autosave's glyph look: the locked beat-builds look at 160 columns. The lit,
 * full-bleed pictures carry more detail than the old silhouettes (Tom, 10-10). */
export const AUTOSAVE_LOOK: Look = { ...LOCKED_LOOK, cols: 160 };
