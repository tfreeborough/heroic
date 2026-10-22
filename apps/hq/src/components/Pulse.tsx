import { Sparkline } from "./Sparkline";

/**
 * A number with where it's been: the value, a sparkline over the series,
 * and the change against the previous window (hq-v2.md § Stage 3). Colour
 * only on the delta, and only when it's outside noise.
 */
export function Pulse({
  label,
  value,
  series,
  labels,
  previous,
  detail,
  color = "var(--accent)",
  format = (v: number) => v.toLocaleString("en-GB"),
}: {
  label: string;
  value: number;
  /** Oldest → newest; the sparkline. */
  series: number[];
  /** One per series point (the day), for the hover. */
  labels?: string[];
  /** The comparable figure from the window before `value` — null hides the delta. */
  previous: number | null;
  detail?: string;
  color?: string;
  format?: (v: number) => string;
}) {
  let delta: { text: string; cls: string } | null = null;
  if (previous !== null) {
    const diff = value - previous;
    const noise = Math.max(1, Math.abs(previous) * 0.1);
    const cls = Math.abs(diff) <= noise ? "flat" : diff > 0 ? "up" : "down";
    const pctText = previous === 0 ? (diff === 0 ? "no change" : "new") : `${diff > 0 ? "+" : ""}${Math.round((diff / previous) * 100)}%`;
    delta = { text: `${diff > 0 ? "+" : ""}${format(diff)} · ${pctText}`, cls };
  }
  return (
    <div className="tile pulse">
      <div className="k">{label}</div>
      <div className="v num">{format(value)}</div>
      <Sparkline values={series} labels={labels} tips={series.map(format)} color={color} />
      {delta ? <div className={`delta ${delta.cls}`}>{delta.text}</div> : null}
      {detail ? <div className="d">{detail}</div> : null}
    </div>
  );
}
