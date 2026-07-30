/**
 * The app's ONE server connection, made survivable. ArenaClient stays a
 * one-shot socket (it dies with its WebSocket); this manager owns the
 * lifecycle around it — dial, watch, redial — so a socket death stops being
 * a dead end the player has to notice and fix. Phones kill idle sockets
 * constantly (sleep, background, wifi↔cellular handoff), so before this
 * layer the "connection lost" page mostly showed STALE deaths: nothing was
 * wrong by the time the player read it.
 *
 * Policy (the seat-preserving rejoin is future work — docs/design/bits-reconnect.md):
 *   • QUIET first: the first few failures redial on a short backoff while
 *     the UI shows plain "connecting…" — a blip never becomes an error page.
 *   • VISIBLE after that: the connect screen flips to "can't reach the
 *     arena", but the redial loop keeps running with its countdown shown;
 *     RETRY NOW only accelerates it.
 *   • Foregrounding and re-entering PLAY/RANKED (wake) redial immediately,
 *     turning the stale-death case into an invisible sub-second reconnect.
 *   • A death that cost a SEAT (or a queue spot) can't be resumed yet — the
 *     next open client carries a one-shot lastError so the room list /
 *     ranked home say why the player is back at the gates.
 *   • "rejected" (protocol mismatch) never redials — that's the update flow.
 */
import { useEffect, useReducer, useRef } from "react";
import { AppState } from "react-native";
import { ArenaClient, resolveServerUrl } from "./connection";

export type ConnectState =
  | "connecting" //   quiet dial — reads as a splash, never an error
  | "waking" //       still quiet, but slow enough to earn a "taking longer than usual" hint
  | "online"
  | "down" //         quiet attempts exhausted — visible failure, countdown redial
  | "mismatch" //     protocol reject → the update flow owns the screen
  | "unconfigured"; // no EXPO_PUBLIC_DEFAULT_SERVER (dev-only)

/** Attempts 1..N redial quietly; every failure after that is visible. */
const QUIET_DELAYS_MS = [1000, 3000, 6000];
/** …but the quiet phase is also wall-clock capped: hung dials (8s each)
 * would otherwise keep the splash up for ~30s before admitting trouble. */
const QUIET_MAX_MS = 15000;
/** Visible-failure redial cadence (the last entry repeats forever). */
const VISIBLE_DELAYS_MS = [8000, 12000, 15000];
/** RN's WebSocket has no dial timeout of its own — a hung CONNECTING (e.g. a
 * LAN address that blackholes the SYN) must fail into the redial loop, not
 * spin forever. The server is always-on, so an answer normally comes fast;
 * kept above a slow-cellular TLS handshake but low enough that the quiet
 * phase can't crawl for a minute on back-to-back hung dials. */
const DIAL_TIMEOUT_MS = 8000;
/** A quiet dial still unanswered after this long gets the "taking longer
 * than usual" hint. (The Render service is always-on — a slow dial means a
 * bad network path, never a cold start.) */
const WAKING_AFTER_MS = 5000;
/** Android's own connectivity-check endpoint — a tiny 204 that is effectively
 * always up. If THIS fails the device is offline; if it answers while the
 * arena doesn't, the trouble is on our end. (The NetInfo native module can't
 * ship over OTA, so a plain fetch probe stands in.) */
const PROBE_URL = "https://clients3.google.com/generate_204";
const PROBE_TIMEOUT_MS = 4000;

export class ConnectionManager {
  /** The live client — null while between sockets (redial pending/underway). */
  client: ArenaClient | null = null;
  state: ConnectState;
  /** Seconds until the next automatic redial (visible failures only); null
   * while a dial is actually in flight — the UI shows "retrying…". */
  retryIn: number | null = null;
  /** Reachability verdict while "down": true = the device has no internet,
   * false = internet is fine so the arena is at fault, null = still probing. */
  offline: boolean | null = null;
  /** Re-render hook — also fired through from every client.onChange. */
  onChange: (() => void) | null = null;

  /** Set once by dispose() — a disposed manager is inert forever, and the
   * hook builds a fresh one (Fast Refresh remounts App: the ref survives,
   * the manager must not). */
  disposed = false;

  private readonly url: string | null;
  private attempts = 0;
  private suspended = false; // backgrounded — no dialing until wake()
  private dropped = false; //   a death cost a seat/queue spot → notice on next open
  private probing = false;
  private nextDialAt = 0;
  private quietSince = 0; // first failure of the current quiet phase
  private redialTimer: ReturnType<typeof setTimeout> | null = null;
  private dialTimer: ReturnType<typeof setTimeout> | null = null;
  private wakingTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(serverInput: string | null) {
    this.url = serverInput ? resolveServerUrl(serverInput) : null;
    this.state = this.url ? "connecting" : "unconfigured";
  }

  start = (): void => {
    if (this.url !== null && this.client === null) this.dial();
  };

  /** Redial NOW — foregrounding, PLAY/RANKED entry, and the RETRY button.
   * From "down" the visible screen stays put while the dial runs (no flicker
   * back to "connecting"); success flips straight to online either way. */
  wake = (): void => {
    this.suspended = false;
    if (this.disposed || this.state === "mismatch" || this.state === "unconfigured") return;
    if (this.client !== null) return; // open, or a dial already in flight
    this.clearRedial();
    if (this.state !== "down") {
      this.attempts = 0;
      this.setState("connecting");
    }
    this.dial();
  };

  /** Backgrounded: stop dialing (the OS is about to kill sockets and throttle
   * timers anyway); wake() redials the moment we're back. */
  sleep = (): void => {
    this.suspended = true;
    this.clearRedial();
  };

  dispose = (): void => {
    this.disposed = true;
    this.clearAllTimers();
    this.client?.close();
    this.client = null;
  };

  private dial(): void {
    if (this.disposed || this.suspended || this.url === null) return;
    this.clearRedial();
    this.retryIn = null;
    let c: ArenaClient;
    try {
      c = new ArenaClient(this.url);
    } catch {
      this.scheduleRedial();
      return;
    }
    this.client = c;
    c.onChange = () => {
      this.watch(c);
      this.onChange?.();
    };
    this.dialTimer = setTimeout(() => {
      if (this.client === c && c.status === "connecting") this.onDead(c);
    }, DIAL_TIMEOUT_MS);
    if (this.state === "connecting") {
      this.wakingTimer = setTimeout(() => {
        if (this.state === "connecting") this.setState("waking");
      }, WAKING_AFTER_MS);
    }
    this.onChange?.();
  }

  private watch(c: ArenaClient): void {
    if (c !== this.client) return; // a zombie socket's parting callback
    if (c.status === "open") {
      if (this.state !== "online") {
        this.clearAllTimers();
        this.attempts = 0;
        this.retryIn = null;
        this.offline = null;
        if (this.dropped) {
          this.dropped = false;
          // The lost seat can't be resumed yet (bits-reconnect.md) — at least
          // say why the player is back at the gates. RoomListScreen and
          // RankedScreen both render lastError.
          c.lastError = "connection to the arena was lost";
        }
        this.setState("online");
      }
    } else if (c.status === "rejected") {
      this.clearAllTimers();
      this.client = null;
      c.close();
      this.setState("mismatch");
    } else if (c.status === "closed") {
      this.onDead(c);
    }
  }

  private onDead(c: ArenaClient): void {
    if (c !== this.client) return;
    // Remember what the death cost before the client goes — the notice rides
    // the NEXT successful connection.
    this.dropped ||= c.welcome !== null || c.queued;
    this.client = null;
    c.close();
    this.clearDialTimers();
    this.scheduleRedial();
  }

  private scheduleRedial(): void {
    if (this.disposed) return;
    if (this.suspended) {
      // No dialing in the background — reset to the quiet path so the
      // foreground wake() reads as a plain "connecting…".
      this.attempts = 0;
      this.setState("connecting");
      return;
    }
    // A death from "online" re-enters the quiet path — the UI shows a plain
    // "connecting…" during the redial, never a flash of the failure panel.
    if (this.state === "online") this.setState("connecting");
    if (this.attempts === 0) this.quietSince = Date.now();
    const quiet =
      this.attempts < QUIET_DELAYS_MS.length && Date.now() - this.quietSince < QUIET_MAX_MS;
    const table = quiet ? QUIET_DELAYS_MS : VISIBLE_DELAYS_MS;
    // Clamp both ways: the wall-clock cap can flip visible while attempts is
    // still small, which would otherwise index the table negatively.
    const i = Math.max(0, Math.min(quiet ? this.attempts : this.attempts - QUIET_DELAYS_MS.length, table.length - 1));
    // Jitter, so a server restart doesn't get every client redialing in lockstep.
    const delay = table[i]! * (0.85 + Math.random() * 0.3);
    this.attempts++;
    this.nextDialAt = Date.now() + delay;
    this.redialTimer = setTimeout(() => this.dial(), delay);
    if (!quiet) {
      this.retryIn = Math.ceil(delay / 1000);
      this.probe();
      this.startTick();
      this.setState("down");
    }
    this.onChange?.();
  }

  /** The 1s-ish countdown the "down" screen renders — kept coarse on purpose. */
  private startTick(): void {
    this.tickTimer ??= setInterval(() => {
      if (this.state !== "down") return;
      const left =
        this.redialTimer === null ? null : Math.max(0, Math.ceil((this.nextDialAt - Date.now()) / 1000));
      if (left !== this.retryIn) {
        this.retryIn = left;
        this.onChange?.();
      }
    }, 250);
  }

  private probe(): void {
    if (this.probing) return;
    this.probing = true;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    fetch(PROBE_URL, { signal: ctrl.signal })
      .then(() => true)
      .catch(() => false)
      .then((reachable) => {
        clearTimeout(timeout);
        this.probing = false;
        if (this.disposed || this.state !== "down") return;
        const offline = !reachable;
        if (offline !== this.offline) {
          this.offline = offline;
          this.onChange?.();
        }
      });
  }

  private setState(s: ConnectState): void {
    if (this.state !== s) {
      this.state = s;
      this.onChange?.();
    }
  }

  private clearRedial(): void {
    if (this.redialTimer !== null) {
      clearTimeout(this.redialTimer);
      this.redialTimer = null;
    }
  }

  private clearDialTimers(): void {
    if (this.dialTimer !== null) {
      clearTimeout(this.dialTimer);
      this.dialTimer = null;
    }
    if (this.wakingTimer !== null) {
      clearTimeout(this.wakingTimer);
      this.wakingTimer = null;
    }
  }

  private clearAllTimers(): void {
    this.clearRedial();
    this.clearDialTimers();
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
}

/** One manager for the app's life: dials on mount, redials on foreground,
 * re-renders the caller on every connection/client change. */
export const useArenaConnection = (serverInput: string | null): ConnectionManager => {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const ref = useRef<ConnectionManager | null>(null);
  // Recreate after dispose, not just on first render: the ref outlives a
  // Fast Refresh remount, but the unmount cleanup disposed its manager —
  // reviving the corpse would leave the app stuck on "connecting" forever.
  if (ref.current === null || ref.current.disposed) ref.current = new ConnectionManager(serverInput);
  const mgr = ref.current;
  useEffect(() => {
    mgr.onChange = force;
    mgr.start();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") mgr.wake();
      else mgr.sleep();
    });
    return () => {
      sub.remove();
      mgr.onChange = null;
      mgr.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);
  return mgr;
};
