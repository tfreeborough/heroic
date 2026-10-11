/**
 * The channel's three sounds, made with ElevenLabs (the forge). Writes
 * public/sfx/<name>.mp3. `bun scripts/forge-sfx.ts [name…]` redoes just those.
 */
import { generateSfx } from "@heroic/forge";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = readFileSync(join(import.meta.dir, "../../desk/.env"), "utf8");
const key = env.match(/^ELEVENLABS_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!key) throw new Error("no ELEVENLABS_API_KEY in apps/desk/.env");

const SOUNDS: Record<string, { text: string; durationSeconds: number }> = {
  // Looped under the build; its volume follows how many glyphs are landing.
  ticks: { text: "a soft, even patter of tiny digital clicks and quiet keyboard ticks, like light rain made of typing on an old computer terminal, gentle, no rhythm, no melody", durationSeconds: 6 },
  // Once, on "Save complete".
  chime: { text: "a soft retro video game save confirmation chime, two gentle warm bell notes rising, short and clean", durationSeconds: 2 },
  // Very low, the whole video.
  hum: { text: "the quiet steady hum of an old CRT monitor with a faint high whine, calm, constant", durationSeconds: 8 },
};

const only = process.argv.slice(2);
await Promise.all(
  Object.entries(SOUNDS)
    .filter(([name]) => !only.length || only.includes(name))
    .map(async ([name, s]) => {
      writeFileSync(join(import.meta.dir, "../public/sfx", `${name}.mp3`), await generateSfx(key, { ...s, promptInfluence: 0.5 }));
      console.log("✓", name);
    }),
);
