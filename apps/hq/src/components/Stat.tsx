/** One number with its label; `detail` is the small line under it. */
export function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="tile">
      <div className="k">{label}</div>
      <div className="v num">{typeof value === "number" ? value.toLocaleString("en-GB") : value}</div>
      {detail ? <div className="d">{detail}</div> : null}
    </div>
  );
}

export function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="tiles">{children}</div>;
}
