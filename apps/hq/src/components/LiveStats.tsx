"use client";

/**
 * The live picture, refreshed every 30 s while the tab is visible. The
 * server render supplies the first value so the page never flashes empty;
 * polling pauses when the tab is hidden and resumes with an immediate
 * fetch on return.
 */
import { useEffect, useState } from "react";
import type { LiveResult } from "@/lib/live";
import { Stat, Tiles } from "./Stat";

const INTERVAL_MS = 30_000;

export function LiveStats({ initial, variant }: { initial: LiveResult; variant: "tiles" | "pill" }) {
  const [live, setLive] = useState<LiveResult>(initial);
  const [at, setAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as LiveResult;
        if (!stopped) {
          setLive(next);
          setAt(Date.now());
        }
      } catch {
        // keep the last good value — the next tick tries again
      }
    };
    const start = () => {
      if (timer) return;
      void fetchOnce();
      timer = setInterval(fetchOnce, INTERVAL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) timer = setInterval(fetchOnce, INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // A 1 s clock so "updated Ns ago" moves.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  void tick;
  const agoS = at === null ? null : Math.max(0, Math.floor((Date.now() - at) / 1000));
  const stamp = agoS === null ? "from page load" : `updated ${agoS}s ago`;

  if (variant === "pill") {
    if (live.state === "ok") {
      return (
        <span className="pill ok" title={stamp}>
          live · {live.stats.seatedHumans} in rooms · {live.stats.connections} connected
        </span>
      );
    }
    if (live.state === "offline") return <span className="pill bad">server offline</span>;
    return <span className="pill">live stats not configured</span>;
  }

  if (live.state === "ok") {
    const s = live.stats;
    return (
      <>
        <Tiles>
          <Stat label="Connected" value={s.connections} detail="open sockets" />
          <Stat label="In rooms" value={s.seatedHumans} detail="humans seated" />
          <Stat label="Rooms" value={s.rooms} detail={`${s.roomsInMatch} mid-match · ${s.rankedRooms} ranked`} />
          {Object.entries(s.queue).map(([bracket, size]) => (
            <Stat key={bracket} label={`Queue ${bracket}`} value={size} detail="waiting" />
          ))}
          <Stat label="Pending" value={s.pendingMatches} detail="matches awaiting accept" />
        </Tiles>
        <p className="hint">Refreshes every 30 s while this tab is open · {stamp}</p>
      </>
    );
  }
  if (live.state === "offline") {
    return (
      <p className="hint">
        Game server unreachable: {live.reason}. (BITS_SERVER_URL is set, so this is worth a look.) Retrying every 30 s · {stamp}
      </p>
    );
  }
  return <p className="hint">Set BITS_SERVER_URL and BITS_STATS_TOKEN (matching the server's STATS_TOKEN) to see who's online.</p>;
}
