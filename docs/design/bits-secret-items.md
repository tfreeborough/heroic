# BITS — secret items (M5) & the Trident

Status: **designed 2026-08-09 with Tom · BUILT same day** (all tests green;
protocol now v20; trident icon is a harpoon stand-in + `hit_trident` clip
owed — both briefed for the next Forge session; Tom's naming pass owed on
the rounds-trident chain placeholders) ·
Companion to [achievements.md](./achievements.md) (§ secret items — the
reveal/entitlement rules), [pvp-arena.md](./pvp-arena.md) (weapon roster),
[pvp-loadout-flow.md](./pvp-loadout-flow.md) (the arming wizard),
[bot-brains.md](./bot-brains.md) (archetypes), and
[bits-art-style.md](./bits-art-style.md) (icon language).

> M5's job is the SYSTEM — items that exist only behind deeds — proven by
> ONE weapon players earn early enough to learn the lesson: the Chronicle
> pays out steel, not just titles. Tom's calls (2026-08-09): the host deed
> is **The Sand snake** (5 ranked wins — the carrot at the top of the first
> ladder, and one more reason to queue ranked), and the item is the
> **Trident**.

## The teaching beat

Five ranked wins is session-two or session-three for most players — early
enough that the lesson lands, late enough to be EARNED. Reward secrecy is
already built: frontier deeds show their title only, so nobody knows a
weapon is coming until the ceremony card flips and reads "Unlocked
'Trident'". Rewards stack, so the Sand snake pays its wearable title AND
the weapon in one card.

## The Trident — reach melee (the retiarius thrust)

The roster's 2×2 had a hole: fast melee (blade), heavy melee (hammer),
auto ranged (bow), magic ranged (staff) — nothing plays the SPACING game.
The trident is a head on a long shaft: the longest melee reach in the
game, but **only the head bites** (Tom's band rework, 2026-08-09 — "a
trident is really only dangerous at the end"). `attack.minReach: 115`
floats the hit region off the wielder into a band from 115 to 180px
(160/95 at first; Tom sized the range up same-day, same 65px head) — a
floating segment at the end of the reach, not a long thin cone. Hold them
at the tip and every poke lands; let them inside the prongs and the
weapon cannot touch them at all.

Numbers after the band rework (2026-08-09; supersedes the first device
pass):

| | blade | hammer | **trident** |
| --- | --- | --- | --- |
| shape | arc | arc | **arc BAND + TRAVELLING front** |
| reach | 90 | 125 | **180, minReach 115** |
| arcWidth | 40° | 90° | **26°** (18° read as a sliver once band-only) |
| windup | 0.25 | 0.65 | **0.35** (a snap-jab) |
| recovery | 0.55 | 0.75 | **0.70** |
| knockback | 100 | 0 | **480** (a real launch — stab, shove, reposition) |
| attack stat | base | +19 | **+15** |
| riders | bleed 35% | slow 1.5s | **40% slow 1s + GUARANTEED bleed 1dmg × 0.5s × 6s (refresh-not-stack)** |

- **The band** (`attack.minReach`, core `hitsInArc`): both range tests are
  generous to the attacker — any body OVERLAP with the band counts, so
  the dead zone ends where the victim's far edge crosses 115px. The sim's
  swing gate mirrors it: a target inside the prongs never even starts a
  windup. Render: the windup telegraph and strike draw as an annular
  segment (honest to the hitbox), the strike rakes three tine lines across
  the band (the pronged head), and your own range ring gains an inner
  circle marking the dead-zone edge.
- **The thrust TRAVELS** (`attack.thrustDuration: 0.15`): the hit front
  expands from the wielder to full reach over 0.15s and only bites once it
  crosses into the band — the point visibly runs out through the harmless
  shaft-zone. Close-in-band bodies are struck before far ones, each
  exactly once. Sim: `resolveArcStrike` + per-player
  `thrustLeft`/`thrustHits` (sim-only, nothing on the wire).
- **Riders re-cut for the band** (pokes are harder to land, so a landed
  one must matter): the slow is a real 40% snare for 1s — combined with
  knockback 480 the poke shoves them back out past your preferred range AND
  pins them there, setting up the next poke. The bleed is guaranteed — a
  12-tick drip (1 dmg every 0.5s for 6s, 12 total) that REFRESHES on
  re-poke instead of stacking (`BleedConfig.refresh`; the blade's bleeds
  still stack).
- engagementRadius = reach + 160 (melee convention).
- Counterplay: dash i-frames through the travelling front — and dash's
  75px hop carries you from max range INSIDE the band, where the trident
  is completely harmless; blade and hammer both out-trade it in close.
- **Bots never wield it**: the FREE-roster rule (config.ts
  `FREE_WEAPON_IDS`, "an earned item in hand is proof of humanity") — the
  band rework fixed two leaks (ranked backfill arming + practice bots
  drafted from the full roster) and the brains hold no trident band
  anyway. If trident bots ever come, they need a band brain first
  (bot-brains.md).

## Entitlement plumbing (the M5 system)

- **Namespace**: gated items are entitlements `weapon:<id>` / `ability:<id>`
  (titles already own `title:<id>`). The Sand snake's rewards become
  `[{ kind: "title" }, { kind: "entitlement", itemId: "weapon:trident" }]` —
  the server's existing award path grants the row; `/achievements/me`
  already serves it.
- **GATED_ITEMS** (sim): the registry of which roster ids are
  achievement-gated — the single source the wizard, the server validator,
  and the bots all read. Everything not listed stays free forever.
- **ITEM_NAMES registry** (sim): itemId → display name ("weapon:trident" →
  "Trident"), retiring `humanizeItemId`. Codex reward lines and the
  ceremony card read it; unknown ids fall back to the kebab-case
  humaniser (a newer server's content).
- **Client**: a module-global entitlement set (the worn-title pattern) —
  warmed at boot from `/achievements/me`, refreshed when `deedUnlocks`
  land, persisted in AsyncStorage so the wizard works offline-after-first-
  fetch. The wizard's weapon row shows gated items ONLY when entitled —
  hidden, never greyed: a secret doesn't exist until it's yours.
- **Server validation**: ranked seats have accountId — setWeapon/
  setAbilities reject gated picks the account isn't entitled to (silent
  ignore, the titles posture). Skirmish/practice trust the client (same
  stance as titles/announcers; cosmetically-modded friends lobbies are
  not our war).

## Bots — base roster only, PERMANENTLY *(Tom, 2026-08-09)*

**Bots never draft gated items — not in v1, not later.** Bots use the
default weapons/abilities only, as a standing rule. Consequences, all
good ones:
- No bot cast rules, no archetype work, no bot tuning EVER for gated
  items — the new-content tax for secrets shrinks for good (the
  "bots must use it credibly" rule in achievements.md § secret items is
  hereby overridden for gated items).
- A gated item in an opponent's hands is a HUMANITY PROOF — bots can't
  hold one, so the flex is real.
- The accepted tell: a disguised ranked bot can never flash earned steel.
  Invisible at our volumes; the simplicity is worth it.
Bots still FIGHT gated items with existing generic logic (engagement
radius drives melee spacing; nothing weapon-specific needed).
`deriveArchetype` needs only a safe default bucket for opponents' sake —
never a dedicated archetype.

## Rollout — this one bumps the protocol

Unlike titles/deeds (additive), a new weapon id is NOT old-client-safe:
shipped bundles index WEAPONS[weapon] straight off snapshots — an unknown
id crashes them. So: **PROTOCOL_VERSION 19 → 20**, one coordinated ship
(server + API deploy, then the EAS update; the existing mismatch screen
walks stragglers through updating). Entitlements make the order forgiving:
nobody CAN wield it until the server grants the first rows.

## The new-content tax (all owed with the build)

- `rounds-trident` deed chain in defs.ts (the coverage test refuses to
  ship a weapon without one) + chapter home + board positions.
- Forge: loadout icon row auto-derives from the WEAPONS table; needs a
  styleBible subject (trident head — single bold object) + Tom forges.
- Audio: `hit_trident` impact bank row + brief (catalogue WEAPON_IMPACTS);
  melee weapons have no fire sound. Clip owed = silent until forged.
- Wizard weapon card + practice loadout picker read GATED_ITEMS.
- Tests: gating (unentitled pick ignored in ranked), wizard visibility,
  registry names, trident combat maths ride the existing weapon suites.
