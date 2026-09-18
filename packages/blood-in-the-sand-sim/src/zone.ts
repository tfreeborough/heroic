/**
 * The bundled arena zones (docs/design/bits-arenas.md). They live inside this
 * package (not on the wire, not in an app's assets) so the Bun server and the
 * Expo client statically import the SAME files — a mismatch is impossible and
 * there's no disk-path plumbing. `welcome.zoneId` tells a client which one its
 * room is playing.
 *
 * Ordinary Realmsmith format-v1 JSON — open them in Realmsmith to edit (its
 * landing page lists them; "New arena" adds one here). arena-00: 1024×1024, a
 * centre pillar plus two 180°-symmetric slabs — the pillar breaks line of
 * sight (auto-targeting drops, attacks lock-break), which is what gives the
 * dash a juke purpose. Dressed with the desert tileset (tilesets.md).
 */
import type { ZoneFile } from "@heroic/core";
import { ARENAS } from "./zones";

export { ARENAS };

/** The original arena — the fixed map for anything scripted against its
 *  layout (the Primer, showcase captures, the bot script). */
export const ARENA_00: ZoneFile = ARENAS["arena-00"]!;

/** Every registered arena id, registry order. */
export const ARENA_IDS: readonly string[] = Object.keys(ARENAS);

/**
 * The arenas the server deals to ONLINE rooms (skirmish, brawl, ranked), one
 * picked uniformly per room. Hand-edited on purpose: an arena can sit in the
 * registry (practice, editor) while it's still being built.
 *
 * COMPATIBILITY: a client that doesn't know an id can't render it, and the
 * zone never travels — so adding an id here is a PROTOCOL_VERSION bump.
 */
export const ARENA_ROTATION: readonly string[] = ["arena-00", "desert-1", "grasslands"];

/** Pick a rotation arena with the caller's rng (Math.random on the server). */
export const pickArena = (rand: () => number): ZoneFile => {
  const id = ARENA_ROTATION[Math.min(ARENA_ROTATION.length - 1, Math.floor(rand() * ARENA_ROTATION.length))]!;
  return ARENAS[id] ?? ARENA_00;
};

/**
 * A skirmish host's map pick (`createRoom.arena`, v35) → the room's zone.
 * Only rotation ids count — a half-built registry arena is never dealt to
 * strangers, whoever asks — and anything else (absent, junk, unknown) is the
 * "random" answer: a fresh roll. Ranked never reads this; it always rolls.
 */
export const hostArena = (v: unknown, rand: () => number): ZoneFile =>
  typeof v === "string" && ARENA_ROTATION.includes(v) ? ARENAS[v]! : pickArena(rand);

/** A registry arena by id; unknown → the default (never throw over a map name). */
export const arenaById = (id: string | null | undefined): ZoneFile => (id ? (ARENAS[id] ?? ARENA_00) : ARENA_00);
