/**
 * The client's side of the wire: one WebSocket, typed send/receive, and the
 * SnapshotBuffer the renderer samples. No React in here — screens hold an
 * ArenaClient instance and subscribe via the two callbacks.
 */
import {
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  SnapshotBuffer,
  TICK_RATE,
  type ArenaClientConfig,
  type ArenaEvent,
  type ClientMsg,
  type LobbyPlayer,
  type ServerMsg,
  type Team,
} from "@heroic/blood-in-the-sand-sim";

export type ConnectionStatus = "connecting" | "open" | "closed" | "rejected";

/**
 * Baked in at build time (Expo inlines EXPO_PUBLIC_*). Set it in apps/
 * blood-in-the-sand/.env to the Render hostname so the join screen pre-fills
 * and nobody types an address on game night.
 */
export const DEFAULT_SERVER = process.env.EXPO_PUBLIC_DEFAULT_SERVER ?? "";

/**
 * What the address field accepts, resolved to a WebSocket URL:
 * - `192.168.1.23` / `192.168.1.23:7777` / `localhost` / `toms-mac.local`
 *   → plain `ws://` on the game port (LAN dev server, no TLS)
 * - `blood-in-the-sand.onrender.com` → `wss://` on 443 (the PaaS proxy
 *   terminates TLS and forwards to the server's PORT)
 * - a full pasted URL (`https://…` / `wss://…`) → honored, http(s) mapped to ws(s)
 */
export const resolveServerUrl = (input: string): string => {
  const t = input.trim().replace(/\/+$/, "");
  if (t.includes("://")) return t.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const [host = "", portStr] = t.split(":");
  const port = portStr ? Number(portStr) : undefined;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isLocal = isIp || host === "localhost" || host.endsWith(".local");
  if (isLocal) return `ws://${host}:${port ?? DEFAULT_PORT}`;
  return port ? `wss://${host}:${port}` : `wss://${host}`;
};

export interface WelcomeInfo {
  playerId: number;
  team: Team;
  zoneId: string;
  config: ArenaClientConfig;
}

export class ArenaClient {
  /** Interpolation source — the renderer samples this every frame. */
  readonly buffer = new SnapshotBuffer(TICK_RATE);
  welcome: WelcomeInfo | null = null;
  lobby: LobbyPlayer[] = [];
  status: ConnectionStatus = "connecting";
  rejectReason: string | null = null;

  /** Fired when status / welcome / lobby change (drive React re-renders). */
  onChange: (() => void) | null = null;
  /** Fired with each snapshot's freshly-drained events (drive FX/audio). */
  onEvents: ((events: ArenaEvent[]) => void) | null = null;

  private readonly ws: WebSocket;
  private seq = 0;

  constructor(url: string, name: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.status = "open";
      this.send({ t: "hello", v: PROTOCOL_VERSION, name });
      this.onChange?.();
    };
    this.ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      this.handle(msg);
    };
    this.ws.onclose = () => {
      if (this.status !== "rejected") this.status = "closed";
      this.onChange?.();
    };
    // onclose follows onerror; no separate handling needed for M1.
    this.ws.onerror = () => {};
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case "welcome":
        this.welcome = { playerId: msg.playerId, team: msg.team, zoneId: msg.zoneId, config: msg.config };
        this.onChange?.();
        return;
      case "lobby":
        this.lobby = msg.players;
        this.onChange?.();
        return;
      case "snapshot": {
        const events = this.buffer.push(msg, performance.now());
        if (events.length > 0) this.onEvents?.(events);
        return;
      }
      case "reject":
        this.status = "rejected";
        this.rejectReason = msg.reason;
        this.onChange?.();
        this.ws.close();
    }
  }

  sendInput(sx: number, sy: number, dash: boolean): void {
    this.send({ t: "input", seq: this.seq++, sx, sy, dash });
  }

  private send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.onChange = null;
    this.onEvents = null;
    this.ws.close();
  }
}
