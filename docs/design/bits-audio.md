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
| `death` | `death` | — |
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
