/**
 * Client half of tileset resolution (docs/design/tilesets.md): the zone stores a
 * tileset *name*; the dev server (tilesetServer/plugin.ts) serves the atlas PNGs
 * from the game apps' asset folders. Unknown names simply resolve to null and the
 * viewport falls back to the placeholder checker — every pre-tileset zone
 * (`"placeholder"`) keeps rendering untouched.
 */

const cache = new Map<string, Promise<HTMLImageElement | null>>();

/** The atlas image for a tileset name, cached; null if the server has no such set. */
export const loadAtlas = (name: string): Promise<HTMLImageElement | null> => {
  let p = cache.get(name);
  if (!p) {
    p = new Promise((resolvePromise) => {
      const img = new Image();
      img.onload = () => resolvePromise(img);
      img.onerror = () => {
        cache.delete(name); // a repack may land later — allow a retry
        resolvePromise(null);
      };
      img.src = `/tilesets/${encodeURIComponent(name)}.png`;
    });
    cache.set(name, p);
  }
  return p;
};

/** Names of every atlas the dev server can find (drives the tileset switcher). */
export const fetchTilesetIndex = async (): Promise<string[]> => {
  try {
    const res = await fetch("/tilesets");
    if (!res.ok) return [];
    const body = (await res.json()) as { tilesets?: unknown };
    return Array.isArray(body.tilesets) ? body.tilesets.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
};
