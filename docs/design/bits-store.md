# BITS — Writs & the Armory (the store)

Status: **designed 2026-08-09 — NOT built** (targets the end-of-August launch window) ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-08-09 ·
Companion to [monetisation.md](./monetisation.md) (principles — never a flat paid
advantage), [glory-economy.md](./glory-economy.md) (wallet/ledger/identity),
[bits-secret-items.md](./bits-secret-items.md) (the entitlement plumbing this reuses),
and [pvp-loadout-flow.md](./pvp-loadout-flow.md) (the Arming wizard, where the impulse
purchase lives).

> **The problem (Tom, 2026-08-09):** if weapons/spells are priced directly in Glory,
> every future change to Glory *earn rates* forces a store-wide repricing — which reads
> to players as being squeezed. And selling Glory itself never made flavour sense
> (glory is earned by definition).

## The model: one universal Writ

A **Writ** is a voucher that unlocks **any one weapon or spell**. All purchasable
items cost exactly **1 Writ, forever**. Writs are obtained two ways:

1. **Bought with Glory** — the Glory→Writ exchange rate is the economy's **single
   tunable knob**, server-side. Earn rates and item prices never have to move together
   again.
2. **Bought directly with money** (IAP, consumable) — flavour-coherent: someone is
   sponsoring your equipment, not printing your glory. This replaces the old doc's
   "coin packs"; **Glory is never sold**.

Decisions locked 2026-08-09:

- **Name: "Writ"** — an official licence to bear arms in the arena. Short enough for
  UI ("UNLOCK — 1 WRIT"). (Two-type names *Writ of Steel* / *Writ of Sand* were
  considered and retired with the next decision.)
- **One universal type, not weapon/spell variants** — a player can never hold the
  *wrong* voucher (the no-stranded-remainders hygiene rule from monetisation.md).
  A pricing lever survives anyway: a future item may cost 2 Writs if it ever must.
- **Launch lock policy: all current content stays free** (the full weapon + spell
  roster as of today). The **Trident is deed-gated** (the Sand snake, 5 ranked wins)
  and is **never Writ-purchasable** — Writs cannot buy secret items. Post-launch
  weapons/spells ship Writ-locked by default (per-item call at design time).
  Consequence, stated honestly: **nothing is Writ-purchasable on day one** — the Writ
  economy activates with the first post-launch content drop; the day-one shelf is
  cosmetic (announcer packs, below).

## Two gate kinds (extends GATED_ITEMS)

The trident work built one registry the wizard, server validator, and bots all read.
It grows a `gate` field:

| | `deed` (secret items) | `writ` (store items) |
| --- | --- | --- |
| wizard/codex visibility | **hidden until owned** — a secret doesn't exist until it's yours | **always visible**, locked frame + unlock CTA — impulse buying requires visibility |
| how it unlocks | achievement reward → entitlement row | Writ spend → entitlement row |
| practice mode | hidden until earned | **fully usable, free** — pay-to-learn stays defused, and practice is the try-before-buy funnel |
| example | Trident | first post-launch weapon |

Both kinds resolve to the **same entitlement rows** (`weapon:<id>` / `ability:<id>`)
and the same client entitlement cache + ranked-seat validation built for M5. The store
is a second *writer*, not a second system.

## Where the store lives — three surfaces, one system

### 1. The Armory (working name — Tom's naming pass owed)

The browse-freely home, entered from the **title screen** and by **tapping the Glory
pill** (currency links to what it buys). Reuses the Arming wizard's card DNA
(`loadout/catalogue.ts`: big icon, flavour quote, roster-normalised stat bars) — so it
doubles as the codex for free. Per card:

- Owned → owned state. Writ-locked → **UNLOCK — 1 WRIT** CTA. Deed-gated → absent
  until earned (secrets rule).
- **TRY IT** on every card — deep-links into practice with that item pre-picked.
  Practice-allows-everything makes the shop a test-range door; the funnel is
  browse → try → want → unlock.
- Writ balance shown beside the Glory pill; **buy Writs here** (with Glory, or the
  IAP packs). This is the **only surface with real-money IAP**.
- A **cosmetics shelf** (announcer packs first — below).

### 2. The Arming wizard — the impulse point

- Writ-locked items appear **in place, alphabetically, in the normal carousels** with
  a locked frame — every arming pass shows the full roster (deed-gated items stay
  hidden as built).
- On a locked card, CHOOSE becomes **UNLOCK — 1 WRIT** → one sheet showing the Writ
  balance:
  - has a Writ → one tap spends it;
  - no Writ but enough Glory → the same sheet does Glory→Writ→unlock in **one tap**
    (the exchange is an implementation detail, not a two-step chore);
  - neither → points at the Armory. **No IAP inside the wizard** — the Apple purchase
    sheet is slow and clunky under a lobby countdown; Glory-denominated spends only.
- After unlocking, the icon does the **normal fly-to-socket** — the purchase *becomes*
  the pick. Purchase is an API round-trip; on failure nothing is charged and the card
  stays locked (picks are editable through the countdown, so timing is safe).

### 3. Practice / codex surfaces

Writ-locked items are fully usable in practice and fully readable everywhere —
the unlock gates **matchmade use only** (standing rule from monetisation.md).

## Persistence & API (design-ahead; shapes only)

- **`writ_ledger`** mirrors `glory_ledger` exactly (signed amounts, open `source`
  namespace, unique idempotency key). Balance = `SUM(amount)`. Writs from promos,
  deeds, or compensation are just new source strings — same future-proofing as Glory.
- `GET /wallet` grows to `{ glory, writs }`.
- `POST /store/exchange` — debit Glory, credit Writ, **one atomic transaction**,
  price read server-side (never trusted from the client).
- `POST /store/unlock` — debit 1 Writ + insert the entitlement row, atomic;
  idempotency key `unlock:<playerId>:<itemId>` (double-taps can't double-spend;
  already-owned is a no-op success).
- `POST /store/iap` — Apple/Google receipt validation server-side → Writ credit with
  the store transaction id as the idempotency key.
- **Enforcement posture unchanged from secret items:** ranked seats validate
  entitlements via accountId; skirmish/practice trust the client (modded-client friend
  lobbies are not our war — revisit only if casual rooms ever carry accountId).

## Bots

The standing rule from bits-secret-items.md — **bots never draft gated items,
permanently** — extends to Writ-locked content unchanged. Same payoffs: zero bot
cast-rule/archetype/tuning tax on store content forever, and a locked item in an
opponent's hands stays a humanity proof.

## Announcer packs — the first shelf

With arms free at launch, the day-one sellable is cosmetic. Announcer packs are
recorded (Eliza Nightshade), wired room-wide (protocol v18), and explicitly waiting on
"until the store exists" — the Armory is that store. Packs become entitlements
(`announcer:<id>`) validated like everything else, closing the any-client-can-claim
hole. **Open:** whether packs price in Glory, direct IAP, or both — decide with the
IAP pack sizing (Writs are for *arms*; cosmetics need not share the currency).

## Build milestones (proposed, not committed)

1. **S1 — Writ wallet + wizard unlock UX**: `writ_ledger`, exchange + unlock
   endpoints, wizard locked-card flow, `gate: "writ"` support. Ships dormant (no
   writ items exist yet) but fully testable behind the dev menu.
2. **S2 — IAP**: receipt validation, Writ packs (honest sizing — no stranded
   remainders), account-linking nudge after first purchase (per glory-economy.md).
3. **S3 — the Armory screen**: browse/codex + TRY IT + cosmetics shelf + announcer
   entitlements.
4. **First post-launch weapon/spell drop** ships `gate: "writ"` and turns the
   economy on.

New-content tax additions when built: unlock-stamp + Writ-purchase SFX via Asset
Forge (consult [bits-audio.md](./bits-audio.md), add to the done-tick checklist),
Writ icon art per [bits-art-style.md](./bits-art-style.md).

## Open questions (deliberately undecided)

- **Names:** "Armory" is a working name (desert-arena alternatives welcome — the
  Bazaar? the Quartermaster?); Writ display flourish ("Arena Writ"?) — Tom's pass.
- **Numbers:** Glory price of a Writ (price against retention data, server-side),
  IAP pack sizes/prices, announcer pack pricing model.
- **Policy:** do post-launch items *always* ship Writ-locked, or is free-drop an
  option for community-goodwill moments?
