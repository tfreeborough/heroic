# BITS — Accounts & Purchase Persistence (Clerk linking)

Status: **designed 2026-08-21 · Clerk CLI/SDK setup same day · A1 (server:
schema + /account routes + kill switch) BUILT 2026-08-22 · A2 (client: Clerk
provider, AccountSheet, wallet restore door, Settings rows + deletion, 401
recovery) BUILT 2026-08-22 · A3 (post-purchase sheet on both purchase
surfaces) BUILT 2026-08-22 · A4 (per-device tokens — multi-device play, one
sign-in per device ever) BUILT 2026-08-22 · **WORKING IN PRODUCTION on both
platforms 2026-08-23** (production Clerk instance + Apple/Google connections +
Render env + native-app registrations all configured)** — owed: ship the
sheet's improved error surfacing (in working tree, not yet in a build/OTA),
account_linked SFX ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-08-21 ·
Companion to [glory-economy.md](./glory-economy.md) (the anonymous identity this
protects), [bits-store.md](./bits-store.md) (the purchases worth protecting), and
[monetisation.md](./monetisation.md) (principles).

> **The problem (Tom, 2026-08-21):** identity is a bearer token in SecureStore
> (`net/api.ts`) and that token is the *only* credential. Purchases live server-side
> keyed to it, so losing the token loses everything. On Android the Keystore is wiped
> on uninstall — a reinstall mints a stranger. On iOS the keychain survives reinstall,
> but a **new or second device** (phone → iPad, phone upgrade) mints a stranger on
> *both* platforms. Someone who paid real money for Signet packs and opens the game
> on their iPad sees an empty armory. That's the support ticket we never want.

## Principles

1. **Anonymous-first, forever.** The account is a *link*, not a replacement. Nobody
   is ever forced to sign in; every system keeps speaking `playerId` + bearer token.
   Clerk is a lookup table bolted onto the side, nothing more.
2. **Sell it as protection, not registration.** The pitch is one sentence: *your
   purchases follow you to any device*. Never "create an account" — that phrase is
   a chore.
3. **One tap.** Native Sign in with Apple on iOS, native Google sign-in on Android.
   No email/password path exists anywhere, ever. No profile screen, no username
   (the arena name is already a separate thing).
4. **Both platforms.** The loudest failure (Android reinstall) is Android-only, but
   the real-money failure (new/second device) is universal — and it's one behaviour
   to build and test instead of a platform fork.

## Decisions locked 2026-08-21

- **The sheet fires after ANY first purchase** — an Armory unlock (a Signet spent)
  or a Signet pack (real money). Both are equally worth protecting; a spent Signet
  *was* money or earned Glory either way. (Tom: "both are probably equally
  important.")
- **Providers: Apple on iOS, Google on Android.** One button on the sheet, matched
  to the platform. (Apple's guideline 4.8 only forces Sign in with Apple when a
  *third-party* login is offered — Apple-only on iOS is clean.)
- **Dismissing the sheet requires a confirm.** Tapping outside / "Not now" opens a
  small confirm ("Skip for now? Purchases stay on this device only.") so nobody can
  claim they dismissed it by accident. (Tom, 2026-08-21.)
- **The wallet header carries a sign-in door even before any purchase** — the
  restore path: you're on a new device, you have nothing locally, you need a way
  in. (Tom, 2026-08-21.)

## The sheet (post-purchase)

**Timing — the ceremony always finishes first.** The unlock moment is the product
(bits-store.md); the sheet never steps on it.

- **Armory unlock:** after the seal-break ceremony is dismissed, not after the
  purchase POST. The purse tick, the seal crack, the reveal — all land; *then* the
  sheet rises.
- **Signet pack:** after the `credited` event lands and the WritPacks/SignetPacks
  sheet has shown its balance tick. The sheet replaces the pack sheet rather than
  stacking on it.

**Layout** — a bottom sheet in the store's language (parchment/wax palette):

> **KEEP YOUR ARMORY**
> Sign in and your purchases follow you to any device.
> `[  Sign in with Apple  ]`   *(or Google on Android — one button, native)*
> *Not now*

No feature list, no bullets. One claim, one button, one escape link.

**The confirm on skip** (small centered dialog over the sheet):

> Skip for now?
> Your purchases stay on **this device only** until you sign in.
> You can sign in any time from the wallet.
> `[ Skip ]` `[ Sign in ]`

**Re-offer cadence (proposed, not locked):** while unlinked, the sheet shows after
any purchase but **at most once per app session**. A confirmed skip is respected for
the session, not forever — the next session's purchase re-offers. The header door
and Settings row exist precisely so the sheet doesn't have to nag.

**On success:** a short "Armory secured" beat (reuse the stamp/seal motif — this is
literally a signet moment), sheet closes. No profile UI appears anywhere.

## The restore door (wallet header)

The purse (Glory · Signets, in the shared `ScreenHeader` every menu screen wears
since 2026-08-22 — it replaced the GloryPill) is the wallet's face. While
**unlinked**, a small companion affordance sits beside it — a signet-ring outline
glyph, tappable → the same sign-in sheet (headlined **RESTORE YOUR ARMORY** in this
context). While **linked**, the glyph disappears entirely — signed-in is the quiet
state, per the api.ts rule (never show state the player didn't ask about).

**The restore door shows ONE platform-matched button** — same as the post-purchase
sheet. **AMENDED 2026-08-23 (Tom, production device pass):** the original design gave
restore both providers so an Apple-linked iPhone armory could migrate to Android,
but a player straddling platforms is too rare to earn a second button — that
migration path is deliberately unserved until it proves needed (the fix would be
re-adding the cross-platform provider via the browser SSO flow, a one-line
revert).

A **Settings row** ("Save purchases across devices" / when linked: "Signed in ·
Apple") is the always-available fallback, and hosts **account deletion** (required:
App Store guideline 5.1.1(v) — any app offering account creation must offer in-app
deletion). Deleting = unlink `clerk_user_id` + delete the Clerk user via the API.
The local player survives as pure-anonymous with purchases intact — deletion
removes the *link*, never the armory.

**Offline:** the door hides (api.ts rule — no error surfaces the player didn't
invite).

## Server (blood-in-the-sand-api + persistence)

**Schema:** `ALTER TABLE players ADD COLUMN clerk_user_id TEXT UNIQUE` (nullable).
That single column is the entire account system.

**Verification:** Clerk session JWTs verified on Bun against Clerk's JWKS
(`@clerk/backend` or `jose` — same shape as the Apple JWS work in `/store/iap`).
Envs: `CLERK_SECRET_KEY` (server), `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (client,
single-sourced in `.env.production` per bits-ota-env-gotcha). Kill switch:
`ACCOUNTS_ENABLED` — off hides every door client-side via `/store` config, same
pattern as ranked's kill switch.

**Endpoints:**

- `POST /account/link` — auth: bearer token **+** Clerk JWT in body. Sets
  `clerk_user_id` on the caller's player. If that Clerk user is already linked to a
  *different* player → merge policy below.
- `POST /account/restore` — auth: Clerk JWT only. Looks up the linked player and
  mints the calling device **its own bearer token**. Tokens are per-device (**A4,
  built 2026-08-22** — the single-token model shipped first and was upgraded the
  same day when Tom confirmed multi-device play matters): a `player_tokens` table
  is the authoritative credential store (one row per device, newest-10 cap per
  player — a pruned device just re-restores), `players.token_hash` survives as a
  legacy column, backfilled once on boot, guarded so a pruned legacy token is
  never resurrected. One sign-in per device, ever; no device logs out another.
  Client stores the new identity in SecureStore exactly as `/register` does.
- `POST /account/unlink` — auth: bearer. Clears `clerk_user_id`, deletes the Clerk
  user server-side (deletion requirement).

**Merge policy** (link called on a device that has local anonymous progress, but
the Clerk user already owns another player):

- Local anonymous player has **no purchases** (empty signet ledger + no unlocks):
  silently discard it — adopt the account's player via the restore path. This is
  the overwhelmingly common case (fresh install, then remembered "I have an
  account").
- **Both** players have purchases (rare): keep the account's player, merge server-
  side — union the unlock entitlements, sum the wallets, ledger rows annotated
  `merge:<abandonedPlayerId>`. Never prompt the player to choose; nobody loses
  anything under union+sum.
- Ranked/Elo, deeds, names: the account player's records win; the abandoned
  player's are left orphaned (not merged — Elo merging is unprincipled).

**Security notes:** restore is rate-limited like the other store endpoints; a
Clerk JWT is single-audience (our Clerk instance) so replay across apps is dead;
one-live-ranked-seat already handles the same-account-two-devices case; and the
**401 self-wipe** from the store-security audit becomes recoverable — a 401 on a
linked account offers "Sign in to restore" *instead of* silently re-registering.

## Client

- `@clerk/clerk-expo` + native providers (`expo-apple-authentication`;
  Google via Clerk's native flow). **Dev-client rebuild required** (new native
  modules — remember expo-precompiled-abi-skew: bump as a set, clean reinstall).
- Linked state: `GET /wallet` grows a `linked: boolean` (cheap — the wallet fetch
  already rides every screen that shows the pill). Cached alongside identity.
- New-device restore flow: door → Clerk native sign-in → `/account/restore` →
  overwrite SecureStore identity → wallet/armory refetch. Total taps: two.

## Milestones

- **A1 — server:** schema, JWT verify, `/account/link` + `/restore` + `/unlink`,
  merge policy, kill switch, tests. No client surface.
- **A2 — client link + restore:** Clerk SDK, the wallet-header door (both-provider
  sheet), Settings rows (sign-in / signed-in / delete), 401-recovery path.
- **A3 — the post-purchase sheet:** platform-matched single button, ceremony-safe
  timing on both purchase surfaces, skip-confirm, once-per-session cadence.

## As built (2026-08-22)

Where the build refined the design:

- **The restore door lives where the purse lives** — first the GloryPill on
  Mode Select + Ranked; since the 2026-08-22 header unification, the shared
  `ScreenHeader`'s purse on EVERY menu screen (Mode Select, Ranked, Armory,
  Deeds, Settings, Practice, Rooms). It's part of the purse component itself,
  so any future purse placement carries the door.
- **Google is Clerk's system-browser SSO flow** (`useSSO`, `oauth_google`),
  not an in-process native one-tap — one tap to the browser sheet, provider
  UI, straight back. Apple on iOS is fully native (`useSignInWithApple` +
  the official `expo-apple-authentication` button, HIG-compliant).
  Apple-on-Android (restore only) rides the same SSO browser flow.
- **`app.json` gained `"scheme": "bloodinthesand"`** — the SSO redirect needs
  it (and the owed TRY IT deep-link gets it for free).
- **Every wallet-shaped response** (`/wallet` AND the store-mutation
  responses) now carries `linked` + `accounts`, so the pack-purchase offer
  can key off the wallet that rides the credit answer itself.
- **The sheet is a react-native `Modal`** so it can rise over any screen from
  inside the pill; Android hardware-back routes through `onRequestClose`,
  which is how the skip-confirm still gates it. **Gotcha, both halves (device
  pass 2026-08-22):** a Modal mounts OUTSIDE the app's
  `GestureHandlerRootView`, so (1) RNGH Pressables/gestures inside one are
  silently dead until the Modal's content wraps its own
  `GestureHandlerRootView`, and (2) once it does, sheetGestures'
  `useSheetDrag` (a JS PanResponder) STILL never engages there — a
  Modal-hosted sheet must drag via RNGH (`Gesture.Pan` + `GestureDetector`,
  as AccountSheet now does; same thresholds). Applies to any future
  Modal-hosted sheet. A keep-mode swipe deliberately springs back and raises
  the skip-confirm instead of sliding away — the swipe IS the accidental
  dismiss the confirm exists for.
- **Copy leads with the honest state** (Tom, device pass): a "SAVED TO THIS
  DEVICE ONLY" status chip, purchases-AND-progress framing, and an explicit
  "no account is ever needed to play" line — the sheet informs first, sells
  second.
- **401 recovery** is a locally persisted `bits.linkedAccount` hint (written
  on every wallet fetch): `revalidateIdentity` skips the anonymous
  wipe-and-remint for a player last seen linked — the doors sign them back in.
- **`/account/unlink` deletes the Clerk user FIRST**, clears the local link
  only after Clerk confirms — a half-deleted account can't exist; the client
  then drops its local Clerk session.
- **Merge is unconditional on link-conflict** (union entitlements + sum both
  ledgers with deterministic `merge:<playerId>` idempotency keys) — the
  "empty player" adopt case is just a merge that moves nothing, so there's
  one code path and a retried merge is provably a no-op.

### Production config gotchas (device pass 2026-08-23 — each one cost a debug round)

- **Native packages a library lazy-imports must be declared in the app's own
  package.json.** `@clerk/expo` lazy-imports `expo-crypto` and (via
  `expo-auth-session`) `expo-linking`; hoisted transitive copies satisfied
  Metro but NOT autolinking → release builds crashed on tap with "Cannot
  find native module 'ExpoCrypto'" (Metro's module-load guard reports it
  fatally before any try/catch). All three now declared.
- **`@clerk/expo` needs iOS deployment target 17.0** — set via
  expo-build-properties; drops iPhone 8/X-era devices, accepted.
- **Native Apple sign-in needs the app's Bundle ID in Clerk's "Native
  applications"** (production dashboard) — the native token's audience is the
  bundle id, not the Services ID (which only covers the web flow). Symptom
  when missing: Apple sheet completes, then "sign-in didn't complete".
- **Production instances enforce a redirect-URL allowlist** (dev doesn't —
  works-in-dev-only trap). The browser SSO redirect
  `bloodinthesand://sso-callback` (app scheme + Clerk's `sso-callback` path)
  had to be added via BAPI `/redirect_urls`; the Native-applications setup
  auto-adds two DIFFERENT patterns that don't match it. Symptom when
  missing: no browser ever opens ("Redirect url mismatch" from FAPI).
- **Android native-app registration**: namespace + package
  `com.heroic.blood_in_the_sand`, SHA-256 of the **Play App Signing** cert
  (read off the installed APK with `apksigner verify --print-certs`; keytool
  can't read scheme-v2 signatures). EAS internal-distribution sideloads are
  signed by the upload key = different fingerprint.
- Debug technique that found all of this: FAPI can be driven with curl
  (mint client → POST sign_ins with strategy+redirect_url) to test instance
  config without a device; Android crashes read directly via adb logcat.

Owed after build: Tom's Clerk dashboard setup (Apple Services ID + native Google
OAuth creds — manual), Render env vars, dev-client rebuild, an `account_linked`
"armory secured" SFX on the Forge done-tick checklist (bits-audio.md), on-device
pass both platforms.
