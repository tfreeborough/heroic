# Blood in the Sand — Monetisation

Status: **designed 2026-07-12 — NOT built** (post-launch work; needs accounts/DB/IAP infra) ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-07-12

> Records the 2026-07-12 discussion so the economy has a written shape before any of it is
> built. Guiding principle (Tom): **never a flat paid advantage** — competitive integrity is
> the product. Money buys impatience or appearance, never power.

## The model

One earnable currency (coins), earned from playing and winning matches, spendable on:

- **Weapons & abilities** — *sidegrades, not upgrades*: new decision space, not more power.
  Always earnable by playing at generous rates; coin packs purchasable for the impatient.
  Rule that keeps this honest: **Practice mode can use every weapon, including locked ones**
  — the unlock gates matchmade use, the knowledge is free (defuses "pay-to-learn").
- **Cosmetics** (best margin, zero balance cost — must be visible to other players):
  - **Blood colour** — thematically perfect. Constraint: blood trails are information
    (you can track a wounded player), so vary hue only — visibility/contrast stays fixed.
  - **Kill signatures** — attach to the existing death blood-cone / 2× death burst.
  - Weapon skins/trails, name-tag styles, victory celebrations, emotes.

**Hygiene rules:** no loot boxes / randomised purchases (regulatory + trust). Single
currency, honest pack sizing (no stranded-remainder pricing). Prices in coins, coins in
packs, that's it.

## Accounts

- **No signup, ever required.** A silent anonymous player ID is created on first launch
  (iOS: Keychain, survives reinstall; Android has no equivalent — device-bound), registered
  with the server. Coins earn and spend against a **server-authoritative wallet**.
- IAP needs no email: billing is Apple/Google's; our server only validates receipts
  (server-side, always — never trust the client about a balance).
- **Account linking is insurance, not a gate**: an optional "secure your account"
  (email/Apple/Google) prompt — nudged after a first purchase — for cross-device and
  device-loss recovery. Coin packs are consumables, so store-level "restore purchases"
  will NOT recover them; linking is our answer.
- Apple rule to remember: offering any third-party login requires Sign in with Apple.

## Balance posture (what selling weapons commits us to)

- **Soft counters only** (~60/40 matchup edges, never invalidation) — one-life rounds make
  hard counters miserable. Counters express through the
  [pick ceremony](./pvp-pick-ceremony.md) (built 2026-07-12).
- **Log per-weapon pick rate + win rate at match end from day one** — the server sim makes
  this a few counters. High win + high pick = overtuned; community feedback surfaces
  *feel* problems, data decides.
- **Keep tuning numbers server-side** so balance patches don't wait on app review.

## Sequencing

Ship and validate the game first; the wallet/accounts/IAP backend is its own milestone
(the server is deliberately in-memory/no-DB today). Design the earn rates when there's
retention data to price against.
