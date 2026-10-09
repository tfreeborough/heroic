import type { ExportJob, ExportSpec } from "../lib/export";
import type { Scene } from "../lib/scene";
import type { Stamp } from "../lib/stamps";
import type { OutFile, SceneSummary } from "../lib/store";

export type Brand = { id: string; name: string; palette: { name: string; hex: string }[]; background: string; stampGroups: { id: string; label: string }[]; desk: boolean };

const j = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return data as T;
};
const body = (data: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

export const api = {
  games: () => j<Brand[]>("/api/games"),
  stamps: (g: string) => j<Stamp[]>(`/api/${g}/stamps`),
  scenes: (g: string) => j<SceneSummary[]>(`/api/${g}/scenes`),
  scene: (g: string, name: string) => j<Scene>(`/api/${g}/scenes/${encodeURIComponent(name)}`),
  createScene: (g: string, name: string) => j<Scene>(`/api/${g}/scenes`, body({ name })),
  saveScene: (g: string, s: Scene) => j<Scene>(`/api/${g}/scenes/${encodeURIComponent(s.name)}`, { ...body(s), method: "PUT" }),
  deleteScene: (g: string, name: string) => j<{ ok: true }>(`/api/${g}/scenes/${encodeURIComponent(name)}`, { method: "DELETE" }),
  renameScene: (g: string, name: string, to: string) => j<Scene>(`/api/${g}/scenes/${encodeURIComponent(name)}/rename`, body({ to })),
  startExport: (g: string, spec: ExportSpec) => j<ExportJob>(`/api/${g}/exports`, body(spec)),
  frame: (g: string, id: string, n: number, blob: Blob) => j<{ frames: number }>(`/api/${g}/exports/${id}/frames/${n}`, { method: "PUT", body: blob }),
  finishExport: (g: string, id: string) => j<ExportJob>(`/api/${g}/exports/${id}/finish`, { method: "POST" }),
  abandonExport: (g: string, id: string) => j<{ ok: true }>(`/api/${g}/exports/${id}`, { method: "DELETE" }),
  recording: (g: string, name: string, blob: Blob) => j<{ file: string }>(`/api/${g}/recordings?name=${encodeURIComponent(name)}`, { method: "POST", body: blob }),
  still: (g: string, name: string, blob: Blob) => j<{ file: string }>(`/api/${g}/stills?name=${encodeURIComponent(name)}`, { method: "POST", body: blob }),
  out: (g: string) => j<OutFile[]>(`/api/${g}/out`),
  deleteOut: (g: string, file: string) => j<{ ok: true }>(`/api/${g}/out/${encodeURIComponent(file)}`, { method: "DELETE" }),
  sendToDesk: (g: string, file: string) => j<unknown>(`/api/${g}/out/${encodeURIComponent(file)}/desk`, { method: "POST" }),
};
