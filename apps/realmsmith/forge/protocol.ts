/**
 * Wire types shared by the Forge panel (browser) and the Vite plugin (Node).
 * Pure types only — the panel imports this with `import type`, so nothing
 * Node-flavoured can leak into the client bundle. See docs/design/asset-forge.md.
 */

export interface ForgeTypeInfo {
  id: string;
  label: string;
  provider: string;
  /** Takes generated per request (auditioned as a spread, saved as a variation bank). */
  candidates: number;
}

export interface ForgeStatus {
  types: ForgeTypeInfo[];
  /** Which provider keys the dev server found — the panel warns on the missing ones.
   * `stableAudio` = the LOCAL Stable Audio 3 checkout + weights are in place. */
  keys: { elevenlabs: boolean; openai: boolean; stableAudio: boolean; stableAudioWeights: boolean };
  /** Which SFX engine `generate` will use (FORGE_SFX_PROVIDER, default
   * elevenlabs), and — when it's Stable Audio and not ready — what's missing. */
  sfxProvider: SfxProvider;
  sfxProviderMissing: string[];
  /** PNGs already in the icon destination folder. The panel derives done-ness
   * by matching these against the set it builds from the SIM's own tables
   * (src/forge/iconSet.ts) — the server has no icon list of its own. */
  iconFiles: string[];
  /** mp3s already in the Blood in the Sand SFX folder. The panel matches these
   * against the sound set it builds (src/forge/soundSet.ts): a bank is done when
   * any `<id>_<n>.mp3` exists. Same server-has-no-list pattern as iconFiles. */
  sfxFiles: string[];
  /** PNGs already in the sprite destination folder — done-ticks for the sprite
   * set (which is the checked-in SPRITE_SUBJECTS list, not a sim derivation). */
  spriteFiles: string[];
  /** PNGs already in the mode-card destination folder — done-ticks for the
   * mode set (the checked-in MODE_KEYS/MODE_SUBJECTS list). */
  modeFiles: string[];
  /** PNGs already in the rank-badge destination folder — done-ticks for the
   * badge set (the checked-in BADGE_KEYS/BADGE_SUBJECTS list). */
  badgeFiles: string[];
  /** PNGs already in the deed-icon destination folder — done-ticks for the
   * deed set (derived from ACHIEVEMENT_DEFS, deedSet.ts). */
  deedFiles: string[];
  /** Deed id → the subject its PNG was forged FROM (read off the
   * `<id>.forge.json` sidecar). The panel diffs this against the live
   * DEED_SUBJECTS so a deed whose subject was rewritten after forging shows
   * as STALE — re-forge candidates stay visible without regenerating the
   * rest of the set. Absent when the sidecar is missing or unreadable. */
  deedForged: Record<string, string>;
  /** Sound bank id → the brief its mp3s were forged FROM (same sidecar diff as
   * deedForged). With the 2026-09-06 brief rewrite every ElevenLabs-era bank
   * shows STALE — the regenerate list, no clearing-out needed: save overwrites
   * `<id>_1.mp3` + the sidecar in place. */
  sfxForged: Record<string, string>;
  /** PNGs already in the home-backdrop destination folder — done-ticks for
   * the home set (the checked-in HOME_KEYS/HOME_SUBJECTS list). */
  homeFiles: string[];
}

export interface GenerateRequest {
  type: string;
  /** The user's sentence; the style bible turns it into the full prompt. */
  subject: string;
  /**
   * Send this text verbatim instead of templating the subject — the panel's
   * editable prompt box (hand-written).
   */
  prompt?: string;
  /** SFX clip length in seconds (0.5–30); omit to let the provider decide. */
  durationSeconds?: number;
  /** 0–1 override of how literally the provider follows the prompt. */
  promptInfluence?: number;
}

/** Which engine(s) `generate` runs: "both" fans the same prompt + duration out
 * to the local model AND ElevenLabs and returns every take tagged, so the
 * better engine per sound is a per-take pick, not a config choice. */
export type SfxProvider = "elevenlabs" | "stable-audio" | "both";
export type SfxEngine = "stable-audio" | "elevenlabs";

export interface Candidate {
  id: number;
  mime: string;
  b64: string;
  /** SFX: the engine that made this take (shown as a tag; recorded per file). */
  engine?: SfxEngine;
  /** Image flows only: the candidate as the SAVE pipeline would ship it
   * (grid-snapped, quantized) — the panel previews this so what you judge is
   * what saves; `b64` stays the raw generation and is what save receives. */
  preview?: string;
}

export interface GenerateResponse {
  /** The full prompt actually sent — shown in the panel, recorded in the sidecar. */
  prompt: string;
  candidates: Candidate[];
}

export interface SaveRequest {
  type: string;
  /** SFX: snake_case bank name, files land as `<baseName>_<n>` continuing
   * on-disk numbering. Icons: the kebab-case manifest id, saved as `<id>.png`
   * (one file per icon — regenerating overwrites). */
  baseName: string;
  subject: string;
  prompt: string;
  durationSeconds?: number;
  /** The influence the takes were generated with — recorded in the sidecar. */
  promptInfluence?: number;
  /** b64 payloads of the kept candidates. */
  takes: string[];
  /** SFX: the engine per kept take, parallel to `takes` — recorded in the sidecar. */
  engines?: (SfxEngine | undefined)[];
}

export interface SaveResponse {
  files: string[];
  /** Repo-relative path of the bank's sidecar JSON. */
  sidecar: string;
  /** Ready-to-paste manifest lines — images only now; SFX banks are wired by
   * the generated manifest (`manifest`) and need no paste. */
  manifestLines: string[];
  /** SFX: repo-relative path of the regenerated manifest, when one was written. */
  manifest?: string;
}

/** One take already on disk in a sound bank. */
export interface BankTake {
  file: string;
  /** Take number (the `_<n>`). */
  n: number;
  bytes: number;
  mime: string;
  b64: string;
}

/** GET /forge/bank?type=sfx-bits&id=<bank> */
export interface BankResponse {
  id: string;
  takes: BankTake[];
}

/** POST /forge/bank/remove — delete one take; the manifest + sidecar follow. */
export interface BankRemoveRequest {
  type: string;
  id: string;
  file: string;
}

export interface ForgeError {
  error: string;
}
