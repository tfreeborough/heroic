// Manual sync of the generated audio manifests (the Forge does the SFX one on
// every save/remove; music is hand-dropped Suno files, so this is its only
// path): `bun run sfx:manifest` after adding/moving files by hand.
import { resolve } from "node:path";
import { SFX_BITS } from "../forge/styleBible";
import { bitsManifestTarget, bitsMusicTarget, writeMusicManifest, writeSfxManifest } from "../forge/sfxManifest";

const repoRoot = resolve(import.meta.dir, "../../..");
const { count, strays } = await writeSfxManifest(bitsManifestTarget(repoRoot, SFX_BITS.destination));
console.log(`sfxManifest.generated.ts: ${count} clips${strays.length ? ` (ignored: ${strays.join(", ")})` : ""}`);
const songs = await writeMusicManifest(bitsMusicTarget(repoRoot));
console.log(`musicManifest.generated.ts: ${songs} songs`);
