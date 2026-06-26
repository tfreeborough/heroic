import type { AudioManifest } from "@heroic/engine";

/**
 * Clip name → bundled audio file. Zone `audio.beds` (and, later, SFX events)
 * name clips that resolve here; the AudioDirector looks them up. Keep the names
 * stable — they live in zone JSON. See docs/design/audio.md.
 *
 * Today: one idle bed. A combat bed drops in by adding the file, one line here,
 * and `"combat": "<name>"` to a zone's `audio.beds` — no code changes.
 */
export const AUDIO_MANIFEST: AudioManifest = {
  idle: require("../../../assets/audio/music/idle.mp3"),
};
