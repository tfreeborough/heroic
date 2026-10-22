"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  // A section stays lit on its sub-pages (the player window under Players),
  // but the game's own root lights only on itself.
  const isRoot = href === "/" || href.split("/").filter(Boolean).length === 1;
  const active = isRoot ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} className={active ? "active" : undefined}>
      {children}
    </Link>
  );
}
