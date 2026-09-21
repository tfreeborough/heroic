import type { ZoneFile } from "@heroic/core";

/**
 * Client half of project zones (zonesServer/plugin.ts, bits-arenas.md): the
 * repo's own zone files, opened and saved through the dev server — no picker,
 * no permission prompt. Files outside the repo still go through fileAccess.ts.
 */

export interface ProjectZone {
  path: string;
  id: string;
  name: string;
  owner: string;
  /** The folder has a generated registry: a new arena here reaches the game. */
  registry: boolean;
}

const fail = async (res: Response): Promise<never> => {
  let msg = `${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") msg = body.error;
  } catch {
    /* no body */
  }
  throw new Error(msg);
};

export const listProjectZones = async (): Promise<ProjectZone[]> => {
  try {
    const res = await fetch("/zones");
    if (!res.ok) return [];
    const body = (await res.json()) as { zones?: unknown };
    return Array.isArray(body.zones) ? (body.zones as ProjectZone[]) : [];
  } catch {
    return [];
  }
};

export const readProjectZone = async (path: string): Promise<ZoneFile> => {
  const res = await fetch(`/zones/file?path=${encodeURIComponent(path)}`);
  if (!res.ok) return fail(res);
  return (await res.json()) as ZoneFile;
};

export const writeProjectZone = async (path: string, zone: ZoneFile): Promise<void> => {
  const res = await fetch(`/zones/file?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(zone),
  });
  if (!res.ok) return fail(res);
};

/** Clone `from` as a new zone beside it; returns the new file's listing entry. */
export const createProjectZone = async (from: string, id: string, name: string): Promise<ProjectZone> => {
  const res = await fetch("/zones/new", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, id, name }),
  });
  if (!res.ok) return fail(res);
  const body = (await res.json()) as { path: string; id: string; name: string; registry: boolean };
  return { ...body, owner: from.split("/")[1] ?? "" };
};

/** A kebab id from a display name: "Sunken Temple" → "sunken-temple". */
export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "");
