"use server";

/**
 * The player window's two writes (hq-v2.md, Tom 2026-10-22: "yes to
 * actions"): a Glory/Signet grant with a note, and HQ's note on the player.
 * Every action re-checks the session: a server action is a public POST.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hqGrant, setPlayerNote } from "@heroic/blood-in-the-sand-persistence";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";

const guard = async (): Promise<void> => {
  if (!(await currentUser())) throw new Error("not signed in");
};

const pathOf = (playerId: string) => `/blood-in-the-sand/players/${encodeURIComponent(playerId)}`;

export async function grantAction(form: FormData): Promise<void> {
  await guard();
  const playerId = String(form.get("playerId") ?? "");
  const ledger = form.get("ledger") === "signet" ? "signet" : "glory";
  const amount = Number(String(form.get("amount") ?? "").trim());
  const note = String(form.get("note") ?? "");
  // The form carries its own key, so a double-submit of the same form
  // lands once; a fresh form gets a fresh key on render.
  const key = String(form.get("key") ?? "") || randomUUID();
  let outcome: string;
  try {
    const landed = await hqGrant(await db(), { playerId, ledger, amount, note, key });
    outcome = landed ? `granted=${encodeURIComponent(`${amount > 0 ? "+" : ""}${amount} ${ledger === "glory" ? "Glory" : amount === 1 || amount === -1 ? "Signet" : "Signets"}`)}` : "granted=already";
  } catch (err) {
    outcome = `error=${encodeURIComponent((err as Error).message)}`;
  }
  revalidatePath(pathOf(playerId));
  redirect(`${pathOf(playerId)}?${outcome}`);
}

export async function noteAction(form: FormData): Promise<void> {
  await guard();
  const playerId = String(form.get("playerId") ?? "");
  await setPlayerNote(await db(), playerId, String(form.get("note") ?? ""));
  revalidatePath(pathOf(playerId));
  redirect(pathOf(playerId));
}
