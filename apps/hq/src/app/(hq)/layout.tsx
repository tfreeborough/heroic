import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { Shell } from "@/components/Shell";

/** The second lock (hq.md): the proxy already turned strangers away, and
 * every page under here re-checks before rendering anything. */
export default async function HqLayout({ children }: { children: React.ReactNode }) {
  const email = await currentUser();
  if (!email) redirect("/sign-in");
  return <Shell email={email}>{children}</Shell>;
}
