# Achievements — the Deed Map

Status: **designed 2026-08-02** (nothing built) ·
Applies to: **all Heroic games** — Blood in the Sand ships it first; Enter the
Gauntlet adopts later ·
Last decided: 2026-08-02

> A cross-game achievement system with a Minecraft-style explorable map instead of a
> scrollable list: a pan/zoom board of nodes that visibly *grows* as you play. The
> engine and map UI are shared; each game supplies its own achievement content and its
> own trust model (BITS: server-awarded into Turso; ETG: same engine run locally).
> Companion to [glory-economy.md](./glory-economy.md) (the ledger achievements pay
> into — its `achievement:` idempotency namespace was reserved for exactly this),
> [monetisation.md](./monetisation.md) (the store that shares the entitlements table),
> [bits-ranked.md](./bits-ranked.md) (the settle path achievements ride), and
> [asset-forge.md](./asset-forge.md) (icon art).

## Decisions locked

1. **Three-layer split for cross-game reuse.** A new shared package
   `@heroic/achievements` (unprefixed = truly shared) holds the *engine* — definition
   types, the pure `evaluate()` function, unlock/progress state, and the map UI
   component. Each game supplies *definitions* (the content) and an *adapter* (where
   evaluation runs, where state lives). The engine imports no DB, no sockets, no
   Expo — that purity is what makes ETG adoption cheap.
2. **BITS is server-authoritative.** Only the game server awards achievements, at
   ranked settle, from stats it accumulated itself. The client renders; it never
   writes. ETG (offline, no backend) runs the same engine locally against
   AsyncStorage — server-authority is a property of the BITS *adapter*, not of the
   shared system. Cheating solo-PvE harms nobody; cheating ranked is theft.
3. **Ranked-only in M1.** Ranked sockets already carry the player's bearer token
   (`verifyAndEnqueue` → `accountId`); skirmish sockets carry no identity at all.
   M1 ships on the existing plumbing. Skirmish counting is M3: optional token on the
   skirmish join, plus a farming policy for friends-lobbies. Practice awards nothing
   (already stated in [bits-mode-select.md](./bits-mode-select.md)).
4. **Frontier reveal.** Unlocked nodes show full art; their immediate children show
   as silhouettes with tap-to-peek *titles only* (mobile's "hover"); anything deeper
   is invisible. The map literally expands outward as you play — the Minecraft
   "living adventure" feel. Descriptions ("how do I unlock this?") and rewards stay
   hidden until unlocked.
5. **Rewards: Glory, cosmetics, and *secret* weapons/abilities.** Store-purchasable
   weapons/abilities are a separate (future) monetisation lane; the current roster
   stays default-and-free forever. Achievement-granted weapons/abilities are a third
   category: **hidden items** — never shown in the store, never purchasable, unknown
   until the achievement pops. Both store and achievements write to one shared
   `entitlements` table with a `source` column.
6. **Hybrid authoring.** Lifetime milestones ("win 100 ranked matches") are
   declarative — a counter name + thresholds. Single-match feats ("heal 200 in one
   ranked 1v1") are plain TypeScript predicates over a `MatchSummary`. No DSL rich
   enough for the interesting ones is worth building when predicates run server-side
   and cost nothing.
7. **Disguised-bot ranked matches count.** Ranked bot backfill
   ([bits-ranked-bots.md](./bits-ranked-bots.md)) exists to be indistinguishable — if
   achievements never popped in bot matches, achievements would *leak bot-ness*.
   One-sided settle already treats these as real ranked matches; achievements do too.

## Architecture

*(Adapter: a thin per-game module that connects the shared engine to that game's
storage and transport — the engine says "player X newly earned Y", the adapter
decides what that means physically.)*

```
packages/achievements            @heroic/achievements (shared, pure + UI)
  src/types.ts                   AchievementDef, MatchSummary shape, UnlockState
  src/evaluate.ts                evaluate(defs, counters, summary) → awards
  src/frontier.ts                visibleNodes(defs, unlocked) → full|silhouette|hidden
  src/map/                       the pan/zoom Skia board (peer-deps: skia,
                                 gesture-handler, reanimated — same posture as engine)

packages/blood-in-the-sand-sim
  src/achievements/defs.ts       BITS content: the actual achievement list
  src/achievements/summary.ts    MatchStatsAccumulator (event stream → MatchSummary)

packages/blood-in-the-sand-persistence
  src/achievements.ts            tables + award transaction + queries

apps/blood-in-the-sand-server    adapter: accumulate per tick, evaluate at settle
apps/blood-in-the-sand-api       GET /achievements/me
apps/blood-in-the-sand           map screen, unlock ceremony
```

Definitions live in the **sim** package because both server (evaluation) and client
(map rendering) already depend on it, and the accumulator must interpret sim
`ArenaEvent`s. Shipping definitions in the client bundle is fine — the client can
read them but can never award them. Datamining the bundle can spoil secret-item
*names*; acceptable for now (every Minecraft secret is on the wiki within a day).
If a secret ever truly matters, its description/reward strings can move server-side
and arrive only after unlock — the shape allows it, M1 doesn't bother.

## The definition

```ts
type AchievementDef = {
  id: string;                       // "sand-surgeon", stable forever once shipped
  board: string;                    // "ranked" | "skirmish" | … — which tabbed map it lives on
  title: string;                    // "Sand Surgeon" — visible from silhouette stage
  description: string;              // "Heal 200 health in a single ranked 1v1" — post-unlock
  icon: string;                     // forge asset key
  parent: string | null;            // frontier edge; null = a root, always visible
  pos: { x: number; y: number };    // authored board position (no auto-layout)
  reward?:
    | { kind: "glory"; amount: number }
    | { kind: "entitlement"; itemId: string }   // secret weapon/ability/cosmetic
  trigger:
    | { kind: "milestone"; counter: CounterId; threshold: number }
    | { kind: "feat"; test: (s: MatchSummary, p: PlayerId) => boolean };
};
```

- **Milestones** read a named lifetime counter (`ranked_wins`, `ranked_kills`,
  `healing_done`, …). Counters are incremented by the adapter from each
  `MatchSummary`; several achievements can ladder off one counter
  (win 10 / 100 / 500 / 1000 as four nodes chained parent→child).
- **Feats** get the whole `MatchSummary` and answer yes/no for one player. All the
  interesting ones live here: *"win a ranked match without taking damage"*, *"kill
  with a harpoon while bleeding"*, *"win the deciding round with under 10% HP"*.
- Chains use `parent` both for frontier reveal and for the board's connecting lines
  — the tree is authored, tiers of one family form a visible path.

### Boards — multiple achievement flows *(added 2026-08-02)*

Deeds are grouped into **boards** — self-contained trees, each a tab on the
achievement screen with its own roots, its own authored coordinate space, and its
own frontier state (progress on one board reveals nothing on another). Season I
ships the `ranked` board; a `skirmish` board arrives with M3. Boards are a
*content/presentation* grouping only:

- **Storage, pipeline, and rewards are board-agnostic** — unlocks/counters/
  entitlements key on player + id, and `evaluate()` runs all definitions against
  every summary regardless of board. Nothing in the schema knows boards exist.
- **Counters are deliberately shared across boards** — a lifetime `ranked_kills`
  counter can feed chains on more than one board if content ever wants that.
- Each board declares a **context default** (e.g. the ranked board only evaluates
  against ranked summaries) so individual feat predicates don't each re-check
  `summary.ranked` — closes the authoring slip where a skirmish match pops a
  ranked deed.
- The shared map component is single-board: it takes one board's defs + unlock
  state; the screen owns the tabs. ETG's entire achievement set is simply another
  board with another theme.

## MatchSummary — what the server accumulates

The sim already emits everything needed: `stepSim` returns `ArenaEvent`s every tick
(`hit` with damage/crit/lethal/bleed, `heal` with amount, `death`, `cast`, `shoot`,
`roundStart/End`, `matchEnd`) into `Room.eventBuffer`, where today only logging and
the ranked match-end hook consume them. A `MatchStatsAccumulator` (sim package, pure,
unit-testable by feeding it event streams) is fed each tick before the buffer clears:

- **Per-player totals**: kills, deaths, damage dealt/taken, healing done, crits,
  bleeds applied, casts per ability, rounds won while alive.
- **Windowed / derived flags**, computed *during* the match so feat predicates stay
  pure functions over the finished summary: fastest multi-kill window, lowest HP at
  a round win, took-no-damage-this-round, per-round (not just per-match) maxima.
  When a feat needs a new derived stat, the accumulator grows — predicates never
  get raw event access, which keeps them cheap and keeps the summary the single
  audited surface.
- **Match context**: bracket, team size, ranked flag, winner, duration, per-seat
  `accountId`/bot flag, round score.

The accumulator is deliberately also the future skirmish/ETG path: anything that
steps a sim and produces `ArenaEvent`s can produce a `MatchSummary`.

## Award pipeline (BITS server)

1. `Room.step()` feeds the accumulator (ranked rooms only in M1).
2. At settle (`RoomManager.settleRanked`), after `recordRankedMatch` succeeds:
   read the player's counters, run `evaluate(defs, counters, summary)` per human
   seat → `{ counterDeltas, newUnlocks }`.
3. **One idempotent write batch** per player (libsql `db.batch`, same posture as the
   settle transaction): counter upserts guarded by an `achievement_progress_marks`
   row keyed `(match_id, player_id)` with `INSERT OR IGNORE` — a retried settle
   can never double-count; unlock inserts `OR IGNORE` on the `(player_id,
   achievement_id)` primary key; Glory rewards through the existing
   `recordGlory()` with idempotency key `achievement:<playerId>:<achievementId>`
   (the namespace `db.ts` documented for this day); entitlement inserts `OR IGNORE`.
4. **Notify during the ceremony hold** — see *The unlock ceremony* below.
5. A player can't be in two ranked matches at once, so read-then-write counter
   races don't exist in practice; the marks table is the correctness backstop.

Milestone "newness" is the threshold crossing itself (`old < threshold ≤ new` —
fires exactly once); feats are additionally filtered against the player's existing
unlock set. The server computes the diff; the client is never asked "what's new".
Only counters and unlocks are ever persisted — the `MatchSummary` is server memory,
discarded after settle. (Future option, not M1: persist the summary as a JSON
column on `ranked_matches` for a match-history screen.)

## The unlock ceremony *(decided 2026-08-03)*

Unlocking is the payoff moment and gets a dedicated animated flow, shipped
*before* the map (see milestone order):

- **Delivery**: new unlocks accompany the settle result during the existing
  post-match ceremony hold (ranked rooms never return to lobby), but are **sent
  per-socket — each player sees only their own** (a room-wide broadcast would
  leak secret-item unlocks to the opponent; per-connection sends already exist
  for per-team roomState).
- **The flow**: after the rank-movement / placement beat, the unlock queue plays —
  arena dims, one deed card at a time: forge icon stamps in with a dust burst,
  title reveal, reward line, unlock sting (new clip for the
  [bits-audio.md](./bits-audio.md) catalogue). Multiple unlocks play sequentially
  (a first match pops 2–3); tap advances. Once the message lands the client owns
  the celebration — the room closing mid-animation costs nothing.
- **The moment is never lost**: unlocks are persisted at settle regardless of
  delivery. The client keeps a local "celebrated" id set (AsyncStorage); on
  opening the deeds screen, anything in `/achievements/me` not yet celebrated
  replays the full ceremony first, then is marked. A disconnect delays the
  moment, never skips it.

### Schema (additive, `ensureSchema` as usual)

| table | columns |
|---|---|
| `achievement_unlocks` | `player_id`, `achievement_id`, `unlocked_at` — PK `(player_id, achievement_id)` |
| `achievement_counters` | `player_id`, `counter`, `value` — PK `(player_id, counter)` |
| `achievement_progress_marks` | `match_id`, `player_id` — PK both; the double-count guard |
| `entitlements` | `player_id`, `item_id`, `source` (`achievement:<id>` \| `purchase:<sku>` later), `granted_at` — PK `(player_id, item_id)` |

Achievements are **permanent and cross-season** — rank resets, deeds don't. A
season-tagged achievement ("reach Immortal in Season I") is just content with the
season baked into its id.

### API

- `GET /achievements/me` (bearer): unlocked ids + timestamps, counter values, owned
  entitlements. The map screen's single fetch; band math stays server-side as ever.
- Definitions themselves ship in the app bundle (sim package) — no endpoint.

## Secret items in the wizard

An achievement-granted weapon/ability, once entitled, simply appears in the arming
wizard roster — the flex is opponents seeing an item they've never seen (cast-flash
intel already teaches enemy kits). Store-side it never exists. Every secret item is
still a full sim citizen and pays the standard new-content tax before shipping:
forge icon + cast SFX, bot cast rule in `botCasts.ts`, `deriveArchetype` pass, and
an archetype-worthiness check — bots must use it credibly or its existence leaks
that a lobby is bot-backfilled.

## The map (the Deed Map)

*(Greenfield gesture work: the game camera is fully automatic today — this is our
first user-driven camera.)*

- One Skia `<Canvas>` drawing the board; `Gesture.Pan()` + `Gesture.Pinch()` running
  simultaneously drive translate/scale shared values (reanimated), clamped to the
  authored content bounds with a soft rubber-band at the edges.
- **Node states**: *unlocked* — full woodcut icon, warm ink; *frontier* — silhouette
  (the greyscale `ColorMatrix` trick RankedScreen already uses on locked cards),
  tap opens a card with title only; *hidden* — not drawn. Parent→child connecting
  lines draw only when the child is at least frontier.
- Unlocked-node tap shows the full card: art, title, description, reward, unlock
  date. Milestone frontier nodes may show counter progress ("487/500") — earned
  anticipation, not a spoiler.
- Board dressing in the BITS voice: parchment/sand field, vignette, the dark-fantasy
  woodcut icon set on die-cut bone outlines. The board component itself is themable
  (colors/textures via props) since ETG will reskin it.
- Entry point: HomeScreen (alongside the Glory pill) — deeds span modes, so it's not
  a ranked-screen child. New `deeds` route in App.tsx's hand-rolled router. The
  screen owns the board tabs (ranked-only until M3) and hands the active board to
  the map component.

## Icon art

Standard forge pattern: an `achievementSet.ts` in Realmsmith derived from the
definitions list in the sim package (the `badgeSet.ts` shape: id + subject +
accent), destination `apps/blood-in-the-sand/assets/achievements`, subjects written
per-achievement in the style bible, done-ticks derived from the directory listing.
Adding an achievement to `defs.ts` automatically adds a to-forge row.

## Enter the Gauntlet later

ETG has no backend, no identity, no server — and doesn't need one for this. Its
adapter: a local accumulator over its own sim events, `evaluate()` on run end,
unlock state in AsyncStorage, no entitlements/Glory (its rewards are its own).
The map component renders ETG definitions with an ETG theme. The engine package
must never grow a Turso or bearer-token assumption — that's the contract.

## Season I ranked board — content sketch *(Tom, 2026-08-02; draft, titles TBD)*

Milestone chains (tiers share one icon; bronze/silver/gold frame per tier — keeps
the forge bill at ~25 unique subjects instead of ~85 and makes chains read as
chains on the board):

| chain | tiers | counter | notes |
|---|---|---|---|
| First ranked match | 1 | `ranked_matches` | the board's root node |
| Ranked wins | 5/25/50/100/250/500/1000 | `ranked_wins` | the spine chain |
| Killing blows | 1/25/100/500/1250/**9001** | `killing_blows` | from `hit.lethal` + attacker; 9001 keeps its meme |
| Rounds won per weapon | 5/50/200 × blade/bow/warhammer/staff | `rounds_won:<weapon>` | loadout is per-match, so = team round wins in matches using that weapon |
| Casts per ability | e.g. 10/50/250 sandtrap | `cast:<ability>` | one chain per ability, thresholds tuned per ability |
| Ability-effect chains | e.g. reflect 25/250/1500 (Mirror Guard), heal 100/1000/7500 (Blood Font) | `reflects`, `heal:<ability>` | **needs sim events**: a reflect event; `heal` gains a source-ability field |
| Win streak | 3/5/10 | `best_win_streak` | streak counters: `current_*` reset on loss, milestone reads `best_*` |
| Lose streak | 3/5/10 | `best_loss_streak` | **no reward** — rewarding ranked losses is a throw incentive; the unlock is the joke |
| Lifetime Glory | 500/2500/5000/7500/15000/25000 | *(none)* | read from `glory_ledger` (SUM of positive rows — balance breaks once spending exists). Achievement Glory landing in the same settle counts on the *next* evaluation — one-match lag, accepted |
| Damage dealt | 500/2500/10k/25k/100k | `damage_dealt` | |
| Healing done | 500/2500/10k/25k/100k | `healing_done` | |
| Last one standing | *(parked)* | — | trivially every round win in 1v1; belongs to team brackets / the skirmish board |

Feats to salt between the chains (the memorable ones — draft pool): win a match
untouched · win the deciding round below 10% HP · heal 200 in a single match ·
kill with a reflected projectile · win a match without casting a single ability ·
win a round in under N seconds. Each is a one-off node branching off the related
chain.

Content implications folded into the design:
- **Streak counter kind**: same `achievement_counters` table, but the adapter's
  update rule is streak-aware (increment current / reset on opposite result /
  high-water the best).
- **Chain layout helper**: ~85 nodes on day one blows past hand-authored `pos` —
  chains author an origin + direction and space their tiers; the Realmsmith
  board-layout tab moves up to M2 (was "deferred until it hurts"; it hurts now).
- Per-ability chains keep the content honest with
  [asset-forge.md](./asset-forge.md) derivation: new ability → new cast-chain row
  appears in the forge set automatically.

## Milestones *(reordered 2026-08-03 — ceremony ships before the map)*

- **M1 — engine + server awards**: `@heroic/achievements` (types, evaluate,
  frontier, chain-builder helper, tests), accumulator in the sim package,
  persistence tables + award batch, settle-path wiring, per-socket unlock
  delivery, `/achievements/me`. **Wave-1 content** = every chain needing zero sim
  changes: first match, wins, killing blows, rounds-per-weapon, casts-per-ability,
  win/lose streaks, damage dealt, lifetime Glory, + feats from existing tallies
  (untouched match, heal-200-in-one-match). Titles from Tom slot in as data.
  **Wave 2** (small sim additions, can trail M1): reflect event → Mirror Guard
  chain; heal-source attribution → per-ability healing; round-end state sampling →
  HP feats.
- **M2 — the unlock ceremony**: the animated post-match flow + unlock sting +
  celebrated-set replay (see *The unlock ceremony*). Small, high-payoff, ships
  the moment players start earning.
- **M3 — the Deed Map**: pan/zoom board, node states, cards, forge icon set
  (tier frames), chain layout helper + Realmsmith board-layout tab, HomeScreen
  entry.
- **M4 — skirmish counting**: optional identity on skirmish join, friends-lobby
  farming policy, skirmish-flavoured deeds on their own board.
- **M5 — secret items**: first achievement-granted weapon/ability (full new-content
  tax), entitlement-aware arming wizard, store exclusion.

## Open questions

- **Board authoring**: resolved by the content sketch — ~85 day-one nodes means
  the chain layout helper ships in M2 alongside a Realmsmith board-layout tab
  (drag nodes/chain origins, save positions back to `defs.ts`).
- **Retroactive counters**: `ranked_matches` history exists, so day-one milestone
  counters *could* be backfilled from it (wins/losses only — no kill/heal history).
  Decide at M1 ship whether early adopters' existing wins count.
- **Anti-abuse beyond ranked**: M3's skirmish counting needs a stance on
  friends-lobby feat farming (e.g. skirmish counts milestones but not feats, or
  requires N unique opponents). Not designed yet.
