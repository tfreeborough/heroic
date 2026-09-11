/**
 * The game server's live read (hq.md § M2): GET /stats with STATS_TOKEN.
 * Never cached, never fatal — an unreachable server renders as "offline".
 *
 * Env: BITS_SERVER_URL (https://…onrender.com), BITS_STATS_TOKEN.
 */
export interface LiveStats {
  ok: true;
  protocol: number;
  connections: number;
  rooms: number;
  roomsInMatch: number;
  rankedRooms: number;
  seatedHumans: number;
  queue: Record<string, number>;
  pendingMatches: number;
}

export type LiveResult = { state: "ok"; stats: LiveStats } | { state: "unconfigured" } | { state: "offline"; reason: string };

export const liveStats = async (): Promise<LiveResult> => {
  const base = process.env.BITS_SERVER_URL?.replace(/\/$/, "");
  const token = process.env.BITS_STATS_TOKEN;
  if (!base || !token) return { state: "unconfigured" };
  try {
    const res = await fetch(`${base}/stats`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { state: "offline", reason: `HTTP ${res.status}` };
    return { state: "ok", stats: (await res.json()) as LiveStats };
  } catch (err) {
    return { state: "offline", reason: (err as Error).message };
  }
};
