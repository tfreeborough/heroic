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
| `hit` (non-bleed) | `weaponStrike` / `hitTaken` if it's you | attacker's weapon |
| `death` | `death` | — |
| `cast` | `abilityCast` | ability id |
| `detonate` | `abilityDetonate` | `sandtrap` |
| `harpoon` | `harpoonWhip` | — |
| `heal` | `heal` | — |
| `roundStart`/`fightStart` | `roundStart`/`fightStart` | — |
| `roundEnd`/`matchEnd` | those | `win`/`loss`/`draw` vs my team |

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
  `STREAK_WINDOW_MS` (4.5s) of the last, broken the instant that attacker dies.
  Tiers: 2 = Double, 3 = Multi, 4 = Mega, 5 = Ultra, 6+ = Monster Kill. A
  self-kill (your own sandtrap) breaks the chain and never announces.

Two sound events — `firstBlood` and `multiKill` (qualified by tier) — plus a big
gold centre-top banner (`FIRST BLOOD`, `DOUBLE KILL`, …) for ~1.9s.

**The voice clips are user-supplied VO, NOT Forge-generated** (Tom records them):
intelligible speech needs text-to-speech, which the Forge's sound-effects model
can't do. Drop the mp3s into `assets/audio/sfx/` and add a manifest line like any
other clip. Expected names: `announce_first_blood_1`, `announce_double_kill_1`,
`announce_multi_kill_1`, `announce_mega_kill_1`, `announce_ultra_kill_1`,
`announce_monster_kill_1`. (If we ever want to generate them, that's a TTS path
in the Forge — deferred.)

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
