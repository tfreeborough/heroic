"use server";

/**
 * Code management (bits-redeem-codes.md § Admin, through the persistence
 * writers the API's /admin/codes routes use — same rules, same errors).
 * Every action re-checks the session: a server action is a public POST.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mintCodes, setCodeActive, type CodeKind } from "@heroic/blood-in-the-sand-persistence";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";

const PATH = "/blood-in-the-sand/codes";

const guard = async (): Promise<void> => {
  if (!(await currentUser())) throw new Error("not signed in");
};

const int = (v: FormDataEntryValue | null): number | null => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const x = Number(s);
  return Number.isInteger(x) ? x : Number.NaN;
};

export async function mintAction(form: FormData): Promise<void> {
  await guard();
  const kind = form.get("kind") === "tester" ? "tester" : ("promo" as CodeKind);
  const glory = int(form.get("glory")) ?? 0;
  const signets = int(form.get("signets")) ?? 0;
  const maxRedemptions = int(form.get("maxRedemptions"));
  const count = int(form.get("count"));
  const display = typeof form.get("display") === "string" ? String(form.get("display")).trim() : "";
  const note = typeof form.get("note") === "string" ? String(form.get("note")).trim().slice(0, 200) : "";
  const expiresRaw = typeof form.get("expiresAt") === "string" ? String(form.get("expiresAt")).trim() : "";
  // The date input gives a local calendar day; a promo expires at the END
  // of that day, London time.
  const expiresAt = expiresRaw ? Math.floor(new Date(`${expiresRaw}T23:59:59+01:00`).getTime() / 1000) : null;
  let outcome: string;
  if ([glory, signets, maxRedemptions, count].some((x) => Number.isNaN(x))) {
    outcome = `error=${encodeURIComponent("numbers only, please")}`;
  } else {
    try {
      const codes = await mintCodes(await db(), {
        kind,
        glory,
        signets,
        note: note || null,
        maxRedemptions: kind === "tester" ? 1 : maxRedemptions,
        expiresAt,
        ...(kind === "promo" && display ? { display } : {}),
        ...(kind === "tester" ? { count: count ?? 1 } : {}),
      });
      outcome = `minted=${encodeURIComponent(codes.join(","))}`;
    } catch (err) {
      outcome = `error=${encodeURIComponent((err as Error).message)}`;
    }
  }
  revalidatePath(PATH);
  redirect(`${PATH}?${outcome}`);
}

export async function toggleAction(form: FormData): Promise<void> {
  await guard();
  const code = String(form.get("code") ?? "");
  const active = form.get("active") === "1";
  await setCodeActive(await db(), code, active);
  revalidatePath(PATH);
  redirect(PATH);
}
