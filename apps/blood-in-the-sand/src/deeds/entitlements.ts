/**
 * The device's earned-entitlement cache (bits-secret-items.md) — what the
 * arming wizard reads to decide which gated items EXIST for this player.
 * Module state + AsyncStorage, the worn-title pattern: loaded at boot,
 * refreshed from two directions —
 *  - authoritatively, whenever /achievements/me is fetched (DeedsScreen);
 *  - instantly, when a `deedUnlocks` push lands mid-session: the unlocked
 *    deeds' reward entitlements are derived LOCALLY from the defs, so the
 *    trident is pickable in the very next lobby, no round-trip.
 * The server independently validates ranked picks — a stale or tampered
 * cache costs nothing worse than a hidden wizard card or an ignored pick.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ACHIEVEMENT_DEFS } from "@heroic/blood-in-the-sand-sim";

const KEY_ENTITLEMENTS = "bits.entitlements";

let entitlements = new Set<string>();

export const getEntitlements = (): ReadonlySet<string> => entitlements;

const persist = (): void => {
  void AsyncStorage.setItem(KEY_ENTITLEMENTS, JSON.stringify([...entitlements]));
};

/** Boot load (App.tsx) — the wizard works offline-after-first-fetch. */
export const loadEntitlements = async (): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(KEY_ENTITLEMENTS);
    if (raw !== null) entitlements = new Set(JSON.parse(raw) as string[]);
  } catch {
    // a corrupt cache heals on the next authoritative refresh
  }
};

/** The authoritative set from /achievements/me — REPLACES the cache (it can
 * shrink after a dev DB reset; the cache must follow). */
export const setEntitlements = (itemIds: readonly string[]): void => {
  entitlements = new Set(itemIds);
  persist();
};

/** A store unlock succeeded (bits-store.md): fold the bought item in
 * instantly so the War Table shows it in the very next lobby — the server
 * already holds the authoritative row this mirrors. */
export const grantEntitlement = (itemId: string): void => {
  if (entitlements.has(itemId)) return;
  entitlements.add(itemId);
  persist();
};

/** A `deedUnlocks` push landed: fold in what those deeds pay, from our own
 * defs — ids this bundle doesn't know are skipped (the next authoritative
 * refresh picks them up). */
export const grantFromDeedUnlocks = (deedIds: readonly string[]): void => {
  let changed = false;
  for (const id of deedIds) {
    const def = ACHIEVEMENT_DEFS.find((d) => d.id === id);
    for (const r of def?.rewards ?? []) {
      if (r.kind === "entitlement" && !entitlements.has(r.itemId)) {
        entitlements.add(r.itemId);
        changed = true;
      }
      if (r.kind === "title" && !entitlements.has(`title:${id}`)) {
        entitlements.add(`title:${id}`);
        changed = true;
      }
    }
  }
  if (changed) persist();
};
