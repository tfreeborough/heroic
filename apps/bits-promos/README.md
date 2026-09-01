# Blood in the Sand — promo video factory

Remotion templates that turn the game's real assets and sim numbers into
vertical (1080×1920) marketing videos for TikTok, Reels and Shorts. The
marketing plan these feed lives in [docs/marketing.md](../../docs/marketing.md).

## The idea

Templates are code, content is data. `bun run sync` copies the game's icon
PNGs + Cinzel font into `public/` and regenerates `src/data/roster.json`
straight from `@heroic/blood-in-the-sand-sim` — so names, cooldowns, charges
and reach in the videos can never drift from the shipped game. Producing a
video is picking a template and passing props.

## Templates

Every video **cold-opens on the footage** — no logo screen (it reads as an
ad and eats the scroll-decision second). A preview banner rides the first
~3s ("ABILITY PREVIEW · SINKHOLE · ● real gameplay, recorded in-match"),
a corner REC chip keeps the raw-capture framing, the tagline card slides
through mid-clip, and the whole pitch (features, FREE TO PLAY, iOS +
Android, support-indie line) lives in the outro — seen only by people who
watched. Text in Inter, the game's name in Cinzel; every word in
`src/data/copy.ts` (`TAGLINES`, `DEV`).

| Composition | Props |
| --- | --- |
| `WeaponSpotlight` | `{kind:"weapon", id:"blade", clip?, clipSeconds?, clipStartFrom?, music?}` |
| `AbilitySpotlight` | `{kind:"ability", id:"sinkhole", …}` |
| `GameplayClip` | `{clip, title, line, durationSeconds, startFrom?, muted?, music?}` |

**Sound:** simulator recordings are silent (`simctl` captures no audio) and
the footage plays muted. Drop a track in `public/music/` and pass
`music: "bed.mp3"` (or `bun run render:roster -- --music bed.mp3`) to lay it
under the whole video; phone recordings in `GameplayClip` keep their own
audio unless `muted`.

## Hands-free gameplay footage (the capture rig)

The spotlights get real in-game footage of the item without anyone
playing: the game has a dev-only deep link (`src/net/showcase.ts`) that
starts an offline match where *every* seat plays the item's choreographed
script (`src/net/showcaseScripts.ts`, docs/design/bits-showcase-scripts.md)
— melee holds its reach, ranged kites, each ability gets one clean beat;
Lifeline is a 2v2, Sinkhole a 1v3. No bot brains. The capture script opens
that link on the iOS Simulator and records the screen.

One-time: `bun run --cwd apps/blood-in-the-sand ios` (builds + installs the
dev app on a booted simulator). Gotcha: with an iPhone plugged in, Expo
insists on code-signing for the phone — unplug it, or after the pods step
build straight from `apps/blood-in-the-sand/ios` with
`xcodebuild -workspace BloodDev.xcworkspace -scheme BloodDev -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -derivedDataPath build build`
and `xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/BloodDev.app`
(don't disable signing — Clerk needs the keychain entitlement even on the
simulator). Then, per session:

```sh
# terminal 1 — Metro with the showcase link enabled (shipped builds ignore it)
EXPO_PUBLIC_SHOWCASE=1 bun run --cwd apps/blood-in-the-sand start -- --port 8082
#   connect the dev client to it (accept the "Open in Blood (Dev)?" prompt):
xcrun simctl openurl booted "bloodinthesand://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"

# terminal 2
cd apps/bits-promos
bun run capture -- --kind ability --id sinkhole   # → public/clips/ability-sinkhole.mp4 (+ .json)
bun run capture:roster                            # every weapon + ability, ~20s each
bun run render:roster                             # spotlights now cut to the footage automatically
```

The script decides every seat's kit, placement and movement, so there are
no per-capture flags beyond `--seconds`. A take is deterministic (fixed
seed) — re-shoot after a balance patch and the beat is identical.

**Pushing renders to Google Drive:** `bun run upload` copies every mp4 in
`out/` to the `blood-in-the-sand/promos` folder of your Drive via rclone
(only new/changed files transfer — it's a sync, so re-renders re-upload and
already-current files are skipped). `bun run publish` = render the whole
roster, then upload. One-time setup: `rclone config create gdrive drive scope=drive.file`
(opens a browser to sign in; the drive.file scope means rclone can only
touch files it created, nothing else in your Drive). Change the destination
folder in package.json's `upload` script.

**Tuning a script without the simulator:** `bun scripts/dry-run.ts --kind
weapon --id staff` shoots the script headlessly and prints the beat
timeline — every hp change, cast, death and the round end, in seconds
since FIGHT. The showcase seeds a fixed RNG, so this is the exact fight the
capture would record; size foe hp and beats here, then capture once.

`render:roster` uses a clip whenever `public/clips/<kind>-<id>.mp4` exists,
whatever produced it — so if a script reads badly for some item, record
that one yourself on a phone and drop it in under the same name. Re-run
`capture` after any balance change; nothing else needs touching.

## Use it

```sh
cd apps/bits-promos
bun run studio                  # live preview, edit props in the UI

# one video
bunx remotion render AbilitySpotlight out/sinkhole.mp4 --props='{"kind":"ability","id":"sinkhole"}'

# every weapon + ability (~23 videos into out/)
bun run render:roster           # or: bun scripts/render-roster.ts --only harpoon,sinkhole

# a gameplay clip: record on-device, AirDrop into public/clips/, then
bunx remotion render GameplayClip out/clutch.mp4 \
  --props='{"clip":"recording.mp4","hook":"He had one HP left. Then the Harpoon.","durationSeconds":12,"startFrom":4}'

# thumbnails / static posts (also great for Reddit + Discord announcements)
bunx remotion still WeaponSpotlight out/blade.png --frame=120 --props='{"kind":"weapon","id":"blade"}'
```

One render works everywhere: TikTok, Instagram Reels and YouTube Shorts all
take the same 9:16 MP4. Upload natively to each platform (don't cross-post
watermarked exports).

On a headless box, point Remotion at a Chrome/Chromium headless-shell build
with `REMOTION_BROWSER_EXECUTABLE=/path/to/headless_shell`; locally it
downloads its own.

## Adding a new weapon/ability video when the game grows

1. Ship the item in the sim + its icon in the game app (already the dev loop).
2. Add a tagline for its id in `src/data/copy.ts`.
3. `bun run render:roster -- --only <id>`.
