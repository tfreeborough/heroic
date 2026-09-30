import type { FormatSpec } from "../game";
import type { Binned } from "../lib/footage";
import type { Job } from "../lib/render";
import type { Batch, Render } from "../lib/renders";
import type { Platform, Post, Schedule } from "../lib/schedule";
import type { CleanupSpec, FootageSidecar } from "../lib/sidecar";
import type { Take, VoiceOver } from "@heroic/voiceover";
import type { VoiceSummary } from "../lib/voice";
import type { WhisperStatus } from "../lib/whisper";

export type Clip = FootageSidecar;
export type { Batch, Binned, Job, Platform, Post, Render, Schedule, VoiceSummary, WhisperStatus };
/** What /api/games says about a game — enough for the page; templates load separately. */
export type GameInfo = { id: string; name: string; icon: string; fps: number; formats: Record<string, FormatSpec>; footageFolderId: string; footageDir: string; rendersDir: string };

const j = async <T>(res: Response): Promise<T> => {
  const text = await res.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(text) as T & { error?: string };
  } catch {
    // The page is bundled fresh on every load but the server only reads its
    // code when it starts, so a route added since then isn't there yet.
    if (res.status === 404) throw new Error("The Desk's server doesn't know this part of the page yet. It was started before the code changed: stop it (Ctrl+C) and run `bun run desk` again.");
    throw new Error(text.slice(0, 200) || res.statusText);
  }
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
};
const enc = encodeURIComponent;
const post = (url: string, body?: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const games = () => fetch("/api/games").then((r) => j<GameInfo[]>(r));

/** All calls scoped to one game. */
export const gameApi = (game: string) => {
  const base = `/api/${enc(game)}`;
  return {
    clips: () => fetch(`${base}/clips`).then((r) => j<Clip[]>(r)),
    sync: (offline = false) => post(`${base}/clips/sync${offline ? "?offline=1" : ""}`).then((r) => j<{ ok: boolean; log: string }>(r)),
    saveClip: (file: string, patch: Partial<Clip>) =>
      fetch(`${base}/clips/${enc(file)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) => j<Clip>(r)),
    trashClip: (file: string) => fetch(`${base}/clips/${enc(file)}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
    bin: () => fetch(`${base}/bin`).then((r) => j<Binned[]>(r)),
    restoreClip: (file: string) => post(`${base}/bin/${enc(file)}/restore`).then((r) => j<{ onDisk: boolean }>(r)),
    cleanup: (file: string, body: CleanupSpec & { name: string; replace?: string }) =>
      post(`${base}/clips/${enc(file)}/cleanup`, body).then((r) => j<Clip>(r)),
    clipThumb: (file: string, at: number) => `${base}/clips/${enc(file)}/thumb?at=${at.toFixed(2)}`,
    clipStrip: (file: string, frames = 24) => `${base}/clips/${enc(file)}/strip?frames=${frames}`,
    clipUrl: (file: string) => `/g/${enc(game)}/footage/${enc(file)}`,

    voices: () => fetch(`${base}/voice`).then((r) => j<VoiceSummary[]>(r)),
    /** The saved voice-over, or an empty one for this clip. `path` is what a template's `voice` prop takes. */
    voice: (id: string, clip: string) => fetch(`${base}/voice/${enc(id)}?clip=${enc(clip)}`).then((r) => j<VoiceOver & { path: string }>(r)),
    saveVoice: (voice: VoiceOver) => fetch(`${base}/voice/${enc(voice.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(voice) }).then((r) => j<VoiceOver>(r)),
    /** `keepTakes`: the edit has moved to another clip, its recordings stay. */
    deleteVoice: (id: string, keepTakes = false) => fetch(`${base}/voice/${enc(id)}${keepTakes ? "?keep=1" : ""}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
    /** A saved voice-over as it is on disk, or undefined. */
    savedVoice: (id: string) => fetch(`${base}/voice/${enc(id)}`).then((r) => (r.ok ? j<VoiceOver & { path: string }>(r) : undefined)),
    addTake: (id: string, audio: Blob, opts: { tidy: boolean; denoise?: number; ext?: string }) =>
      fetch(`${base}/voice/${enc(id)}/takes?tidy=${opts.tidy ? 1 : 0}&denoise=${opts.denoise ?? 0}&ext=${enc(opts.ext ?? "wav")}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: audio }).then((r) => j<Take>(r)),
    transcribe: (id: string, take: Take) => post(`${base}/voice/${enc(id)}/transcribe`, take).then((r) => j<Take>(r)),
    /** The takes' sound made another way: tidied or not, the background noise down (0–3) or not. */
    sound: (voice: VoiceOver, want: { tidy?: boolean; denoise?: number }) => post(`${base}/voice/${enc(voice.id)}/sound`, { voice, ...want }).then((r) => j<VoiceOver>(r)),
    whisper: () => fetch(`${base}/voice/whisper`).then((r) => j<WhisperStatus>(r)),
    installWhisper: () => post(`${base}/voice/whisper`).then((r) => j<WhisperStatus>(r)),
    backupTakes: () => post(`${base}/voice/backup`).then((r) => j<{ ok: boolean; log: string }>(r)),
    /** A file under the game's public dir, as the page fetches it (a take's WAV). */
    publicUrl: (path: string) => `/g/${enc(game)}/${path.split("/").map(enc).join("/")}`,

    render: (body: { template: string; props: Record<string, unknown>; formats: string[]; name: string }) => post(`${base}/render`, body).then((r) => j<Job[]>(r)),
    still: (body: { template: string; props: Record<string, unknown>; format: string; frame: number; name: string }) => post(`${base}/still`, body).then((r) => j<{ file: string }>(r)),
    jobs: () => fetch(`${base}/jobs`).then((r) => j<Job[]>(r)),

    batches: () => fetch(`${base}/batches`).then((r) => j<Batch[]>(r)),
    deleteBatch: (id: string) => fetch(`${base}/batches/${enc(id)}`, { method: "DELETE" }).then((r) => j<{ ok: true; deleted: number }>(r)),
    deleteRender: (slug: string) => fetch(`${base}/renders/${enc(slug)}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
    upload: (slugs: string[]) => post(`${base}/renders/upload`, { slugs }).then((r) => j<{ ok: boolean; log: string; uploaded: string[] }>(r)),
    renderThumb: (slug: string) => `${base}/renders/${enc(slug)}/thumb`,
    renderUrl: (slug: string) => `/g/${enc(game)}/renders/${enc(slug)}.mp4`,

    /** `claude` = the server has a key and the game a voice, so drafting is on. */
    schedule: () => fetch(`${base}/schedule`).then((r) => j<Schedule & { claude: boolean }>(r)),
    redraft: (id: string) => post(`${base}/schedule/${enc(id)}/draft`).then((r) => j<Schedule>(r)),
    queue: (batches: string[]) => post(`${base}/schedule`, { batches }).then((r) => j<{ schedule: Schedule; placed: Post[]; skipped: string[] }>(r)),
    scheduleSettings: (patch: { slotsPerDay?: number; minGapDays?: number; slotLabels?: string[] }) =>
      fetch(`${base}/schedule`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) => j<Schedule>(r)),
    reflow: () => post(`${base}/schedule/reflow`).then((r) => j<Schedule>(r)),
    move: (id: string, day: string, slot: number) => post(`${base}/schedule/${enc(id)}/move`, { day, slot }).then((r) => j<Schedule>(r)),
    updatePost: (id: string, patch: Partial<Pick<Post, "day" | "slot" | "title" | "description" | "posted">> & { doneAt?: string | null }) =>
      fetch(`${base}/schedule/${enc(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) => j<Schedule>(r)),
    ignore: (batch: string, ignored: boolean) =>
      fetch(`${base}/batches/${enc(batch)}/ignore`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ignored }) }).then((r) => j<Schedule>(r)),
    unqueue: (id: string) => fetch(`${base}/schedule/${enc(id)}`, { method: "DELETE" }).then((r) => j<Schedule>(r)),
  };
};
export type GameApi = ReturnType<typeof gameApi>;

export const fmtSeconds = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m ? `${m}:${r.toFixed(1).padStart(4, "0")}` : `${r.toFixed(1)}s`;
};
export const fmtBytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
export const fmtDate = (iso: string) => iso.slice(0, 10) + " " + iso.slice(11, 16);
