/**
 * The front door: every route except sign-in and the auth endpoints needs
 * an allowed session. Next 16's proxy (the renamed middleware) runs this
 * before any page renders.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/allowed";

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/auth") || pathname === "/sign-in") return NextResponse.next();
  if (isAllowedEmail(req.auth?.user?.email)) return NextResponse.next();
  const to = req.nextUrl.clone();
  to.pathname = "/sign-in";
  to.search = "";
  return NextResponse.redirect(to);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
