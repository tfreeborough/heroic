# BITS — Redeem Codes (promo · tester)

Status: **designed 2026-09-10 · BUILT same day** (persistence `codes.ts` +
tests, API `/codes/redeem` + `/admin/codes`, client: Armory header ticket →
`RedeemCodeSheet`) · owed: `CODES_ADMIN_TOKEN` on Render, on-device pass ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-09-10 ·
Companion to [bits-accounts.md](./bits-accounts.md) (the gate every code sits
behind), [bits-store.md](./bits-store.md) (what a code pays out in),
[glory-economy.md](./glory-economy.md) (the ledger it writes to) and
[monetisation.md](./monetisation.md) (principles).

> **The idea (Tom, 2026-09-10):** a way to hand out Glory and Signets by code —
> to early testers as a thank-you, and as promotional codes in the Borderlands
> style (Discord, Reddit, a tweet). A code pays a player once and only once.
> A friend-referral scheme was sketched alongside and **cut from this pass**
> (Tom, 2026-09-10: "dump all the referral logic for now, we can do it later")
> — nothing here presumes it, and nothing here blocks it.

## Principles

1. **Linked players only.** No code of any kind redeems on an anonymous player.
   The cheap farm — reinstall, redeem, repeat — dies the moment the redemption is
   keyed to an account rather than an install, and the merge-double-pay problem
   never exists because only an account's one canonical player can hold a
   redemption. (Tom, 2026-09-10.)
2. **Gate the door, not the error.** The client never shows a code field to a
   player who can't use it. Unlinked players see the sign-in row where the field
   would be; linked players see the field. Nobody types a code that "doesn't
   work". The server enforces the same rule regardless — the client gate is the
   experience, the server check is the security.
3. **One writer, one key.** A redemption is one more Glory / Signet ledger
   writer. Its idempotency key is `code:<code>:<playerId>`; the ledgers' UNIQUE
   constraint is what makes "once per code per player" true, not bookkeeping.
4. **Codes are never sold.** They're gifts. Selling codes outside the store is
   what Apple/Google actually forbid; granting in-app currency by code is fine.
5. **Glory is cheap, Signets are money.** A Signet code is a real discount on a
   real-money item. Default to Glory for public codes; reserve Signets for
   testers and deliberate moments.

## Kinds

One table, two kinds. The kind only changes who mints the code and what the
backstop limits look like.

| Kind | Who gets one | Uses | Backstops | Typical reward |
| --- | --- | --- | --- | --- |
| `promo` | everyone (posted publicly) | many | use limit + `expires_at`, both required | Glory (occasionally 1 Signet for a launch beat) |
| `tester` | one person, handed out privately | one | use limit forced to 1; expiry optional | Signets |

**Promo** — the Borderlands shape. `BLOODTIDE-2026`, posted on the Discord, works
for the first N linked players until the date. The **use limit**
(`max_redemptions` — how many different players may ever redeem the code) and
the expiry are the backstop against someone burning a fresh Apple/Google
identity per redemption (Sign in with Apple's relay emails make that cheaper
than it sounds, so the backstop stays even with the account gate).

**Tester** — minted in a batch, one unique string per person, single use. The
thank-you for the early-days testers. Because it's single-use, nothing else
needs limiting.

## Rules

- **Normalisation.** Codes are stored and compared upper-cased with everything
  but letters and digits stripped: `blood tide 2026`, `BLOODTIDE-2026` and
  `bloodtide2026` are the same code. Display form (with hyphens) is whatever
  was minted.
- **Alphabet.** Generated codes use `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no
  `0/O`, `1/I`), 10 characters shown as `XXXXX-XXXXX` (~10^15 space); promo
  codes are human-authored words. The alphabet matters for reading a code off a
  phone screen, not for entropy — the attempt limit does the security work.
- **Attempt limit.** 10 attempts per player per minute on the redeem route, via
  the existing `overLimit` window. Enumeration is pointless at that rate.
- **Once per player.** `code_redemptions` has a PRIMARY KEY `(code, player_id)`.
  The ledger write's idempotency key repeats the pair. Both can't be
  half-applied: the redemption row and the credit(s) go in one `db.batch` with
  the redemption `INSERT OR IGNORE` gating the credits, same shape as `store.ts`.
- **The use limit is enforced in the write.** `max_redemptions` is checked
  inside the same batch (`COUNT(*) < max`), never in a read-then-write, so two
  people racing the last slot can't both win.
- **Expiry and `active` are read-time.** An expired, full or deactivated code
  answers `code_expired` (full and expired are the same answer — the player
  can't tell the difference and shouldn't); an unknown or inactive code answers
  `code_invalid`. Existing redemptions stand either way.
- **Payout can be either or both.** `glory` and `signets` columns, each ≥ 0, at
  least one > 0. One ledger row per non-zero currency, sources
  `code:<kind>` (e.g. `code:promo`), so the store audit query in `store.test.ts`
  keeps working and Tom can `GROUP BY source` to see what codes have cost.
- **Merge.** Nothing special. A redemption can only exist on a linked player,
  and a linked player is the account's canonical player, so a merge never sees
  two redemptions of one code. `mergePlayers` stays untouched.
- **Unlink / delete account.** The redemption row keys on `player_id`, not the
  Clerk id, so an install that unlinks and relinks to a new account still can't
  redeem the same code again. The Clerk id is stored on the row for audit only.

## Schema

```sql
CREATE TABLE IF NOT EXISTS codes (
  code            TEXT PRIMARY KEY,          -- normalised form
  display         TEXT NOT NULL,             -- as minted, hyphens kept
  kind            TEXT NOT NULL,             -- promo | tester
  glory           INTEGER NOT NULL DEFAULT 0,
  signets         INTEGER NOT NULL DEFAULT 0,
  max_redemptions INTEGER,                   -- NULL = unlimited
  expires_at      INTEGER,                   -- unix seconds, NULL = never
  active          INTEGER NOT NULL DEFAULT 1,
  note            TEXT,                      -- "launch tweet", "tester: Alice"
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS code_redemptions (
  code          TEXT NOT NULL REFERENCES codes(code),
  player_id     TEXT NOT NULL REFERENCES players(id),
  clerk_user_id TEXT NOT NULL,               -- audit only
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (code, player_id)
);
CREATE INDEX IF NOT EXISTS idx_code_redemptions_player ON code_redemptions (player_id);
```

## API

All under the existing bearer auth in `apps/blood-in-the-sand-api`. No room
protocol change — this is REST only, no `PROTOCOL_VERSION` bump.

- `POST /codes/redeem` `{ code }` →
  - `200 { credited: { glory, signets }, glory, signets, linked, accounts }` —
    the top-level fields are the post-credit wallet so the client needs no
    second read.
  - `403 not_linked` — anonymous player. The client should never trigger this
    (§ Client) but it must exist.
  - `404 code_invalid` — unknown or deactivated.
  - `409 already_redeemed` — this player has used this code.
  - `410 code_expired` — past `expires_at`, or the use limit is reached.
  - `429 rate_limited`.
- **Admin** — live only when `CODES_ADMIN_TOKEN` is set, gated exactly like
  `/admin/feedback` (sha256 timing-safe bearer compare, IP-limited):
  - `POST /admin/codes` — mint. Body `{ kind, glory, signets, note?,
    expiresAt?, maxRedemptions?, display?, count? }`. `display` = one
    human-authored promo code; `count` = that many generated codes (tester
    batches). Promo codes are refused without both a use limit and an
    expiry. Returns `{ codes: [display…] }`.
  - `GET /admin/codes` — every code with its redemption count.
  - `POST /admin/codes/active` `{ code, active }` — switch a code off (a
    leaked promo code) or back on.

Minting from a shell:

```sh
curl -X POST "$API/admin/codes" -H "authorization: Bearer $CODES_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"kind":"promo","display":"BLOOD-TIDE","glory":200,"maxRedemptions":500,"expiresAt":1767225600,"note":"launch tweet"}'
curl -X POST "$API/admin/codes" -H "authorization: Bearer $CODES_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"kind":"tester","signets":3,"count":20,"note":"first testers"}'
```

A Realmsmith tab can sit on these later.

## Client

**Door.** A ticket glyph in the Armory header, after the purse (`ScreenHeader
right` slot, `HeaderDoor` = the restore door's ring around a screen-supplied
glyph). Tom, 2026-09-10: an icon at the top of the Armory opening a modal,
not a card at the bottom, and nothing on Settings at all — a code is a way to
get Signets, and the Armory is the only place that talks about them. The door
shows whenever a code COULD be redeemed — linked already, or accounts live so
the sheet can offer the sign-in — and is absent otherwise (accounts off
server-side, no Clerk key shipped).

**Sheet.** `RedeemCodeSheet`, a bottom sheet in the AccountSheet's shell
(Modal + own gesture root). It lifts itself over the keyboard from
`Keyboard` frame events — `KeyboardAvoidingView` never sees a keyboard frame
inside a Modal (device pass, 2026-09-10: "the keyboard covers it"); any
future sheet with a field inside a Modal should copy the `lift` hook:

- **Linked:** *"got a code from me? put it in here"*, the field (auto-focused,
  capitals, `XXXXX-XXXXX` placeholder), a gold REDEEM button, DONE.
- **Not linked:** *"codes need an account so I can make sure each one's used
  once — sign in and it'll unlock"*, a SIGN IN button → `AccountSheet
  mode="restore"` stacked on top. When the link lands the Armory refreshes its
  wallet, the prop flips, and the same sheet now shows the field — no second
  tap, no leaving the screen.

**Result.** Success plays `signetPurchase` for a Signet payout, `gloryEarned`
for a Glory-only one; the purse in the header ticks up (the Armory owns the
wallet, the sheet hands the post-credit one back); the field clears and a
one-line credit note (*"+200 Glory"*) sits under it so the player can put a
second code in. Errors are one line, no alerts: *"that's not a code I know"*,
*"you've already used that one"*, *"that one's finished"*, *"couldn't reach
the ledger — try again in a moment"*.

## Sound

Consult [bits-audio.md](./bits-audio.md): `signetPurchase` and `gloryEarned`
already exist. No new events.

## Later (not built)

- **Referral.** Personal code per linked player, friend paid on redeem,
  referrer paid on a milestone (first ranked match), friend must be a younger
  player than the referrer. Would add `owner_player_id` to `codes` and a
  `referral` kind; the redeem path is unchanged.
- **Realmsmith tab** over the admin routes.
- **Deed?** A "Redeemed a code" deed would be count-based, which Tom finds
  boring. Not proposed.
