import { signOut } from "@/auth";
import { dbLabel } from "@/lib/db";
import { NavLink } from "./NavLink";

/** The frame every signed-in page sits in: studio nav on the left, one
 * section per game. A second game = another <h4> block. */
export function Shell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          HQ<small>Free the Borough</small>
        </div>
        <nav className="nav">
          <NavLink href="/">Overview</NavLink>
          <h4>Blood in the Sand</h4>
          <NavLink href="/blood-in-the-sand">Dashboard</NavLink>
          <NavLink href="/blood-in-the-sand/players">Players</NavLink>
          <NavLink href="/blood-in-the-sand/ranked">Ranked</NavLink>
          <NavLink href="/blood-in-the-sand/economy">Economy</NavLink>
          <NavLink href="/blood-in-the-sand/deeds">Deeds</NavLink>
          <NavLink href="/blood-in-the-sand/feedback">Feedback</NavLink>
          <NavLink href="/blood-in-the-sand/codes">Codes</NavLink>
        </nav>
        <div className="foot">
          <span className="mono">{dbLabel()}</span>
          <span>{email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/sign-in" });
            }}
          >
            <button type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}
