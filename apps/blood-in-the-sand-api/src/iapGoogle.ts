/**
 * Google Play receipt validation (bits-store.md § S3): the client sends the
 * purchase token Play minted for it and we look the purchase up ourselves on
 * the Play Developer API — the token is an opaque claim until Google
 * confirms what it bought and that it's actually in the `purchased` state.
 *
 * Auth is the store service account (the same credential `eas submit` uses,
 * never committed): a self-signed RS256 JWT exchanged for a short-lived
 * access token, cached until expiry. No SDK — it's one signature and two
 * HTTPS calls, and the API stays dependency-light.
 *
 * Env: GOOGLE_SERVICE_ACCOUNT_JSON (the key file's contents, inline — how
 * Render carries it) or GOOGLE_SERVICE_ACCOUNT_FILE (a path, local dev);
 * ANDROID_PACKAGE_NAME defaults to the shipped package. The package name in
 * the lookup URL is OURS from env — a client cannot point us at another
 * app's purchases.
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME ?? "com.heroic.blood_in_the_sand";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const loadServiceAccount = (): ServiceAccount | null => {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  try {
    const raw = inline ?? (file ? readFileSync(file, "utf8") : null);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    return typeof parsed.client_email === "string" && typeof parsed.private_key === "string"
      ? (parsed as ServiceAccount)
      : null;
  } catch {
    return null;
  }
};

const serviceAccount = loadServiceAccount();
if (!serviceAccount) {
  console.log(
    "⚠️  no Google service account configured — Google IAP verification is OFF (GOOGLE_SERVICE_ACCOUNT_JSON or _FILE)",
  );
}

const b64url = (data: string | Buffer): string =>
  Buffer.from(data).toString("base64url");

/** Access token cache — Google mints hour-long tokens; refresh a minute early. */
let cachedToken: { token: string; expiresAt: number } | null = null;

const accessToken = async (account: ServiceAccount): Promise<string | null> => {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(account.private_key);
  const assertion = `${header}.${claims}.${b64url(signature)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (typeof body.access_token !== "string") return null;
  cachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.token;
};

export type GoogleVerification =
  | { ok: true; transactionId: string }
  | { ok: false; reason: "invalid" | "unavailable" };

/**
 * Look up (our package, claimed product, purchase token) on Play. A token
 * that doesn't belong to that product 404s — so the client's productId claim
 * is verified by the lookup itself. `purchaseState 0` (purchased) is the
 * only state that credits; pending and cancelled do not.
 */
export const verifyGooglePurchase = async (
  productId: string,
  purchaseToken: string,
): Promise<GoogleVerification> => {
  if (!serviceAccount) return { ok: false, reason: "unavailable" };
  try {
    const token = await accessToken(serviceAccount);
    if (!token) return { ok: false, reason: "unavailable" };
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(PACKAGE_NAME)}/purchases/products/` +
      `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 400 || res.status === 404) return { ok: false, reason: "invalid" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const purchase = (await res.json()) as { purchaseState?: number; orderId?: string };
    if (purchase.purchaseState !== 0) return { ok: false, reason: "invalid" };
    // Google's order id is the receipt-shaped transaction id; the token is
    // the fallback identity for test tracks that omit one.
    return { ok: true, transactionId: purchase.orderId ?? purchaseToken };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
};
