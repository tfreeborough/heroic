# Blood in the Sand — Pick Ceremony (lock-in → reveal → adjust)

Status: **SUPERSEDED 2026-07-14** by [pvp-loadout-flow](./pvp-loadout-flow.md) ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-07-12 (built, protocol v6)

> **Superseded (Tom, 2026-07-14):** casual testers bounced off the
> lock-in / reveal / counterpick loop — it was designed for a competitive
> player type we don't yet know exists. The default lobby is now a guided
> pick wizard with server auto-start; enemy picks stay hidden with no reveal
> at all. This doc is kept because the yomi layer is *deferred, not dead*
> (ranked/veteran mode candidate) and its per-team filtered `roomState`
> transport lives on unchanged.

> Grew out of the counterpick discussion (2026-07-12): weapon picks are a strategic layer,
> so they need pick-visibility rules. Decision: one honest reveal, then hidden adjustments —
> a *yomi* (opponent-reading) layer where counterpicking is a calculated risk, not a free win.
>
> Relationship to the abilities draft ([pvp-abilities](./pvp-abilities.md)): this is the
> **weapons-only v1** of that doc's 4-beat draft flow (blind pick w/ per-player LOCK IN →
> staged reveal → counterpick → sand). Same information rules, host-driven and lighter-weight.
> The per-team wire filtering built here IS that doc's "scout-proof by protocol" foundation.
>
> **Update (2026-07-12, later):** the sim now carries the full 4-beat draft behind this
> ceremony — a timed `pick` RoundPhase (`startMatch(sim, events, { pickSeconds,
> adjustSeconds })`), per-player LOCK IN in both phases, and **ability loadouts**
> (`setPlayerAbilities`, 3 distinct picks in button order, auto-filled + revealed
> alongside the weapon; see the ABILITIES table in config.ts). All headlessly tested
> (reveal.test.ts). **Later the same day the full draft went live everywhere:**
> `setAbilities` on the wire, the server's `startByHost` runs the timed draft (30s pick
> + 15s counterpick), RoomScreen became the draft screen (loadout sheet, lock checks,
> radial timer, reveal overlay), and practice runs the identical draft against a
> drafting/bait-swapping bot. Everything fit in protocol v6 (it never shipped between
> versions). This doc's "lobby is the blind pick" flow remains available as
> `pickSeconds: 0`.

## The flow

```
lobby (untimed, host-driven)          reveal window (REVEAL_ADJUST_SECONDS = 15)
picks visible to YOUR TEAM ONLY  ──▶  everyone's lock-in pick shown to all      ──▶  countdown → fight
enemy rows show ready/choosing…       repick freely; changes hidden from enemy       picks locked & public
        host presses START            unpicked seats were auto-filled at lock
```

1. **Lobby** — untimed, as before. Picks are **team-visible only**: enemies see
   `ready` / `choosing…`, never the weapon. The host can start once every seat is
   filled and connected — picks are no longer required (see auto-select).
2. **Lock-in (host presses START)** — every unpicked player is **auto-assigned a
   random weapon** (sim RNG, so it's deterministic/replayable). Each player's
   current pick is snapshotted as their **revealed** pick and shown to both teams.
3. **Adjust window (15s)** — anyone may repick. Changes are visible to teammates,
   **never to the enemy**. Your own row shows `was X → now Y`; enemy rows show
   `revealed: X`. So a counterpick may itself be countered blind — **bait picks
   are an intended mechanic**, not an exploit (Tom: "exactly the sort of
   mind-fuckery I want to create").
4. **LOCK IN (per player, optional)** — "I'm done adjusting": freezes your pick
   (no unlock — a lock is a lock) and shows a public ✓ to both teams. Everyone
   locked ends the window early (Tom 2026-07-12); a disconnected player never
   blocks it. Otherwise the clock closes the window.
5. **Window closes** — scoreboard resets, countdown, fight. From the countdown on,
   actual picks are public (snapshots carry them — you can see the weapons anyway).

## Rules & edges

- **No re-reveal, no counter-staircase**: exactly one reveal per match. After it,
  everyone is predicting, not reacting.
- **Roster locks at lock-in**: the reveal phase counts as in-match for joins
  (no free seats); a disconnect during the window keeps the seat — the body idles
  into the match, same as a countdown disconnect. Their revealed pick stands.
- **Leaving mid-ceremony** = mid-match leave (idle body), consistent with the
  "matches never pause" rule.
- **Practice mode runs the SAME ceremony** (Tom 2026-07-12 — it's the
  no-second-player test bed): PracticeClient starts the reveal window
  in-process and drives RoomScreen through the shared LobbyClient interface;
  the bot bait-swaps its revealed weapon ~half the time on a random delay,
  then locks in (so lock-early is exercised solo too). The headless server
  bot (`scripts/bot.ts`) plays the ceremony the same way — create a room on
  one phone, `bun scripts/bot.ts --room CODE`, and the whole flow is testable
  alone. `startMatch` without a ceremony (`{}`, the default) still skips
  straight to countdown — that keeps every pre-ceremony test instant.
- **Timing** (Tom: keep the ceremony tight): lobby untimed (party game, host
  starts when ready), adjust window 15s (`REVEAL_ADJUST_SECONDS` in config.ts).

## Team-filtered visibility (the transport change)

Built now, deliberately ahead of need — anything hidden-per-team later (fog,
role info) reuses it.

- **`roomState` is no longer a room-wide broadcast.** The server sends each seat
  a view filtered for its team (`toRoomStatePlayers(state, viewerTeam)`):
  `weapon` is real for teammates, `null` for enemies; `picked` (boolean) is
  public; `revealed` is public during/after lock-in.
- **Snapshots stay one uniform broadcast** — but `weapon` is scrubbed to `null`
  for everyone while the phase is `lobby`/`reveal` (nothing renders weapons
  then). This closes the leak without per-team snapshot encoding.
- **Watchers** get the neutral view (team 0: no weapons, flags only) — a watcher
  socket must not be a picks-spying side channel. (Mid-match watchers still see
  everything; positions are already public then.)

## Wire changes (protocol v6)

- `RoomStatePlayer`: `weapon` (and `abilities`, riding along for the draft)
  become viewer-dependent; adds public `picked`, `locked`, `revealed`,
  `revealedAbilities`.
- `ClientMsg` gains `lockIn`.
- `RoundPhase` gains `"pick"` and `"reveal"` (between `lobby` and `countdown`);
  the weapons-only flow uses `pickSeconds: 0` — the lobby is the blind pick.
- Client routing: `lobby` **and** `reveal` show the RoomScreen; the ceremony UI
  lives there (reveal banner + countdown, `was → now` on your row,
  `revealed:` on enemy rows).

## Why this design (recorded so we don't re-litigate)

- Hidden-until-reveal picks make counter-*design* meaningful: soft counters only
  create a skill layer if responding to picks is possible but not free.
- The single reveal + hidden adjustment was chosen over (a) fully-open picks
  (counterpick staircase, last-picker advantage) and (b) fully-blind picks
  (comp lottery, counters never express).
- Auto-select exists so an AFK friend can't hold the lobby hostage; it fills at
  lock-in so the reveal always shows a complete comp.
- More weapons ⇒ more uncertainty in the adjust window — the unlockable-weapon
  monetisation plan ([monetisation](./monetisation.md)) and this system
  reinforce each other.
