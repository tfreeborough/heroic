/**
 * The business-logic API client (glory-economy.md) — identity + Glory wallet.
 * This talks to blood-in-the-sand-api (HTTP), NOT the game server (WS): the
 * two are separate services on purpose, so economy screens never depend on
 * the arena being up and vice versa.
 *
 * Identity is anonymous-first, forever: on first launch we silently register
 * and keep the minted playerId + bearer token in the device keychain
 * (SecureStore — survives reinstall on iOS; device-bound on Android until
 * Clerk linking exists). The token is the only credential; losing it is
 * losing the wallet, which is exactly what account linking will insure.
 */
import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

/**
 * Same conventions as the game server's EXPO_PUBLIC_DEFAULT_SERVER — unset
 * means "no API configured" and every call quietly no-ops (the title screen
 * just doesn't show a wallet), and a scheme-less value is normalised the way
 * resolveServerUrl does it: LAN hosts (IPs, localhost, *.local) get plain
 * `http://`, anything else is a TLS-terminated proxy → `https://` on 443.
 */
const resolveApiUrl = (input: string): string => {
  const t = input.trim().replace(/\/+$/, "");
  if (!t || t.includes("://")) return t;
  const [host = ""] = t.split(":");
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isLocal = isIp || host === "localhost" || host.endsWith(".local");
  return `${isLocal ? "http" : "https"}://${t}`;
};

export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL ?? "");

const KEY_PLAYER_ID = "bits.playerId";
const KEY_TOKEN = "bits.playerToken";

export interface Identity {
  playerId: string;
  token: string;
}

/** Never let a dead API hang a screen — every call gets a hard deadline. */
const FETCH_TIMEOUT_MS = 8000;

const apiFetch = async (path: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Reachability probe for the mode-select gate (bits-mode-select.md) — GET /
 * is the API's health check (Render pings the same route). This is the ONE
 * place API reachability is surfaced to the player; every other call in this
 * file keeps degrading silently.
 */
export const probeApi = async (): Promise<boolean> => {
  if (!API_URL) return false;
  try {
    return (await apiFetch("/")).ok;
  } catch {
    return false;
  }
};

/**
 * The stored identity, registering silently if this device has none yet.
 * Null when the API is unconfigured or unreachable AND nothing is stored —
 * callers treat that as "wallet features off", never as an error the player
 * sees. A stored identity is returned even while offline.
 */
export const ensureIdentity = async (): Promise<Identity | null> => {
  const [playerId, token] = await Promise.all([
    SecureStore.getItemAsync(KEY_PLAYER_ID),
    SecureStore.getItemAsync(KEY_TOKEN),
  ]);
  if (playerId && token) return { playerId, token };
  if (!API_URL) return null;
  try {
    const res = await apiFetch("/register", { method: "POST" });
    if (!res.ok) return null;
    const minted = (await res.json()) as Identity;
    if (typeof minted.playerId !== "string" || typeof minted.token !== "string") return null;
    await Promise.all([
      SecureStore.setItemAsync(KEY_PLAYER_ID, minted.playerId),
      SecureStore.setItemAsync(KEY_TOKEN, minted.token),
    ]);
    return minted;
  } catch {
    return null; // offline first launch — we'll register on a later launch
  }
};

/** The server-authoritative Glory balance; null = unavailable right now. */
export const fetchGlory = async (identity: Identity): Promise<number | null> => {
  if (!API_URL) return null;
  try {
    const res = await apiFetch("/wallet", {
      headers: { authorization: `Bearer ${identity.token}` },
    });
    if (!res.ok) return null;
    const wallet = (await res.json()) as { glory?: unknown };
    return typeof wallet.glory === "number" ? wallet.glory : null;
  } catch {
    return null;
  }
};

/**
 * The title screen's wallet: registers if needed, then loads the balance.
 * Stays null (render nothing) until a real number arrives — the scene
 * shouldn't show an error state for a feature the player never asked for.
 */
export const useGlory = (): number | null => {
  const [glory, setGlory] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const identity = await ensureIdentity();
      if (!identity || !live) return;
      const balance = await fetchGlory(identity);
      if (live && balance !== null) setGlory(balance);
    })();
    return () => {
      live = false;
    };
  }, []);
  return glory;
};
