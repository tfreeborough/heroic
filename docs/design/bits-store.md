# BITS — Writs & the Armory (the store)

Status: **designed 2026-08-09 · S1 (Writ wallet + store endpoints + dev tools) BUILT
same day · S4 launch shelf (7 items, bits-store-arms.md) BUILT 08-09→08-14 ·
S2 (the Armory screen) BUILT 2026-08-15** — IAP (S3) owed for the end-of-August
launch, plus TRY IT deep-link, forge art/SFX, on-device pass ·
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
(`loadout/catalogue.ts`: big icon, flavour quote, roster-normalised stat bars).
**Amended on Tom's device pass (2026-08-15): a storefront, not a codex — owned
items don't appear at all** (the original design listed them as an owned-state
codex; in hand it muddied "this is a store", and owned steel already lives in
the War Table). Sold items simply leave the racks; the stock sits in two
trades, **STEEL** (weapons) and **SORCERY** (spells) — "The Shelf" as a
player-facing label was rejected as boring. Per card:

- Writ-locked → **UNLOCK — 1 WRIT** CTA. Deed-gated and owned → absent.
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
2. **S2 — the Armory screen — BUILT 2026-08-15** (`ArmoryScreen.tsx`). As built:
   two doors (home-screen ARMORY button; the mode-select Glory pill is now
   tappable — back retraces whichever door was used); header purse shows Glory
   AND Writs (the Writ mark = a wax dot in a gold ring); **featured hero**
   rotates daily through the unowned shelf (icon-anchored card until forge hero
   art lands); the stock in two trades — **STEEL** and **SORCERY** — as
   unowned writ items only, plus a **STRIKE A WRIT** chip on the counter row
   (banks one for Glory, `writExchange` SFX). Device pass 2026-08-15: the
   original THE SHELF + YOUR ARSENAL layout was cut (owned items gone —
   storefront, not codex), the tile became the **extracted shared
   `loadout/ItemTile.tsx`** (the War Table's exact Skia-band tile, both
   screens import it — my hand-copied approximation had a visibly thicker
   band), and safe-area padding moved to the ROOT view so scrolling content
   never slides under the Android system tray. The sheet reuses the War
   Table's card body via shared `loadout/CodexBody.tsx` (one codex, two
   doors — ItemTile is the tile half of the same rule).
   **Second device pass (Tom, 2026-08-15) — the WRIT FORGE:** the sheet's
   one-tap Glory→Writ→unlock path was CUT — mixing "1 WRIT" on cards with
   "EARN N MORE GLORY" on the CTA muddied what a Writ even was. New rule:
   **the Armory speaks Writs only; Glory and Writs meet on exactly one
   surface — the Writ Forge**, a dedicated modal (rate row `800 GLORY → 1
   WRIT`, both balances, a stamp-strike animation per forge, `writExchange`
   SFX + medium haptic) opened by a solid-gold **FORGE WRITS** button on the
   counter row and by the sheet's CTA (`FORGE A WRIT` when writless — the
   forge opens OVER the sheet, so closing lands back on the item with the
   Writ in hand and the CTA flipped to BREAK THE SEAL). `unlock` now spends
   held Writs only. Also fixed: both bottom sheets (Armory + War Table
   codex) now carry `insets.bottom` inside their padding — CTAs never sit
   under gesture-nav chrome. **Third pass (Tom, 2026-08-15) — sheet
   behaviours, shared in `components/sheetGestures.ts`:** the handle now
   drags for real (`useSheetDrag`: vertical pull follows the finger, past
   110px or a flick dismisses, short pulls spring back; grab zone = handle +
   header; the drag exit removes the sheet INSTANTLY so the close animation
   never replays), and **Android back closes the topmost overlay instead of
   navigating** (`useBackClose`: BackHandler runs listeners newest-first, so
   overlays subscribed on mount outrank App.tsx's navigation handler, and a
   forge stacked over a sheet outranks the sheet; the handler rides a ref —
   re-subscribing on re-render would shuffle the stacking order). Wired on:
   both codex sheets, the Writ Forge, and the ceremony (back = tap there).
   **Fourth pass (Tom, 2026-08-15) — the forge-effects pass, BUILT
   (`WritForge.tsx`, its own file):** the tap-to-exchange was "super
   underwhelming"; the conversion is now a **hold-to-forge ritual**. HOLD
   the button: the charge fills it under the thumb (850ms), heat blooms
   behind the seal (real Skia blur, the EmberGlow recipe), the wax runs
   molten, haptic ticks climb at 30/55/80% — release early and it cools,
   nothing spent. At full charge **THE STRIKE falls**: stamp ring slams
   with a 12-dart spark burst and a shockwave, `writExchange` +
   crit-weight haptic, the Glory count visibly DRAINS (rAF ease-out), and
   the finished Writ card **flies down onto a fanned stack of sealed
   documents** — every forge visibly grows the pile, the do-it-again hook.
   The strike is optimistic: the ~300ms server round-trip hides inside the
   480ms slam; a refused forge says so in place, nothing charged. Commerce
   stayed in ArmoryScreen (pure, silent, ok/insufficient/unavailable); the
   ritual owns all presentation. Both store clips FORGED + wired same day
   (`writ_exchange_1` / `writ_unlock_1`; the seal-break brief was rejigged
   to concrete crackable sources — "wax seal cracking" alone has no audio
   anchor and generated mush).
   **Fifth pass (Tom, 2026-08-15) — forge polish:** the hold now ticks the
   **Glory readout down live** (drains against a press-frozen baseline —
   phase-clamped so the server debit landing mid-ritual can never
   double-dip; the number is continuous through strike and cool-down, and
   refills on an early release) while **red Glory diamonds stream from the
   purse into the seal** (six loopers, per-diamond period/delay so the
   stream drifts organically); the heat bloom's canvas grew to 320px with
   the glow tails well inside it (a gaussian clipped at the canvas edge
   reads SQUARE once scaled — the reported bug); the hold button's fill
   carries its own radius inset past the border (Android's overflow clip is
   unreliable on rounded bordered parents — square corners + edge gaps);
   and the whole screen gained an **SkSL ember field**
   (`forgeEmbers.tsx`, the dustStorm discipline: UI-thread clock, half-res
   raster, zero JS per frame) — a rising drift of embers that the held
   charge visibly stokes (faster, brighter, extra embers wake).
   **expo-gl was considered and rejected**: not installed, needs a
   dev-client rebuild, and Skia already IS the GPU path — SkSL delivers
   the particles with zero new native modules. Plus **chain-forging**: a
   button still held when the Writ lands auto-begins the next charge — the
   full rhythm is hold 850ms → strike → the card flies (~0.9s) → recharge,
   about 2s per Writ held; the chain breaks on release, an empty purse, or
   any refused forge (failures always require a fresh press, so an offline
   ledger can never machine-gun error strikes). The sheet's ONE CTA
   is honestly worded per purse state: BREAK THE SEAL — 1 WRIT / UNLOCK — 800
   GLORY (exchange+unlock in one tap) / EARN N MORE GLORY (ghosted) / CONNECT
   TO UNLOCK; plus the free-in-practice note, and failure notices that always
   say what was and wasn't charged (a banked-but-unspent Writ says so). The
   **seal-break ceremony**: deed-ceremony DNA (700ms staged reveal, min-dwell,
   tap-snaps), the wax seal parts in halves as the item pops through, heavy
   haptic + `writUnlock`. Client plumbing: `fetchStore`/`storeExchange`/
   `storeUnlock` (discriminated insufficient-vs-unavailable) + `mintPurchaseKey`
   per tap in api.ts, `grantEntitlement` fold-in so the War Table shows the buy
   in the next lobby, `writExchange`/`writUnlock` catalogue events (stand-ins:
   glory_earned_1 / deed_unlock_1 with forge briefs in place), dev-menu RESET
   PURCHASES row. Verified: client typecheck + live curl of every commerce path
   against the stocked 7-item shelf. **Owed**: TRY IT practice deep-link (needs
   a preset-loadout param through PracticeClient/RoomScreen), forge hero art +
   writ_exchange/writ_unlock clips, cosmetics/announcer shelf (with S3),
   on-device pass.
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
