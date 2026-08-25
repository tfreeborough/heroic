# BITS — Feedback, bug reports & contact

Status: **designed + BUILT 2026-08-24** (persistence `feedback` table, API
`POST /feedback` + env-gated `GET /admin/feedback`, FeedbackScreen, Settings
rows, mailto contact door) — owed: on-device pass, a way to browse reports
that isn't curl/Turso shell ·
Applies to: **Blood in the Sand** ·
Companion to [bits-store.md](./bits-store.md) (real money is why a contact
route is non-negotiable) and [bits-accounts.md](./bits-accounts.md) (the
identity every report is stamped with).

> **The need (Tom, 2026-08-24):** early players will find bugs and have
> opinions, and anyone who paid real money for Signets needs a way to reach a
> human. Two doors, one place: a **feedback form** whose reports land in the
> database, and a **contact** button that opens the phone's mail app addressed
> to Tom. Neither requires an account — the anonymous identity is enough.

## Where it lives

Both doors sit in **Settings**, the app's one "about this app" surface:

| Row | Hint | Action |
|---|---|---|
| Feedback & bug reports | tell me what broke or what you'd change | `FEEDBACK` → the Feedback screen |
| Contact | `tfreeborough@gmail.com` | `EMAIL` → mail app, prefilled |
| Discord | chat with other gladiators and the developer | `JOIN` → `https://discord.gg/8FHgBmaSnT` |
| Reddit | r/HeroicGame — news, clips and discussion | `VISIT` → `https://www.reddit.com/r/HeroicGame/` |

The two **community** rows (added 2026-08-25) are plain `Linking.openURL`
doors — the Discord invite hands off to the Discord app when installed, the
browser otherwise; same for Reddit. Links live in `support.ts`
(`COMMUNITY_LINKS`) beside the support address, with the same
can't-open → alert-with-COPY fallback as the mail door.

They also sit on the **title screen** (2026-08-26, Tom: players should see
them, not dig for them): `CommunityIcons` — two round ghost buttons under
SETTINGS, the brand marks drawn monochrome in Skia (Simple Icons paths,
CC0) so they stay inside the parchment palette. Same `openCommunity` door.

The Feedback screen also carries the email door as its **fallback** — when
the API can't be reached (which is exactly when "the game is down" reports
happen) the failure line offers the mail app instead of a dead SEND.

## The form

- **Kind** — three pills: `BUG` · `IDEA` · `OTHER`. Stored as-is; it's the
  first-pass triage column.
- **Message** — multiline, 2,000 chars max, required.
- **Email (optional)** — "so I can reply". Remembered on-device
  (`bits.contactEmail`) so the second report doesn't ask again. Never
  validated beyond length — a typo'd address is the player's to own.
- **Context, attached silently** and listed under the form so nobody is
  surprised: platform + OS version, the store binary + OTA bundle identity
  (`runningVersion()` — the same two lines the Settings footer shows), and
  the gladiator name, and the **anonymous player id** (shown in the list;
  the server stamps it from the bearer token, so it can't be forged).

Send = `POST /feedback` with the device identity. Success shows a thanks
plate with SEND ANOTHER; failure keeps the draft in place and offers the
email door. 10 reports per player per hour server-side — a real person
never hits it, a script does.

## Storage

`feedback` table, one row per report, append-only:

```
id, player_id → players, kind, message, contact_email, player_name,
platform, os_version, app_binary, app_bundle, created_at
```

Reading it: `GET /admin/feedback?after=<id>&limit=<n>` with
`Authorization: Bearer $FEEDBACK_ADMIN_TOKEN` (newest first; the route does
not exist unless the env var is set), or the Turso shell. No in-app admin
view — Tom is the only reader.

## Contact

`mailto:tfreeborough@gmail.com` with a subject of `Blood in the Sand` and
the same context lines — **player id included**, read from SecureStore
without ever triggering a registration — pre-filled below a blank body, via
RN `Linking`. If
no mail app is configured (simulators, some Androids) the tap falls back to
an alert that shows the address with a COPY button (expo-clipboard).

## Not built (on purpose)

- No attachments/screenshots — a message plus the version stamp answers most
  reports; attachments are a later door if the inbox says otherwise.
- No reply channel in-app — email is the reply channel, hence the optional
  address field.
- No push/notify to Tom on new rows — poll the admin route or check Turso.
