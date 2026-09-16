/**
 * Tileset name → bundled atlas image (docs/design/tilesets.md) — the same
 * "zone names it, each app resolves it" pattern the audio manifest uses. Zone
 * JSON stores only the name; Metro bundles only the atlases listed here. A name
 * with no entry (e.g. "placeholder") renders the flat fallback look.
 */
import { useImage, type SkImage } from "@shopify/react-native-skia";
import { arenaById } from "@heroic/blood-in-the-sand-sim";

const TILESET_IMAGES: Record<string, number> = {
  desert: require("../../assets/tilesets/desert.png") as number,
  ancient: require("../../assets/tilesets/ancient.png") as number,
};

/** An arena's atlas (by the room's `welcome.zoneId`, bits-arenas.md), decoded
 *  async — null until ready (or unknown name), during which the renderer draws
 *  the flat pre-tileset look. */
export const useArenaAtlas = (zoneId: string): SkImage | null =>
  useImage(TILESET_IMAGES[arenaById(zoneId).tileset] ?? null);
