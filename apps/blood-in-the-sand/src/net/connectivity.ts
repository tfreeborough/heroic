/**
 * API reachability for the mode select (bits-mode-select.md). Ranked and
 * Casual need BOTH services up: the game server's state already lives on
 * ArenaClient (App.tsx maps it into a prop), so this hook only owns the HTTP
 * side — a probe of the API's `GET /` health check.
 *
 * A fresh "ok" is trusted for CACHE_MS so hopping home ↔ mode select doesn't
 * re-fire a request per visit; "down" is never cached — RETRY always probes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { probeApi } from "./api";

export type ApiHealth = "checking" | "ok" | "down";

const CACHE_MS = 30_000;
let lastOkAt = 0;

export const useApiHealth = (): { api: ApiHealth; recheckApi: () => void } => {
  const [api, setApi] = useState<ApiHealth>("checking");
  // Probes race when RETRY is mashed — only the newest one may report.
  const seq = useRef(0);

  const recheckApi = useCallback(() => {
    if (Date.now() - lastOkAt < CACHE_MS) {
      setApi("ok");
      return;
    }
    const mine = ++seq.current;
    setApi("checking");
    void probeApi().then((ok) => {
      if (mine !== seq.current) return;
      if (ok) lastOkAt = Date.now();
      setApi(ok ? "ok" : "down");
    });
  }, []);

  useEffect(() => {
    recheckApi();
    // Late probes must not set state on an unmounted screen.
    return () => {
      seq.current++;
    };
  }, [recheckApi]);

  return { api, recheckApi };
};
