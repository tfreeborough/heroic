/**
 * Auth.js (hq.md § Decision 2): Google is the only provider, and a sign-in
 * only succeeds for an allowed, Google-verified address — anyone else is
 * refused at the callback, before a session ever exists. Sessions are
 * stateless JWTs (no user table: there is exactly one user).
 *
 * Env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET (Auth.js reads the
 * Google pair itself), optional HQ_ALLOWED_EMAILS.
 */
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "@/lib/allowed";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  // Render terminates TLS in front of us; trust the forwarded host.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in", error: "/sign-in" },
  callbacks: {
    signIn: ({ profile }) => {
      const email = typeof profile?.email === "string" ? profile.email : null;
      const verified = profile?.email_verified === true;
      return verified && isAllowedEmail(email);
    },
    authorized: ({ auth }) => isAllowedEmail(auth?.user?.email),
  },
});

/** The signed-in, allowed email — or null. Pages call this as the second
 * lock behind the proxy. */
export const currentUser = async (): Promise<string | null> => {
  const session = await auth();
  const email = session?.user?.email ?? null;
  return isAllowedEmail(email) ? email : null;
};
