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
  /** A caution under the form for these props (effective = what renders,
   * typed = what's in the form), e.g. a loop that's too long. */
  warn?: (effective: Record<string, unknown>, typed: Record<string, unknown>) => string | undefined;
  /** Selects instead of free text for some fields. */
  options?: Record<string, { value: string; label: string }[]>;
  /** Fields the screen handles itself. */
  hide?: string[];
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
};
