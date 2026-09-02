/**
 * The wire contract — pure types shared by the Bun server and the Expo client
 * (the realmsmith forge/protocol.ts precedent). JSON text frames over a
 * WebSocket; every message is a tagged union so fields stay strictly-additive.
 *
 * Design notes:
 * - Snapshots go out every tick (30Hz ≈ 21KB/s per client — nothing on LAN);
 *   SNAPSHOT_DIVISOR in config.ts is the one-constant path to 15Hz later.
 * - Transient events ride INSIDE snapshots: the socket is already ordered and
 *   reliable, so one stream needs no second channel.
 * - The zone itself is never sent — both ends import ARENA_00 from this
 *   package; `welcome.zoneId` only asserts they agree.
 */
import type { AttackPhase } from "@heroic/core";
import type { AbilityId, WeaponId } from "./config";
import type { ArenaEvent } from "./events";
import type { DeployableKind, ProjectileKind, RoundPhase, Team } from "./state";

/**
 * v2 (2026-07-09): rooms + host-driven lobbies replaced the single global room.
 * v3 (2026-07-10): lobby weapon picks (setWeapon), per-player weapon in
 * snapshots/room state, projectiles in snapshots; per-weapon telegraph config
 * moved off ArenaClientConfig (the client imports WEAPONS, like ARENA_00).
 * v4 (2026-07-12): `slowed` on player snapshots (the hammer's slow debuff
 * replaced its knockback — the client renders a slowed marker).
 * v5 (2026-07-12): `slowed` → `slowLeft` + `bleedLeft` seconds — the client's
 * status rings pulse faster as the effect nears expiry, which needs time, not
 * a flag.
 * v6 (2026-07-12): the pick ceremony (pvp-pick-ceremony.md). roomState becomes
 * VIEWER-DEPENDENT (per-team weapon/ability filtering; adds `picked`, `locked`,
 * `revealed`, `revealedAbilities`), RoundPhase gains "pick" + "reveal", client
 * gains `lockIn` (all-locked ends a draft phase early), and snapshots scrub
 * `weapon` during the hidden-pick phases. Ability loadouts ride the draft
 * (setAbilities), picked via the loadout sheet.
 * v7 (2026-07-13): the host owns the room — when the host leaves (or is gone
 * after the match), the room closes for everyone instead of migrating the crown.
 * Adds `roomClosed` (a kick with a reason; the client drops back to the list).
 * v8 (2026-07-14): abilities are castable (pvp-abilities.md). `input.dash`
 * generalises to `casts[]` (one latched flag per drafted slot); player
 * snapshots carry the slot list (id + cooldown + active seconds — cooldown
 * clocks and body-effect rings derive from these, replacing `dashCd`);
 * snapshots gain `deployables`; projectiles carry `kind` (weapon or harpoon);
 * events gain cast/detonate/heal. `dashCooldown` leaves the welcome config —
 * the client reads ABILITIES[id].cooldown from this package, the WEAPONS rule.
 * Amended 2026-07-15 (still unshipped, folded in): deployables carry `team`
 * (the sandtrap's yours/theirs rendering); slots carry `charges` (the
 * per-round budget); the harpoon is an instant chain — its projectile kind is
 * gone and a `harpoon` event carries the chain-line endpoints.
 * v9 (2026-07-15): the guided loadout flow (pvp-loadout-flow.md) replaces the
 * draft ceremony. GONE: `lockIn` + `startMatch` messages, the `pick`/`reveal`
 * RoundPhases, and `picked`/`locked`/`revealed`/`revealedAbilities` on
 * RoomStatePlayer (there is no reveal, ever — in-match, ability picks show
 * only through cast events, the cast flash). NEW: `armed` on RoomStatePlayer
 * (public: weapon + full hand picked), `forceStart` (host-only AFK backstop —
 * random-fills stragglers, then the same countdown runs). The 5s arming
 * countdown rides `round.timer` while the phase is "lobby" (0 = not running);
 * the `armingComplete` event cues the banner. Snapshots scrub picks in the
 * lobby only.
 * v10 (2026-07-16): loadouts drop from three abilities to two
 * (LOADOUT_ABILITY_COUNT). The wire shape is unchanged (casts[] and the slot
 * list were always variable-length), but the count is a compatibility
 * contract — a two-ability client can't share a match with a three-ability
 * server — so the version gates it.
 * v11 (2026-07-16): events gain `shoot` — a ranged weapon loosing a projectile,
 * so the bow/staff SFX fires on release (every shot) instead of only on impact.
 * Purely additive (older clients would ignore an unknown event), but bumped per
 * convention so client and server agree on the event vocabulary.
 * v12 (2026-07-16): host-selectable team sizes (1v1–4v4). `createRoom` gains
 * `teamSize` (1–4 → 2×N seats, sanitized server-side); `welcome` gains
 * `teamSize` (the client renders capacity/empty seats from it). Team
 * assignment is random-balanced server-side (join the smaller side, sim-rng
 * coin-flip on ties). The arming countdown now gates on a FULL room, with the
 * host's forceStart doubling as the partial-room launcher (a `forced` sim
 * override, cleared by any join/leave). The break is behavioural (full-room
 * gating + variable seat counts), so the version gates it.
 * v13 (2026-07-17): tremor REWORKED into an earthquake zone (pvp-abilities
 * §2) — the cast now spawns a `quake` DeployableKind fixed at the caster's
 * feet (chip ticks + a refreshed slow on enemies inside) instead of
 * resolving an instant slam — and the slam's peel becomes the NEW
 * `warding-shout` ability (§11), an instant no-damage knockback cone off the
 * facing. The wire SHAPE is unchanged, but both vocabularies grow
 * (deployable kinds, ability ids) and tremor's meaning flips, so the
 * version gates it.
 * v14 (2026-07-18): lobby liveness + host migration. A force-quit/lost-network
 * client often sends NO close frame (and the server's own snapshot broadcasts
 * keep Bun's idle timer from ever firing), so its seat lingered as a "ghost" —
 * a room that reads full but nobody can join, worst of all when it's the host.
 * Adds `ping` (client→server heartbeat every HEARTBEAT_INTERVAL_MS — the quiet
 * lobby's liveness signal; a match already streams input) so the server can
 * free a seat gone silent past HEARTBEAT_TIMEOUT_MS. The host no longer owns
 * the room's life (reversing v7): when the host leaves or times out the crown
 * hands off to another seated player and the room lives on — it only closes
 * when the LAST player is gone. Adds `notice` (server→client) for the
 * "X left — Y is now the host" lobby banner.
 * v15 (2026-07-19): bot backfill + team switching (bits-bot-backfill.md). A
 * host force-start now FILLS empty seats with server-run bots (previously it
 * waived them) — the same 5s countdown runs, and during it any seated player
 * may `cancelStart` (the veto: you queued for humans; bots dismissed, lobby
 * restored). `switchTeam` hops the sender to the other side when it has a
 * free seat (random-balanced assignment can split a couple who wanted to
 * fight each other). RoomStatePlayer gains `bot` (roster markers + the
 * cancel button's visibility). Cancel announcements reuse `notice`.
 * v16 (2026-07-20): team identity (bits-bot-backfill.md § team identity). Each
 * side gets a persistent COLOUR-NEUTRAL faction name, born with the room and
 * stable until it closes; `welcome` carries `teamNames` ([team 1, team 2]).
 * Colour flips from absolute (was: team 1 red / team 2 blue everywhere) to
 * RELATIVE — your side is always blue, the enemy always red, in lobby AND
 * match — so the name is the shared identity and the colour is the allegiance
 * cue. Only the welcome shape changes on the wire (names ride it once; they're
 * fixed for the room's life, so nothing per-tick); the colour flip is
 * client-only. The added welcome field is a compatibility contract, so the
 * version gates it.
 * v17 (2026-07-20): Straw Man REWORKED into a drop-taunt (pvp-abilities.md §
 * Straw Man): enemies inside the taunt radius at cast are force-locked onto
 * the dummy — an in-flight windup included — until the hold runs out, the
 * dummy stops being a legal mark, or they walk it out of their own weapon's
 * engagement radius. PlayerSnapshot gains `tauntLeft` (the victim's straw
 * status ring; the aim ring snapping to the dummy carries the rest).
 * v18 (2026-07-22): announcer packs ride the wire (monetisation.md § announcer
 * packs — the flex: when YOU take first blood / a multi-kill, YOUR pack's
 * voice plays to the whole room). `createRoom`/`joinRoom` gain `announcer`
 * (the sender's pack id) and RoomStatePlayer carries it PUBLICLY — kill
 * announcements are client-derived from the shared event stream, so all any
 * client needs is every seat's pack id; each then plays the ATTACKER's voice
 * and the room stays in unison. Free-form string on the wire (the sim doesn't
 * know the pack roster; length-capped server-side) — clients fall back to the
 * default pack on ids they don't recognise, so a newer player's exotic pack
 * degrades gracefully instead of breaking. Bots/dummies always announce in
 * the default voice. Entitlements are NOT here — until the store exists any
 * client may claim any pack.
 * v19 (2026-07-29): the ranked queue (bits-ranked.md). NEW client msgs:
 * `queueJoin` (bearer token + brackets — the FIRST authenticated message on
 * this socket; the server verifies against the shared DB, never the API),
 * `queueLeave`, `queueInfo` (unauthenticated queue-size read for the ranked
 * screen). NEW server msgs: `queueStatus` (per-bracket sizes + your wait),
 * `queueLeft`, `matchFound` (informational — the server SEATS you itself; the
 * standard `welcome` follows on the same socket, no joinRoom round-trip), and
 * `rankedResult` (the post-match settlement: rating deltas + tier + Glory,
 * broadcast into the room so the ceremony needs no API poll). `brackets` is
 * an array on the wire from day one so multi-queue (queue several brackets,
 * first match wins) is additive later; Season I clients always send ["1v1"].
 * Ranked rooms reject forceStart/cancelStart/switchTeam and outside joins.
 * Amended 2026-07-30 (still unshipped, folded in): rankedResult rows carry
 * `placement` ({number, of} while the player is in their placement matches,
 * null once placed) — during placements the client hides rank and rating
 * everywhere and shows placement progress instead (Tom, 2026-07-30).
 * Amended again 2026-07-30 (display v2, bits-ranked.md): rows also carry
 * `peak` (season-high rating after the settle) and `newBest` (this match set
 * it) — the ceremony's celebration hook; `tier` is now the DISPLAY tier with
 * the sticky-badge grace applied, not the raw band. Same day (divisions):
 * rows carry `division` — the middle six tiers split into III/II/I for a
 * 20-rung ladder; null in the single-rung end tiers.
 * Amended 2026-08-03 (achievements M1, achievements.md) — additive, NO bump:
 * new server msg `deedUnlocks` (this player's newly-unlocked achievement ids,
 * sent PER-SOCKET after the settle — never broadcast, a room-wide send would
 * leak secret-item unlocks to the opponent). Shipped v19 clients ignore
 * unknown message types (verified: the client switch has no default), so a
 * version bump would only lock them out for nothing; the ceremony client
 * lands in M2.
 * Amended 2026-08-08 (wearable titles, achievements.md § wearing titles) —
 * additive, NO bump: `createRoom`/`joinRoom`/`queueJoin` gain `title?` (the
 * sender's worn DEED ID, never display text) and RoomStatePlayer carries it
 * PUBLICLY like `announcer`. Clients resolve the display string from their
 * own ACHIEVEMENT_DEFS — an unknown id renders bare, so free-text spoofing
 * is impossible by construction. The ranked queue verifies the claim against
 * the entitlements table and SILENTLY strips unowned ids (a cosmetic never
 * costs a match); skirmish takes the client's word until M4 brings identity
 * to lobby sockets (the announcer-pack stance). Shipped v19 clients neither
 * send nor read the field.
 * (2026-08-08: a skirmish-counting amendment — `token?` on
 * createRoom/joinRoom feeding lifetime counters — was built and REVERTED
 * the same day: deeds are RANKED-ONLY by design (Tom: ranked is the mode
 * to push players toward, and per-mode counting rules are too hard to
 * explain). Don't rebuild it without that decision changing.)
 * v20 (2026-08-09): the TRIDENT — the first achievement-gated weapon
 * (bits-secret-items.md; The Sand snake grants `weapon:trident`). A new
 * weapon id is NOT additive: shipped bundles index WEAPONS[weapon]
 * straight off snapshots, so an old client meeting a trident would crash
 * — hence the bump (the mismatch screen walks stragglers through the OTA
 * update). No message shapes changed. Wizard hides gated items until
 * entitled; ranked validates picks server-side against entitlements
 * loaded at queue time; bots draft from the FREE roster only,
 * permanently (Tom: an earned item in hand is proof of humanity).
 * v21 (2026-08-09): the FANG — the first SIGNET (store) weapon
 * (bits-store-arms.md launch shelf, item 1) — and the poison status
 * (core stacking dot: stacks share one refreshed clock, tick damage
 * scales with stacks, all fall off together). PlayerSnapshot gains
 * `poisonLeft` + `poisonStacks` (the green status ring; weight scales
 * with stacks), hit events gain `poison?: true` (green tick tint). The
 * new-weapon-id rule from v20 applies — old bundles index
 * WEAPONS[weapon] off snapshots, hence the bump.
 * v22 (2026-08-09): the SCORPION — signet weapon 2 (bits-store-arms.md) —
 * and the burst mechanic (BurstConfig: follow-up bolts on their own
 * clock, re-aimed per release). No message shapes changed; the bump is
 * the new-weapon-id rule again (bolts also ride snapshots as projectile
 * kind "scorpion", which old bundles couldn't render).
 * v23 (2026-08-10): the BOMBARD — signet weapon 3 (bits-store-arms.md) —
 * and the shell entity: snapshots gain `shells` (launch/landing points +
 * landing clock — the telegraph ring both teams read, and the dodge data
 * a future bot pass reads the same way). Blast is the sandtrap idiom and
 * reuses the detonate event. New-weapon-id rule bumps as ever.
 * v24 (2026-08-10): the SINKHOLE — the first SIGNET ability
 * (bits-store-arms.md): a thrown both-teams pull zone, deployable kind
 * "sinkhole" (old bundles can't index the new ability id off slot
 * snapshots, hence the bump). FREE_ABILITY_IDS now genuinely excludes a
 * gated id for the first time — bots and random-fill never draft it.
 * Amended same day — additive, NO bump: cast events gain `tx`/`ty` (a
 * thrown cast's landing point, the lob-FX endpoint — carried ON the
 * event because the sampled view lags the interp delay; the harpoon
 * precedent). Absent for every at-the-feet cast.
 * v25 (2026-08-10): the TAR PIT — signet ability 2 (bits-store-arms.md,
 * REDESIGNED at build from a placed circle to a movement-painted TRAIL):
 * deployable kind "tar", many small growing blobs laid behind the caster
 * during the cast's active window. New ability id ⇒ bump, as ever.
 * v26 (2026-08-11): TITAN'S DRAUGHT — signet ability 3 (bits-store-arms.md):
 * a status buff (the Ironhide family). No new wire shapes — the client
 * derives the grow scale from the slot's broadcast active window, and the
 * sim's radiusOf/damageFactorOf read the same status. New id ⇒ bump.
 * v27 (2026-08-14): the LIFELINE — signet weapon 4, the LAST launch-shelf
 * item (bits-store-arms.md): the first beam weapon (core combat/beam.ts
 * link primitive; no attack cycle). PlayerSnapshot gains `beamTargetId`
 * + `beamLink` (the drawn beam + its ramp glow). Heals ride the existing
 * heal event (casterId = the healer — the healing deed chain now has a
 * real team engine); snap ticks are plain hit events. New id ⇒ bump.
 * v28 (2026-08-15): seat tokens + ranked-door hardening (bits-reconnect.md
 * § seat tokens; the 2026-08-15 security audit confirmed all four holes).
 * Every seat is minted a random per-seat secret when first taken, carried in
 * `welcome.seatToken`; `joinRoom` gains `seatToken?` and a disconnected seat
 * is reclaimed ONLY on a matching token — no token, no reclaim, ever
 * (previously anyone with the code could take over an idling body, rename
 * it, and play out the owner's ranked match). The ranked doors close with
 * it: a ranked join that can't prove a seat, and ANY `watchRoom` on a ranked
 * room, reject with the same generic "no such room" a guessed code gets —
 * a ranked room doesn't exist to outsiders, and a watcher feed is
 * full-position wallhack intel for an accomplice. Server-side on the same
 * bump: one live ranked seat per account (a second socket on the same bearer
 * token could farm parallel bot-backfill matches), and a ranked rejoin keeps
 * the seat's OWN name/title/announcer — a rejoiner resumes an identity,
 * never creates one (the queue-time entitlement check otherwise had a
 * verbatim bypass through Room.seat()).
 * v29 (2026-08-24): the 2v2 SOLO QUEUE (bits-ranked.md § 2v2 solo queue).
 * `RANKED_BRACKETS` gains "2v2" (teamSize 2, NO bot backfill) — the matcher
 * takes four solo entries and dictates the sides (best + worst vs the middle
 * two), `rankedResult.results[]` carries four rows (one per seat; the shape
 * was an array from day one), and `queueJoin.brackets[]` may now name both
 * brackets at once (multi-queue, first match wins — the client UI finally
 * exposes it). No new message shapes; the bump exists because a v28 client
 * has no 2v2 card to seat into and would be reading a 4-row settlement it
 * never expected.
 * v30 (2026-08-25): QUEUE ROAMING + MATCH ACCEPT (bits-ranked.md § Queue
 * roaming & match accept). A pairing no longer seats anyone: the server opens
 * a PENDING match and every player must say yes within the window. NEW server
 * msgs: `matchReady` (the summons — bracket, seats, seconds to answer),
 * `matchPending` (accept progress, `accepted` of `players`), `matchCancelled`
 * (the pending match fell through: `dodged` = YOU were at fault, out of the
 * queue with `lockoutSec` to serve; otherwise you're already back in line
 * with your earned wait and a queueStatus follows). NEW client msgs:
 * `matchAccept`, `matchDecline`. Once everyone is in, the v19 flow runs
 * unchanged (`matchFound` → seat → `welcome`). Bot backfill matches go
 * through the same stage. Bump: a v29 client would sit through every
 * summons in silence and eat a lockout each time.
 * v31 (2026-09-02): store drop 2 — THREE new signet abilities
 * (config.ts has each design note): SHARD OF TRUE ICE (a freeze status:
 * PlayerSnapshot gains `frozenLeft`, hit events gain `immune?: true`, new
 * `freeze` event), MAGIC MIRROR (a telegraphed position swap:
 * PlayerSnapshot gains `mirrorTargetId`, new `mirror`/`mirror-swap`
 * events, and AbilityDef grows `initialCooldown` — the round-start lock),
 * and ELVEN CLOAK (a concealment status — no new wire shapes; the client
 * fades the body off the slot's broadcast active window, and a new
 * `decloak` event marks the drop). New ability ids ⇒ bump, as ever.
 */
export const PROTOCOL_VERSION = 31;
export const DEFAULT_PORT = 7777;

/** The ranked formats (bits-ranked.md § brackets). A bracket key names a
 * ladder — per-subject ratings are keyed by it — and maps to the room shape
 * its matches run. `botBackfill`: whether overdue queuers may draw disguised
 * server bots after the wait (bits-ranked-bots.md). 2v2 backfill reversed ON
 * 2026-08-31 (Tom: the launch population can't sustain a bots-never team
 * queue): seats the queue can't fill with humans are filled with bots — a
 * lone queuer may face (or partner) up to three. Both brackets' displayed
 * queue sizes ride the fuzz while backfill is on. */
export const RANKED_BRACKETS = {
  "1v1": { teamSize: 1, botBackfill: true },
  "2v2": { teamSize: 2, botBackfill: true },
} as const;

export type RankedBracket = keyof typeof RANKED_BRACKETS;

// ── client → server ────────────────────────────────────────────────────────
export type ClientMsg =
  /** `teamSize` 1–4 (the host's 1v1/2v2/3v3/4v4 pick) → 2×N seats; absent or
   * off-menu falls back to 1v1 (sanitizeTeamSize). */
  | { t: "createRoom"; v: number; playerName: string; roomName?: string; pass?: string; teamSize?: number; announcer?: string; title?: string }
  /** `seatToken` is the rejoin proof (bits-reconnect.md § seat tokens): the
   * secret the last `welcome` for this room carried. Present and matching a
   * disconnected seat, that exact seat is reclaimed — name, team, body.
   * Absent (a fresh join), only a free lobby seat will do. */
  | { t: "joinRoom"; v: number; code: string; playerName: string; pass?: string; announcer?: string; title?: string; seatToken?: string }
  | { t: "listRooms" }
  /** Spectate without taking a seat (debug tooling now; bench-viewing later). */
  | { t: "watchRoom"; code: string }
  | { t: "leaveRoom" }
  /** Weapon pick — lobby only; picks replace, never clear. */
  | { t: "setWeapon"; weapon: WeaponId }
  /** The whole picked hand each change (idempotent) — same gate as setWeapon. */
  | { t: "setAbilities"; abilities: AbilityId[] }
  /** Host-only: fill every empty seat with a bot AND random-fill every
   * unarmed straggler, then the normal 5s arming countdown runs (never
   * instant). Ignored from non-hosts. */
  | { t: "forceStart" }
  /** Any seated player's veto on a bot-filled countdown: bots dismissed,
   * countdown stopped, lobby restored (bits-bot-backfill.md). Ignored unless
   * a countdown with bots in it is running. */
  | { t: "cancelStart" }
  /** Hop to the other team — lobby only, and only while the other side has a
   * free seat (the sim re-checks). Loadout survives the hop. */
  | { t: "switchTeam" }
  /** Liveness heartbeat — the quiet lobby's "still here" (a match already
   * streams input). Any inbound message counts as alive; this is the one a
   * seated-but-idle client sends on its own timer (HEARTBEAT_INTERVAL_MS). */
  | { t: "ping" }
  | { t: "input"; seq: number; sx: number; sy: number; casts: boolean[] }
  /** Enter the ranked queue (bits-ranked.md). `token` is the persistence
   * bearer secret — verified server-side against the shared DB; a bad token
   * (or an unreachable DB) rejects, ranked being the one honestly
   * connectivity-gated mode. `brackets` is the set to wait in at once —
   * first match found wins, the rest are auto-left (multi-queue). */
  | { t: "queueJoin"; v: number; token: string; playerName: string; brackets: string[]; announcer?: string; title?: string }
  | { t: "queueLeave" }
  /** Unauthenticated queue-size read — the ranked screen's population display
   * before the player commits to queueing. Answered with `queueStatus`. */
  | { t: "queueInfo" }
  /** Answer the summons (`matchReady`). Accepting is idempotent; declining —
   * like not answering, or dropping the socket — is a dodge (v30). */
  | { t: "matchAccept" }
  | { t: "matchDecline" };

// ── server → client ────────────────────────────────────────────────────────

/** Everything the renderer needs from the tuning table, sent once at welcome —
 * the client never duplicates sim constants. (Per-weapon telegraph numbers are
 * NOT here: the client imports WEAPONS from this package, the ARENA_00 rule.) */
export interface ArenaClientConfig {
  tickRate: number;
  playerRadius: number;
  winsToTake: number;
  countdownSeconds: number;
}

/** One drafted slot as the HUD sees it: which ability, how long until it's
 * ready (drives the button clock), how long its effect window has left
 * (drives body-effect rings and zone auras), and the round budget left
 * (drives the charge pips; 0 = spent until the next round). */
export interface AbilitySlotSnapshot {
  id: AbilityId;
  /** Cooldown seconds remaining; 0 = ready. */
  cd: number;
  /** Active-window seconds remaining; 0 = not running. */
  active: number;
  /** Uses left this round. */
  charges: number;
}

export interface PlayerSnapshot {
  id: number;
  team: Team;
  name: string;
  /** Drives the per-player telegraph (reach/arc/windup from WEAPONS[weapon]).
   * Scrubbed to null for EVERYONE while the phase is "lobby" — snapshots are
   * one uniform broadcast and must not leak hidden picks. */
  weapon: WeaponId | null;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  facing: number;
  /** Attack phase + seconds left in it — the windup telegraph derives from these. */
  atk: AttackPhase;
  atkLeft: number;
  /** Arc telegraph direction, latched at windup start. */
  lockedFacing: number;
  dashing: boolean;
  /** Seconds left on the hammer's movement slow (0 = unslowed) — drives the
   * blue status ring, whose pulse quickens as this runs out. */
  slowLeft: number;
  /** Seconds until the last pending bleed tick lands (0 = clean) — the red
   * status ring, same pulse rule. */
  bleedLeft: number;
  /** Seconds until the poison stack expires (0 = clean) — the green status
   * ring, same pulse rule. All stacks share one clock (core StackingDot). */
  poisonLeft: number;
  /** Current poison stack count (0 = clean) — ring weight scales with it. */
  poisonStacks: number;
  /** Seconds left on a Straw Man's forced lock (0 = free aim) — the straw
   * status ring, same pulse rule. */
  tauntLeft: number;
  /** Seconds left entombed in true ice (0 = free) — drives the ice block
   * over the body; while > 0 every hit on this player reads IMMUNE. */
  frozenLeft: number;
  /** The player id this player's Magic Mirror is about to swap with, or
   * null — the client swirls BOTH bodies for the telegraph window (the
   * caster's magic-mirror slot carries the countdown in `active`). */
  mirrorTargetId: number | null;
  /** The picked hand in button order. Scrubbed to [] alongside `weapon` in
   * the lobby. In-match it IS broadcast (cooldown clocks need it), but the
   * client renders enemy abilities only as they're cast — the cast flash. */
  abilities: AbilitySlotSnapshot[];
  /** The player id this player's harpoon chain is currently REELING in, or
   * null — the client draws the taut chain between the two for the haul. */
  reeling: number | null;
  /** The Lifeline's linked player (v27), or null — the client draws the
   * beam between the two; ally = heal green, enemy = the snap. */
  beamTargetId: number | null;
  /** Unbroken link seconds — the beam's glow ramps with it (client reads
   * this, never re-derives the ramp). */
  beamLink: number;
  /** Last input seq the sim applied for this player — latency debugging. */
  lastSeq: number;
}

export interface RoundSnapshot {
  phase: RoundPhase;
  timer: number;
  roundNumber: number;
  wins: [number, number];
  lastWinner: Team | 0;
}

export interface RoomStatePlayer {
  id: number;
  name: string;
  team: Team;
  connected: boolean;
  /** VIEWER-DEPENDENT: the live pick for your own team; ALWAYS null for the
   * enemy team and for watchers — there is no reveal, ever. */
  weapon: WeaponId | null;
  /** VIEWER-DEPENDENT like `weapon`: picked abilities in button order. */
  abilities: AbilityId[] | null;
  /** Public: weapon + full hand picked — enemies see "armed"/"choosing…". */
  armed: boolean;
  /** A server-run backfill bot — drives roster markers and the countdown
   * veil's cancel button (only a bot-filled start is cancellable). */
  bot: boolean;
  /** This player's announcer-pack id — PUBLIC (unlike picks): every client
   * plays the ATTACKER's voice on their kill calls, so everyone needs
   * everyone's. Unrecognised ids fall back to the default pack client-side. */
  announcer: string;
  /** This player's worn title as a DEED ID (`""` = bare) — PUBLIC like
   * `announcer`. Clients resolve the display string from ACHIEVEMENT_DEFS;
   * unknown ids render bare (achievements.md § wearing titles). */
  title: string;
}

/** A live shot, projected for rendering (the client lerps x/y/angle by id). */
export interface ProjectileSnapshot {
  id: number;
  x: number;
  y: number;
  /** Travel direction, radians. */
  angle: number;
  kind: ProjectileKind;
}

/** A placed thing, projected for rendering (keyed by id; static once placed).
 * Sent to everyone — but the sandtrap RENDERS team-dependent (Tom,
 * 2026-07-14): the owning team sees a clear marker, enemies a faint
 * occasional glint. Every other kind stays uniformly visible. */
export interface DeployableSnapshot {
  id: number;
  kind: DeployableKind;
  /** Who placed it — drives the sandtrap's yours/theirs rendering split. */
  team: Team;
  x: number;
  y: number;
  /** Sandtrap: seconds until armed (drives the arming countdown circle). */
  armLeft: number;
  /** Seconds until it expires (zones fade on this). */
  lifeLeft: number;
  /** Straw man durability left; 0 for kinds without hp. */
  hp: number;
}

/** A bombard shell in flight (v23). The landing mark and clock ARE the
 * telegraph: both teams draw the ring at (tx,ty) sweeping in over landIn,
 * and the shell sprite lerps from→target with a render-side arc. No
 * position is broadcast — flight is fully derived, keyed by id. */
export interface ShellSnapshot {
  id: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  /** Seconds until it lands. */
  landIn: number;
  /** Full flight time (arc progress = 1 − landIn/total). */
  total: number;
  /** Blast radius — the telegraph ring's true size (honest, not decorative). */
  blast: number;
}

/** Public directory entry — never carries the passcode. */
export interface RoomListing {
  code: string;
  name: string;
  players: number;
  capacity: number;
  locked: boolean;
  phase: "lobby" | "in-match";
}

export interface SnapshotMsg {
  t: "snapshot";
  tick: number;
  round: RoundSnapshot;
  players: PlayerSnapshot[];
  projectiles: ProjectileSnapshot[];
  deployables: DeployableSnapshot[];
  /** Bombard shells in flight (v23). */
  shells: ShellSnapshot[];
  events: ArenaEvent[];
}

export type ServerMsg =
  | {
      t: "welcome";
      v: number;
      playerId: number;
      team: Team;
      /** Players per side — the client renders capacity (2×N) and empty-seat
       * rows from this. Per-room, like zoneId, so NOT in ArenaClientConfig. */
      teamSize: number;
      /** The two sides' faction names, [team 1, team 2] — fixed for the room's
       * life (teamNames.ts). Both clients get the same array; each renders its
       * own side blue and the other red. */
      teamNames: [string, string];
      roomCode: string;
      roomName: string;
      hostId: number;
      zoneId: string;
      config: ArenaClientConfig;
      /** This seat's rejoin secret (bits-reconnect.md § seat tokens) — send
       * it back in `joinRoom.seatToken` to reclaim the seat after a socket
       * death. Minted when the seat is first taken and stable for its life
       * (a reclaim re-receives the same token). Client memory only, v1. */
      seatToken: string;
    }
  | { t: "rooms"; rooms: RoomListing[] }
  /** Membership/host changes — sent to the room on join/leave/migration. */
  | { t: "roomState"; players: RoomStatePlayer[]; hostId: number }
  /** A transient lobby toast — currently host handoff ("X left — Y is now the
   * host"). The server composes the human text; the client just shows it. */
  | { t: "notice"; text: string }
  /** Watcher acknowledgment (no seat, snapshots only). */
  | { t: "watching"; roomCode: string; roomName: string }
  /** You left (or were never in) a room — back to the room list. */
  | { t: "left" }
  /** The room was closed under you (host left / gone after the match) — the
   * client drops its seat and returns to the list showing `reason`. */
  | { t: "roomClosed"; reason: string }
  | SnapshotMsg
  | { t: "reject"; reason: string }
  /** Per-bracket queue populations; `waitedSec` present only on YOUR queued
   * brackets. Sent on queueInfo, on queue entry, and every matcher beat. */
  | { t: "queueStatus"; brackets: { bracket: string; size: number; waitedSec?: number }[] }
  /** You left the queue (queueLeave, or a lockout bounced your join). */
  | { t: "queueLeft" }
  /** The summons (v30): a pairing landed and needs your yes within
   * `acceptSec`. `players` = seats in the match (2 in 1v1, 4 in 2v2) — the
   * accept sheet's "N OF M". Nobody is seated until everyone accepts. */
  | { t: "matchReady"; bracket: string; players: number; acceptSec: number }
  /** Accept progress on a pending match — sent to every human in it each
   * time the count moves. */
  | { t: "matchPending"; accepted: number; players: number }
  /** The pending match fell through. `dodged` = you were the one who didn't
   * answer (declined / timed out) — you're out of the queue and locked out
   * for `lockoutSec`. Otherwise someone else was, and you're already back in
   * line with your earned wait (a queueStatus follows). */
  | { t: "matchCancelled"; dodged: boolean; lockoutSec?: number }
  /** Everyone accepted. Informational — the server seats you itself and the
   * standard `welcome` follows on this socket; no joinRoom round-trip, no
   * code entry (ranked rooms are unlisted and unjoinable from outside). */
  | { t: "matchFound"; bracket: string; code: string }
  /** The settlement, broadcast into the ranked room after matchEnd: each
   * seat's rating movement + tier + Glory. `playerId` is the in-room seat id;
   * the client shows its own row as the ceremony and the opponent's as the
   * epilogue line. `placement` is non-null while that player is still in
   * their placement matches — the client then shows progress ("match 3 of
   * 10") and hides the rating movement. */
  | {
      t: "rankedResult";
      matchId: string;
      bracket: string;
      winnerTeam: Team;
      results: {
        playerId: number;
        before: number;
        after: number;
        delta: number;
        /** Display tier (sticky-badge grace applied server-side). */
        tier: string;
        /** Division inside the tier (3 entry → 1 top); null in the
         * single-rung end tiers (Initiate, Immortal). */
        division: 1 | 2 | 3 | null;
        /** The DISPLAYED rank moved this match (server-computed, grace
         * included) — the client's rank_up / rank_down audio cue. */
        rankChange: "up" | "down" | null;
        glory: number;
        /** Season-high rating after this settle; `newBest` = set just now. */
        peak: number;
        newBest: boolean;
        placement: { number: number; of: number } | null;
      }[];
    }
  /** YOUR newly-unlocked achievements this match (achievements.md), sent
   * per-socket alongside the settle — the client looks the ids up in
   * ACHIEVEMENT_DEFS and queues the unlock ceremony. Never carries the
   * opponent's unlocks. */
  | { t: "deedUnlocks"; matchId: string; unlocks: string[] };
