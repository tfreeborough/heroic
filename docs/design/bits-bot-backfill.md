# Blood in the Sand — Bot Backfill & Team Switching

Status: **agreed direction 2026-07-19 — built same day (protocol v15)** ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-07-19

> "I could create a 4v4 and play against my wife, but we could have bot team
> mates that help and make it more interesting." (Tom, 2026-07-19)

Real rooms stop being gated on head-count: when the host force-starts a
partial room, **every empty seat is filled by a bot**. Combined with
[bot-brains](./bot-brains.md), this makes bots first-class citizens of online
play, not just practice-mode sparring partners — two humans can field a full
4v4 with bot teammates on both sides.

## The flow

1. Host creates a 4v4 → the room lists with 1/8 players (bots never appear in
   the listing — the count is humans).
2. Players join and arm as usual. A **full** room starts itself exactly as
   before (pvp-loadout-flow.md) — nothing changes when no seats are empty.
3. With empty seats, the host's **START NOW** button is available immediately
   (no 30s grace — that grace exists to shield unarmed stragglers in a *full*
   room, and it still applies there). Pressing it:
   - fills every empty seat with a bot (visible in the roster, named, armed),
   - auto-arms any unarmed human straggler (the existing backstop), and
   - runs the same sim-owned 5s countdown — a force-start is never instant.
4. **Anyone can cancel during the 5s window** — see below.
5. The match plays with the server thinking for the bot seats. At match end
   the lobby return **dismisses the bots**: their seats free up for real
   players, the humans re-arm, and a rematch is one more force-start.

## Cancel: consent, not just convenience (Tom, 2026-07-19)

You joined a 4v4 to fight *people*. If the host starts early, the match you
get is not the match you queued for — so during the 5s countdown of a
bot-filled start, **any seated player** can cancel it (then leave, or make
the host wait for more humans). Mechanics:

- Cancel is only offered on **bot-filled** starts (Tom: "can only happen if
  the room isn't full"). A full room of humans counting down has no cancel —
  same as today.
- Cancelling removes the bots, stops the countdown, and returns the lobby to
  its partial state with everyone's loadouts intact. A notice names the
  canceller ("X cancelled the start — the bots stand down") — social pressure
  is the v1 anti-grief mechanism. If a public-room stalemate (force/cancel
  loop) shows up in the wild, the escalation path is a host kick control —
  deliberately NOT built yet.
- A real player joining during the window already cancels the countdown (the
  party changed); the bots are dismissed and the host can force again — so a
  force-start is a soft commit, never a trap.

## Bots are seats, brains are the server's

The split mirrors practice mode (`PracticeClient`):

- **Sim** owns the *seats*: `ArenaPlayer.bot` (like `dummy`), `addBot()`,
  `cancelStart()`, and lobby-return cleanup (matchEnd frees bot seats the way
  it frees never-reconnected ones). `forceStartMatch` already random-arms
  every unarmed seat from the sim rng, so freshly added bots draft weapons +
  hands through the exact same deterministic sweep as AFK stragglers.
- **Server** owns the *brains*: one `botThink` call per bot seat per tick,
  reading the last broadcast snapshot (bots see what clients see — the
  snapshot-staleness lever difficulty will later dial), feeding the same
  per-tick input map as sockets do. The brain is a **black-box import** from
  the sim package — when bot-brains v2 lands (archetypes × difficulty tiers),
  backfill inherits it with no server changes beyond passing the tier.
- **Difficulty**: fixed at "Average" once tiers exist; today's brains are the
  v1 strategies picked at random per bot ("random behaviours"). Host-picked
  difficulty at room creation is a later add, after tiers feel distinct.

Bots never count as humans: the room listing, GC/desertion checks, heartbeat
sweep, and host succession all filter `bot` — a crown can never land on a bot
and a bots-only room can never linger.

## Team switching

Random-balanced join assignment can put a couple on the same team with no
recourse — and bot backfill makes the gap glaring (the dream matchup is
you-vs-her, bots filling around). So the lobby gains **SWITCH SIDE**:

- Self-serve, lobby-phase only, and gated on **a free seat on the other
  team** — which also makes it impossible during a bot-filled countdown (the
  room is full then) and in any full room. Two players who both want to swap
  in a full room can't (v1 limitation; host seat-assignment is the eventual
  answer if it stings).
- **Hidden while you're alone** (Tom, 2026-07-20): the lobby renders
  viewer-relative (YOUR TEAM is always the top list), so a solo hop changes
  nothing visible — and balanced join assignment seats the next joiner
  opposite you either way. The sim still allows a solo switch (tests/tools);
  the UI just doesn't offer a control that can't show its effect.
- Switching keeps your armed loadout — picks are not team-dependent — and
  re-anchors your lobby position to the new team's spawn line.
- `welcome.team` goes stale on switch: the client syncs its own team from
  each `roomState` (one fix in `ArenaClient`, every screen inherits it).

## Team identity — factions + relative colour (protocol v16, 2026-07-20)

Bot backfill and SWITCH SIDE both exposed that the game had **no absolute team
identity** — only the viewer-relative "your team / enemy team." Worse, lobby
and match disagreed: the lobby always drew YOUR TEAM red, but the match tints
bodies by absolute team (team 1 red, team 2 blue), so a team-2 player was told
"your team" in red, then walked in and was blue. Two fixes, one idea:

- **Name = absolute identity.** Each side gets a **persistent, colour-neutral
  faction name** (`teamNames.ts`, 76 desert-and-arena names — beasts of the
  waste, the sand's weathers, the pit's honorifics). Both players agree "team
  1 is The Scorpions." Names are **born with the room and fixed until it
  closes** (Tom, 2026-07-20 — a rematch is almost always the same people, so
  churning names would just confuse). Derived from the room seed alone (no
  gameplay-RNG draw, so replays reproduce them); ride `welcome` once.
- **Colour = relative allegiance.** Flipped from absolute to **your side
  always blue, the enemy always red**, in lobby AND match (Tom: don't fix on
  red/blue as team numbers). Bodies, the off-screen ally chevron, the
  scoreboard tally, and the lobby headers all follow. A seatless spectator has
  no side, so bodies fall back to absolute team 1 red / team 2 blue for them.

Because colour now means allegiance, the names **must not be colour words** —
a "Crimson" faction rendered blue for its own players would be nonsense. The
pool is enforced colour-neutral (a test guards it). The pre-round countdown
shows "*your faction* (blue) vs *their faction* (red)" — teaching both names
and the colour rule in the moment players look. SWITCH SIDE's hint is
deliberately neutral gold, not a team colour (you're crossing sides, so a
colour there would fight the cue).

## Protocol v15

- `ClientMsg` + `switchTeam` (no payload — the other side is the only target)
  and `cancelStart` (valid from any seated player while a bot-filled
  countdown runs).
- `RoomStatePlayer` + `bot: boolean` — drives the roster's bot markers and
  the veil's cancel-button visibility. Snapshots don't carry the flag (names
  suffice in-match; nothing else needs it).
- Cancel announcements reuse `notice` (the host-handoff toast).

## Owed

- Asset Forge: a "start cancelled" sting (the veil collapsing) and a "bots
  join" moment — logged in the bits-audio catalogue; uiTap/uiBack stand in.
- In-match bot name-tag treatment (subtle "BOT" tick) if playtests want it.
- Host difficulty pick + host kick — both deliberately deferred.
