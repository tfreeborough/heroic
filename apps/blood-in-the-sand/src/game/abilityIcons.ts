/**
 * The forge icon art as decoded Skia images — the cast flash draws these into
 * the arena picture (render.ts), which plain RN <Image> can't serve.
 */
import { useImage, type SkImage } from "@shopify/react-native-skia";
import { ABILITY_IDS, type AbilityId } from "@heroic/blood-in-the-sand-sim";
import { ICON_SOURCES } from "../loadout/icons";

/**
 * Every ability icon, keyed by id; an entry is absent until its PNG decodes
 * (a frame or two — the flash just skips an icon that isn't ready yet).
 * Calling a hook in a loop is safe here: ABILITY_IDS is a module constant,
 * so the hook order never changes between renders.
 */
export const useAbilityIconImages = (): Partial<Record<AbilityId, SkImage>> => {
  const out: Partial<Record<AbilityId, SkImage>> = {};
  for (const id of ABILITY_IDS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-order constant list
    const img = useImage(ICON_SOURCES[id]);
    if (img) out[id] = img;
  }
  return out;
};
