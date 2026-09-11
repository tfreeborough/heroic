/**
 * The live tiles' refresh endpoint: the same game-server /stats read the
 * pages do on render, behind the same session check. No caching anywhere.
 */
import { NextResponse } from "next/server";
import { currentUser } from "@/auth";
import { liveStats } from "@/lib/live";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await liveStats(), { headers: { "cache-control": "no-store" } });
}
