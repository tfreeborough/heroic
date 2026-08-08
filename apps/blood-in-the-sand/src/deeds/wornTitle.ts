/**
 * The worn title (achievements.md § wearing titles) — which earned deed's
 * name this player wears under their own. Device-local like the announcer
 * pack (`bits.announcerPack` pattern): module state read on the join path,
 * AsyncStorage for persistence, applied on launch by App.tsx. The server
 * only ever sees per-room claims (a DEED ID, never display text); ranked
 * verifies the claim against entitlements, so a stale local value costs
 * nothing worse than joining bare.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ACHIEVEMENT_DEFS, type BitsAchievementDef } from "@heroic/blood-in-the-sand-sim";

const KEY_WORN_TITLE = "bits.title";

const DEFS_BY_ID = new Map<string, BitsAchievementDef>(ACHIEVEMENT_DEFS.map((d) => [d.id, d]));

/** A deed id → its wearable display string, or null when the id is unknown
 * (a newer server's content) or the deed crowns no title. The one resolver
 * every render site uses — free-text spoofing dies here. */
export const resolveTitleText = (deedId: string | null | undefined): string | null => {
  if (!deedId) return null;
  const def = DEFS_BY_ID.get(deedId);
  return def?.rewards?.some((r) => r.kind === "title") ? def.title : null;
};

/** The title worn right now ("" = bare). Module state, not React: read on
 * every create/join/queue send (connection.ts), like getActiveAnnouncer. */
let wornTitle = "";

export const getWornTitle = (): string => wornTitle;

/** Set + persist ("" = go bare). Takes effect on the NEXT room — a worn
 * title is claimed at seat time, mid-room it never changes. */
export const setWornTitle = (deedId: string): void => {
  wornTitle = resolveTitleText(deedId) !== null ? deedId : "";
  void AsyncStorage.setItem(KEY_WORN_TITLE, wornTitle);
};

/** Boot load (App.tsx) — validated through the resolver so a deed retired
 * by an app update falls back to bare instead of a dangling claim. */
export const loadWornTitle = async (): Promise<void> => {
  const raw = await AsyncStorage.getItem(KEY_WORN_TITLE);
  wornTitle = raw !== null && resolveTitleText(raw) !== null ? raw : "";
};
