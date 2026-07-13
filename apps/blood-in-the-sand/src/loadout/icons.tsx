/**
 * Line-glyph icons for weapons + abilities — placeholder art until Asset
 * Forge's image path produces the real set. One SVG path string per id
 * (24×24 design space), stroked in the caller's colour via a tiny Skia
 * canvas. Multi-subpath strings are fine (MakeFromSVGString handles M…M…).
 */
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import type { AbilityId, WeaponId } from "@heroic/blood-in-the-sand-sim";

export type IconId = WeaponId | AbilityId;

const PATHS: Record<IconId, string> = {
  // weapons
  blade: "M5 19 L17 7 M15 4 l5 5 M9 13 l2 2 M4 17 l3 3",
  bow: "M6 3 c6 3 6 15 0 18 M6 3 v18 M6 12 h13 M16 9 l3 3 -3 3",
  staff: "M12 8 v13 M9.4 5 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0 M7 5 h1 M16 5 h1",
  hammer: "M7 3 h10 v6 h-10 z M12 9 v12",
  // abilities
  sandtrap: "M4 18 c3 -3 13 -3 16 0 M9 15 l1.5 -4 1.5 4 M13.5 15 l1.5 -4 1.5 4",
  tremor: "M12 12 l-2 3 h4 l-2 3 M5 12 a7 7 0 0 1 14 0 M2.5 12 a9.5 9.5 0 0 1 19 0",
  harpoon: "M4 5 l9 9 M13 14 c2 2 5 2 6 -1 c0 4 -2 6 -5 5 M6 4 L4 5 L5 7",
  dash: "M5 6 l5 6 -5 6 M11 6 l5 6 -5 6 M17 6 l5 6 -5 6",
  "mirror-guard": "M12 3 l7 3 v6 c0 4 -3 7 -7 9 c-4 -2 -7 -5 -7 -9 V6 z M16 9 l-5 5 M11.5 9.5 L16 9 L15.5 13.5",
  ironhide: "M12 3 l7 3 v6 c0 4 -3 7 -7 9 c-4 -2 -7 -5 -7 -9 V6 z M9 9 l3 3 -1.5 2 3 3",
  "straw-man":
    "M12 8 v11 M6 11 h12 M9.6 5 a2.4 2.4 0 1 0 4.8 0 a2.4 2.4 0 1 0 -4.8 0 M9.4 14 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0",
  "war-drums":
    "M6 10 a6 2.4 0 1 0 12 0 a6 2.4 0 1 0 -12 0 M6 10 v6 c0 1.3 2.7 2.4 6 2.4 s6 -1.1 6 -2.4 v-6 M4 5 l4 3 M20 5 l-4 3",
  "blood-font":
    "M6 4 h12 l-1.5 5 a4.5 4.5 0 0 1 -9 0 z M12 13 v4 M8 20 h8 M12 17.5 l-1 1.7 a1.2 1.2 0 1 0 2 0 z",
  sandstorm: "M4 8 c5 -2 11 -2 16 0 M6 12 c4 -1.6 8 -1.6 12 0 M5 16 c5 -2 9 -2 14 0 M5 4 l14 16",
};

// Parse once at module scope — path strings never change.
const PARSED = Object.fromEntries(
  Object.entries(PATHS).map(([id, d]) => [id, Skia.Path.MakeFromSVGString(d)!]),
) as Record<IconId, ReturnType<(typeof Skia)["Path"]["Make"]>>;

export interface LoadoutIconProps {
  id: IconId;
  size: number;
  color: string;
}

/** A stroked line glyph. Cheap: one static path per id, scaled to fit. */
export const LoadoutIcon = ({ id, size, color }: LoadoutIconProps) => {
  const scale = size / 24;
  return (
    <Canvas style={{ width: size, height: size }}>
      <Path
        path={PARSED[id]}
        style="stroke"
        color={color}
        strokeWidth={1.7 / scale}
        strokeCap="round"
        strokeJoin="round"
        transform={[{ scale }]}
      />
    </Canvas>
  );
};
