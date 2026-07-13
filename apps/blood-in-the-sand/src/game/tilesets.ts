/**
 * Tileset name → bundled atlas image (docs/design/tilesets.md) — the same
 * "zone names it, each app resolves it" pattern the audio manifest uses. Zone
 * JSON stores only the name; Metro bundles only the atlases listed here. A name
 * with no entry (e.g. "placeholder") renders the flat fallback look.
 */
import { useImage, type SkImage } from "@shopify/react-native-skia";
import { ARENA_00 } from "@heroic/blood-in-the-sand-sim";

const TILESET_IMAGES: Record<string, number> = {
  desert: require("../../assets/tilesets/desert.png") as number,
};

/** The bundled arena's atlas, decoded async — null until ready (or unknown name),
 *  during which the renderer draws the flat pre-tileset look. */
export const useArenaAtlas = (): SkImage | null =>
  useImage(TILESET_IMAGES[ARENA_00.tileset] ?? null);
