/**
 * A script that comes from a Google Doc (docs/design/desk-docs.md): the
 * Doc arrives as markdown (rclone's export), so its headings, bold and
 * lists survive. Headings are the author's sections: never read aloud,
 * usually a chapter. This is the pure half (the page imports it too); the
 * Drive side is scriptDocs.ts.
 */

/** Which Doc a script came from, and when it was last pulled. */
export type ScriptDoc = {
  /** The Drive file id. */
  id: string;
  /** Its name in Drive. */
  name: string;
  /** When the Desk last pulled it. */
  pulledAt: string;
  /** Drive's modified time for the version pulled. */
  modified: string;
};

/** A Doc in the scripts folder, for the picker. */
export type DocEntry = { id: string; name: string; path: string; modified: string };

const HEADING = /^\s{0,3}#{1,6}\s+/;
/** A quoted line: Tom's own notes (his Sources list is one). */
const QUOTE = /^\s{0,3}>/;
/** A section of notes, not script, by its heading. */
const NOTES = /^(sources?|references?|links|notes?)\b/i;

/** A line that's a markdown heading. */
export const isHeading = (line: string): boolean => HEADING.test(line);

/**
 * Which lines aren't read aloud: headings, quoted lines (>), and
 * everything in a section headed Sources, References, Links or Notes
 * until the next heading. True = not said.
 */
export const unsaidLines = (md: string): boolean[] => {
  let notes = false;
  return md.split("\n").map((l) => {
    if (isHeading(l)) {
      notes = NOTES.test(stripMarks(l.replace(HEADING, "")).trim());
      return true;
    }
    return notes || QUOTE.test(l);
  });
};

/**
 * Google's markdown, tidied: images and their base64 tails gone, the
 * backslash escapes undone (Docs escapes every . - ! it thinks might be
 * markdown), no more than one blank line in a row, no trailing spaces.
 */
export const cleanDocMarkdown = (md: string): string =>
  md
    .replace(/\r\n?/g, "\n")
    // Reference-style images: the use and the definition (a data: URL that can run to megabytes).
    .replace(/^\[[^\]\n]+\]:\s*<?data:[^\n]*$/gm, "")
    .replace(/!\[[^\]\n]*\](\[[^\]\n]*\]|\([^)\n]*\))/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~<])/g, "$1")
    // Older Docs mark a section with a line that's all bold rather than a heading style: short, and not a sentence
    // that ends in a stop (a bold line that's said for emphasis does). A question counts, titles often are.
    .replace(/^[ \t]*\*\*([^*\n]+?)\*\*[ \t]*$/gm, (line, t: string) => (t.trim().split(/\s+/).length <= 12 && !/[.!…]$/.test(t.trim()) ? `## ${t.trim()}` : line))
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Emphasis and link marks off a line: what's actually said. */
export const stripMarks = (line: string): string =>
  line
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a: string | undefined, b: string | undefined) => a ?? b ?? "")
    .replace(/(^|[\s(])\*(?!\s)(.+?)(?<!\s)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/(^|[\s(])_(?!\s)(.+?)(?<!\s)_(?=[\s).,;:!?]|$)/g, "$1$2");

/** The script as it's read aloud: no headings or notes, no marks, no bullets. Line breaks stay where they were. */
export const spokenText = (md: string): string => {
  const unsaid = unsaidLines(md);
  return md
    .split("\n")
    .map((l, i) => (unsaid[i] ? "" : stripMarks(l.replace(/^\s*[-*+]\s+/, ""))))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

/** What the rewrite reads: the script with its headings (for the shape) but none of Tom's notes. */
export const forRewrite = (md: string): string => {
  const unsaid = unsaidLines(md);
  return md
    .split("\n")
    .filter((l, i) => !unsaid[i] || isHeading(l))
    .join("\n")
    // A notes section's own heading goes too.
    .replace(/^\s{0,3}#{1,6}\s+\W*(sources?|references?|links|notes?)\b.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

/** The author's headings, each with the start of what's said after it (for the picture plan's chapters). */
export const docHeadings = (md: string): { heading: string; before: string }[] => {
  const lines = md.split("\n");
  const unsaid = unsaidLines(md);
  const out: { heading: string; before: string }[] = [];
  lines.forEach((l, i) => {
    if (!isHeading(l)) return;
    const heading = stripMarks(l.replace(HEADING, "")).trim();
    // The first line said after it, before the next heading (a Sources heading has none).
    let next: string | undefined;
    for (let j = i + 1; j < lines.length && !isHeading(lines[j]!); j++) {
      if (!unsaid[j] && lines[j]!.trim()) {
        next = lines[j];
        break;
      }
    }
    if (!heading || !next) return;
    out.push({ heading, before: stripMarks(next).trim().split(/\s+/).slice(0, 14).join(" ") });
  });
  return out;
};

/** A Doc's name without the export's extension. */
export const docTitle = (name: string): string => name.replace(/\.md$/i, "").trim();
