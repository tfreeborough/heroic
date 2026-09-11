/**
 * A stacked bar chart as inline SVG — no chart library. `rows` are the
 * x-axis in order (one bar each); `series` names the stacked keys with a
 * colour. Hover a bar for its numbers. Scales to the container's width.
 */
export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

export function Bars({
  rows,
  series,
  height = 140,
}: {
  rows: { label: string; values: Record<string, number> }[];
  series: BarSeries[];
  height?: number;
}) {
  const totals = rows.map((r) => series.reduce((s, k) => s + (r.values[k.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const w = 100;
  const gap = 0.15;
  const slot = rows.length === 0 ? w : w / rows.length;
  const bw = slot * (1 - gap);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img">
        {rows.map((r, i) => {
          let y = height;
          const x = i * slot + (slot - bw) / 2;
          const title = `${r.label}: ${series.map((k) => `${k.label} ${r.values[k.key] ?? 0}`).join(" · ")}`;
          return (
            <g key={r.label}>
              <title>{title}</title>
              <rect x={x} y={0} width={bw} height={height} fill="transparent" />
              {series.map((k) => {
                const v = r.values[k.key] ?? 0;
                const h = (v / max) * (height - 4);
                y -= h;
                return v > 0 ? <rect key={k.key} x={x} y={y} width={bw} height={h} fill={k.color} /> : null;
              })}
            </g>
          );
        })}
      </svg>
      <div className="axis">
        <span>{rows[0]?.label ?? ""}</span>
        <span className="num">peak {max.toLocaleString("en-GB")}</span>
        <span>{rows[rows.length - 1]?.label ?? ""}</span>
      </div>
      {series.length > 1 ? (
        <div className="legend">
          {series.map((k) => (
            <span key={k.key}>
              <i className="dot" style={{ background: k.color }} />
              {k.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
