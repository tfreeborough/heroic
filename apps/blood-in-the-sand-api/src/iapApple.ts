/**
 * Apple receipt validation (bits-store.md § S3): the client sends the
 * StoreKit 2 signed transaction (a JWS) and we verify it HERE, against
 * Apple's pinned root certificates — the client is never trusted about what
 * it bought. Verification is offline crypto (x5c chain → Apple Root CA) plus
 * an online revocation check; no shared secret, no call to Apple's legacy
 * verifyReceipt.
 *
 * Everything the credit path uses (productId, transactionId) comes from the
 * VERIFIED payload, never from request fields — a client can lie about its
 * body, it cannot forge Apple's signature.
 *
 * Env: APPLE_BUNDLE_ID (defaults to the shipped app), APPLE_APP_APPLE_ID —
 * the numeric App Store id, REQUIRED for production-environment verification
 * (Apple's rule, not ours). Until it's set, sandbox receipts still verify,
 * so TestFlight testing works before the App Store listing exists.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Environment,
  SignedDataVerifier,
  VerificationException,
} from "@apple/app-store-server-library";

const BUNDLE_ID = process.env.APPLE_BUNDLE_ID ?? "com.tfreeb.blood-in-the-sand";
const APP_APPLE_ID = Number(process.env.APPLE_APP_APPLE_ID ?? 0) || undefined;

/** Apple's public root CAs, vendored (certs/ — public documents, committed
 * on purpose). G3 is what StoreKit 2 chains to today; the older root rides
 * along because the verifier accepts a set and Apple may cross-sign. */
const appleRoots = ["AppleRootCA-G3.cer", "AppleIncRootCertificate.cer"].map((name) =>
  readFileSync(resolve(import.meta.dir, "../certs", name)),
);

/** One verifier per store environment — the library refuses a payload whose
 * environment differs from its own, so we try production first and fall back
 * to sandbox (TestFlight bills against sandbox). Production verification is
 * only possible once APPLE_APP_APPLE_ID is configured. */
const verifiers: { verifier: SignedDataVerifier; sandbox: boolean }[] = [];
if (APP_APPLE_ID) {
  verifiers.push({
    verifier: new SignedDataVerifier(appleRoots, true, Environment.PRODUCTION, BUNDLE_ID, APP_APPLE_ID),
    sandbox: false,
  });
} else {
  console.log("⚠️  APPLE_APP_APPLE_ID not set — Apple IAP verification is SANDBOX-ONLY");
}
verifiers.push({
  verifier: new SignedDataVerifier(appleRoots, true, Environment.SANDBOX, BUNDLE_ID),
  sandbox: true,
});

export type AppleVerification =
  | { ok: true; productId: string; transactionId: string; sandbox: boolean }
  | { ok: false; reason: "invalid" | "unavailable" };

/**
 * Verify a signed transaction JWS. `invalid` = affirmatively rejected (bad
 * signature, wrong bundle, refunded) — the client should surface an error
 * but may finish the transaction. `unavailable` = we couldn't complete
 * verification (network to Apple's revocation check) — the client must keep
 * the transaction unfinished and retry later.
 */
export const verifyAppleTransaction = async (jws: string): Promise<AppleVerification> => {
  let sawInfraFailure = false;
  for (const { verifier, sandbox } of verifiers) {
    try {
      const payload = await verifier.verifyAndDecodeTransaction(jws);
      // A refunded/revoked purchase must never credit — Apple stamps the
      // payload rather than un-signing it.
      if (payload.revocationDate) return { ok: false, reason: "invalid" };
      if (!payload.productId || !payload.transactionId) return { ok: false, reason: "invalid" };
      return {
        ok: true,
        productId: payload.productId,
        // Sandbox transaction ids live in their own numbering — prefix them
        // so a sandbox id can never collide with (or replay as) a production
        // credit in the ledger's global idempotency namespace.
        transactionId: sandbox ? `sandbox-${payload.transactionId}` : payload.transactionId,
        sandbox,
      };
    } catch (err) {
      if (err instanceof VerificationException) continue; // try the next environment
      sawInfraFailure = true; // non-crypto failure (e.g. OCSP fetch) — retryable
    }
  }
  return { ok: false, reason: sawInfraFailure ? "unavailable" : "invalid" };
};
