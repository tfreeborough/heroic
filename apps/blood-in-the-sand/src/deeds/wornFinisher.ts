/**
 * The worn kill finisher (bits-cosmetics.md § Finishers v1) — which owned
 * finisher plays over this player's kills. Device-local, the worn-title
 * pattern (`wornTitle.ts`): module state read on the join path, AsyncStorage
 * for persistence, applied on launch by App.tsx. The server only ever sees
 * a per-room CLAIM and is default-deny about it — a seat starts bare and the
 * finisher is granted only after an ownership read, in ranked AND skirmish —
 * so a stale or tampered local value costs nothing worse than killing bare.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  FINISHER_NONE,
  grantedFinisher,
  ownableFinisher,
  type FinisherId,
} from "@heroic/blood-in-the-sand-sim";
import { getEntitlements } from "./entitlements";

const KEY_WORN_FINISHER = "bits.finisher";

/** The finisher worn right now ("none" = bare). Module state, not React:
 * read on every create/join/queue send (connection.ts), like getWornTitle. */
let wornFinisher: FinisherId = FINISHER_NONE;

export const getWornFinisher = (): FinisherId => wornFinisher;

/** What plays where no server stands behind the claim (practice): the worn
 * finisher only if the local entitlement cache says it's owned — finishers
 * are never free to try (Tom, 2026-09-19). Offline and seen by nobody else,
 * so the client-side check is enough. */
export const getOwnedWornFinisher = (): FinisherId => grantedFinisher(wornFinisher, getEntitlements());

/** Set + persist ("none" = go bare). Takes effect on the NEXT room — a
 * finisher is claimed at seat time, mid-room it never changes. */
export const setWornFinisher = (id: FinisherId): void => {
  wornFinisher = ownableFinisher(id) ?? FINISHER_NONE;
  void AsyncStorage.setItem(KEY_WORN_FINISHER, wornFinisher);
};

/** Boot load (App.tsx) — validated so a finisher retired by an app update
 * falls back to bare instead of a dangling claim. */
export const loadWornFinisher = async (): Promise<void> => {
  const raw = await AsyncStorage.getItem(KEY_WORN_FINISHER);
  wornFinisher = ownableFinisher(raw) ?? FINISHER_NONE;
};
