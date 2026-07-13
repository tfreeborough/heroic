/**
 * The bundled arena zone. It lives inside this package (not on the wire, not
 * in an app's assets) so the Bun server and the Expo client statically import
 * the SAME file — a mismatch is impossible and there's no disk-path plumbing.
 * `welcome.zoneId` exists only to assert both ends agree.
 *
 * Ordinary Realmsmith format-v1 JSON — open it in Realmsmith to edit. Layout
 * notes: 1024×1024, a centre pillar plus two 180°-symmetric slabs — the pillar
 * breaks line of sight (auto-targeting drops, attacks lock-break), which is
 * what gives the dash a juke purpose. Dressed with the desert tileset
 * (docs/design/tilesets.md): floor tile ids index the desert atlas, and the
 * prop objects (cacti/tufts, 180°-symmetric) carry hidden footprints — body
 * cover that blocks movement but not sight.
 */
import type { ZoneFile } from "@heroic/core";
import arena00 from "./zones/arena-00.json";

// JSON imports widen literal unions (e.g. kind: string), hence the cast —
// same idiom the gauntlet uses for its zone imports.
export const ARENA_00 = arena00 as unknown as ZoneFile;
