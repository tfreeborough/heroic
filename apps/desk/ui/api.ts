import type { FormatSpec } from "../game";
import type { Binned } from "../lib/footage";
import type { Job } from "../lib/render";
import type { Batch, Render } from "../lib/renders";
import type { CleanupSpec, FootageSidecar } from "../lib/sidecar";

export type Clip = FootageSidecar;
export type { Batch, Binned, Job, Render };
/** What /api/games says about a game — enough for the page; templates load separately. */
export type GameInfo = { id: string; name: string; icon: string; fps: number; formats: Record<string, FormatSpec>; footageFolderId: string; footageDir: string; rendersDir: string };

const j = async <T>(res: Response): Promise<T> => {
  const data = (await res.json()) as T & { error?: string };
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
    clipStrip: (file: string) => `${base}/clips/${enc(file)}/strip`,
    clipUrl: (file: string) => `/g/${enc(game)}/footage/${enc(file)}`,

    render: (body: { template: string; props: Record<string, unknown>; formats: string[]; name: string }) => post(`${base}/render`, body).then((r) => j<Job[]>(r)),
    still: (body: { template: string; props: Record<string, unknown>; format: string; frame: number; name: string }) => post(`${base}/still`, body).then((r) => j<{ file: string }>(r)),
    jobs: () => fetch(`${base}/jobs`).then((r) => j<Job[]>(r)),

    batches: () => fetch(`${base}/batches`).then((r) => j<Batch[]>(r)),
    deleteBatch: (id: string) => fetch(`${base}/batches/${enc(id)}`, { method: "DELETE" }).then((r) => j<{ ok: true; deleted: number }>(r)),
    deleteRender: (slug: string) => fetch(`${base}/renders/${enc(slug)}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
    upload: (slugs: string[]) => post(`${base}/renders/upload`, { slugs }).then((r) => j<{ ok: boolean; log: string; uploaded: string[] }>(r)),
    renderThumb: (slug: string) => `${base}/renders/${enc(slug)}/thumb`,
    renderUrl: (slug: string) => `/g/${enc(game)}/renders/${enc(slug)}.mp4`,
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
