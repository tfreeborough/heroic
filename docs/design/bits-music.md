# Battle music — the arena score

*Designed 2026-09-04 (Tom + Claude); v2 same evening after the first on-device
listen. Status: client BUILT (`src/audio/music.ts`); tracks being generated in
Suno (Pro plan). Placeholders in the pool until the v2 takes land.*

## The shape (v3, 2026-09-07)

Rounds are short (expected to resolve inside a minute; the Closing Sands roll
at 45s — see [bits-sand-circle.md](./bits-sand-circle.md)) and a match is
first to three round wins.

- **The score belongs to the match.** v2 dealt one song per round and cut it
  on every end plate; on device the songs never got into their swing before
  the round was over. Now a song runs ACROSS rounds: ducked to 35% under the
  end plate and the next countdown, back to full at FIGHT. The round stinger
  lands over the duck (a softer button than the old hard cut).
- **A breath, then in.** The match's first fight opens with 4s of crowd and
  steel, then the song creeps in over 3s. After that the score is simply on.
- **Songs chain.** When one runs out the next starts from its top (its quiet
  opening is the breath). A five-round match hears two or three songs.
- **No song hogs the arena (2026-09-08).** Every pick is uniform over the
  pool minus the last 12 songs played, and that recent list persists across
  matches and launches — so a song sits out at least a dozen plays before it
  returns, and the rotation spaces itself. (The v3 per-match shuffled deck
  only stopped repeats inside a match; across an evening some songs came
  round far more than others.)
- **Match end fades out** (1.5s).
- **Practice is silent.** A bot scrimmage isn't the arena; the score would
  cheapen the tracks. The crowd bed and SFX still play.
- **The sands alignment is gone.** Wherever the song is when the tide rolls
  is where it is — the horn carries the moment. (A rejoin with the tide out
  still brings the score in at once.)
- **Songs ≥ 2:00, ideally 2:30**, each carrying its own sparse→relentless
  build; a track plays once, never loops.
- **Settings toggle.** "Battle music" row in Settings (`bits.music`, default
  on); off mid-song fades it out, the crowd bed and SFX stay.
- **Common tempo (100 BPM) across the pool** so it reads as one score. Key
  free per song. Each song is anchored on a different regional tradition
  (Roman, Greek, Egyptian, Byzantine, Iberian, Nordic, Armenian, Persian…) —
  the v1 "same drum kit, different lead" prompts all came out alike.

## Suno workflow (v5.5, Custom mode, Instrumental on)

Instrumental mode hides the Lyrics box; the style box carries everything.
Personas/Voices are vocal-only — no help for instrumentals.

**Write tags, not prose (learned 2026-09-06).** Suno reads the style box as a
list of descriptors. Long sentences get skimmed, and negations backfire —
naming an instrument you *don't* want can summon it. So: short comma-separated
tags, one known genre anchor per song, the mood, the shape ("starts quiet, slow
build, intense finale"), and the tempo. Put every "no" in Exclude Styles
instead. Keep each prompt under ~250 characters.

Exclude styles (every generation):
`brass fanfare, epic trailer, orchestral hits, choir, electric guitar, synth, EDM, vocals, lyrics, ballad, piano, pop`

One generation per song; pick the take whose opening is quietest and whose
peak lands late. If a take front-loads the build, discard it. If a take you
love is short, Extend it from its last bar with `intense finale, full
intensity, no breakdown` and Get Whole Song.

Commercial rights need the Pro/Premier plan active at generation time.

## The songs

Two styles per culture of the ancient arena world, so the pool differs at the
root rather than by lead instrument. Song ids (left) are the manifest keys and
file names. Every prompt shares the tail: instrumental, starts quiet, slow
build, intense finale, 100 BPM.

| culture | id | angle |
|---|---|---|
| Rome | `legion` | war march, Ottoman-mehter drums |
| Rome | `horns` | cornu horns + timpani, ceremonial |
| Greece | `cretan` | Cretan folk, lyra + bouzouki, dance rhythm |
| Greece | `hellas` | ancient lyre + aulos, Greek modes, solemn to driving |
| Egypt | `nile` | Nubian, ney + tabla, hypnotic |
| Egypt | `pharaoh` | Egyptian classical, oud + qanun, darbuka rhythms speeding up |
| Byzantium | `chant` | men's chant + war drums |
| Byzantium | `pontic` | Pontic lyra, fast Black Sea dance |
| Iberia | `hispania` | flamenco, guitar + palmas + cajón |
| Iberia | `celtiberia` | gaita bagpipe + tamboril war-pipes |
| The North | `north` | tagelharpa + lur horn + throat singing |
| The North | `berserker` | ritual war chant, huge skin drums, bone flute |
| Armenia / Caucasus | `duduk` | duduk + female vocalise |
| Armenia / Caucasus | `caucasus` | Georgian male polyphony + doli, lezginka dance |
| Persia | `persia` | santur + tar + tombak, ornamented |
| Persia | `zurkhaneh` | house-of-strength zarb drum + bell + chant |
| Carthage | `carthage` | Gnawa guembri + krakebs, trance groove |
| Carthage | `sahara` | Tuareg desert folk, tinde drum, handclaps, call-and-response |
| Gaul | `gaul` | Celtic war, bodhrán, carnyx horn, low whistle |
| Gaul | `druid` | dark pagan ritual, hurdy-gurdy drone, frame drums |
| Japan | `taiko` | taiko drum ensemble + shakuhachi |
| Japan | `kabuki` | kabuki/noh percussion, shamisen, tsuzumi, kakegoe shouts |
| China | `warring` | Chinese war drums + guqin + erhu |
| China | `opera` | Peking opera gongs + cymbals + jinghu |
| India | `mauryan` | Carnatic mridangam + konnakol + tanpura |
| India | `rajput` | Rajasthani folk, dhol + sarangi + been |
| The Steppe | `steppe` | morin khuur + throat singing + hoofbeat rhythm |
| The Steppe | `shaman` | shamanic frame drum, jaw harp, ritual |
| The Islands | `gamelan` | Balinese gong kebyar, accelerating |
| The Islands | `kecak` | Balinese kecak chant, interlocking voices |
| No place | `dread` | dark ambient, heartbeat, metal, chains |
| No place | `anvil` | industrial tribal, anvil + hammer rhythms |

### Rome

```
legion: Ancient Roman gladiator arena, war march, Ottoman mehter, davul drums, zurna, deep bass drums, marching rhythm, dark, cinematic, instrumental, starts quiet, slow build, intense finale, 100 BPM
```

```
horns: Ancient Roman ceremonial, cornu horns, timpani, taiko drums, drone, gladiator arena, dark, grand, restrained, instrumental, starts quiet, slow build, thunderous finale, 100 BPM
```

### Greece

```
cretan: Ancient Greek arena, Cretan folk, lyra, bouzouki, laouto, frame drum, Mediterranean dance rhythm, dark, driving, instrumental, starts slow and sparse, gradually speeds up, frantic finale, 100 BPM
```

```
hellas: Ancient Greek music, lyre, kithara, aulos double flute, tympanum drum, Dorian mode, solemn, dark, ancient arena, instrumental, starts with lyre alone, slow build, driving drums finale, 100 BPM
```

### Egypt

```
nile: Ancient Egyptian arena, Nubian folk, ney flute, tabla, bendir, hypnotic rhythm, dark, mysterious, instrumental, starts quiet, slow build, relentless drumming finale, 100 BPM
```

```
pharaoh: Egyptian classical, oud, qanun, riq, darbuka, maqsum rhythm, dark, dramatic, ancient arena, instrumental, starts slow and sparse, drums gradually speed up, frantic malfuf finale, 100 BPM
```

### Byzantium

```
chant: Byzantine chant, low male voices, wordless, drone, war drums, ancient arena, dark, solemn, cinematic, instrumental, starts with a single voice, slow build, pounding drums finale, 100 BPM
```

```
pontic: Pontic Greek folk, Pontic lyra, davul drum, Black Sea dance, serra, dark, fierce, ancient arena, instrumental, starts slow, gradually speeds up, breakneck finale, 100 BPM
```

### Iberia

```
hispania: Ancient Hispania arena, flamenco, Spanish guitar, palmas handclaps, cajón, bulería rhythm, dark, fiery, instrumental, starts slow and quiet, gradually speeds up, frantic rasgueado finale, 100 BPM
```

```
celtiberia: Celtiberian war music, gaita bagpipe, tamboril drum, Galician folk, war pipes, deep drums, dark, martial, ancient arena, instrumental, starts with a lone drum, slow build, roaring pipes finale, 100 BPM
```

### The North

```
north: Nordic folk, tagelharpa, lur horn, frame drums, throat singing, ancient arena, dark, cold, menacing, instrumental, starts quiet, slow build, pounding intense finale, 100 BPM
```

```
berserker: Viking ritual, war chant, low male voices, wordless, huge skin drums, bone flute, drone, dark, savage, ancient arena, instrumental, starts as a slow ritual, slow build, raging drums finale, 100 BPM
```

### Armenia / Caucasus

```
duduk: Armenian duduk, ethereal female vocalise, wordless, frame drums, drone, ancient arena, mournful, dark, cinematic, instrumental, starts quiet, slow build, driving drums finale, 100 BPM
```

```
caucasus: Georgian folk, male polyphonic chant, wordless, doli drum, panduri, lezginka dance rhythm, dark, fierce, ancient arena, instrumental, starts with a slow chant, gradually speeds up, frantic finale, 100 BPM
```

### Persia

```
persia: Persian classical, santur, tar, tombak, daf frame drum, ornamented, ancient arena, dark, hypnotic, instrumental, starts sparse, slow build, frantic drumming finale, 100 BPM
```

```
zurkhaneh: Persian zurkhaneh, zarb drum, bell, rhythmic chant, wordless, warrior training ritual, dark, hypnotic, powerful, ancient arena, instrumental, starts slow and heavy, gradually speeds up, pounding finale, 100 BPM
```

### Carthage

```
carthage: Gnawa, guembri bass lute, krakebs iron castanets, trance groove, North African, dark, hypnotic, ancient arena, instrumental, starts sparse, slow build, gradually speeds up, relentless finale, 100 BPM
```

```
sahara: Tuareg desert folk, tinde drum, handclaps, call and response, wordless, acoustic, hypnotic, dark, ancient arena, instrumental, starts quiet, slow build, driving clapping finale, 100 BPM
```

### Gaul

```
gaul: Celtic war music, bodhrán, carnyx war horn, low whistle, deep drums, drone, dark, wild, ancient arena, instrumental, starts quiet, slow build, thunderous drums finale, 100 BPM
```

```
druid: Dark pagan ritual, hurdy-gurdy drone, frame drums, bone rattles, wordless low chant, medieval folk, ominous, ancient arena, instrumental, starts almost silent, slow build, pounding intense finale, 100 BPM
```

### Japan

```
taiko: Japanese taiko drum ensemble, odaiko, shime-daiko, shakuhachi flute, biwa, dark, disciplined, ancient arena, instrumental, starts with a lone flute, slow build, thunderous taiko finale, 100 BPM
```

```
kabuki: Kabuki theatre music, noh percussion, tsuzumi drums, shamisen, nohkan flute, kakegoe shouts, wordless, dark, tense, ancient arena, instrumental, starts sparse with long silences, gradually speeds up, frantic finale, 100 BPM
```

### China

```
warring: Ancient Chinese war music, Warring States, Chinese war drums, guqin, erhu, bianzhong bronze bells, dark, solemn, ancient arena, instrumental, starts with guqin alone, slow build, pounding war drums finale, 100 BPM
```

```
opera: Peking opera percussion, luo gongs, bo cymbals, bangu drum, jinghu fiddle, martial scene, dark, frantic, ancient arena, instrumental, starts slow and sparse, gradually speeds up, clashing cymbals finale, 100 BPM
```

### India

```
mauryan: Carnatic percussion, mridangam, ghatam, kanjira, konnakol vocal percussion, tanpura drone, dark, intense, ancient arena, instrumental, starts with drone and a slow beat, gradually speeds up, blistering finale, 100 BPM
```

```
rajput: Rajasthani folk, dhol drums, sarangi, been, khartal, desert warrior, dark, proud, ancient arena, instrumental, starts with sarangi alone, slow build, pounding dhol finale, 100 BPM
```

### The Steppe

```
steppe: Mongolian folk, morin khuur horsehead fiddle, throat singing, wordless, hoofbeat rhythm, frame drums, dark, vast, ancient arena, instrumental, starts quiet, slow build, galloping drums finale, 100 BPM
```

```
shaman: Siberian shamanic ritual, big frame drum, jaw harp, bone rattles, throat singing, wordless, drone, dark, trance, ancient arena, instrumental, starts with a single slow drum, gradually speeds up, frenzied finale, 100 BPM
```

### The Islands

```
gamelan: Balinese gamelan gong kebyar, metallophones, kendang drums, gongs, interlocking rhythms, dark, dramatic, ancient arena, instrumental, starts slow and sparse, gradually speeds up, explosive finale, 100 BPM
```

```
kecak: Balinese kecak, interlocking male chant, chak chak, wordless, gongs, kendang drum, dark, hypnotic, ancient arena, instrumental, starts with a few voices, slow build, roaring mass chant finale, 100 BPM
```

### No place

```
dread: Dark ambient, cinematic tension, heartbeat drum, metallic percussion, chains, sub bass drone, ancient arena, dread, instrumental, starts almost silent, slow build, intense percussive finale, 100 BPM
```

```
anvil: Industrial tribal, anvil strikes, hammer rhythms, chains, deep drums, sub drone, ancient forge, dark, relentless, ancient arena, instrumental, starts with a lone anvil, slow build, hammering intense finale, 100 BPM
```

If a genre anchor pulls in something you don't want (a singer on `chant`,
`caucasus` or `kecak`, a guitar solo on `hispania`), add the offender to Exclude Styles
for that one generation rather than adding a "no" to the prompt.

## The client (v3, 2026-09-07)

`apps/blood-in-the-sand/assets/audio/music/<song>.mp3`, song = an id from the
table above (lowercase — Suno saves Capitalised; Linux builders care). 15
songs landed 2026-09-07, re-encoded in place to 112 kbps (52MB → 33MB);
originals stashed at `~/Documents/GitHub/heroic-audio-originals/music/`.

`src/audio/music.ts` owns it:

- `MUSIC_MANIFEST` is GENERATED (`musicManifest.generated.ts`, one line per
  `<song>.mp3`, written by `bun run sfx:manifest` in apps/realmsmith — the
  same script as the SFX manifest). The pool is its keys: drop the file in,
  run the script, done.
- **One expo-audio player of its own**, not the AudioDirector's decks — those
  carry the crowd-ambience loop. Fades ride a 33ms interval like the ambience
  ramp. `MUSIC_VOLUME` 0.55 over the crowd bed (`AMBIENCE_VOLUME` 0.18);
  rides the app-wide mute. `loop = false`; a `playbackStatusUpdate` listener's
  `didJustFinish` chains the next song in the deck.
- `syncRoundMusic(round)` is called **per frame from GameScreen's HUD derive**
  with the round snapshot, idempotent: a round number LOWER than the last
  seen (or a resolved match) = a new match → fresh shuffled deck, silent;
  `MUSIC_ENTRY_S` (4s of the first `active` frame, timed client-side) or
  `round.sands !== null` enters the score; active → level 1, countdown /
  roundEnd → `DUCK_LEVEL` 0.35, matchEnd / lobby → out (1.5s) and stays out
  until a fresh round 1. Snapshot-driven rather than event-driven so a
  mid-match rejoin behaves.
- Pick: `pickSong` (`@heroic/core` `audio/songRotation`, pure + tested) —
  uniform over the pool minus the last `RECENT_SONGS` (12) played, oldest
  plays released first if a pool is too small to hold all 12 out. The recent
  list is persisted (`bits.musicRecent`, `settings.ts`) and restored on the
  first sync; `nextSong` records every play. Local `Math.random`, never the
  sim rng. `stopRoundMusic` on GameScreen unmount fades out and forgets the
  match (the recent list survives).
- GameScreen skips `syncRoundMusic` for a `PracticeClient` — practice is
  silent.
- The pre-match asset warm (`preloadClips`) includes every music source.

## Open

- Forge the four button stings (round_win / round_loss / match_win /
  match_loss). Suno fallback if ElevenLabs can't do choir:
  `Low male choir, single sustained note, one gong strike, long reverb tail, cinematic stinger, dark, ancient arena, instrumental` —
  generate, trim the best 4–6s hit, normalise.
- On-device: the 4s entry + 3s fade, `DUCK_LEVEL` under the stinger and the
  countdown ticks, `MUSIC_VOLUME` against SFX + crowd.
- Peak-section loop for stalled rounds past ~2:30 (needs a per-song `peakAt`
  and a second player; not built).
- A music VOLUME slider (the on/off toggle shipped 2026-09-07).
- v1 retired 2026-09-04: calm/urgent twin per song with a `sandsStart`
  crossfade. The two-player crossfade code is in git history if a twin ever
  comes back.
