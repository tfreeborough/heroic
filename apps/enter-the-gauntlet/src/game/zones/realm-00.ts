/**
 * realm-00 — the proving-grounds arena, now authored as JSON (`realm-00.json`,
 * under the game's assets) and edited in Realmsmith (docs/design/realmsmith.md).
 *
 * This module just imports that JSON and types it as a `ZoneFile` so the game can
 * `loadZone` it; the JSON is the source of truth the editor round-trips. It began
 * life as computed TypeScript (an `isFloor` predicate + arithmetic pillar rects) —
 * `git log` has that original generator if the floor-shape logic is ever wanted.
 */
import type { ZoneFile } from "@heroic/core";
import data from "../../../assets/zones/realm-00.json";

// JSON imports widen string literals (e.g. a breakable's `type: "explode"` becomes
// `string`), so the inferred type doesn't structurally match ZoneFile's unions.
// The data IS valid — it was emitted from a ZoneFile — so assert it.
export const REALM_00 = data as unknown as ZoneFile;
