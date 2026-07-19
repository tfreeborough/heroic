# Audio: Music & Sound

Status: **music shipped (v1)** · SFX scheduler built (core) — app wiring in progress · Applies to: both
games (shared system) · First consumer: Enter the Gauntlet · Last decided: 2026-07-19

Built: `core` carries `ZoneAudio` + the `musicState` decider **and now the pure SFX scheduler**
(`audio/sound.ts`); `@heroic/engine` has the `AudioDirector` — music beds crossfade on `expo-audio`,
one-shot SFX mix through **react-native-audio-api** (Web Audio; see the 2026-07-19 section below);
Enter the Gauntlet plays its idle bed (`assets/audio/music/idle.mp3`), crossfading to combat when a
combat bed exists. Remaining: the app catalogue + clip files + the call-site wiring that feeds the
scheduler's decisions to `playSfx`.

How the game makes sound. Two halves share one system: **music** — zone-attached, looping beds that
crossfade with the situation (idle ↔ combat) — and **SFX** — short one-shot sounds tied to gameplay
events (weapon hits, creatures, spells). This first pass **builds the music half** and **designs the SFX
seams** so weapon/creature/spell sounds drop in later without re-architecting.

Today there is no audio at all. The one precedent is `haptics.ts` (app-side, fire-and-forget, called from
the sim on combat events, throttled so bursts don't blur). SFX will follow that pattern exactly; music is
the new shape this doc introduces.

## Terms (we're new to this)

- **Bed** — a looping music track for a situation: the *idle bed*, the *combat bed*.
- **Crossfade** — fade one bed's volume down while fading the next one up, so the switch is smooth, not a
  hard cut.
- **One-shot** — a short, non-looping SFX played once on an event (a sword connecting).
- **Bus** — a volume group. We have a **Music** bus and an **SFX** bus, both under a **Master**. Muting or
  lowering a bus scales everything routed through it.
- **Director** — the runtime object that owns the audio players, runs the crossfades, and plays one-shots.
- **Stems** — separate instrument layers of *one* piece, layered in/out for intensity. We are **not** using
  stems now (see Decisions); the model can grow into them later.

## The problem

We want, eventually: a background soundtrack that fits each place, that *reacts* — combat music when a
fight starts, calm again when it ends — plus a full range of effect sounds (weapons, spells, creatures,
destruction, UI). Enter the Gauntlet is a linear realm sequence with little ambient variety; Journey to
Greatness' open world wants **per-zone** idle/combat music that fades in as you enter
([realms-and-overworld](./realms-and-overworld.md)). So music is a property of the **zone**, switched by
the **combat state**, and the system must run on phone (Expo native) and web alike.

## Decisions (this pass)

1. **Crossfade between named beds**, not layered stems. A zone declares named beds (`idle`, `combat`,
   later `boss`/`ambient`); the director crossfades to whichever situation is active. Our two existing
   tracks are the first two beds. Simplest thing that covers the case and grows; stems would need
   tempo-synced multitrack authoring we don't have.
2. **The reusable mixer lives in `@heroic/engine`.** That package is already "the only place that knows
   device/runtime concerns" (frame timing, physics, Skia) — the audio device API belongs there too, and
   Journey to Greatness inherits it for free. The app supplies the manifest and the asset files.
3. **Music now, SFX seams designed not built.** Ship zone-attached idle/combat music + master/bus volume.
   Define the SFX event vocabulary and where it plugs in; don't wire clips yet.

## Layering (maps onto the existing split)

The three-layer rule the repo already follows — pure core, device-aware engine, app wiring — applies
cleanly:

| Layer | Owns | Why here |
| --- | --- | --- |
| `@heroic/core` (pure TS) | Zone music **metadata** in the format; the pure **idle/combat decider**; (later) the typed **sound-event vocabulary** | No device APIs — unit-testable like the AI hysteresis and `loadZone` |
| `@heroic/engine` (device) | The **AudioDirector**: loads/loops/crossfades beds, plays one-shots, master + bus volume — built on `expo-audio` | Device playback = runtime concern, same bucket as `useGameLoop` |
| `apps/enter-the-gauntlet` | The **manifest** (clip name → file), the **wiring** (feed zone + combat state to the director, tick its fades), and the **audio files** | Content + per-game glue, like the zone JSON and the Skia bake |

Core never imports `expo-audio`. The director never decides *when* combat music plays — it's told. Mirrors
how the sim decides a strike landed and `haptics.ts` just plays the pulse.

## Music: the model

### Beds attached to the zone

Music is zone data. Add an optional `audio` block to the authored `ZoneFile` and pass it through to the
runtime `Zone` (`packages/core/src/zone/format.ts`, threaded in `loadZone`). It's **additive and optional**,
so no `ZONE_FORMAT_VERSION` bump — existing zones with no audio just stay silent.

```ts
/** Music situations a zone can supply a bed for. Open to extension (boss, ambient…). */
export type MusicSituation = "idle" | "combat";

export interface ZoneAudio {
  /** Situation → clip name in the app's audio manifest. A zone may supply any subset. */
  beds: Partial<Record<MusicSituation, string>>;
  /** Seconds to crossfade when the active bed changes. Default 2. */
  crossfade?: number;
}
```

On `ZoneFile` and `Zone`: `audio?: ZoneAudio`. `loadZone` copies it verbatim (no transformation) — one
line added to the returned object. A zone with no `audio` is silent. A zone that has *some* beds but none
for the current situation **keeps the current bed playing** — so an idle-only zone stays on idle through a
fight until a combat bed is authored (this is how Enter the Gauntlet behaves today, with only `idle.mp3`).

Realmsmith gets an editor UI to author these beds later — out of scope here, tracked against
[world-representation](./world-representation.md) / [realmsmith](./realmsmith.md). For now they're hand-set
in the zone JSON.

### The idle ↔ combat decider (pure, in core)

"In combat" is already computed every step: each enemy carries an **`engaged`** flag (chasing vs idling,
with edge hysteresis — `packages/core/src/ai/perception.ts`). Combat music = **any enemy engaged**. To stop
the music snapping back to idle the instant the last enemy dies or briefly breaks line-of-sight, we add a
**hangover**: combat music lingers a few seconds after engagement ends. This is a pure, deterministic,
unit-testable state machine — same shape as the perception leash:

```ts
// packages/core/src/audio/musicState.ts
export interface MusicState {
  situation: MusicSituation; // the bed that should be playing
  hangover: number;          // seconds of combat music left after disengage
}

export const initMusicState = (): MusicState => ({ situation: "idle", hangover: 0 });

/** Advance the music situation. `inCombat` = any enemy engaged this step. Returns the active situation. */
export const stepMusicState = (
  state: MusicState,
  inCombat: boolean,
  dt: number,
  hangoverSecs = 4,
): MusicSituation => {
  if (inCombat) {
    state.situation = "combat";
    state.hangover = hangoverSecs;
  } else if (state.situation === "combat") {
    state.hangover -= dt;
    if (state.hangover <= 0) state.situation = "idle";
  }
  return state.situation;
};
```

**What shipped:** the app computes `inCombat` as *any living enemy within `COMBAT_MUSIC_RADIUS`* (≈7 tiles,
`game/constants.ts`) of the player — a cheap, tunable proxy for the AI's own engagement (the brain keeps
`engaged` in opaque archetype state, so we don't reach into it). It calls `stepMusicState` each step and
hands the result to the director. With only an idle bed today this path is inaudible but live; refine the
trigger to true brain-engaged state if it ever feels off once a combat bed exists.

## The AudioDirector (engine)

A two-deck crossfading player on top of `expo-audio` (the v56 SDK audio module: `createAudioPlayer`,
`player.loop`, `player.volume` 0–1, concurrent players, `setAudioModeAsync`, web-supported — no built-in
fade, so we ramp volume ourselves each frame).

Intended surface (final names settle in code review):

```ts
export interface AudioDirector {
  /** Set the active zone's beds + crossfade time. Call on zone load. */
  setZone(audio: ZoneAudio | undefined): void;
  /** Request the active situation; crossfades if it changed. Call each step with the decider's output. */
  setSituation(situation: MusicSituation): void;

  /** Master / per-bus volume, 0..1. */
  setMasterVolume(v: number): void;
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  setMuted(on: boolean): void;

  /** Advance crossfades. Call once per render frame with dt. */
  tick(dt: number): void;

  /** One-shot SFX — designed now, used in the SFX pass. */
  playSfx(name: string, opts?: { volume?: number; pitchVariance?: number }): void;

  dispose(): void;
}
```

How it runs:

- **Two music decks (A/B).** The active bed loops on one deck. On a situation change, load the new bed onto
  the idle deck at volume 0 (looping), then over `crossfade` seconds ramp the outgoing deck → 0 and the
  incoming → full in `tick`. A faded-out deck is paused so it stops decoding silence. A situation with no
  bed is a no-op — the active deck keeps playing. Re-requesting a bed already loaded on the off-deck just
  reverses the fade (no restart), so rapid idle↔combat flips stay smooth.
- **Volume model.** Each deck's real volume = `master · musicBus · fadeGain · mute`. Any control change
  recomputes; `tick` only moves `fadeGain`. One source of truth, no fighting.
- **Looping.** Beds set `loop = true`. (mp3 has a few ms of encoder padding that can tick at the loop seam;
  inaudible on long beds — revisit with seamless encoding / the gapless playlist API only if it ever bites.)
- **`expo-audio` dependency** added to engine as a **peerDependency** (the app already bundles Expo).

## App wiring

- **Manifest** — `apps/enter-the-gauntlet/src/game/audio/manifest.ts`: `clip name → require("…/assets/audio/…")`,
  same bundling story as the zone JSON. The director resolves bed/SFX names through it.
- **Director lifecycle** — created once in a `GameScreen` effect. On mount: `setZone(ZONE.audio)` then
  `resume()`. Each step (tail of `onStep`): `setSituation(stepMusicState(…))` then `tick(dt)` — the fade
  advances on simulated time, no `onRender` involvement. Disposed on unmount.
- **Web autoplay** — browsers block audio until the first user gesture, so the first thumbstick touch
  (`handleStick`) calls `resume()`. Native autoplays from the mount `resume()`.
- **Backgrounding** — an `AppState` listener calls `director.suspend()` (releases the OS audio session via
  `setIsAudioActiveAsync(false)`) when the app leaves the foreground and `resume()` on return.
- **Silent switch / focus** — **not yet configured**: we run on `expo-audio` defaults (`playsInSilentMode`
  true, `mixWithOthers` — our music plays *over* other apps' audio, doesn't pause it). Whether to take audio
  focus (pause/duck Spotify) and whether to respect the iOS mute switch are product calls; wire an explicit
  `setAudioModeAsync` when they're decided (good companion to the in-game mute below).

## SFX: the model *(decided 2026-07-05)*

Mirrors music exactly — **core decides, engine plays, app supplies content** — so it's testable and the
other two games inherit the whole thing. The SFX pass subscribes to the **same event points haptics fires
from** (`haptics.ts` is the map: strike, hit-taken, crit; plus breakable-destroyed / explosion), and adds a
footfall cadence and the UI moments (level-up, talent pick).

### Events are a *type* + an open *qualifier* (the key move)

A raw `event → one clip` map doesn't survive contact with a real game: creature deaths sound *entirely*
different per creature, and footsteps depend on the *surface* under the foot. So an event is a stable
**type** (the shared vocabulary) **plus an open-string qualifier** (the per-game variable) that selects a
**variant bank** of clips, with an optional base bank as fallback:

```ts
// packages/core/src/audio/sound.ts
type SoundEvent = "weaponStrike" | "projectileFire" | "hitTaken" | "abilityCast" | "footstep"
                | "creatureDeath" | "breakableDestroyed" | "explosion" | "levelUp" | "talentPick" | "uiSelect";

interface SoundDef {            // one catalogue entry
  clips?: string[];             // base/fallback variation set (manifest names)
  variants?: Record<string, SoundBank>; // qualifier value → its own bank
  volume?; pitchVariance?; throttleMs?;  // config, inherited by variants
}
```

The **types** stay a small typed union in core (the contract every game speaks); the **qualifier values**
(`goblin`, `stone`, `sword`) are open strings the app binds in its catalogue — so a new creature or tileset
is a catalogue line, never a core change, and games 2 & 3 reuse the scheduler with their own content.

### The scheduler (pure, in core)

`createSoundScheduler({ catalogue, now, rng })` → `play(event, qualifier?, overrides?) → PlaySound | null`.
It resolves `variants[qualifier] ?? base`, picks a random clip (nudged off an immediate repeat),
applies a **per-bank throttle** (keyed by the *resolved* bank, so a footstep isn't gated by a sword and a
cleave hitting 6 targets fires once — better than one global floor), and returns `{clip, volume,
pitchVariance}` or `null`. Pure and deterministic (injected clock + `Rng`), unit-tested like the perception
hysteresis. Footsteps have no natural event — `stepFootstepCadence(state, distanceMoved, stride)`
accumulates travel and fires one footfall per stride; the app samples the tile under the player when it
fires and plays `footstep` qualified by that surface. A dash covers its distance in one step, so the helper
swallows an oversized step to one footfall (and the app can simply not tick it while dashing — dash has its
own whoosh).

### App wiring

- **Catalogue** — `apps/enter-the-gauntlet/src/game/audio/sounds.ts`: a `SoundCatalogue` binding events →
  clip names + config. Content, like the zone JSON; the designer's authoring surface.
- **Manifest** — SFX clip names → `require("…/assets/audio/sfx/…")`, alongside the music beds.
- **Wiring** — build the scheduler in `GameScreen`; at each haptic/`TODO(audio)` seam call
  `scheduler.play(event, qualifier)` and hand any non-null result to `director.playSfx`. Level-up rides the
  existing React level-watch effect; talent pick rides `TalentPickScreen`'s `onPress`.

Nothing in the music build blocked this; `playSfx`, the `sfxVolume` bus + its Settings slider all pre-exist.

### One-shots play through a voice pool *(decided 2026-07-06 — superseded 2026-07-19)*

`playSfx` originally created a fresh native player per one-shot, self-released on finish. At real
gameplay rates (footsteps every ~300ms + strikes + hurts) that exhausts Android's native audio
sessions — `AudioPlayer.constructor … Null pointer error creating session` — and leaks any player
whose finish callback never fires. The second pass owned a fixed **voice pool** (reusable
`expo-audio` players, warm pinning, stalest-steal) — but every voice was still a full OS media
player (ExoPlayer/AVPlayer), and BITS proved ~30 resident decoder pipelines plus per-play native
traffic freezes combat on weak Androids (and bred every iOS silent-drop workaround the director
carried).

### One-shots are Web Audio *(decided 2026-07-19)*

SFX now play through **react-native-audio-api** (Software Mansion's Web Audio implementation):
clips decode ONCE to in-memory PCM (`AudioBuffer`, ≈350KB/s stereo — size the warm set
accordingly); a play is a buffer-source → gain → destination graph mixed on a dedicated native
audio render thread. Dozens of simultaneous one-shots are the design point; the JS cost of a play
is two allocations. `warm(names)` = decode ahead (sequential, off-thread); a cold clip still fires
if its decode lands within ~250ms (first-ever UI taps), else stays silent — and is resident from
then on. The pool, stealing, busy-mirrors, deferred starts, and seek-before-play ordering are all
deleted with the media players; muted/zero-gain plays cost nothing. **Music beds stay on the
`expo-audio` two-deck crossfader** (two long-lived players, no per-play churn); both libraries
configure the shared iOS session with the SAME category (`playback` + `mixWithOthers`) so neither
fights the other. Positional **pan** (StereoPannerNode) is now a cheap future add.

## Volume, mute & settings

Master / Music / SFX buses + a global mute live on the director from day one. No settings UI yet — a future
pause/settings screen wires straight into these setters (and persists them). The silent-switch and
background behaviour above are the only audio policy shipping now.

## Out of scope / future

- **Realmsmith** bed authoring + preview UI.
- **Layered stems** (vertical intensity) — the bed model can grow into per-bed stem groups if we ever author
  for it.
- **Ducking** music under big one-shots (boss roar), and **positional** SFX (pan by on-screen position).
- **Per-band default music** as a fallback when a zone declares no beds ([realms-and-overworld](./realms-and-overworld.md) bands).

## Assets

- **Format: mp3.** Universally decodable on iOS, Android, and web. (ogg is unsupported on iOS/Safari; m4a/aac
  is fine on Apple but historically inconsistent on older Android — mp3 is the safe common denominator.)
  Deliver brother's tracks as mp3, or as wav we encode.
- **Loudness.** Normalise idle and combat beds to a consistent target so the crossfade doesn't jump in level,
  and leave headroom for SFX layered on top.
- **Location.** `apps/enter-the-gauntlet/assets/audio/music/*.mp3`, bundled via `require()` like the zone JSON.

## Build order (once this doc is agreed)

1. **core** — `ZoneAudio` on the format + `loadZone` pass-through; `musicState.ts` decider + tests.
2. **engine** — `AudioDirector` on `expo-audio` (two-deck crossfade, buses); `expo-audio` peer dep.
3. **app** — manifest + the two beds wired into `GameScreen` (zone load → `setZone`, step → `setSituation`,
   frame → `tick`), `setAudioModeAsync`, web-gesture start, background pause.
4. **verify** — fade in on launch, crossfade to combat on aggro, back to idle after the hangover, on
   device and web.
