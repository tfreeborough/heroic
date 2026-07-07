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
  /** Which provider keys the dev server found — the panel warns on the missing ones. */
  keys: { elevenlabs: boolean; openai: boolean };
}

export interface ExpandRequest {
  type: string;
  /** The user's rough sentence; an LLM turns it into a crafted provider prompt. */
  subject: string;
  durationSeconds?: number;
}

export interface ExpandResponse {
  prompt: string;
}

export interface GenerateRequest {
  type: string;
  /** The user's sentence; the style bible turns it into the full prompt. */
  subject: string;
  /**
   * Send this text verbatim instead of templating the subject — the panel's
   * editable prompt box (hand-written or LLM-expanded).
   */
  prompt?: string;
  /** SFX clip length in seconds (0.5–30); omit to let the provider decide. */
  durationSeconds?: number;
  /** 0–1 override of how literally the provider follows the prompt. */
  promptInfluence?: number;
}

export interface Candidate {
  id: number;
  mime: string;
  b64: string;
}

export interface GenerateResponse {
  /** The full prompt actually sent — shown in the panel, recorded in the sidecar. */
  prompt: string;
  candidates: Candidate[];
}

export interface SaveRequest {
  type: string;
  /** snake_case bank name; files land as `<baseName>_<n>` continuing on-disk numbering. */
  baseName: string;
  subject: string;
  prompt: string;
  durationSeconds?: number;
  /** The influence the takes were generated with — recorded in the sidecar. */
  promptInfluence?: number;
  /** b64 payloads of the kept candidates. */
  takes: string[];
}

export interface SaveResponse {
  files: string[];
  /** Repo-relative path of the bank's sidecar JSON. */
  sidecar: string;
  /** Ready-to-paste `manifest.ts` lines for the saved files. */
  manifestLines: string[];
}

export interface ForgeError {
  error: string;
}
