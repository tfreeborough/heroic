export const n = (v: number): string => v.toLocaleString("en-GB");

export const pct = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined ? "–" : `${(v * 100).toFixed(digits)}%`;

export const ms = (v: number | null): string => (v === null ? "–" : `${v} ms`);

export const secs = (v: number | null): string => {
  if (v === null) return "–";
  const m = Math.floor(v / 60);
  const s = v % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
};

/** "3h ago" / "2d ago" from unix seconds. */
export const ago = (unixS: number, nowS = Math.floor(Date.now() / 1000)): string => {
  const d = Math.max(0, nowS - unixS);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86_400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86_400)}d ago`;
};

export const when = (unixS: number): string =>
  new Date(unixS * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });

export const date = (unixS: number): string =>
  new Date(unixS * 1000).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/London" });

/** Short id: first 8 chars of a uuid. */
export const short = (id: string): string => (id.length > 12 ? id.slice(0, 8) : id);
