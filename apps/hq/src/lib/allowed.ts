/**
 * Who may open HQ (hq.md § Decision 2). The studio address is the built-in
 * default; HQ_ALLOWED_EMAILS (comma-separated) replaces it if set. This
 * check is THE lock — every other gate (Google, Auth.js) only decides who
 * can present an email to it.
 */
const DEFAULT_ALLOWED = ["tom@harewood.io"];

export const allowedEmails = (): string[] => {
  const raw = process.env.HQ_ALLOWED_EMAILS?.trim();
  const list = raw ? raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean) : DEFAULT_ALLOWED;
  return list;
};

export const isAllowedEmail = (email: string | null | undefined): boolean =>
  typeof email === "string" && allowedEmails().includes(email.trim().toLowerCase());
