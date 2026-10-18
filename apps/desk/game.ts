/**
 * What a game hands the Desk. One `desk.config.ts` per promos package
 * (see apps/bits-promos/desk.config.ts), registered in games.ts.
 *
 * The config is imported by BOTH the server (paths, Drive, prepare) and the
 * browser (name, icon, formats); the templates — React components — are
 * behind a lazy `templates()` so the server never loads them.
 */
import type * as React from "react";
import type { ZodObject } from "zod";
import type { AiVoice } from "./lib/draft";
import type { ScriptVoice } from "./lib/rewrite";

export type FormatSpec = { width: number; height: number; label: string };

export type DeskTemplate = {
  /** The Remotion composition id in the game's Root. */
  id: string;
  label: string;
  blurb: string;
  component: React.FC<any>;
  schema: ZodObject;
  /** Total seconds for these props (drives the preview + render length). */
  seconds: (props: Record<string, unknown>) => number;
  /** Props the Make screen fills from the chosen clip rather than the form
   * (`facts` = the sidecar's measurements, when the Desk has them). */
  clipProps: (clipPath: string, clipSeconds: number, facts?: { width: number; height: number }) => Record<string, unknown>;
  /** The prop naming the footage file. */
  clipKey: string;
  /** Props Make never fills from the chosen clip's sidecar (its title, its line): they start blank. */
  noClipFill?: string[];
  /** The "how much of the clip" props: leaving `durationKey` blank in the
   * Desk means "from `startKey` to the end of the clip", and a typed value is
   * capped there too. */
  uncapped?: { durationKey: string; startKey: string };
  defaults: Record<string, unknown>;
  /** The Render button waits for a clip. */
  needsClip?: boolean;
  /** One field may carry several alternatives (a hook A/B test): the Make
   * screen shows it as a list you add lines to one at a time, the preview
   * picks one, and a Render press makes one batch per alternative, named
   * `<name>-<suffix><n>`. Each render gets a single string. */
  variants?: { key: string; suffix: string; placeholder?: string };
  /** Fields that hold a list of lines (a list clip's items): shown as a row
   * per line, Enter adds the next. The render gets the array. `number`
   * labels row `i` of `n` filled ones (default: 1, 2, 3…). */
  lists?: { key: string; label: string; placeholder?: string; hint?: string; number?: (i: number, n: number, props: Record<string, unknown>) => string }[];
  /** A caution under the form for these props (effective = what renders,
   * typed = what's in the form), e.g. a loop that's too long. `clip` = the
   * chosen clip's facts the form doesn't hold: an edit's marker times
   * (undefined for a plain recording). */
  warn?: (effective: Record<string, unknown>, typed: Record<string, unknown>, clip?: { markers?: number[] }) => string | undefined;
  /** Selects instead of free text for some fields. */
  options?: Record<string, { value: string; label: string }[]>;
  /** The render name a blank Name field falls back to, worked out from the
   * props (Autosave: `slot-7-the-memory`). Typing a name still wins. */
  name?: (props: Record<string, unknown>) => string;
  /** Fields the screen handles itself. */
  hide?: string[];
  /** One field picked from a library of pictures instead of a select:
   * preview squares, with what's already been rendered on its own tab. */
  gallery?: { key: string; label: string; items: GalleryItem[] };
  /** Text fields that get a big box (long words). */
  long?: string[];
  /** Whole-number fields (a seed) that start random on a fresh form and
   * get a Reroll button. */
  reroll?: string[];
  /** Changing one field fills others (picking a picture brings its words). */
  linked?: (key: string, value: unknown) => Record<string, unknown> | undefined;
  /** Props a fresh form fetches (the next pair off a queue the game keeps),
   * laid over the defaults. A re-opened batch keeps its own. */
  fresh?: () => Promise<Record<string, unknown>>;
  /** A plain note under the form (not a warning): what these props will do,
   * e.g. which easter egg a save gets and why. */
  info?: (props: Record<string, unknown>) => string | undefined;
  /** Files these props need, made before the preview plays them and before
   * a render (Autosave's generated music). Returns props to lay over the
   * form, e.g. the made file's name; the Make screen calls it a moment after
   * the form settles, and awaits it on Render/Still. */
  prepare?: (props: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Told after a Render press with what went off (so the game can mark
   * the queue's pair used). Once per press, whatever the variants. */
  rendered?: (props: Record<string, unknown>, name: string) => void | Promise<void>;
  /** It takes a voice-over: the props `voice` (a path under public/, from
   * the Voice screen), `captions`, `voiceVolume` and `duck`, plus the hidden
   * `voiceData` (an unsaved edit, inline). Make fills the `voice` choices
   * from what's been recorded against the chosen clip. */
  voice?: boolean;
};

/** What the Voice screen plays while you record and edit: a composition
 * that shows the clip the way a finished video would, and takes `voiceData`
 * + `captions` so the captions on screen are the render's own. */
export type VoicePreview = {
  component: React.FC<any>;
  props: (clipPath: string, clipSeconds: number, clip: { width: number; height: number; cropTop: number; cropBottom: number }) => Record<string, unknown>;
};

/** A picture a gallery field can take; `thumb` is under the game's public dir. */
export type GalleryItem = { value: string; label: string; thumb: string };

export type GameConfig = {
  /** URL-safe id: /api/<id>/… */
  id: string;
  name: string;
  /** Under the game's public dir, e.g. "assets/app-icon.png". */
  icon: string;
  /** Absolute path of the promos package (use import.meta.dir). */
  root: string;
  /** Relative to root. */
  remotionEntry: string;
  publicDir: string;
  footageDir: string;
  rendersDir: string;
  /** Voice-overs (the edits + a takes/ folder). Must sit inside publicDir;
   * default `<publicDir>/voice`. */
  voiceDir?: string;
  /** Names Whisper should know how to spell (the game, its weapons…). */
  voice?: { vocabulary: string[] };
  /** Source folders outside the entry's own (relative to root) that the
   * templates import: a change there re-bundles too. */
  bundleWatch?: string[];
  /** Run in root when the Desk starts (e.g. sync icons from the game). */
  prepare?: string[][];
  fps: number;
  formats: Record<string, FormatSpec>;
  drive: {
    /** The Drive folder recordings get dropped in (the id from its URL). */
    footageFolderId: string;
    /** rclone remote (drive.readonly) rooted at that folder. */
    footageRemote: string;
    /** rclone destination for finished videos, e.g. "gdrive,root_folder_id=…:Promos/Desk". */
    uploadTarget: string;
    /** The Drive folder the video scripts (Google Docs) live in (the id from its URL): the Scripts tab pulls them from here (docs/design/desk-docs.md). */
    scriptsFolderId?: string;
    /** rclone remote (drive.readonly) rooted at that folder. */
    scriptsRemote?: string;
  };
  templates: () => Promise<{ TEMPLATES: DeskTemplate[]; VOICE_PREVIEW?: VoicePreview }>;
  /** The posting queue's words: draft a title (Shorts) and description
   * (everywhere) from a render's template + props, in the game's voice.
   * Without it the queue uses the batch name and the hook. */
  post?: {
    draft: (template: string, props: Record<string, unknown>) => { title: string; description: string };
    /** With ANTHROPIC_API_KEY set, Claude writes the variable part of each
     * post in this voice at queue time (and on the Queue's Redraft button);
     * `draft` above stays the fallback. */
    ai?: AiVoice;
  };
  /** The Scripts tab: with ANTHROPIC_API_KEY set, Claude rewrites a pasted
   * script into a long cut in this voice (docs/design/desk-scripts.md) and
   * plans a picture per beat (docs/design/desk-ascii-scripts.md), previewed
   * as glyphs in `palette` (ascii-build's PALETTES; default matrix). */
  script?: { ai: ScriptVoice; palette?: "matrix" | "sand" };
  /** The game's own tabs (browser, lazy), after the Desk's. Their server
   * side is `desk.server.ts` beside the config (see GameRoutes). */
  tabs?: GameTab[];
  /** Desk tabs this game has no use for, e.g. ["clips", "scripts"]. */
  hideTabs?: string[];
};

/** What a game's own tab is handed. `game` is the game's id. */
export type GameTabProps = { game: string; arg?: string };
export type GameTab = { id: string; label: string; load: () => Promise<{ Tab: React.FC<GameTabProps> }> };

/**
 * A game's server routes: `export const routes: GameRoutes` in
 * `<root>/desk.server.ts`, which the Desk loads by path at start (so the
 * browser bundle never sees it). `"POST draft"` answers POST
 * /api/<game>/x/draft. Long work must not block: use async I/O, never
 * spawnSync (memory: bun-serve-no-spawnsync).
 *
 * Reserved: `"POST batch-deleted"`, if a game has it, is called after a batch
 * of renders is deleted, with `{ id, props }` (each deleted render's props).
 */
export type GameRoutes = Record<string, (req: Request, g: GameConfig) => Response | Promise<Response>>;
