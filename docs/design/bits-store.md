# BITS — Writs & the Armory (the store)

Status: **designed 2026-08-09 · S1 (Writ wallet + store endpoints + dev tools) BUILT
same day** — Armory screen (S2), IAP (S3), content drops (S4) owed for the
end-of-August launch ·
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
- **Launch lock policy: all *current* content stays free** (the full weapon + spell
  roster as of today). The **Trident is deed-gated** (the Sand snake, 5 ranked wins)
  and is **never Writ-purchasable** — Writs cannot buy secret items. New
  weapons/spells ship Writ-locked by default (per-item call at design time) — and
  **Tom is adding several new weapons + spells before launch (2026-08-09)**, so the
  Writ shelf is stocked on day one; announcer packs (below) join it as the cosmetic
  shelf.

## Pricing *(decided 2026-08-09; exact figures proposed, Tom to ratify)*

- **Single Writ: $1.89 — DECIDED (Tom, 2026-08-09).** Impulse-tier ($2.99 rejected
  as too expensive); the .89 ending visibly breaks from the .99 wall, which suits
  the no-hustle posture. ⚠ Context: Apple sells only from ~900 fixed price points
  ($0.10 steps under $10, all ending in 9 on the US storefront) — Tom's first
  instinct ($1.85) doesn't exist; $1.89 is the nearest. Google Play mirrors it.
- **Steep bundle ladder** (Tom, 2026-08-09). Writs are integral units so bundles
  can never strand a remainder, and surplus Writs bank against future drops.
  Proposed at a $1.89 single: **3 for $4.49** (~21% off) · **6 for $7.99** (~30%
  off). Steep is acceptable here *because* the single stays impulse-priced — it's
  a real product, not a decoy.
- **Glory grind target: ~4–5 hours of casual play per Writ** (decided — roughly a
  week of casual sessions; genuinely generous vs the 10–20h norm in comparable
  F2P PvP). The actual Glory number is **derived from earn rates server-side at
  tuning time and re-derived whenever rates change** — the number is never the
  commitment, the time is.

## Two gate kinds (extends GATED_ITEMS)

The trident work built one registry the wizard, server validator, and bots all read.
It grows a `gate` field:

| | `deed` (secret items) | `writ` (store items) |
| --- | --- | --- |
| Arming wizard | **hidden until owned** — a secret doesn't exist until it's yours | **hidden until owned** (Tom, 2026-08-09 — see wizard section: locked cards would swamp the carousels as the roster grows) |
| the Armory | absent until earned | **always visible**, locked frame + unlock CTA |
| how it unlocks | achievement reward → entitlement row | Writ spend → entitlement row |
| practice mode | hidden until earned | **fully usable, free** — pay-to-learn stays defused, and practice is the try-before-buy funnel |
| example | Trident | the pre-launch weapon/spell drops |

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

### 2. The Arming wizard — owned items only *(Tom, 2026-08-09)*

The first design put locked cards in the wizard carousels as the impulse point.
**Rejected**: as the purchasable roster grows, a new player's loadout picker becomes
a wall of locks — awful first touch, and it fights the casual-first premium lobby.
The wizard shows **what you own, nothing else** (mechanically identical to the
deed-gate rule already built — locked means absent). Consequences:

- **The Armory is the sole conversion surface** — all discovery, desire, and
  purchase happen there, which is also what justifies its premium bar (below).
- The wizard stays clean forever, at any roster size.
- Open option (decide at build, cheap either way): a single slim **"MORE IN THE
  ARMORY →" tail card** at the end of each carousel — one doorway, not N locks —
  as a discovery breadcrumb without the clutter.
- The one-sheet unlock flow (Writ balance → spend, or Glory→Writ→unlock in one tap;
  never IAP mid-lobby) still exists — it just lives on Armory cards instead of
  wizard cards.

### 3. Practice / codex surfaces

Writ-locked items are fully usable in practice and fully readable everywhere —
the unlock gates **matchmade use only** (standing rule from monetisation.md).

## The bar: SUPER PREMIUM *(Tom, 2026-08-09)*

> "This is what is going to make or break this game and my ability to sustain my
> business off it." The Armory is not a menu with prices — it is the game's flagship
> screen, held to at least the Arming wizard's production standard.

What premium means here, concretely:

- **Curation over catalogue.** A rotating **featured hero** — one item, full-bleed
  forged scene art (the mode-card treatment: 900×360, right-anchored crop, per
  [bits-art-style.md](./bits-art-style.md)) — above clean, uncrowded rows. Premium
  is the absence of visual noise, not the presence of badges.
- **The unlock ceremony.** A Writ is a wax-sealed document: spending one **breaks
  the seal** — dedicated animation, heavy haptic, forged SFX — then the item card
  flips in ceremony-DNA style (the deed ceremony / ARMED-moment stamp language
  already built). Buying must *feel* like a moment, because the moment is the
  product.
- **Motion quality.** 60fps snap carousels (wizard DNA), parallax on hero art,
  skeleton states instead of spinners, nothing that stutters. The store shares the
  UI thread with nothing heavy — it's a menu screen, there is no excuse.
- **Trust reads premium.** No fake discounts, no countdown-pressure timers, no
  "BEST VALUE!!" badge spam — extends the existing hygiene rules (no loot boxes,
  honest pack sizing). A store that doesn't hustle you is what premium feels like.
- **Voice (option, decide later):** the announcer system could give the Armory a
  barker/quartermaster voice line on entry or on the featured item — the flex
  economy already proved VO sells.
- **Art tax accepted:** every store item needs hero/scene art beyond its loadout
  icon — a styleBible subject + forge session per item joins the new-content
  checklist.

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

## Announcer packs — the cosmetic shelf

Announcer packs are recorded (Eliza Nightshade), wired room-wide (protocol v18), and
were explicitly waiting on "until the store exists" — the Armory is that store. Packs
become entitlements (`announcer:<id>`) validated like everything else, closing the
any-client-can-claim hole. **Open:** whether packs price in Glory, direct IAP, or
both — decide with the IAP pack sizing (Writs are for *arms*; cosmetics need not
share the currency).

## Deferred: the Charter *(Tom, 2026-08-09 — not at launch)*

A **premium one-time purchase granting every current and future Writ-gated item** —
Tom's "never run out of Writs" idea, Brawlhalla All-Legends-Pack precedent, deferred
because **it's pointless with a small catalogue**: all-access has to mean access to
a lot. Revisit when the purchasable roster is deep enough (rough trigger: when the
catalogue's total Writ value comfortably exceeds the Charter price). Design rules
already agreed, so pick-up is cheap:

- Implemented as a **non-consumable entitlement flag**, NOT a 9999-Writ balance —
  store-level Restore Purchases then just works (unlike consumable Writ packs,
  whose recovery story is account linking), and future items are covered without
  ever touching a balance.
- **Never includes deed-gated items** — the Trident is earned by everyone, Charter
  or not. Arms only; cosmetics (announcer packs) stay separate.
- Charter holders see no Writ CTAs anywhere — the Armory renders their catalogue
  as owned/claimable.
- Proposed **$24.99** (priced as patronage, not arithmetic); name "Charter" = the
  document family above a Writ (a Writ licenses one arm, a Charter licenses them
  all, in perpetuity). Accepted trade-off: caps a player's lifetime *arms* revenue.

## Deferred: renting *(Tom's idea, 2026-08-09 — explicitly not now)*

Rent a Writ-locked weapon/spell **for a single ranked match** for a small Glory fee
(~25 Glory floated). Why it's promising: it monetises curiosity, gives locked items
real matchmade exposure (rented steel in a lobby is an advert), and repeated rents
make buying the Writ feel obviously sensible — a conversion ramp, not a substitute.
Design notes for whenever it's picked up: it's a **per-match entitlement** (grant
with a one-match TTL or a `rented:<matchId>` scope — the ranked seat validator is
the enforcement point that makes this trivially safe), Glory-priced only (never
money — money buys permanence), and the rent price must stay well below the
Glory→Writ rate so it never becomes the rational permanent path.

## Build milestones (proposed, not committed)

1. **S1 — Writ wallet + unlock plumbing — BUILT 2026-08-09.** As built:
   `writ_ledger` mirrors the Glory ledger (persistence `writs.ts`); `store.ts`
   owns the spend paths with the balance guard INSIDE the debit SQL (`INSERT …
   SELECT … WHERE balance ≥ price`, one batch = one transaction) because the API
   is a second writer process racing the game server — the old pre-check-then-batch
   idiom isn't safe for debits. Unlock's debit key is the deterministic
   `unlock:<playerId>:<itemId>` (a player can never pay twice for one item, under
   any retry/race), exchange keys are client-minted per tap, and a deed-owned item
   is refused before any Writ moves. Endpoints: `/wallet` → `{ glory, writs }`,
   `GET /store` → `{ writGloryPrice, writItems }` (price from `WRIT_GLORY_PRICE`
   env, default **800** ≈ the 4–5h target at ~14 Glory/match), `/store/exchange`,
   `/store/unlock` (refuses non-writ ids — deed items are never purchasable),
   dev-only `/dev/grant` + `/dev/reset-purchases` behind `STORE_DEV_TOOLS=1`.
   Sim: `items.ts` split into `DEED_*`/`WRIT_*` sets with `GATED_*` unions (all
   existing readers unchanged) + `WRIT_ITEM_IDS` shelf. Client: `fetchWallet`/
   `devGrant` in `api.ts`, dev-menu WALLET readout (tap = refresh) + GRANT 500
   GLORY / GRANT 1 WRIT rows (inert against a prod API). Verified: 9 store
   money-math tests + full persistence/sim/server suites + a live curl smoke of
   every endpoint path incl. idempotent retry.
2. **S2 — the Armory screen at the premium bar**: featured hero + browse/codex +
   TRY IT + seal-break unlock ceremony + cosmetics shelf + announcer entitlements.
3. **S3 — IAP**: receipt validation, Writ packs (honest sizing — no stranded
   remainders), account-linking nudge after first purchase (per glory-economy.md).
4. **Pre-launch content drops** ship `gate: "writ"` and stock the shelf for day
   one. (All four are launch-blocking if the store is to make money in August.)

## Testing the store without being charged *(Tom, 2026-08-09)*

Three tiers, cheapest first — most store testing never involves money at all:

1. **Dev-menu ledger grants** (the existing 5-tap secret dev menu is the home):
   GRANT 500 GLORY / GRANT WRIT / RESET ENTITLEMENTS buttons hitting dev-only API
   endpoints (ledger rows with `source: "dev-grant"`; endpoints refuse to exist
   unless a `STORE_DEV_TOOLS` env flag is set — never in prod). This exercises the
   entire Glory→Writ→unlock flow, the one-sheet UX, and the seal-break ceremony —
   no store account anywhere.
2. **Mock IAP path** behind the same env flag: the client's buy button skips the
   native store sheet and posts a fake receipt the API accepts only in dev — full
   end-to-end (button → credit → balance refresh) against the local API, works in
   Expo Go/dev client before any IAP native module exists.
3. **Store sandbox** for the real sheet: Apple Sandbox tester accounts (App Store
   Connect → Users → Sandbox) and Google Play licence testers — the genuine
   purchase UI with no charge; TestFlight builds also bill against sandbox. The
   API's receipt validator checks the sandbox endpoint when the receipt says so.
   ⚠ The IAP native module (react-native-iap or RevenueCat — decide at S3) is a
   **dev-client rebuild**, same as expo-secure-store was.

New-content tax additions when built: unlock-stamp + Writ-purchase SFX via Asset
Forge (consult [bits-audio.md](./bits-audio.md), add to the done-tick checklist),
Writ icon art per [bits-art-style.md](./bits-art-style.md).

## Open questions (deliberately undecided)

- **Names:** "Armory" is a working name (desert-arena alternatives welcome — the
  Bazaar? the Quartermaster?); Writ display flourish ("Arena Writ"?) — Tom's pass.
- **Numbers to ratify:** exact bundle ladder (3/$4.49 · 6/$7.99 proposed), announcer
  pack pricing model.
- **Policy:** do post-launch items *always* ship Writ-locked, or is free-drop an
  option for community-goodwill moments?
- **Wizard tail card:** ship the single "MORE IN THE ARMORY →" carousel tail card,
  or keep the wizard doorless? Decide on device at build.
- **Renting** (deferred section above): revisit once the store has real purchase
  data.
