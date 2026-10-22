# BITS match score: a generated, ratcheting arena score (tried, parked)

**Status: parked on 2026-10-22, the day it was built.** Nothing shipped;
the game's music system and the Suno pool were never touched.

## The idea

Battle music that tightens as a match goes on, the way Shepard tones and
Risset rhythms seem to rise forever: one real hammer clock whose tempo and
layers ratchet UP on match progress only (rounds played + match point, flat
within a round, never down), with the perpetual illusions (an overtone
whistle climbing, tick density drifting) riding on top. The end plate was a
volume duck, not a stop, so FIGHT never felt like a reset; the bar
re-anchored on the gong.

## What was built, offline, in a day

A Bun renderer in bits-promos (removed with this note) that wrote a whole
fake five-round match: the ratchet clock; a seeded SONG per match from a
band of synthesised instruments (Karplus–Strong sitar with a bridge buzz and
sympathetic strings, oud, qanun, duduk, bowed strings, brass, a vowel
chant, darbuka and war-drum kits); chords from Tom's bardcore progression
library re-stacked in the band's scale; one band per arena (desert, Norse,
Roman) with a stated mood each.

## Why it was parked

Tom's ear, three renders in: the synthesised band did not reach the
quality bar of the produced Suno tracks the game already has, and the
heavier arena bands read as a folk group, then as too empty, never as a
fight to the death. Code-written instruments built in a day are not going
to beat a produced track, and the match-shaped behaviour was not worth
the drop in sound.

## If the ratchet idea comes back

Keep the real/illusion split and the volume-only duck; drop the generated
audio. The cheaper route is produced music in two or three intensity
versions per song (Suno can render the same song hotter), crossfaded up at
round boundaries on the existing music system, which needs the SCORE added
to `syncRoundMusic` for the match-point term.
