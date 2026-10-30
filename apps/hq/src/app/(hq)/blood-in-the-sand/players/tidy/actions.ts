"use server";

/**
 * Deleting old test accounts (Tom 2026-10-30: the player count is padded
 * with devices from testing earlier in the year). The persistence delete
 * re-checks the stale rule itself, so a stale page or a hand-made POST can
 * never take out someone who has played since the cutoff.
 * Every action re-checks the session: a server action is a public POST.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteStalePlayers } from "@heroic/blood-in-the-sand-persistence";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { cutoffOf } from "./cutoff";

const PATH = "/blood-in-the-sand/players/tidy";

const guard = async (): Promise<void> => {
  if (!(await currentUser())) throw new Error("not signed in");
};

export async function deleteAction(form: FormData): Promise<void> {
  await guard();
  const before = String(form.get("before") ?? "");
  const { day, cutoffS } = cutoffOf(before);
  const back = `${PATH}?before=${day}`;
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== "delete") {
    redirect(`${back}&error=${encodeURIComponent('type "delete" in the box to confirm')}`);
  }
  const ids = form.getAll("id").map(String);
  const gone = await deleteStalePlayers(await db(), ids, cutoffS);
  revalidatePath("/blood-in-the-sand", "layout");
  redirect(`${back}&deleted=${gone}&asked=${ids.length}`);
}
