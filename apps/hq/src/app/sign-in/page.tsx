import { redirect } from "next/navigation";
import { currentUser, signIn } from "@/auth";

const ERRORS: Record<string, string> = {
  AccessDenied: "That Google account isn't on the HQ list.",
  Configuration: "Auth isn't configured — check AUTH_SECRET and the Google client env vars.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;
  return (
    <div className="signin">
      <div className="box">
        <div className="brand">
          HQ<small>Free the Borough</small>
        </div>
        <p>The studio console. One account gets in.</p>
        {error ? <div className="banner err">{ERRORS[error] ?? `Sign-in failed (${error}).`}</div> : null}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button className="primary" type="submit">
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  );
}
