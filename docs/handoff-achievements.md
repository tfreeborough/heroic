# Hand-off — Achievements / Deeds system (2026-08-06)

Context for continuing the achievements ("Deeds") work in a fresh session.
Full design + decision history: `docs/design/achievements.md` (the design
doc, kept current) and the auto-memory file `achievements-design`. This doc
is the working snapshot: what exists, where it lives, what's decided, and
what's next.

## What's built and verified (all tests green, all 11 workspaces typecheck)

**M1 — server-authoritative awards (2026-08-03).**
- `packages/achievements` — pure shared engine: `AchievementDef<S>`,
  `evaluate()` (milestone crossing `old < t ≤ new` fires once; feats filter
  vs unlocked set; board `accepts` gate fails closed), `milestoneChain()`
  tier builder, `streakUpdates()` (current/best), `visibility()` frontier.
  No RN/DB imports at the ROOT — servers import it. RN lives behind the
  `./map` subpath export only.
- `packages/blood-in-the-sand-sim/src/achievements/` — `MatchStatsAccumulator`
  (fed each step with EXACTLY what `stepSim` returned — never
  `Room.eventBuffer`, which persists across steps until snapshot flush),
  `counterDeltas()`, `ACHIEVEMENT_DEFS` (~90 deeds, Tom's final titles),
  `ACHIEVEMENT_BOARDS` (ranked board, `accepts: s.ranked`),
  `ACHIEVEMENT_CHAPTERS` (codex reading order, content-owned).
- `packages/blood-in-the-sand-persistence/src/achievements.ts` — tables
  `achievement_unlocks` / `achievement_counters` /
  `achievement_progress_marks` (the per-(match,player) double-count guard)
  / `entitlements` (shared with the future store; titles land here as
  `title:<deed-id>` rows). `applyMatchAchievements()` = one idempotent
  batch. `gloryEarned()` = SUM of positive ledger rows (never balance).
- Server: `RoomManager.awardDeeds()` runs after `settleRanked` commits —
  reads counters/unlocks/gloryEarned, applies deltas + streaks + glory
  counter (before = earnedNow − thisMatchGlory), evaluates, awards, then
  sends `deedUnlocks` PER-SOCKET (broadcast would leak secret unlocks to
  the opponent). Never blocks the settle. Disguised-bot ranked matches
  COUNT (excluding them would leak bot-ness).
- API: `GET /achievements/me` → unlocks + counters (glory_earned served
  live off the ledger) + entitlements.
- Wire: `deedUnlocks` ServerMsg added at v19 WITHOUT a bump — verified the
  shipped client ignores unknown message types.

**M2 — unlock ceremony (2026-08-03, tuned 08-04).**
- Deeds beat = third act of `RankedCeremony` (glory → rating/placement →
  deeds). Reveal machine + card face + replay overlay all live in
  `src/screens/DeedCards.tsx` (ONE home — ceremony and deeds-screen replay
  share it verbatim). One eased 700ms staged timeline per card; snap-tap
  lands it; advancing taps gated by `DEED_MIN_DWELL_MS = 1100` so the
  forged `deed_unlock_1` sting finishes. `GLORY_HOLD_MS = 2000`.
- Celebrated set: `src/deeds/celebrated.ts` (AsyncStorage
  `bits.deedsCelebrated`), marked per card AS SHOWN; the deeds screen
  replays anything in `/achievements/me` not in the set. Unknown ids are
  skipped and NOT celebrated (replay after app update).

**M3 — presentation: THE CHRONICLE CODEX (2026-08-04, replaced the map).**
- The 2D pan/zoom map was retired after four polish rounds (Tom: primitives
  never felt premium). `DeedMap` REMAINS in `@heroic/achievements/map` —
  pure, tested, unused by BITS; a future game may use it. Its Realmsmith
  board-layout tab is DEAD as a work item.
- `src/screens/DeedsScreen.tsx` = SectionList codex: chapters from
  `ACHIEVEMENT_CHAPTERS` (test enforces every deed in exactly one), tap
  header to collapse (LayoutAnimation, chevron, count visible folded).
  Blocks: chain = full HEAD row (family icon, shown once) + indented tier
  ladder under a faint spine — tiers carry roman NUMERAL CHIPS (II/III/…),
  the ONE next-earnable tier is named + progress bar, deeper tiers are slim
  numbered "???" rungs. Rewards render as sentences ("Earned the title
  “The World Serpent”", "Unlocked “Chu Ko Nu”" via `humanizeItemId` —
  a real item-name registry is owed with M5). Rising-ember ambience.
- Entry: DEEDS card on the mode select (Ranked full-width top, Skirmish +
  Practice half-width compact-title row, Deeds, locked Story). Deeds card
  art unforged → painted fallback. Back → mode select.

**Wearable titles (data layer, 2026-08-04).**
- `rewards?: AchievementReward[]` ARRAY on defs/tiers (glory sums; each
  entitlement/title = own row). `{ kind: "title" }` carries NO itemId — the
  deed's own name IS the title; server grants entitlement `title:<deed-id>`.
  Loss-streak rule: never Glory/items, joke TITLES allowed (test-enforced).
- The WEARING UX does not exist yet (see next steps).

**Forge / art.**
- `deed-bits` forge type: 10 subjects (title-driven, written to each
  chain's APEX fantasy), all 10 PNGs forged + pasted into `DEED_ICONS`
  (`src/deeds/deedIcons.ts`); cast/weapon chains REUSE loadout icons.
- Style rules (Tom, apply to ALL future image forging): NO die-cut
  outlines (game owns separation), NO frames/circles/medallions in art, no
  "emblem" wording (circle bias), subjects favour ONE bold familiar object
  (scenes and obscure nouns generate mush — the win-streak icon took 3
  tries: molten wave → fulgurite → branding tallies → taut molten CHAIN
  won). Badge shield anchor is the one kept exception.
- Manifest paste lines are comment-free (Tom kept hand-stripping them).

**Dev tooling.**
- Dev menu (5 title taps): `DEED CEREMONY ▶` rehearsal (full fake
  settlement incl. rank-up; `rehearsal` prop skips celebrated marking) and
  `DEEDS ○ REAL / ◉ SOME / ◉ ALL` preview (client-only fake unlock state,
  read on DeedsScreen mount; SOME = root + first tiers + counters faked
  60% toward next; replay suppressed during preview).

## Open decisions (need Tom)

1. **Retroactive counters** — DECIDED 2026-08-08: everyone starts at zero,
   no backfill. First settles after deploy start writing counters. No
   migration work needed.
2. **Glory amounts on tiers** — economy pass; `rewards` slots ready,
   mostly unset. Loss-streaks must stay Glory-free (test enforces).

## Next steps (priority order from the 2026-08-04 session close)

1. **On-device pass of the whole loop** — never done: mode card →
   chronicle → ranked match → deed pops → sting → replay. Gate for ship.
2. Deploy choreography: server + API to Render (schema self-applies), then
   EAS update. All wire changes are v19-compatible.
3. **Chapter-art headers** — 8 forged strips behind codex chapter titles;
   needs a small new forge set (mode-card pattern). Highest visual return.
4. `deeds.png` mode card (one forge, replaces painted fallback).
5. Bundled display font — DONE 2026-08-08: IM Fell English SC (Tom's pick
   from a six-face specimen round), bundled TTF + OFL in assets/fonts,
   loaded via useFonts in App.tsx, ONE `DISPLAY_FONT` home in
   src/typography.ts (the seven per-file Copperplate selects are gone).
   On-device check owed: single-weight face under fontWeight 700/900
   styles, and 13px legibility on dark ground.
6. Row-reveal micro-animation + ceremony icon — BOTH DONE 2026-08-08:
   codex blocks fade-and-rise on mount (BlockReveal in DeedsScreen —
   entry, scroll-in, and chapter-expand alike; stagger capped at 6);
   DeedCardFace shows the forged 76px icon riding the title's reveal
   slice.
7. **Title-wearing UX** — BUILT 2026-08-08 (designed with Tom same day;
   achievements.md § wearing titles): deed-id claims on all three join
   shapes + public RoomStatePlayer.title (no protocol bump), ranked
   entitlement verification (silent strip), Chronicle WEAR pills
   (AsyncStorage `bits.title`), lobby row + in-match name-tag render,
   ~30% disguised-bot titles. On-device pass owed.
8. Wave-2 sim events — BUILT 2026-08-08 (all additive on the wire, no
   bump; shipped clients drain events via if/else so unknown types skip):
   `reflect` event at the Mirror Guard bounce (step.ts) + accumulator
   `reflects`; heal events carry `casterId` (blood font's ownerId) →
   `healingDealt` now feeds the healing_done counter (received still
   tracked); `roundEnd.standing` = survivors' HP fractions →
   `lastRoundHpFrac` on PlayerMatchStats (the "win the decider under 10%"
   sample — null = dead at the close, overwritten per round so the final
   ingest holds the decider). Client plays a spatialised `reflect` parry
   ting (catalogue slot + forge soundSet row + styleBible brief added;
   CLIP OWED — silent until forged). NO new deeds authored — chains/feats
   on these stats are Tom's content pass.
9. M4 skirmish counting — BUILT THEN FULLY REVERTED 2026-08-08, and the
   retirement is FINAL DESIGN INTENT (Tom: deeds are ranked's reward
   gravity, and per-mode counting rules are too hard to explain — "deeds
   come from ranked" is one sentence). Do NOT rebuild. The hard-won
   lessons (identity mechanism, seat-map scrubbing, and especially the
   milestone-crossing-consumed-behind-the-accepts-gate trap) are recorded
   in achievements.md § M4 retired. Skirmish board, skirmish_* counters,
   farming policy: all dead as work items. Roadmap is now M5 directly.
10. M5 secret items — BUILT 2026-08-09 (bits-secret-items.md): the TRIDENT
    (reach melee: 160 reach, 18° needle, kb 180, no rider) granted by THE
    SAND SNAKE (5 ranked wins; rewards stack → one card pays title +
    "UNLOCKED — TRIDENT"). PROTOCOL v20 (a new weapon id crashes old
    bundles — coordinated deploy + EAS update REQUIRED, ship together).
    sim items.ts = GATED_WEAPONS/ABILITIES + ITEM_NAMES registries
    (humanizeItemId retired); FREE_WEAPON_IDS/FREE_ABILITY_IDS = the ONLY
    drafting pools (Tom: bots use base roster PERMANENTLY — earned steel
    is humanity proof; archetype/cast-rule tax waived for gated items
    forever). Client: deeds/entitlements.ts cache (boot load, authoritative
    replace on /achievements/me, instant local grant on deedUnlocks via
    defs) → wizard HIDES unearned weapons (sortedWeaponIds takes the set).
    Server: entitlements loaded once at verifyAndEnqueue ride
    QueueEntry/RankedSeatAccount.items → setWeapon/setAbilities silently
    ignore unowned gated picks in ranked (skirmish trusts). rounds-trident
    chain added (PLACEHOLDER titles: Fisherman/Spearside/The Retiarius).
    OWED: forge trident icon (harpoon png stands in) + hit_trident clip
    (briefed in styleBible; rows auto-derive), on-device feel pass +
    number tuning, Tom's naming pass.
11. Wave-2 FEATS BUILT 2026-08-08 (the deferred second set, Tom: "do them
    all" — achievements.md § Wave-2 feats): 8 new one-offs (by-a-thread,
    return-to-sender, still-standing, flawless, the-old-ways, carnage,
    killer-instinct, never-doubted) + lifeblood now reads healingDealt.
    New accumulator tallies: crits, roundWinners (events already carried
    the data — no sim/wire change). PLACEHOLDER TITLES (Tom's naming pass
    owed), thresholds: 7 reflects/10 crits (Tom-tuned), 300 dmg still a first guess, 8 icon
    subjects briefed in the style bible (DEED_ICONS null until forged —
    next Realmsmith session). Feats deliberately cascade (a perfect match
    pops Not a Scratch + Flawless + Still Standing together).

## Gotchas the next session should not rediscover

- Achievement ids are persistence keys — NEVER change shipped ids
  (`idBase-threshold` for chain tiers; thresholds are content, frozen once
  live). Pre-ship they've moved freely; post-deploy they're frozen.
- The coverage test fails the suite when a new weapon/ability lacks a
  hand-authored chain in `defs.ts` (derivation was removed on purpose).
- The overlap test on `pos` still runs (map retired but positions kept);
  if defs positions ever get culled, kill that test with them.
- `bun test packages` + server `bun test` + `bun run --filter '*'
  typecheck` is the full verification sweep used throughout.
- IDE TS server goes stale on cross-package type edits (showed phantom
  errors twice); the CLI sweep is the source of truth.
- Sound: `deedUnlock` catalogue slot; clip forged. New sounds → catalogue
  slot + forge soundSet row + styleBible brief (memory: sound-on-new-features).
