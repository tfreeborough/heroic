# App Review — rejections and the replies that answer them

Applies to: **Blood in the Sand** (iOS) · Last updated: 2026-09-11

A running record of what App Review has rejected, what we changed, and the
exact words sent back. Keep the replies here rather than only in App Store
Connect — the next submission usually needs the same paragraph again.

## 2026-09-11 — v1.0 rejected on two guidelines

### 5.1.2(i) — Privacy: the labels were wrong, the app was not

> *"The app privacy information provided in App Store Connect indicates the
> app collects data in order to track the user, including Crash Data,
> Purchase History, Performance Data, and Other Diagnostic Data. However, the
> app does not use App Tracking Transparency…"*

**Nothing in the binary tracks.** `apps/blood-in-the-sand/package.json` ships
no advertising, attribution, analytics or crash SDK; nothing reads the IDFA;
`expo-tracking-transparency` is not a dependency. The only destinations are
our own API, Clerk (sign-in), Expo Updates, and the platform's own receipt
validation. Apple's definition of tracking — linking our data with
third-party data for advertising, or handing it to a data broker — never
happens, and the published [privacy policy](https://free-the-borough.com/privacy)
already says so in as many words.

So this was an **App Store Connect data-entry fix, not a code fix**: the
"used for tracking" box was ticked on four data types. What the app actually
collects, and how each type should read:

| Data type | Collected | Linked | Purpose | Tracking |
| --- | --- | --- | --- | --- |
| Purchases → Purchase History | yes | yes | App Functionality | **No** |
| Identifiers → User ID | yes | yes | App Functionality | **No** |
| Contact Info → Email Address (Clerk sign-in) | yes | yes | App Functionality | **No** |
| User Content → Other (feedback + bug reports) | yes | yes | App Functionality / Support | **No** |
| Diagnostics → Performance Data (`rttMs`, app version on reports) | yes | yes | App Functionality | **No** |
| Diagnostics → Crash Data | **no** | — | — | — |
| Diagnostics → Other Diagnostic Data | **no** | — | — | — |

Crash Data is "not collected": we ship no crash SDK, and crash reports
gathered by Apple itself are exempt from declaration.

**Reply sent in App Store Connect:**

> Blood in the Sand does not track users, on iOS or on any other platform.
> The app contains no advertising, attribution or analytics SDKs, never
> accesses the advertising identifier (IDFA), and shares no data with data
> brokers or with third parties for advertising purposes. Data we collect —
> purchase history, an anonymous player ID, an optional sign-in email, and
> bug reports the player sends us — is used solely to run the game for that
> player.
>
> We have corrected the App Privacy information: no data type is now marked
> as used for tracking, and Crash Data and Other Diagnostic Data are marked
> as not collected, since the app ships no crash-reporting or analytics SDK.
> The App Tracking Transparency prompt is therefore not required. Our privacy
> policy at https://free-the-borough.com/privacy states the same commitments.

### 3.1.1 — In-App Purchase: the redeem-code feature

> *"The app unlocks or enables additional functionality with mechanisms other
> than In-App Purchase… Specifically, the app uses code to unlock or enable
> digital content or features."*

Correct, and their rule is unambiguous: a redeem code paid Signets, and
Signets are sold through In-App Purchase. Apple's suggested alternative (IAP
promo codes) does not cover consumables, which is what the Signet packs are,
so there is no compliant in-app shape for codes on iOS.

**Removed from iOS entirely** — see
[bits-redeem-codes.md](./design/bits-redeem-codes.md) § Platforms for the
build. The Armory's ticket door, the sheet and the client call are all gated
on `CODES_ENABLED` (false on iOS), and `/codes/redeem` refuses any caller
stamped `x-client-platform: ios`. Android keeps codes.

In the same pass, the hidden dev menu was locked out of production builds
([bits-dev-menu.md](./design/bits-dev-menu.md)): its announcer cycler was a
local unlock of the paid voices, the same violation waiting to be found.

**Reply sent in App Store Connect:**

> We have removed the code-redemption feature from the iOS app entirely.
> There is no longer any way in the app to enter a code, and no screen refers
> to codes. All digital content and currency in Blood in the Sand is now
> obtained only by playing the game or through In-App Purchase.

## Review Notes for the resubmission

> **Codes (guideline 3.1.1):** the code-redemption feature has been removed
> from the iOS app. No screen accepts or mentions a code. All digital content
> and currency is obtained by playing or through In-App Purchase.
>
> The passcodes shown in Skirmish are private-lobby join keys that friends
> share to play together — they unlock no content, currency or features.
>
> **Tracking (guideline 5.1.2(i)):** the app does not track users. It ships
> no advertising, attribution or analytics SDK and never accesses the IDFA,
> so no App Tracking Transparency prompt is present. The App Privacy
> information has been updated accordingly.
>
> **Reviewing the game:** [account / test steps as usual].

## Checklist before resubmitting

- [ ] App Privacy edited in App Store Connect (table above); requires Account
      Holder or Admin.
- [ ] Reply posted to both rejection messages.
- [ ] New production build from master, submitted for review. The fix is
      pure JS, so an `eas update` to the production channel does reach the
      already-uploaded build — but a reviewer can open the app before the
      update applies, and "we patched it over the air" is a bad answer to a
      compliance rejection. Ship the build; OTA is for players already on
      1.0.0 if it ever goes live.
- [ ] Review Notes pasted into the submission.
