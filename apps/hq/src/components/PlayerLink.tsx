import Link from "next/link";
import { short } from "@/lib/format";

/** Every player id in HQ is a door to that player's window (hq-v2.md). The
 * name is shown when known, the short id otherwise, the full id on hover. */
export function PlayerLink({ id, name, className }: { id: string; name?: string | null; className?: string }) {
  if (id.startsWith("bot:")) return <span className="muted">bot</span>;
  return (
    <Link href={`/blood-in-the-sand/players/${encodeURIComponent(id)}`} className={`plink ${className ?? ""}`} title={id}>
      {name ? name : <span className="mono">{short(id)}</span>}
    </Link>
  );
}
