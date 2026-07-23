import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas, Picture } from "@shopify/react-native-skia";
import { useSharedValue } from "react-native-reanimated";
import { useKeepAwake } from "expo-keep-awake";
import { STICK_ZERO, useGameLoop, type StickSample } from "@heroic/engine";
import {
  ABILITIES,
  isDeployableId,
  LOADOUT_ABILITY_COUNT,
  TICK_DT,
  TREMOR,
  type AbilityId,
  type RoundPhase,
} from "@heroic/blood-in-the-sand-sim";
import type { GameClient } from "../net/connection";
import { BloodField } from "../game/blood";
import { CrackField } from "../game/cracks";
import { playStrikeHaptic, WEAPON_HAPTIC } from "../game/haptics";
import {
  asAnnouncerPack,
  playAnnouncement,
  playSound,
  startCrowdAmbience,
  stopCrowdAmbience,
  unlockAudio,
  warmCombatAudio,
} from "../audio";
import { KillStreaks, type MultiKillTier } from "../audio/killstreaks";
import {
  AbilityButton,
  EMPTY_BUTTON_PICTURE,
  recordAbilityButton,
} from "../game/AbilityButton";
import { useAbilityIconImages } from "../game/abilityIcons";
import { EMPTY_ARENA_PICTURE, recordArena, type FxItem } from "../game/render";
import { useArenaAtlas } from "../game/tilesets";
import { FloatingStick } from "../game/FloatingStick";
import { RoundBanner } from "../game/RoundBanner";
import { pickOutcome, type OutcomeKind } from "../game/roundMessages";
import { StatusPulses } from "../game/statusRings";
import { loadLefty } from "../settings";
import { devFlags } from "../dev";

const NUMBER_TTL = 750;
const RING_TTL = 380;
const DETONATE_TTL = 1150; // the sandtrap boom lingers well past a hit ping
const FIGHT_BANNER_TTL = 900;
/** How long a First Blood / multi-kill call stays on screen. */
const ANNOUNCE_TTL = 1900;
/** Beat the death-camera holds on your own corpse before cutting to an ally —
 *  a moment for the kill to sink in (Tom, 2026-07-19). */
const SPECTATE_DELAY_MS = 2000;
/** Proximity attenuation: a positional sound plays full within SOUND_NEAR px of
 * your fighter, fading to SOUND_FLOOR by SOUND_FAR px — a floor, not silence, so
 * distant fights still read faintly as info. Global cues (round/match stings,
 * UI, announcer) ignore this and always play full. Grounded to the arena, which
 * is 1600×1600px (25 tiles × 64px): NEAR ≈ your immediate scrap, FAR ≈ half the
 * map, so the far half fades to the floor. Tune to taste. */
const SOUND_NEAR = 250;
const SOUND_FAR = 850;
const SOUND_FLOOR = 0.22;
/** Volume factor for a sound at world (x, y) heard by `listener` (your
 * fighter; your corpse while spectating). No listener (pure spectator) →
 * unattenuated. Shared by the event drain and the footprint-squelch drain. */
const gainFrom = (
  listener: { x: number; y: number } | undefined,
  x: number,
  y: number,
): number => {
  if (!listener) return 1;
  const d = Math.hypot(x - listener.x, y - listener.y);
  if (d <= SOUND_NEAR) return 1;
  if (d >= SOUND_FAR) return SOUND_FLOOR;
  return 1 - ((d - SOUND_NEAR) / (SOUND_FAR - SOUND_NEAR)) * (1 - SOUND_FLOOR);
};
/** Booming-voice announcement text per multi-kill tier. */
const MULTI_KILL_TEXT: Record<MultiKillTier, string> = {
  double: "DOUBLE KILL",
  multi: "MULTI KILL",
  mega: "MEGA KILL",
  ultra: "ULTRA KILL",
  monster: "MONSTER KILL",
};
/** Cast flash: how long the icon lingers, and where it pops relative to the
 * caster's disc (above the name-tag/hp-bar clutter). */
const CAST_FLASH_TTL = 950;
const CAST_FLASH_RISE_FROM = 24;
/** Warding Shout's cone blast — gone in a blink, like the bellow. */
const SHOUT_CONE_TTL = 380;
/** Straw Man soaking a blow: the puff of flung straw settles just after the
 * hit ping — long enough to read "that landed on the DUMMY", not on flesh. */
const STRAW_BURST_TTL = 520;

interface AgedFx {
  item: FxItem;
  bornMs: number;
  ttlMs: number;
}

interface HudState {
  phase: RoundPhase;
  countdown: number | null;
  wins: [number, number];
  banner: string | null;
  /** The premium round-/match-end plate (win/loss/draw + Victory/Defeat), or
   *  null outside those phases. Kept separate from `banner` so plain cues
   *  (FIGHT / connection lost) stay as the simple centre text. */
  outcome: {
    key: string;
    kind: OutcomeKind;
    title: string;
    subtitle: string;
    score: [number, number];
  } | null;
  lost: boolean;
  /** We're down this round — hide the controls and show the spectator chip. */
  dead: boolean;
  /** The ally the death-camera is trailing (name + hp for the chip), or null
   *  when alive / whole team wiped. hpFrac is quantised to keep setState calm. */
  spectate: { name: string; hpFrac: number } | null;
}

const INITIAL_HUD: HudState = {
  phase: "countdown",
  countdown: null,
  wins: [0, 0],
  banner: null,
  outcome: null,
  lost: false,
  dead: false,
  spectate: null,
};

export interface GameScreenProps {
  client: GameClient;
  onLeave: () => void;
  /** Practice-only: a ✕ chip that abandons the bot match immediately. */
  onQuit?: () => void;
}

/**
 * The match screen. The client never simulates: `onRender` samples the
 * snapshot buffer and re-records the scene picture; `onStep` is the fixed
 * 30Hz cadence that sends input (wired in the input pass).
 */
export const GameScreen = ({ client, onLeave, onQuit }: GameScreenProps) => {
  useKeepAwake();
  // Keep the HUD/controls clear of the notch (top) and the Android nav bar
  // (bottom). The Skia canvas stays full-bleed — only the touch targets inset.
  const insets = useSafeAreaInsets();
  // The tileset atlas decodes async; recordArena draws the flat fallback until
  // it lands (a frame or two), then bakes the floor chunks once.
  const atlas = useArenaAtlas();
  // Forge icon art for the cast flash (decodes async; flashes skip until ready).
  const abilityIcons = useAbilityIconImages();
  const picture = useSharedValue(EMPTY_ARENA_PICTURE);
  // One face per ability slot (pick order = button order). Discrete shared
  // values because hooks can't live in a loop — keep as many as
  // LOADOUT_ABILITY_COUNT (2).
  const overlay0 = useSharedValue(EMPTY_BUTTON_PICTURE);
  const overlay1 = useSharedValue(EMPTY_BUTTON_PICTURE);
  const overlays = [overlay0, overlay1];
  const layoutRef = useRef({ w: 0, h: 0 });
  const fxRef = useRef<AgedFx[]>([]);
  // Blood persists across rounds (the arena remembers); a new match remounts
  // this screen via the lobby, which is what wipes the floor clean.
  const bloodRef = useRef<BloodField | null>(null);
  bloodRef.current ??= new BloodField();
  const blood = bloodRef.current;
  // Tremor's cracked earth — same lifecycle as the blood (arena remembers).
  const cracksRef = useRef<CrackField | null>(null);
  cracksRef.current ??= new CrackField();
  const cracks = cracksRef.current;
  // Per-quake last-pop clocks (deployable id → ms) for the ground-giving-way
  // crack bursts; cleared whenever no quake is live (ids never recycle).
  // Quake zone ids whose fracture web is already born — a vanished id
  // settles its web (cracks v2, bits-blood.md §7).
  const liveQuakesRef = useRef<Set<number> | null>(null);
  liveQuakesRef.current ??= new Set();
  const liveQuakes = liveQuakesRef.current;
  const fightBannerUntil = useRef(0);
  // The flavour line for the current round-/match-end is picked ONCE per outcome
  // and latched here (keyed by phase+winner+round count), so the per-frame HUD
  // rebuild reads a stable pick instead of re-rolling the message every render.
  const outcomeRef = useRef<{
    key: string;
    kind: OutcomeKind;
    title: string;
    subtitle: string;
  } | null>(null);
  // Last countdown digit sounded, so 3·2·1 ticks fire once each (null between rounds).
  const lastCountdown = useRef<number | null>(null);
  // Audio needs a user gesture to start (web/iOS); unlock on the first touch.
  const audioUnlocked = useRef(false);
  const stickRef = useRef<StickSample>(STICK_ZERO);
  // Cast taps latched per slot until the next input send (the dash pattern ×3).
  const castRequests = useRef<boolean[]>(
    Array.from({ length: LOADOUT_ABILITY_COUNT }, () => false),
  );
  const lastButtonKeys = useRef<string[]>(
    Array.from({ length: LOADOUT_ABILITY_COUNT }, () => ""),
  );
  // The drafted hand, from snapshots — names the buttons once the match feeds us.
  const [buttonIds, setButtonIds] = useState<AbilityId[]>([]);
  const buttonIdsKey = useRef("");
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const hudKey = useRef("");
  // Death spectator: the ally id the camera trails once we're down. Sticky —
  // re-picked only when that ally dies or leaves; cleared while we're alive.
  const spectateId = useRef<number | null>(null);
  // The instant we died (performance.now), so the camera lingers on our corpse
  // for SPECTATE_DELAY_MS before cutting to an ally — a beat to let it land.
  const spectateDeadAt = useRef<number | null>(null);
  // Status-ring pulse clocks (slow/bleed), advanced per rendered frame.
  const pulsesRef = useRef<StatusPulses | null>(null);
  pulsesRef.current ??= new StatusPulses();
  const pulses = pulsesRef.current;
  // Lefty mode (settings page): read at mount, i.e. match start.
  const [lefty, setLefty] = useState(false);
  useEffect(() => {
    void loadLefty().then(setLefty);
  }, []);

  // Backstop for paths that skip the lobby (mid-match rejoin routes straight
  // here): idempotent, so the normal lobby-warmed case costs nothing.
  useEffect(() => {
    warmCombatAudio();
  }, []);

  // The looping pit-crowd ambience bed — plays the whole time you're in the
  // arena (incl. spectating your own death), fades out on the way back to the
  // lobby. Silent until the crowd_ambience clip is forged.
  useEffect(() => {
    startCrowdAmbience();
    return () => stopCrowdAmbience();
  }, []);

  // --- Frame profiler (dev menu toggle, session-only). Accumulate JS-thread
  // time per frame — `sim` is everything behind sendInput (online: a WS send,
  // ~0ms; practice: bots + stepSim + snapshot), `rec` is the scene re-record —
  // then sample into state 2×/sec for the readout. Refs for the per-frame
  // writes so they never render; when the toggle is off every branch below is
  // skipped, so it costs nothing. The `×` figure is sim steps per frame: the
  // fixed-step catch-up multiplier (sustained >1× = the loop is fighting to
  // keep up; that catch-up is what the maxSteps clamp below caps).
  const perfOn = devFlags.perfOverlay;
  const perf = useRef({ simMs: 0, steps: 0, recMs: 0, frames: 0 });
  const [perfText, setPerfText] = useState("");
  useEffect(() => {
    if (!perfOn) {
      setPerfText("");
      return;
    }
    const p = perf.current;
    p.simMs = p.steps = p.recMs = p.frames = 0;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - last) / 1000;
      last = now;
      const f = Math.max(1, p.frames);
      const fps = elapsed > 0 ? p.frames / elapsed : 0;
      setPerfText(
        `JS ${fps.toFixed(0)}fps  sim ${(p.simMs / f).toFixed(1)}ms (${(p.steps / f).toFixed(1)}×)  rec ${(p.recMs / f).toFixed(1)}ms`,
      );
      p.simMs = p.steps = p.recMs = p.frames = 0;
    }, 500);
    return () => clearInterval(id);
  }, [perfOn]);

  // First Blood + multi-kill announcements — client-derived from lethal hits
  // (fresh tracker per match, since this screen remounts per match). The banner
  // is event-driven, so setState here is fine (kills are infrequent).
  const killStreaksRef = useRef<KillStreaks | null>(null);
  killStreaksRef.current ??= new KillStreaks();
  const killStreaks = killStreaksRef.current;
  // A kill call is two lines: a small credit line ("Ragnar gets a") over the big
  // booming label ("DOUBLE KILL"). `who` is omitted when we can't name the killer
  // (seat already gone from the view) — then only the label shows.
  const [announce, setAnnounce] = useState<{
    who: string | null;
    label: string;
  } | null>(null);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showAnnounce = (label: string, who: string | null = null): void => {
    setAnnounce({ who, label });
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnounce(null), ANNOUNCE_TTL);
  };
  useEffect(
    () => () => {
      if (announceTimer.current) clearTimeout(announceTimer.current);
    },
    [],
  );

  useEffect(() => {
    client.onEvents = (events) => {
      const now = performance.now();
      const myId = client.welcome?.playerId ?? null;
      const myTeam = client.welcome?.team ?? 1;
      // The listener for proximity attenuation is your own fighter (your corpse
      // while spectating your death). Sampled once per batch — events share a tick.
      const view = client.buffer.sample(now);
      const listener =
        myId != null ? view?.players.find((p) => p.id === myId) : undefined;
      /** Volume factor for a sound at world (x, y): 1 near you → SOUND_FLOOR far. */
      const gainAt = (x: number, y: number): number => gainFrom(listener, x, y);
      for (const e of events) {
        if (e.type === "hit") {
          // The attacker→victim line: every splash exits the far side of the
          // victim along it (the through-wound), and the kill spray fires out
          // of the BACK on the same line. The victim auto-faces their
          // attacker, so if the killer's position isn't in the view (seat
          // gone), -facing is the same line.
          const victim = view?.players.find((p) => p.id === e.targetId);
          const attacker = view?.players.find((p) => p.id === e.attackerId);
          const dx = attacker
            ? e.x - attacker.x
            : victim
              ? -Math.cos(victim.facing)
              : 1;
          const dy = attacker
            ? e.y - attacker.y
            : victim
              ? -Math.sin(victim.facing)
              : 0;
          const len = Math.hypot(dx, dy) || 1;
          // Straw men don't bleed — deployable-target hits puff straw instead
          // of blood (the "sword fell on straw" tell).
          if (!isDeployableId(e.targetId)) {
            blood.splatter(e.x, e.y, e.damage, e.lethal, now, dx / len, dy / len);
          } else {
            fxRef.current.push({
              item: { kind: "strawBurst", x: e.x, y: e.y, life: 1 },
              bornMs: now,
              ttlMs: STRAW_BURST_TTL,
            });
          }
          if (e.lethal) {
            blood.deathBurst(e.x, e.y, dx / len, dy / len, now);
            // First Blood + Unreal-style kill chains (everyone hears them). Only
            // real players count — dummies never report a lethal hit anyway.
            if (!isDeployableId(e.targetId)) {
              const call = killStreaks.registerKill(
                e.attackerId,
                e.targetId,
                now,
              );
              const killer = attacker?.name ?? null;
              // The KILLER's announcer pack voices the call, on every client —
              // the pack-flex (monetisation.md). Every client resolves the same
              // roomState row off the same event, so the room stays in unison;
              // a missing row (seat gone) or unknown pack falls back to default.
              const pack = asAnnouncerPack(
                client.roomState?.players.find((p) => p.id === e.attackerId)?.announcer,
              );
              if (call?.firstBlood) {
                playAnnouncement("firstBlood", pack);
                showAnnounce("FIRST BLOOD", killer && `${killer} gets`);
              } else if (call?.tier) {
                playAnnouncement("multiKill", pack, call.tier);
                showAnnounce(
                  MULTI_KILL_TEXT[call.tier],
                  killer && `${killer} gets a`,
                );
              }
            }
          }
          fxRef.current.push({
            item: {
              kind: "number",
              x: e.x,
              y: e.y,
              life: 1,
              text: String(e.damage),
              crit: e.crit,
              bleed: e.bleed,
            },
            bornMs: now,
            ttlMs: NUMBER_TTL,
          });
          // Bleed ticks are ambient damage — a red number, no impact ring.
          if (!e.bleed) {
            fxRef.current.push({
              item: { kind: "ring", x: e.x, y: e.y, life: 1 },
              bornMs: now,
              ttlMs: RING_TTL,
            });
          }
          // Haptics (gauntlet system): heavy is reserved for kills and dying;
          // landing a hit thuds at the weapon's weight; taking one is medium.
          // Bleed ticks stay silent — ambient damage shouldn't buzz the hand.
          if (e.lethal && (e.attackerId === myId || e.targetId === myId)) {
            playStrikeHaptic("heavy", e.crit);
          } else if (!e.bleed && e.attackerId === myId) {
            playStrikeHaptic(WEAPON_HAPTIC[client.myWeapon ?? "blade"], e.crit);
          } else if (!e.bleed && e.targetId === myId) {
            playStrikeHaptic("medium");
          }
          // SFX: your own pained grunt is reserved for CRITS — a normal hit on
          // you just thuds like any other (you still get the medium haptic).
          // Everyone else's impacts play the attacker's weapon strike (null/
          // hidden weapon → the generic thud). Bleed ticks stay silent.
          // The impact thud, for every weapon incl. ranged — distinct from the
          // ranged release (the `shoot` event below). Your own pained grunt is
          // crit-only; getting hit otherwise just thuds.
          if (!e.bleed && !isDeployableId(e.targetId)) {
            if (e.targetId === myId) {
              if (e.crit) playSound("hitTaken"); // your own pain — always full, it's you
            } else {
              const weapon = view?.players.find(
                (p) => p.id === e.attackerId,
              )?.weapon;
              playSound(
                "weaponStrike",
                weapon ?? undefined,
                undefined,
                gainAt(e.x, e.y),
              );
            }
          }
        } else if (e.type === "shoot") {
          // the bow twang / staff whoosh, on release
          playSound("weaponFire", e.weapon, undefined, gainAt(e.x, e.y));
        } else if (e.type === "death") {
          const dp = view?.players.find((p) => p.id === e.playerId);
          playSound("death", undefined, undefined, dp ? gainAt(dp.x, dp.y) : 1);
          // The crowd roars when an ENEMY falls (YOUR side scored) and groans when
          // one of YOURS falls (the enemy scored) — partisan per-client, so each
          // side hears the mob on its own team's side. Own throttle keys, so a
          // cheer and a jeer never gate each other.
          if (dp) playSound(dp.team !== myTeam ? "crowdCheer" : "crowdJeer");
        } else if (e.type === "cast") {
          if (e.playerId === myId) playStrikeHaptic("soft"); // tactile confirm of the cast
          const caster = view?.players.find((p) => p.id === e.playerId);
          // every cast is audible — the tell is information — but fades with distance
          playSound(
            "abilityCast",
            e.ability,
            undefined,
            caster ? gainAt(caster.x, caster.y) : 1,
          );
          if (caster) {
            // The cast flash: the ability's icon pops above the caster —
            // "they just pressed this button". The ONLY way enemy kits show
            // (pvp-loadout-flow.md); allies and self flash too, one language.
            fxRef.current.push({
              item: {
                kind: "castFlash",
                x: caster.x,
                y: caster.y - CAST_FLASH_RISE_FROM,
                life: 1,
                ability: e.ability,
              },
              bornMs: now,
              ttlMs: CAST_FLASH_TTL,
            });
            // Tremor fractures the sand at the epicentre — slam-sized, not
            // zone-sized (the ZONE reads via the ring + its own web) — and
            // the 4s earthquake bed rolls in UNDER the cast stomp (its own
            // clip; the cast stays the sharp tell).
            if (e.ability === "tremor") {
              cracks.addSlam(caster.x, caster.y, 110, now);
              playSound(
                "quakeRumble",
                undefined,
                undefined,
                gainAt(caster.x, caster.y),
              );
            }
            // Warding Shout: the bellow's wedge, out of the caster's facing.
            if (e.ability === "warding-shout") {
              fxRef.current.push({
                item: {
                  kind: "cone",
                  x: caster.x,
                  y: caster.y,
                  angle: caster.facing,
                  life: 1,
                },
                bornMs: now,
                ttlMs: SHOUT_CONE_TTL,
              });
            }
          }
        } else if (e.type === "harpoon") {
          // The chain flash: caster → hook point, gone in a blink.
          fxRef.current.push({
            item: {
              kind: "line",
              x: e.fromX,
              y: e.fromY,
              x2: e.toX,
              y2: e.toY,
              life: 1,
            },
            bornMs: now,
            ttlMs: 260,
          });
          playSound(
            "harpoonWhip",
            undefined,
            undefined,
            gainAt(e.fromX, e.fromY),
          );
        } else if (e.type === "detonate") {
          fxRef.current.push({
            item: { kind: "ring", x: e.x, y: e.y, life: 1, big: true },
            bornMs: now,
            ttlMs: DETONATE_TTL,
          });
          playStrikeHaptic("heavy"); // a mine going off is a proper thump
          // the only thing that detonates (for now)
          playSound("abilityDetonate", "sandtrap", undefined, gainAt(e.x, e.y));
        } else if (e.type === "heal") {
          fxRef.current.push({
            item: {
              kind: "number",
              x: e.x,
              y: e.y,
              life: 1,
              text: `+${e.amount}`,
              heal: true,
            },
            bornMs: now,
            ttlMs: NUMBER_TTL,
          });
          playSound("heal", undefined, undefined, gainAt(e.x, e.y));
        } else if (e.type === "roundStart") {
          playSound("roundStart");
        } else if (e.type === "fightStart") {
          fightBannerUntil.current = now + FIGHT_BANNER_TTL;
          playSound("fightStart");
        } else if (e.type === "roundEnd") {
          playSound(
            "roundEnd",
            e.winnerTeam === 0
              ? "draw"
              : e.winnerTeam === myTeam
                ? "win"
                : "loss",
          );
        } else if (e.type === "matchEnd") {
          playSound("matchEnd", e.winnerTeam === myTeam ? "win" : "loss");
        }
      }
    };
    return () => {
      client.onEvents = null;
    };
  }, [client]);

  useGameLoop(
    {
      onStep: () => {
        // One input per sim tick (30Hz): stick dir × magnitude + the cast taps
        // (consumed here; the server latches them so a between-tick press holds).
        const stick = stickRef.current;
        const t0 = perfOn ? performance.now() : 0;
        client.sendInput(
          stick.dir.x * stick.magnitude,
          stick.dir.y * stick.magnitude,
          [...castRequests.current],
        );
        castRequests.current.fill(false);
        if (perfOn) {
          perf.current.simMs += performance.now() - t0;
          perf.current.steps += 1;
        }
      },
      onRender: () => {
        const now = performance.now();
        if (perfOn) perf.current.frames += 1;
        const view = client.buffer.sample(now);
        const { w, h } = layoutRef.current;

        // Age FX in place.
        const fx = fxRef.current;
        for (let i = fx.length - 1; i >= 0; i--) {
          const f = fx[i]!;
          f.item.life = 1 - (now - f.bornMs) / f.ttlMs;
          if (f.item.life <= 0) fx.splice(i, 1);
        }

        if (view && w > 0 && client.welcome) {
          const recStart = perfOn ? performance.now() : 0;
          blood.update(view.players, now);
          // Bloody-footprint squelches (bits-blood.md §6): one per wet-pool
          // crossing, attenuated like every other positional sound.
          if (blood.crossings.length > 0) {
            const listener = view.players.find(
              (p) => p.id === client.welcome!.playerId,
            );
            for (const c of blood.crossings)
              playSound("squelch", undefined, undefined, gainFrom(listener, c.x, c.y));
            blood.crossings.length = 0;
          }
          cracks.update(now);
          // One fracture web per quake (bits-blood.md §7), born with the
          // zone and settled at its death — the old 150ms crack pops pinned
          // the scar cache on its fresh beat for every quake's life.
          for (const d of view.deployables) {
            if (d.kind !== "quake" || liveQuakes.has(d.id)) continue;
            liveQuakes.add(d.id);
            // The web fractures outward for the zone's WHOLE duration —
            // animation time == ability time, full radius as the quake dies.
            cracks.addQuake(d.id, d.x, d.y, TREMOR.radius, TREMOR.duration * 1000, now);
          }
          for (const id of liveQuakes) {
            if (!view.deployables.some((d) => d.kind === "quake" && d.id === id)) {
              liveQuakes.delete(id);
              cracks.settle(id, now);
            }
          }
          pulses.update(view.players, now);

          // Death spectator: once we're down, hold on our own corpse for a beat
          // (SPECTATE_DELAY_MS — let the death land), THEN trail a living
          // teammate. Keep the current ally until it dies or leaves, then
          // re-pick the nearest survivor to where the camera already sits — the
          // fallen ally's last spot (their body lingers in the snapshot), or our
          // corpse on the first hop — so the camera slides, never leaps.
          const selfId = client.welcome.playerId;
          const meNow = view.players.find((p) => p.id === selfId);
          if (meNow && !meNow.alive) {
            if (spectateDeadAt.current == null) spectateDeadAt.current = now;
            if (now - spectateDeadAt.current < SPECTATE_DELAY_MS) {
              // Grace beat: stay on the corpse (following our own id = us).
              spectateId.current = selfId;
            } else {
              // Our own id doesn't count as a live ally — force a fresh pick
              // the first frame past the grace window.
              const cur =
                spectateId.current != null && spectateId.current !== selfId
                  ? view.players.find((p) => p.id === spectateId.current)
                  : undefined;
              if (!cur || !cur.alive) {
                const anchor = cur ?? meNow;
                let bestId: number | null = null;
                let bestD = Infinity;
                for (const p of view.players) {
                  if (p.team !== meNow.team || !p.alive || p.id === meNow.id)
                    continue;
                  const d = Math.hypot(p.x - anchor.x, p.y - anchor.y);
                  if (d < bestD) {
                    bestD = d;
                    bestId = p.id;
                  }
                }
                // No living ally: LINGER on whoever the camera already holds
                // — the fallen ally's corpse, or our own — never the zoomed-
                // out bowl fit (Tom, 2026-07-19: the end-of-match zoom-out
                // read as a bug). Corpses stay in every snapshot, so the
                // follow target keeps resolving; only a vanished body (seat
                // fully gone) falls back to our own corpse.
                spectateId.current =
                  bestId ?? (cur ? spectateId.current : selfId);
              }
            }
          } else {
            spectateId.current = null;
            spectateDeadAt.current = null;
          }

          picture.value = recordArena({
            view,
            config: client.welcome.config,
            myId: client.welcome.playerId,
            spectateId: spectateId.current,
            screenW: w,
            screenH: h,
            insetTop: insets.top,
            insetBottom: insets.bottom,
            fx: fx.map((f) => f.item),
            blood,
            cracks,
            scarEpoch: blood.epoch,
            pulses,
            nowMs: now,
            atlas,
            abilityIcons,
          });

          // Ability buttons: name them from the snapshot's slot list (pick
          // order), re-record a face only when its clock or state moved.
          const me = view.players.find(
            (p) => p.id === client.welcome!.playerId,
          );
          const slots = me?.abilities ?? [];
          const idsKey = slots.map((s) => s.id).join(",");
          if (idsKey !== buttonIdsKey.current) {
            buttonIdsKey.current = idsKey;
            setButtonIds(slots.map((s) => s.id));
          }
          for (let i = 0; i < overlays.length; i++) {
            const slot = slots[i];
            if (!slot) {
              if (lastButtonKeys.current[i] !== "") {
                lastButtonKeys.current[i] = "";
                overlays[i]!.value = EMPTY_BUTTON_PICTURE;
              }
              continue;
            }
            const def = ABILITIES[slot.id];
            // Quantised to 1% steps: the raw fraction moves every snapshot, so
            // a running cooldown re-recorded its face (a fresh SkPicture + a
            // canvas redraw) EVERY frame for its whole 10–20s — a steady tax
            // that lands right after every cast. At 1% it re-records a few
            // times a second; 3.6° of wedge per step is invisible.
            const frac = Math.min(
              1,
              Math.max(0, Math.round((slot.cd / def.cooldown) * 100) / 100),
            );
            const active = slot.active > 0;
            const key = `${slot.id}:${frac}:${active}:${slot.charges}`;
            if (key !== lastButtonKeys.current[i]) {
              lastButtonKeys.current[i] = key;
              overlays[i]!.value = recordAbilityButton(
                frac,
                active,
                slot.charges,
                def.charges,
              );
            }
          }
          if (perfOn) perf.current.recMs += performance.now() - recStart;
        }

        // HUD — cheap derive, setState only when something visible changed.
        const myTeam = client.welcome?.team ?? 1;
        const round = view?.round;
        const phase = round?.phase ?? "countdown";
        // The whole enemy TEAM must be gone — one teammate-of-theirs dropping
        // out of a 3v3 is not "finish them".
        const enemies =
          client.roomState?.players.filter((p) => p.team !== myTeam) ?? [];
        const enemyGone =
          enemies.length > 0 && enemies.every((p) => !p.connected);
        let banner: string | null = null;
        let countdown: number | null = null;
        let outcome: HudState["outcome"] = null;
        if (client.status === "closed") banner = "connection lost";
        else if (round && phase === "countdown")
          countdown = Math.max(1, Math.ceil(round.timer));
        else if (round && (phase === "roundEnd" || phase === "matchEnd")) {
          const kind: OutcomeKind =
            phase === "matchEnd"
              ? round.lastWinner === myTeam
                ? "victory"
                : "defeat"
              : round.lastWinner === 0
                ? "roundDraw"
                : round.lastWinner === myTeam
                  ? "roundWin"
                  : "roundLoss";
          // One key per distinct outcome (winsSum bumps every round) so the
          // flavour is rolled once and stays put for the whole hold window.
          const winsSum = round.wins[0] + round.wins[1];
          const key = `${phase}:${round.lastWinner}:${winsSum}`;
          if (!outcomeRef.current || outcomeRef.current.key !== key) {
            const variant = pickOutcome(kind);
            outcomeRef.current = { key, kind, ...variant };
          }
          const mine = myTeam === 1 ? round.wins[0] : round.wins[1];
          const theirs = myTeam === 1 ? round.wins[1] : round.wins[0];
          outcome = {
            key,
            kind,
            title: outcomeRef.current.title,
            subtitle: outcomeRef.current.subtitle,
            score: [mine, theirs],
          };
        } else if (phase === "active" && now < fightBannerUntil.current)
          banner = "FIGHT";
        else if (phase === "active" && enemyGone)
          banner =
            enemies.length === 1
              ? "opponent disconnected — finish them"
              : "enemies disconnected — finish them";

        // A soft tick on each new pre-round digit (roundStart already boomed).
        if (countdown !== null && countdown !== lastCountdown.current)
          playSound("countdownTick");
        lastCountdown.current = countdown;

        // Are we down, and who is the death-camera watching? (spectateId was
        // resolved above, in the record pass.)
        const meHud = view?.players.find(
          (p) => p.id === client.welcome?.playerId,
        );
        const dead = !!meHud && !meHud.alive;
        let spectate: HudState["spectate"] = null;
        // Not during the corpse-hold grace (spectateId === us) — only once the
        // camera is actually on a teammate.
        if (
          dead &&
          spectateId.current != null &&
          spectateId.current !== client.welcome?.playerId
        ) {
          const ally = view?.players.find((p) => p.id === spectateId.current);
          // Round hp to whole percents so the chip's bar doesn't setState every hit.
          if (ally)
            spectate = {
              name: ally.name,
              hpFrac: Math.round(Math.max(0, ally.hp / ally.maxHp) * 100) / 100,
            };
        }

        const next: HudState = {
          phase,
          countdown,
          wins: round ? round.wins : [0, 0],
          banner,
          outcome,
          lost: client.status === "closed",
          dead,
          spectate,
        };
        const key = JSON.stringify(next);
        if (key !== hudKey.current) {
          hudKey.current = key;
          setHud(next);
        }
      },
    },
    // Pinned rate (no adaptive tiers), and catch-up capped at 2 steps/frame.
    // The default cap (5) lets one long frame schedule a burst of make-up
    // ticks; online those are free (a WS send), but in practice each one is a
    // full stepSim + 7 bot brains, so the burst makes the NEXT frame longer —
    // the fixed-timestep spiral, felt as stutter on weak devices. Capping at 2
    // trades that for a moment of slow-motion (advanceFixed drops the excess
    // time), which offline nobody can drift from; online the server never
    // needed the extra input sends anyway (it latches the last one).
    { step: TICK_DT, maxStep: TICK_DT, maxSteps: 2 },
  );

  const myTeam = client.welcome?.team ?? 1;
  const teamNames = client.welcome?.teamNames ?? ["Team 1", "Team 2"];

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        layoutRef.current = {
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        };
      }}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={picture} />
      </Canvas>

      {/* score */}
      <View
        style={[styles.scoreRow, { top: insets.top + 12 }]}
        pointerEvents="none"
      >
        <Text
          style={[styles.score, myTeam === 1 ? styles.mine : styles.theirs]}
        >
          {hud.wins[0]}
        </Text>
        <Text style={styles.scoreDash}>—</Text>
        <Text
          style={[styles.score, myTeam === 2 ? styles.mine : styles.theirs]}
        >
          {hud.wins[1]}
        </Text>
      </View>

      {/* kill announcements (First Blood / DOUBLE KILL …) — sits below the score,
          clear of the centre countdown/banner */}
      {announce ? (
        <View
          style={[styles.announceWrap, { top: insets.top + 70 }]}
          pointerEvents="none"
        >
          {announce.who ? (
            <Text style={styles.announceCredit} numberOfLines={1}>
              {announce.who}
            </Text>
          ) : null}
          <Text style={styles.announceText}>{announce.label}</Text>
        </View>
      ) : null}

      {/* centre banner / countdown */}
      {hud.countdown !== null ? (
        <View style={styles.centre} pointerEvents="none">
          <Text style={styles.countdown}>{hud.countdown}</Text>
          {/* The pre-round beat teaches the names AND the colours at once:
              your faction blue, theirs red — the same allegiance cue the
              bodies wear (bits-bot-backfill.md § team identity). */}
          <Text style={styles.teamHint}>
            <Text style={styles.teamHintMine}>{teamNames[myTeam - 1]}</Text>
            <Text style={styles.teamHintVs}>{"  vs  "}</Text>
            <Text style={styles.teamHintFoe}>{teamNames[2 - myTeam]}</Text>
          </Text>
        </View>
      ) : hud.outcome ? (
        <RoundBanner
          key={hud.outcome.key}
          kind={hud.outcome.kind}
          title={hud.outcome.title}
          subtitle={hud.outcome.subtitle}
          score={hud.outcome.score}
        />
      ) : hud.banner ? (
        <View style={styles.centre} pointerEvents="none">
          <Text style={styles.banner}>{hud.banner}</Text>
        </View>
      ) : null}

      {/* controls — the floating-stick region flex-fills from one side; the
          button column owns the other edge and the region resizes around it
          (more buttons to come — powers). Movement sits under the DOMINANT
          thumb: default = movement right + buttons left; lefty mode mirrors
          (movement left, buttons right). Scheme test verdict 2026-07-12:
          FLOAT won; fixed stick and orbit pad are gone. */}
      {/* Death spectator: a corpse has no inputs — swap the controls for a chip
          naming the ally the camera is trailing, with their live HP. */}
      {hud.dead ? (
        hud.spectate ? (
          <View
            style={[styles.spectateBar, { bottom: insets.bottom + 40 }]}
            pointerEvents="none"
          >
            <Text style={styles.spectateLabel}>
              SPECTATING {hud.spectate.name.toUpperCase()}
            </Text>
            <View style={styles.spectateHpBack}>
              <View
                style={[
                  styles.spectateHpFill,
                  { width: `${Math.round(hud.spectate.hpFrac * 100)}%` },
                ]}
              />
            </View>
          </View>
        ) : null
      ) : (
        <View
          style={[
            styles.controlsRow,
            lefty && styles.controlsLefty,
            { bottom: insets.bottom + 24 },
          ]}
          pointerEvents="box-none"
        >
          <FloatingStick
            onChange={(sample) => {
              stickRef.current = sample;
              if (!audioUnlocked.current) {
                audioUnlocked.current = true;
                unlockAudio();
              }
            }}
          />
          <View style={styles.buttonsCol}>
            {buttonIds.map((id, i) => (
              <AbilityButton
                key={`${i}-${id}`}
                id={id}
                overlay={overlays[i]!}
                onPress={() => {
                  castRequests.current[i] = true;
                  if (!audioUnlocked.current) {
                    audioUnlocked.current = true;
                    unlockAudio();
                  }
                }}
              />
            ))}
          </View>
        </View>
      )}

      {onQuit ? (
        <Pressable
          onPress={onQuit}
          style={[styles.quitChip, { top: insets.top + 10 }]}
          hitSlop={12}
        >
          <Text style={styles.quitText}>✕</Text>
        </Pressable>
      ) : null}

      {/* Frame profiler readout (dev menu toggle) — top-left, clear of the
          centred score and the top-right quit chip. */}
      {perfOn && perfText ? (
        <Text
          style={[styles.perfReadout, { top: insets.top + 12 }]}
          pointerEvents="none"
        >
          {perfText}
        </Text>
      ) : null}

      {hud.lost ? (
        <View style={styles.leaveWrap}>
          <Pressable onPress={onLeave} style={styles.leave}>
            <Text style={styles.leaveText}>BACK</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210" },
  scoreRow: {
    position: "absolute",
    top: 58,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  score: { fontSize: 30, fontWeight: "900", color: "#f0e8d8" },
  scoreDash: { fontSize: 20, color: "#8a7f70" },
  // Your tally reads friend-blue, theirs foe-red — the same allegiance cue as
  // the bodies, so the scoreboard says which number is yours at a glance.
  mine: { color: "#5aa9e0" },
  theirs: { color: "#e07a6a" },
  centre: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  announceWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  // The small credit line ("Ragnar gets a") — deliberately much smaller than the
  // label below so long player names never dwarf FIRST BLOOD / DOUBLE KILL.
  announceCredit: {
    fontSize: 14,
    fontWeight: "700",
    color: "#e8dcc4",
    letterSpacing: 1,
    textAlign: "center",
    marginBottom: 1,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  announceText: {
    fontSize: 32,
    fontWeight: "900",
    color: "#d99a41",
    letterSpacing: 3,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  countdown: { fontSize: 96, fontWeight: "900", color: "#f0e8d8" },
  teamHint: { fontSize: 15, marginTop: 4, fontWeight: "800", letterSpacing: 0.5 },
  teamHintMine: { color: "#5aa9e0" },
  teamHintFoe: { color: "#e07a6a" },
  teamHintVs: { color: "#8a7f70", fontWeight: "700" },
  banner: {
    fontSize: 34,
    fontWeight: "900",
    color: "#f0e8d8",
    letterSpacing: 2,
    textAlign: "center",
  },
  // The bottom control band: stick region flexes, buttons keep their width.
  controlsRow: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 24,
    height: "33%", // the bottom third — tall enough for a thumb, no more
    flexDirection: "row-reverse", // movement region fills from the RIGHT
    alignItems: "stretch",
    gap: 12,
  },
  controlsLefty: { flexDirection: "row" }, // mirrored: movement on the left
  // The ability buttons hug the bottom corner opposite the stick, out of the
  // play space (2026-07-16) — flex-end anchors them to the band's floor (which
  // already sits insets.bottom + 24 above the tray) and they grow upward.
  buttonsCol: {
    justifyContent: "flex-end",
    paddingBottom: 0,
    paddingHorizontal: 12,
    gap: 14,
  },
  // Dev frame profiler: small mono readout pinned top-left.
  perfReadout: {
    position: "absolute",
    left: 12,
    color: "rgba(120, 255, 170, 0.9)",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  quitChip: {
    position: "absolute",
    top: 54,
    right: 18,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  quitText: { color: "#8a7f70", fontSize: 18, fontWeight: "700" },
  // Death spectator chip: sits where the controls were, naming the ally the
  // camera trails with a live HP bar (matches the world-space bar's colours).
  spectateBar: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 8,
  },
  spectateLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: "#f0e8d8",
    letterSpacing: 2,
    opacity: 0.85,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  spectateHpBack: {
    width: 160,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    overflow: "hidden",
  },
  spectateHpFill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: "#5fc75f",
  },
  leaveWrap: { position: "absolute", bottom: 260, alignSelf: "center" },
  leave: {
    backgroundColor: "#8c2f2f",
    borderRadius: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  leaveText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1 },
});
