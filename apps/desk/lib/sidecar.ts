/**
 * One recording = one media file in the game's footage dir + one sidecar
 * JSON next to it with the same basename: the facts the Desk probed and
 * your notes. Media is gitignored; sidecars are committed.
 */
export type FootageFacts = {
  seconds: number;
  width: number;
  height: number;
  fps: number;
  /** ISO timestamp, parsed from the phone's filename when it has one, else the file's mtime. */
  recordedAt: string;
  /** Size on disk — a cheap "has the file changed" check for re-probing. */
  bytes: number;
};

export type FootageSidecar = {
  /** The media file next to this sidecar, e.g. "VID_20260912_194723.mp4". */
  file: string;
  facts: FootageFacts;
  /** Your title / line for it — the Make screen offers them as defaults. */
  title: string;
  line: string;
  /** Free text: what happens in the clip, for future you. */
  note: string;
  /** Crop the templates should apply (fractions of height) — 0 once cleaned. */
  cropTop: number;
  cropBottom: number;
  muted: boolean;
  /** For a clip the Desk cleaned up: the recording it was cut from + how. */
  source?: string;
  cleanup?: CleanupSpec;
};

export type Segment = { start: number; end: number };
/** Pieces always join with a slide left. Cuts saved before that may still
 * say "cut" / "crossfade" / "dip"; a re-cut of one gets the slide. */
export type Transition = "slide";
/** What the Cleanup screen saves: the kept segments of the source, in order,
 * how they join, and the crop + audio applied to all of them. */
export type CleanupSpec = {
  segments: Segment[];
  transition: Transition;
  /** Seconds each slide takes. */
  transitionSeconds: number;
  cropTop: number;
  cropBottom: number;
  muted: boolean;
};

export const sidecarName = (file: string): string => file.replace(/\.[^.]+$/, "") + ".json";
export const MEDIA_EXT = /\.(mp4|mov|m4v)$/i;

/** Defaults for a freshly synced recording. The crop matches an Android
 * recorder's status strip + nav bar; the Cleanup screen is where it's set for real. */
export const freshSidecar = (file: string, facts: FootageFacts): FootageSidecar => ({
  file,
  facts,
  title: "",
  line: "",
  note: "",
  cropTop: 0.035,
  cropBottom: 0.065,
  muted: false,
});
