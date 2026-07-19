# Blood in the Sand — Death Spectator

**Status:** built 2026-07-18

## Problem

Blood in the Sand rounds are one-life. When you die, the round keeps going —
often the fight drifts to the far side of the pit and you're left staring at
your own corpse with nothing to watch and nothing to do. That dead-*player*
time (not just dead-character time) is where a casual player checks out of the
match.

## Solution

On death the camera stops following your corpse and **auto-follows a living
teammate**. You stay inside the fight — cheering your side on, and (for newer
players) learning positioning and ability use by watching.

### Behaviour

- **Death beat:** the camera holds on your own corpse for `SPECTATE_DELAY_MS`
  (2s) before cutting away — a moment for the kill to land, rather than yanking
  you off your body the instant you drop. During the beat the controls are
  already gone but the spectator chip hasn't appeared yet.
- **Target pick:** the living ally nearest to where the camera currently sits.
  On the frame you die that anchor is your corpse, so you snap to whoever died
  closest to you. When the ally you're watching then dies, the anchor is *their*
  last position, so you hop to the next-nearest survivor — the camera never
  teleports across the arena.
- **No manual override.** No cycle arrows — auto-follow only. Lowest friction
  for a player who just died; the "watch my mate specifically" case wasn't worth
  the UI.
- **Whole team down:** fall back to the existing pure-spectator camera (fit the
  whole bowl) until the round-end banner takes over.
- **Respawn:** rounds re-seat everyone, so `me.alive` flips true next round and
  the camera returns to you automatically. The spectate target resets each time
  you're alive.

### UI

- The movement stick and ability buttons are **hidden while you're dead** — a
  corpse has no inputs, and it clears the frame for watching.
- A `SPECTATING {NAME}` chip with a live **HP bar** for the followed ally sits
  where the controls were. (Every player already draws an over-head HP bar in
  world space, so the followed ally's HP is visible either way — the chip just
  makes it unmissable.)

### Deliberately out of scope

- **Kit visibility.** We show the ally's HP, not their ability cooldowns.
- **Intel leak.** A dead spectator now sees corners a living player couldn't.
  For casual / voice-chat play we explicitly don't care.
- **SFX.** No whoosh on a camera hop — it'd fire constantly in a chaotic fight.

## Implementation

Entirely **client-side** — no protocol change, no server work. The snapshot
already carries every player's `x/y/hp/alive/team` every tick
(`snapshot.ts` `toSnapshot`), so following an ally needs no new data.

- `render.ts` `ArenaRenderInput` gains `spectateId`. The camera follows `me`
  while alive, the `spectateId` player while dead, and fits the bowl otherwise.
  `myId` still identifies the real self for range-ring / ally-pointer logic.
- `GameScreen.tsx` picks the spectate target in the render loop (a sticky ref,
  re-picked only when the current target dies or leaves) and surfaces the
  followed ally's name + HP to the HUD. Controls hide on `hud.dead`.
