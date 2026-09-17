# Blood in the Sand — the arm clock

Status: **designed + built 2026-09-16** · Applies to: ranked rooms only ·
Related: bits-ranked.md § Match found → ranked room (the 60 s arm deadline),
bits-reconnect.md (rejoin), bits-audio.md

## The problem

A ranked room gives every seat **60 s to arm** (`ARM_DEADLINE_MS`). Miss it and
the match is void and *you* are the dodger: queue lockout. The client never knew
the deadline existed — new players browse the War Table and read codex sheets,
then get thrown out for a rule they couldn't see.

## Decisions (Tom, 2026-09-16)

- **A coloured bar across the top of the screen** that drains over the arming
  window: green → amber → red → flashing red. It shows over everything an unarmed
  player can be looking at — the SAME ARMS offer, the weapon/ability pickers
  (and their codex sheets), and the lobby if they closed the wizard mid-walk.
- **The timeout rule is unchanged.** Auto-arming the idler and playing the match
  was considered and rejected: in 2v2 solo queue an innocent teammate would lose
  rating for someone else going AFK. The void (innocents requeued at their old
  wait, idler locked out) stands; the bar is how we stop people hitting it.
- **First-timer copy:** "You have 60 seconds to pick your loadout", shown under
  the bar for the first few ranked lobbies on a device.

## Wire (no protocol bump)

`welcome` gains an optional `arm?: { leftSec, totalSec }` — sent only by a ranked
room still in its arming lobby. `leftSec` is computed at send time from the
room's `createdAtMs`, so a **reclaim** gets the true remainder rather than a fresh
60. (A lobby socket close frees the seat and voids the match, so the only
arming-time reclaim is a silent redial that beats the old socket's close —
bits-reconnect.md.) Additive: an old client ignores it, a new
client on an old server just shows no bar. Deploy the server first.

The client stamps `armEndsAt = now + leftSec` on receipt and counts down
locally. The server's check runs on the matcher beat, so the real void lands at
or slightly after zero — the bar never promises time that isn't there.

## Presentation (`ArmClock` in RoomScreen)

- Mounted once at RoomScreen root level, above the picker takeover / SAME ARMS
  overlay, so one component covers every arming view.
- Owns a band under the safe-area inset (`ARM_CLOCK_BAND` = 16 gap + 6 bar +
  8 gap + 16 label line) and RoomScreen shifts the war table, SAME ARMS ✕ and
  lobby down by that much while it shows. *(First cut squeezed a 4 pt bar into
  the existing 18 pt top gap — Tom, 2026-09-16: far too cramped.)* 6 pt rounded
  bar, 24 pt side gutters (the war table's grid line), dark track; the label
  line is always reserved so nothing jumps when the copy changes. The fill
  drains smoothly (native-driver `scaleX` from the left edge — not the 250 ms
  re-render tick).
- Colour bands by **seconds left**: green > 30 s · amber ≤ 30 s · red ≤ 15 s ·
  red + flashing ≤ 10 s.
- Colour is never the only signal (red/green colour-blindness): in the red band
  a seconds readout ("9s") sits under the bar's right end.
- Hidden the moment you're armed (the deadline can no longer hurt you), and
  outside ranked or outside the lobby phase.
- First-timer line: shown under the bar for the first
  `ARM_CLOCK_HINT_LOBBIES` (3) ranked lobbies, counted on device
  (`bits.armClockHints`). Uses the server's `totalSec`, so the copy tracks the
  constant.

## Audio

- `armClockTick` (bank `arm_clock_tick`): a quiet tick on each of the last 5
  seconds while unarmed — people are reading codex sheets, not watching the top
  edge. Deliberately NOT `countdownTick` (that one means "the match is
  starting"; this one means "you're about to be thrown out"). **Clip owed from
  the Forge** — silent until forged (missing-manifest rule).

## On-device pass owed

- Bar reads on notch / dynamic island / Android status bar.
- Flash isn't obnoxious; tick volume sits under the codex cast previews.
- A wifi blip mid-arming redials onto a part-drained bar, not a full one.
