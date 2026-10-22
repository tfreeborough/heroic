"use client";

/** A tiny line over the last N values — no axes, no library. Hover for
 * the day and its value when `labels` are given. A client component, so
 * everything it takes is plain data: the formatted values arrive as
 * `tips`, never as a formatter. */
import { useState } from "react";

export function Sparkline({
  values,
  labels,
  tips,
  color = "var(--accent)",
  height = 28,
}: {
  values: number[];
  labels?: string[];
  /** One per value, already formatted; falls back to the plain number. */
  tips?: string[];
  color?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 100;
  const max = Math.max(1, ...values);
  const n = values.length;
  if (n === 0) return null;
  const xAt = (i: number) => (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const yAt = (v: number) => height - 2 - (v / max) * (height - 4);
  const pts = values.map((v, i) => `${xAt(i)},${yAt(v)}`);
  const area = `0,${height} ${pts.join(" ")} ${w},${height}`;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - box.left) / Math.max(1, box.width);
    setHover(Math.min(n - 1, Math.max(0, Math.round(frac * (n - 1)))));
  };
  const left = hover === null ? 0 : (xAt(hover) / w) * 100;
  const side = left < 25 ? "start" : left > 75 ? "end" : "mid";
  return (
    <div className="sparkbox">
      <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label={values.join(", ")} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <polygon points={area} fill={color} opacity={0.12} />
        <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {hover !== null ? (
          <>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={0} y2={height} stroke="var(--muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.6} />
            <circle cx={xAt(hover)} cy={yAt(values[hover]!)} r={2.5} fill={color} vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
      </svg>
      {hover !== null ? (
        <div className={`tip small ${side}`} style={{ left: `${left}%` }}>
          <div className="tip-title">{labels?.[hover] ?? `day ${hover + 1} of ${n}`}</div>
          <div className="tip-row">
            <b className="num">{tips?.[hover] ?? values[hover]!.toLocaleString("en-GB")}</b>
          </div>
        </div>
      ) : null}
    </div>
  );
}
