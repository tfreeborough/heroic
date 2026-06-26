import type { ZoneFile } from "@heroic/core";

/**
 * The save loop's plumbing (docs/design/realmsmith.md): open/read/write a zone
 * JSON through the browser File System Access API — no server. The opened handle
 * is persisted in IndexedDB so reopening across sessions is one click. Chromium
 * only (Chrome/Edge/Arc/Brave); the caller gates on `fsSupported`.
 */

// --- IndexedDB: persist the opened file handle --------------------------------
const DB_NAME = "realmsmith";
const STORE = "handles";
const KEY = "lastZoneFile";

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const persistHandle = async (handle: FileSystemFileHandle): Promise<void> => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

export const loadPersistedHandle = async (): Promise<FileSystemFileHandle | null> => {
  const db = await openDb();
  try {
    return await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as FileSystemFileHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
};

// --- Permission + read/write --------------------------------------------------
/** Ensure the handle has `mode` permission, prompting once if needed. */
export const ensurePermission = async (
  handle: FileSystemFileHandle,
  mode: "read" | "readwrite",
): Promise<boolean> => {
  if ((await handle.queryPermission?.({ mode })) === "granted") return true;
  return (await handle.requestPermission?.({ mode })) === "granted";
};

/**
 * Prompt the user to pick a zone JSON; returns its handle (or null if cancelled).
 * No type filter on purpose: a `{ "application/json": [".json"] }` accept filter
 * greys the file out on some macOS/Chrome setups (the MIME doesn't map to the
 * `.json` UTI). The editor only opens zone JSON anyway, and a wrong file throws a
 * clear parse error in `readZone`.
 */
export const pickZoneFile = async (): Promise<FileSystemFileHandle | null> => {
  const [handle] = await window.showOpenFilePicker({ multiple: false });
  return handle ?? null;
};

export const readZone = async (handle: FileSystemFileHandle): Promise<ZoneFile> => {
  const file = await handle.getFile();
  return JSON.parse(await file.text()) as ZoneFile;
};

export const writeZone = async (handle: FileSystemFileHandle, zone: ZoneFile): Promise<void> => {
  const writable = await handle.createWritable();
  // Match the on-disk shape the generator wrote (2-space indent, trailing newline)
  // so saves produce minimal git diffs.
  await writable.write(JSON.stringify(zone, null, 2) + "\n");
  await writable.close();
};
