"use client";

/**
 * A stacked bar chart as inline SVG — no chart library. `rows` are the
 * x-axis in order (one bar each); `series` names the stacked keys with a
 * colour. Hover anywhere over a day for its numbers (a highlighted column
 * and a tooltip — Tom, 2026-10-22). Scales to the container's width.
 */
import { useState } from "react";

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

export interface BarRow {
  /** The axis label (short). */
  label: string;
  /** The tooltip heading; falls back to `label`. */
  title?: string;
  values: Record<string, number>;
}

/** Client component: the unit is a name, never a function from the server. */
export type BarUnit = "number" | "usd";
const FORMAT: Record<BarUnit, (v: number) => string> = {
  number: (v) => v.toLocaleString("en-GB"),
  usd: (v) => `$${v.toFixed(2)}`,
};

export function Bars({
  rows,
  series,
  height = 140,
  unit = "number",
}: {
  rows: BarRow[];
  series: BarSeries[];
  height?: number;
  unit?: BarUnit;
}) {
  const format = FORMAT[unit];
  const [hover, setHover] = useState<number | null>(null);
  const totals = rows.map((r) => series.reduce((s, k) => s + (r.values[k.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const w = 100;
  const gap = 0.15;
  const slot = rows.length === 0 ? w : w / rows.length;
  const bw = slot * (1 - gap);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (rows.length === 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - box.left) / Math.max(1, box.width);
    setHover(Math.min(rows.length - 1, Math.max(0, Math.floor(frac * rows.length))));
  };
  const h = hover === null ? null : rows[hover] ?? null;
  const left = hover === null ? 0 : ((hover + 0.5) / rows.length) * 100;
  const side = left < 18 ? "start" : left > 82 ? "end" : "mid";
  return (
    <div className="chart">
      <div className="chartbox">
        <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {hover !== null ? <rect x={hover * slot} y={0} width={slot} height={height} fill="var(--text)" opacity={0.07} /> : null}
          {rows.map((r, i) => {
            let y = height;
            const x = i * slot + (slot - bw) / 2;
            return (
              <g key={`${r.label}:${i}`} opacity={hover === null || hover === i ? 1 : 0.75}>
                {series.map((k) => {
                  const v = r.values[k.key] ?? 0;
                  const bh = (v / max) * (height - 4);
                  y -= bh;
                  return v > 0 ? <rect key={k.key} x={x} y={y} width={bw} height={bh} fill={k.color} /> : null;
                })}
              </g>
            );
          })}
        </svg>
        {h !== null && hover !== null ? (
          <div className={`tip ${side}`} style={{ left: `${left}%` }}>
            <div className="tip-title">{h.title ?? h.label}</div>
            {series.map((k) => (
              <div key={k.key} className="tip-row">
                <i className="dot" style={{ background: k.color }} />
                <span>{k.label}</span>
                <b className="num">{format(h.values[k.key] ?? 0)}</b>
              </div>
            ))}
            {series.length > 1 ? (
              <div className="tip-row total">
                <i className="dot" style={{ background: "transparent" }} />
                <span>total</span>
                <b className="num">{format(totals[hover] ?? 0)}</b>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="axis">
        <span>{rows[0]?.title ?? rows[0]?.label ?? ""}</span>
        <span className="num">peak {format(max)}</span>
        <span>{rows[rows.length - 1]?.title ?? rows[rows.length - 1]?.label ?? ""}</span>
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
