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
ad and eats the scroll-decision second). The footage sits on the Stage
(`src/stage.tsx`: framed, vignetted, the blurred footage as the fill where
the shape leaves room), the brand mark + REC chip hold the corners, a
reveal rides the first ~3s, the tagline follows on an icon-led lower third,
and the whole pitch (features, FREE TO PLAY, iOS + Android, support-indie
line) lives in the outro — seen only by people who watched. Text in Inter,
the game's name in Cinzel; every word in `src/data/copy.ts` (`TAGLINES`,
`DEV`).

**The spotlights each have a flavour** (`src/spotlightKit.tsx`). A weapon is
forged: its icon slams into the frame with a crimson shockwave, sparks and
a shake, and a steel spec plate counts the sim's numbers up beneath it
(style, reach, windup, bleed). An ability is a rite: the icon rises into a
gold bloom, a cooldown ring draws itself round it, the charges light up as
pips, and the plate shows charges + cooldown. Both close on the pitch outro
by default; `ending: "signoff"` swaps in the match clip's indie sign-off.

| Composition | Props |
| --- | --- |
| `WeaponSpotlight` | `{kind:"weapon", id:"blade", clip?, clipSeconds?, clipStartFrom?, music?, ending?}` |
| `AbilitySpotlight` | `{kind:"ability", id:"sinkhole", …}` |
| `GameplayClip` | `{clip, title, line, durationSeconds, startFrom?, muted?, music?, ending?, push?, format?}` |

Every template takes `format`: `vertical` (1080×1920, the default), `square`
(1080×1080) or `landscape` (1920×1080); the layout adapts (`src/components.tsx`).

**The match clip is the premium one** — it's the template a single good
recording goes through, so it gets the trailer treatment (`src/stage.tsx`,
`src/cinematic.tsx`): the footage sits in a framed, vignetted rectangle
fitted to the recording's exact visible aspect (the Desk passes
`sourceAspect` from the sidecar; a CLI render measures the file), with the
same footage blurred and warmed as the fill wherever the shape leaves room,
and the fill breathing slowly behind it — the footage itself stays still,
because pixel art crawls a pixel at a time under a zoom (`push` is there if
you want one anyway). The title lands
in tracked, light-swept gold over the cold open with a "real gameplay"
eyebrow, the brand mark + REC chip hold the corners, the hook sentence
comes in on a broadcast lower third (hugging the footage, above the
platforms' own UI), the audio eases out into a dip, and it closes on the
sign-off (`ending: "signoff"` — an independent game, support indie games,
come and fight me; words in `DEV.signoff`), with the game's item, deed and
rank art popping into the space around the words (`roster.gallery`, synced
from the game) — or the spotlights' feature-list pitch (`ending: "pitch"`).

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
`out/` to `Heroic/BITS/Promos` in your Drive via rclone (only new/changed
files transfer — it's a sync, so re-renders re-upload and already-current
files are skipped). `bun run publish` = render the whole roster, then upload.
One-time setup: `rclone config create gdrive drive scope=drive.file`
(opens a browser to sign in; the drive.file scope means rclone can only
touch files it created, nothing else in your Drive).

Because of that scope rclone can't *see* folders you made in the Drive UI,
so the `upload` script doesn't use a path from the Drive root — it roots
itself at the `Heroic/BITS` folder by id (`root_folder_id=…`, the id from
the folder's URL) and writes into `Promos` beneath it. Spelling the path out
instead (`gdrive:Heroic/BITS/Promos`) would quietly create a second, duplicate
`Heroic` tree. To retarget — another game, say — swap in that game's folder id.

**Tuning a script without the simulator:** `bun scripts/dry-run.ts --kind
weapon --id staff` shoots the script headlessly and prints the beat
timeline — every hp change, cast, death and the round end, in seconds
since FIGHT. The showcase seeds a fixed RNG, so this is the exact fight the
capture would record; size foe hp and beats here, then capture once.

`render:roster` uses a clip whenever `public/clips/<kind>-<id>.mp4` exists,
whatever produced it — so if a script reads badly for some item, record
that one yourself on a phone and drop it in under the same name. Re-run
`capture` after any balance change; nothing else needs touching.

## The Desk — the day-to-day tool

`bun run desk` (repo root) opens [the Desk](../desk/README.md): phone clips
in from the Drive footage folder, cleanup, template + props with a live
preview, render in every format, the library of finished videos. This
package is its Blood in the Sand entry — `desk.config.ts` (folders, Drive
ids, formats) and `desk.templates.ts` (which compositions it offers).
Studio (`bun run studio`) is only for building templates.

Recordings live in `public/footage/` (media gitignored, sidecars committed);
`bun run footage:sync -- [--offline] [--add <file>…]` is the Desk's sync
without the page. One-time Drive setup (opens a browser):

```sh
rclone config create gdrive-footage drive scope=drive.readonly root_folder_id=1xslGjrceWPdqsBq11wU2wL7OLVi9-h-7
```

## Use it

```sh
cd apps/bits-promos
bun run studio                  # live preview, edit props in the UI

# one video
bunx remotion render AbilitySpotlight out/sinkhole.mp4 --props='{"kind":"ability","id":"sinkhole"}'

# every weapon + ability (~23 videos into out/)
bun run render:roster           # or: bun scripts/render-roster.ts --only harpoon,sinkhole

# phone footage: use the Desk (above). The raw template also works by hand:
bunx remotion render GameplayClip out/clutch.mp4 \
  --props='{"clip":"recording.mp4","title":"Match point","line":"He had one HP left. Then the Harpoon.","durationSeconds":12,"startFrom":4}'

# thumbnails / static posts (also great for Reddit + Discord announcements)
bunx remotion still WeaponSpotlight out/blade.png --frame=120 --props='{"kind":"weapon","id":"blade"}'
```

One render works everywhere: TikTok, Instagram Reels and YouTube Shorts all
take the same 9:16 MP4. Upload natively to each platform (don't cross-post
watermarked exports).

On a headless box, point Remotion at a Chrome/Chromium headless-shell build
with `REMOTION_BROWSER_EXECUTABLE=/path/to/headless_shell`; locally it
downloads its own.

## Store listing stills

`bun run render:store` renders the Google Play / App Store assets into
`out/store/`: the 1024×500 feature graphic (title-screen arena + helmet)
and one 1080×1920 phone screenshot per entry in `src/data/store.ts` — a
caption band over a framed capture. A capture is either a clip under
`public/clips/` with an `at` timestamp, or a PNG straight from a phone
(drop it under `public/`), so swapping in a menu screen is one data entry.
`--only feature,03-build` re-renders a subset. The listing prose lives in
[docs/store-listing.md](../../docs/store-listing.md).

## Adding a new weapon/ability video when the game grows

1. Ship the item in the sim + its icon in the game app (already the dev loop).
2. Add a tagline for its id in `src/data/copy.ts`.
3. `bun run render:roster -- --only <id>`.
