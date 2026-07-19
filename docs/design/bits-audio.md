# Blood in the Sand — audio (SFX)

Status: **built 2026-07-15** — in-game SFX playback wired end-to-end (silent until
clips are forged) + a Blood-in-the-Sand authoring path in the Asset Forge ·
Applies to: Blood in the Sand (playback) + Realmsmith Asset Forge (authoring) ·
See also [asset-forge.md](./asset-forge.md), [audio.md](./audio.md),
[pvp-abilities.md](./pvp-abilities.md).

## The ask

Abilities cast and detonate with no sound; the same is true of every combat hit,
the match-flow beats, and the UI. We want (a) a way to **play** sounds in the
game and (b) a way to **produce** them for Blood in the Sand in the Forge — the
same fast sentence→candidates→saved-file loop the icons already use.

## What we reused (almost everything)

The audio stack was already built and proven in Enter the Gauntlet — this feature
is mostly wiring:

- **`@heroic/core` `createSoundScheduler`** — the pure "what plays for this
  moment" decider: variation banks, per-bank throttle, `qualifier`→variant,
  pitch randomisation. Made **generic over its event-key type** (`<E extends
  string = SoundEvent>`) so Blood in the Sand brings its own event vocabulary
  without widening core's deliberately-small shared `SoundEvent` union. Two-line,
  backwards-compatible change; the union stays the stable contract for games that
  speak it.
- **`@heroic/engine` `createAudioDirector` → `playSfx`** — the `expo-audio`
  voice-pool mixer (lazy pool, voice stealing, master/sfx/mute bus). Reused
  verbatim, no change.

## The one design idea: the catalogue *is* the manifest

Mirroring how the icon set derives its to-do list from the sim's tables, the
Blood-in-the-Sand **sound catalogue is a single artifact with two readers**:

- the **game** reads it as content — `apps/blood-in-the-sand/src/audio/catalogue.ts`
  maps each `BitsSoundEvent` to a clip bank;
- the **Forge** reads it (its mirror, `apps/realmsmith/src/forge/soundSet.ts`) as
  a **done-tick manifest** — a bank is "done" when its `<id>_<n>.mp3` exists.

They stay in lockstep by a naming convention, not a shared import (the app can't
import Realmsmith): bank ids are `hit_<weapon>`, `cast_<ability>`,
`detonate_<ability>` for the derived rows, plus a static combat/flow/UI list. A
new weapon or ability in the sim appears in **both** automatically — flagged in
the Forge until a sound brief is written in `SOUND_SUBJECTS`
(`forge/styleBible.ts`), exactly like `ICON_SUBJECTS`.

## Playback wiring

Client audio is a **process-wide singleton** (`src/audio/index.ts`): one
`AudioDirector` + scheduler, built lazily on first use (a menu that never sounds
holds zero native audio sessions) and woken by `unlockAudio()` on the first user
gesture (web/iOS need one). `playSound(event, qualifier?)` is fire-and-forget: a
no-op when throttled or when the clip isn't forged yet, so callers never branch
on readiness. A missing manifest entry warns once and stays silent — so the whole
catalogue is authored now and each slot lights up the moment its clip lands.

The hook point already existed: `GameScreen`'s `client.onEvents` drain (which
drives blood + haptics) now also calls `playSound` per `ArenaEvent`:

| Event | Sound | Qualifier |
| --- | --- | --- |
| `shoot` (ranged release) | `weaponFire`¹ | weapon (bow/staff) |
| `hit` (non-bleed) | `weaponStrike` / `hitTaken` if it's you & crit | attacker's weapon |
| `death` | `death` **+ `crowdCheer`** | — |
| `cast` | `abilityCast` | ability id |
| `detonate` | `abilityDetonate` | `sandtrap` |
| `harpoon` | `harpoonWhip` | — |
| `heal` | `heal` | — |
| `roundStart`/`fightStart` | `roundStart`/`fightStart` | — |
| `roundEnd`/`matchEnd` | those | `win`/`loss`/`draw` vs my team |

¹ Ranged weapons get **two distinct sounds**: a **release** (`weaponFire` →
`fire_bow`/`fire_staff`, the twang/whoosh) on every shot hit-or-miss, AND an
**impact** (`weaponStrike` → `hit_bow`/`hit_staff`, the thwack) when it connects —
the release is the satisfying feedback, the impact is the "it landed"
confirmation. Melee has only the impact (no projectile to loose). All `hit_*`
banks are impacts; `fire_*` banks are releases.

**Proximity (2026-07-16).** Positional sounds attenuate with distance from your
fighter (the listener; your corpse while spectating your own death). `playSound`
gained a `gain` (0..1) multiplier; GameScreen computes it per event as
`gainAt(x, y)` — full within `SOUND_NEAR` (250px), fading linearly to
`SOUND_FLOOR` (0.22) by `SOUND_FAR` (850px). Grounded to the 1600×1600px arena
(25 tiles × 64px): NEAR ≈ your immediate scrap, FAR ≈ half the map. A **floor,
not silence**, so distant
fights still read faintly as info (this is a competitive arena). Attenuated:
weapon fire/strike, ability cast (looked up by caster pos), detonate, harpoon,
heal, **death** (looked up by the dead player's pos). Always full: your own
`hitTaken` grunt, and all global cues — round/match stings, `countdownTick`, UI,
and the announcer (First Blood / multi-kills). No stereo panning — volume only
(expo-audio has no cheap pan). Constants at the top of GameScreen are the tuning
knobs; raise `SOUND_FLOOR` if distant deaths/casts should stay louder.

The **death** sound already fires on *every* death from *every* source (the sim
emits a `death` event from `killPlayer` for all kills incl. bleed; the client
plays it unconditionally) — now distance-scaled like other combat.

**Pit crowd roar (2026-07-18).** Alongside `death`, the client plays
`crowdCheer` — the mob in the arena stands reacting to the kill (the pit-crowd
visual, `apps/blood-in-the-sand/src/game/crowd.ts`). It's an **8-take variation
bank** (`crowd_cheer_1..8`, built 2026-07-18): the scheduler picks a random take
(never twice running) with a wide `pitchVariance` (0.12), so a bloody match never
sounds like one looped roar. **Non-positional** (always full — the whole bowl
reacts, not a point in space). **`throttleMs: 8300`** is set ABOVE the longest
take (~8.05s) on purpose: a new kill can NEVER start a second roar over one
already playing (Tom's rule — some takes run 8s) — a fresh cheer waits until the
current one finishes. Kept **COLD** (NOT in `warmCombatAudio`'s set): 8 long
clips would over-subscribe the voice pool, and the ~8s throttle means cheers
never fire in a burst a cold load could stutter — same call as the announcer
clips. NOTE (2026-07-18): the crowd VISUAL does not react to kills — an earlier
whole-mob bodily surge on death was ripped out ("looks crap"); the roar carries
it entirely. Later headroom: qualified variants (a bigger roar on a multi-kill, a
tense murmur on a near-death).

**Constant crowd ambience bed (scaffolded 2026-07-18, silent until forged).**
Under the one-shot cheers, a LOOPING crowd murmur plays the whole time you're in
the arena — the two are separate channels (looping music deck vs one-shot SFX
voices) so they layer, the bed never interrupted by a cheer. It rides the
engine `AudioDirector`'s existing crossfade **music decks** (proven in the
gauntlet), NOT new infra: `crowd_ambience` is registered as the arena's bed
(same clip for idle+combat = constant). BITS runs the director as a singleton
with no per-frame music tick, so `startCrowdAmbience` snaps the deck's fade-in
gain to full once (`director.tick(9999)`) and drives the AUDIBLE fade on the
music BUS via a small self-contained ramp in `audio/index.ts` — no game-loop
coupling. `stopCrowdAmbience` (GameScreen unmount) fades out then calls the NEW
engine `director.stopMusic()` (pauses both decks so nothing loops inaudibly).
Volume `AMBIENCE_VOLUME` 0.28 (music bus, under combat; tune on device); rides
the master mute. Owed from Forge: ONE long seamless `crowd_ambience` take (30s+)
— it'll be **crossfade-baked into a seamless loop** with ffmpeg like the cheer
fades — plus the one `require` line in `manifest.ts` (commented placeholder
already there). Future: swell the bed by round phase (calmer in the arming
countdown, fuller during the fight — the deck crossfade already supports it).

Bleed ticks stay silent (ambient, like their haptics). The 3·2·1 `countdownTick`
derives from the HUD countdown digit (not an event). UI sounds (`uiTap`,
`uiConfirm`) hook menu taps and the lobby **lock-in** (which had a
`TODO real lock-in SFX` — now fulfilled).

## Announcements — First Blood & multi-kills (2026-07-16)

Borrowed from Unreal Tournament: a **booming announcer voice** over big kill
moments. Detected **client-side** (`src/audio/killstreaks.ts`, a small pure
`KillStreaks` tracker) off the same lethal-`hit` stream — every kill routes
through a `hit` with a real player `attackerId` (weapon, projectile, sandtrap,
tremor, harpoon, and even lethal bleed via `tick.sourceId`), so attribution is
free and no sim/determinism change is needed. Every client runs its own tracker
over the same events, so **everyone in the match hears the same call** with no
networked announcement.

- **First Blood** — the match's first kill (once per match; the tracker lives as
  long as the GameScreen, which remounts per match).
- **Multi-kill** — a *continuous* chain by one attacker: each kill within
  `STREAK_WINDOW_MS` (4.5s) of the *last* kill (a rolling window — each kill resets
  the clock), broken the instant that attacker dies.
  Tiers: 2 = Double, 3 = Multi, 4 = Mega, 5 = Ultra, 6+ = Monster Kill. A
  self-kill (your own sandtrap) breaks the chain and never announces.

Two sound events — `firstBlood` and `multiKill` (qualified by tier) — plus a big
gold centre-top banner (`FIRST BLOOD`, `DOUBLE KILL`, …) for ~1.9s.

**The voice clips are user-supplied VO, NOT Forge-generated** (Tom records them):
intelligible speech needs text-to-speech, which the Forge's sound-effects model
can't do. (If we ever want to generate them, that's a TTS path in the Forge —
deferred.)

**Announcer packs (monetisation, 2026-07-16).** The announcer is meant to be
**sold as swappable packs** — a free `default`, premium voices/personas later —
so it's modelled as data in `src/audio/announcer.ts`, separate from the base SFX:
each pack is a folder `assets/audio/sfx/announcer/<pack>/` and an entry in
`ANNOUNCER_PACKS` mapping the six stable clip names to that pack's files. The
manifest just spreads in the **active** pack (`ACTIVE_ANNOUNCER`, hard-wired to
`default` for now). Because gameplay only references the stable clip names,
**selling or switching a pack is a change in `announcer.ts` alone** — never the
catalogue, scheduler, or GameScreen. Not built: pack *selection* (comes from
settings + entitlements when the store lands — see
[monetisation.md](./monetisation.md)); per-clip fallback to `default` for a
partial pack is a later option. Clip names: `announce_first_blood_1`,
`announce_double_kill_1`, `announce_multi_kill_1`, `announce_mega_kill_1`,
`announce_ultra_kill_1`, `announce_monster_kill_1`.

## Trigger latency — preloading (2026-07-16)

Symptom: some sounds played a beat late. Diagnosis: **not the files** (measured —
every clip's audio starts within ~30ms of t=0; the Forge's silence-trim already
handled them), but the **cold-load path**. The AudioDirector's SFX voice pool
loads a clip's source with `player.replace()` right before `play()`, and in
`expo-audio` that load is async — so the first trigger of any not-yet-resident
clip waits on it, and in dev the asset is even fetched from Metro over HTTP on
first play. With 8 voices cycling 39 clips, most triggers hit that path.

Two fixes:
- **Preload** every clip once at audio init (`preloadClips` → `Asset.loadAsync`,
  expo-asset) so the files are local before anything plays — kills the dev-mode
  HTTP-fetch delay outright.
- **Bigger voice pool for BITS** — `createAudioDirector` took an `sfxVoices`
  option (default 8, unchanged for the gauntlet); BITS passes 16 so the ~20
  frequently-triggered clips stay resident instead of being evicted and reloaded
  cold. Bounded, so still Android-session-safe.

If latency ever persists in a *production* build (local files, no fetch), the
next lever is a resident player per clip (zero per-play decode) — deferred, since
preload + a warm pool should cover it.

## Frame freezes on first plays — voice warming (2026-07-17)

Symptom (low-end device): the whole screen froze for a beat whenever an
ability fired — own casts, enemy casts, and worst at a 4v4's opening scrum.
Diagnosis: the 2026-07-16 preload warmed the **files** (into the asset cache),
but no **player** holds a clip until its first `playSfx` — which pays
`createAudioPlayer(source)` (native player instantiation) or
`player.replace(source)` (native source load) on the exact frame the game
moment fires. Every distinct clip's first play in a session = one mid-combat
hitch; a first teamfight fires many novel clips in one frame.

Fix: **`AudioDirector.warm(names)`** — pre-loads clips onto *pinned* voices,
staggered one native load per ~90ms so warming itself never hitches. Pinned
voices are softly held: ordinary churn (UI taps, stingers) loads onto unpinned
voices first, so the warm set stays resident; a pinned voice is evicted (and
unpinned) only when every unpinned voice is busy. The app calls
`warmCombatAudio()` on RoomScreen mount (the lobby is the calm before the
fight; GameScreen mounts it too as a rejoin backstop) with the **mid-combat
set** (~22 clips) derived from the catalogue's combat events — every cast,
strike, fire, death, hurt, whip, heal, detonate — so a newly forged clip warms
itself. `SFX_VOICES` 16 → 26: the warm set plus unpinned churn headroom.

Deliberately left cold: match-flow stings and UI (play at calm phase
boundaries) and the **announcer** (first blood / multi-kill tiers, 6 clips —
these DO fire mid-combat, so if a first-blood hitch shows up on device, add
them to the warm set and raise the pool to ~32). Why not warm all ~42 clips:
the constraint isn't only memory — Android caps native audio sessions/tracks
per process (the original reason the voice pool exists), so the pool stays
bounded and the warm set is chosen, not universal.

## iOS per-play cost — re-arm + start budget (2026-07-17)

Warming fixed Android but an iPhone SE 3 dev build stayed choppy in busy
fights; the dev menu's SFX kill-switch A/B (Tool 3) confirmed the audio path
as the cost. On iOS, even a warm fire is a batch of native AVPlayer calls
that dispatch through the main thread — `seekTo(0)`, `setPlaybackRate`,
volume, `play()` — and busy fights fire sounds near-continuously. Two
director changes:

- **Re-arm on finish**: each voice carries a persistent finish listener that
  seeks back to 0 while the voice is *idle* (guarded against rewinding a
  just-refired or stolen voice), so a warm fire skips `seekTo` — the
  costliest call — entirely. Falls back to the hot-path seek if the finish
  event never came; short clips (< the 250ms voice-hold) also keep the
  fallback.
- **Per-frame start budget**: at most 3 native play-starts per 16ms window;
  surplus burst sounds are dropped before any native work (perceptually
  masked by the ones that played).

Still choppy after those two — because the sneakiest cost wasn't the *calls*,
it was the *reads*: voice selection scanned `player.playing` across the pool
per play, and expo-audio property getters are synchronous JSI hops into
native (main-thread on iOS). A warm 26-voice pool × fight-rate plays =
hundreds of sync native reads a second — and warming made it WORSE (bigger
pool to scan). Third pass, the **JS mirror**: each voice mirrors `busy` /
`loaded` / `atStart` in plain JS, maintained by its status listener and the
fire path, so voice selection touches zero native properties. A `MAX_BUSY_MS`
escape hatch in `free` keeps a lost status event from leaking a voice.

**Correctness scare (2026-07-18, lessons baked into director.ts comments):**
the first mirror version over-reached and broke playback (late / doubled /
missing sounds). Two rules survived the fix:
- Only `didJustFinish` may free a voice, and REGARDLESS of fire recency —
  most combat clips are shorter than the 250ms voice-hold, so their finish
  lands inside it; a "stale event" guard there locks every short clip's
  voice until the escape hatch.
- The listener never touches the playhead. Re-arming idle voices to 0 (to
  skip the hot-path `seekTo`) triggered on transient `!playing` states and
  rewound live sounds — heard as double-fires. The seek stays at fire time;
  `atStart` only skips it for a freshly loaded item. Same class of caution:
  don't skip "unchanged" volume/rate pushes — whether `replace()` resets
  native state is expo-audio-internal.

If iOS *still* stutters with selection reads gone, expo-audio (AVPlayer
one-shots) is the wrong tool for game SFX and the ladder's last rung is
swapping SFX playback to `react-native-audio-api` (Web Audio: decoded
buffers, native-engine playback, per-play cost ≈ nothing) — music decks
would stay on expo-audio. Native dep + dev-client rebuilds; needs Tom's
buy-in.

## Forge authoring path

`sfx-bits` is its own asset type (symmetry with `icon-bits` being separate from
the gauntlet's `sfx`), sharing the whole ElevenLabs pipeline (3-take banks, trim,
loudness-normalize, sidecars) but with:

- a **desert-arena sound identity** (`BITS_SOUND_IDENTITY`) carried by the
  template and the LLM expander (the expander is now identity-parameterised);
- destination `apps/blood-in-the-sand/assets/audio/sfx`;
- a **done-tick sound manifest** in the panel — grouped combat / ability / flow /
  UI, "N of M done", pick a bank → its brief seeds the prompt box → generate 3 →
  audition → keep → save. Save hands back the exact `src/audio/manifest.ts` line.

## Out of scope (v1)

- **Music beds** — none yet; the director's music decks sit idle. Seamless loops
  are a separate problem (same call as [asset-forge.md](./asset-forge.md)).
- **Positional audio** — every cast/hit is heard flat. The cast tell being
  audible to everyone is deliberate (it's gameplay information).
- **Volume/mute settings UI** — the director supports it (`setAudioMuted`); a
  Settings toggle can land later. Defaults to full volume, unmuted.
