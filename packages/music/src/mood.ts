/**
 * The moods a piece can be in. A save's mood is chosen by Claude from its
 * picture and words (Autosave's desk.server.ts, from the menu in menu.ts);
 * a script beat's is set by its plan (journey.ts). The word lists that used
 * to read it went 10-12: they kept tripping over words ("Daytona" read as
 * racing, every journal read as wistful).
 */

/** The six loading-screen moods, then seven first made for telling a story (desk-ascii-scripts.md). */
export const MOODS = ["cosy", "wistful", "wonder", "night", "playful", "tender", "focus", "curious", "tense", "eerie", "driving", "melancholy", "triumph"] as const;
export type Mood = (typeof MOODS)[number];
