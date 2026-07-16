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
import { playSound, unlockAudio } from "../audio";
import { KillStreaks, type MultiKillTier } from "../audio/killstreaks";
import { AbilityButton, EMPTY_BUTTON_PICTURE, recordAbilityButton } from "../game/AbilityButton";
import { useAbilityIconImages } from "../game/abilityIcons";
import { EMPTY_ARENA_PICTURE, recordArena, type FxItem } from "../game/render";
import { useArenaAtlas } from "../game/tilesets";
import { FloatingStick } from "../game/FloatingStick";
import { StatusPulses } from "../game/statusRings";
import { loadLefty } from "../settings";

const NUMBER_TTL = 750;
const RING_TTL = 380;
const DETONATE_TTL = 1150; // the sandtrap boom lingers well past a hit ping
const FIGHT_BANNER_TTL = 900;
/** How long a First Blood / multi-kill call stays on screen. */
const ANNOUNCE_TTL = 1900;
/** Proximity attenuation: a positional sound plays full within SOUND_NEAR px of
 * your fighter, fading to SOUND_FLOOR by SOUND_FAR px — a floor, not silence, so
 * distant fights still read faintly as info. Global cues (round/match stings,
 * UI, announcer) ignore this and always play full. Grounded to the arena, which
 * is 1600×1600px (25 tiles × 64px): NEAR ≈ your immediate scrap, FAR ≈ half the
 * map, so the far half fades to the floor. Tune to taste. */
const SOUND_NEAR = 250;
const SOUND_FAR = 850;
const SOUND_FLOOR = 0.22;
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
  lost: boolean;
}

const INITIAL_HUD: HudState = { phase: "countdown", countdown: null, wins: [0, 0], banner: null, lost: false };

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
  const fightBannerUntil = useRef(0);
  // Last countdown digit sounded, so 3·2·1 ticks fire once each (null between rounds).
  const lastCountdown = useRef<number | null>(null);
  // Audio needs a user gesture to start (web/iOS); unlock on the first touch.
  const audioUnlocked = useRef(false);
  const stickRef = useRef<StickSample>(STICK_ZERO);
  // Cast taps latched per slot until the next input send (the dash pattern ×3).
  const castRequests = useRef<boolean[]>(Array.from({ length: LOADOUT_ABILITY_COUNT }, () => false));
  const lastButtonKeys = useRef<string[]>(Array.from({ length: LOADOUT_ABILITY_COUNT }, () => ""));
  // The drafted hand, from snapshots — names the buttons once the match feeds us.
  const [buttonIds, setButtonIds] = useState<AbilityId[]>([]);
  const buttonIdsKey = useRef("");
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const hudKey = useRef("");
  // Status-ring pulse clocks (slow/bleed), advanced per rendered frame.
  const pulsesRef = useRef<StatusPulses | null>(null);
  pulsesRef.current ??= new StatusPulses();
  const pulses = pulsesRef.current;
  // Lefty mode (settings page): read at mount, i.e. match start.
  const [lefty, setLefty] = useState(false);
  useEffect(() => {
    void loadLefty().then(setLefty);
  }, []);

  // First Blood + multi-kill announcements — client-derived from lethal hits
  // (fresh tracker per match, since this screen remounts per match). The banner
  // is event-driven, so setState here is fine (kills are infrequent).
  const killStreaksRef = useRef<KillStreaks | null>(null);
  killStreaksRef.current ??= new KillStreaks();
  const killStreaks = killStreaksRef.current;
  const [announce, setAnnounce] = useState<string | null>(null);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showAnnounce = (text: string): void => {
    setAnnounce(text);
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnounce(null), ANNOUNCE_TTL);
  };
  useEffect(() => () => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
  }, []);

  useEffect(() => {
    client.onEvents = (events) => {
      const now = performance.now();
      const myId = client.welcome?.playerId ?? null;
      const myTeam = client.welcome?.team ?? 1;
      // The listener for proximity attenuation is your own fighter (your corpse
      // while spectating your death). Sampled once per batch — events share a tick.
      const view = client.buffer.sample(now);
      const listener = myId != null ? view?.players.find((p) => p.id === myId) : undefined;
      /** Volume factor for a sound at world (x, y): 1 near you → SOUND_FLOOR far.
       *  No listener (pure spectator) → unattenuated. */
      const gainAt = (x: number, y: number): number => {
        if (!listener) return 1;
        const d = Math.hypot(x - listener.x, y - listener.y);
        if (d <= SOUND_NEAR) return 1;
        if (d >= SOUND_FAR) return SOUND_FLOOR;
        return 1 - ((d - SOUND_NEAR) / (SOUND_FAR - SOUND_NEAR)) * (1 - SOUND_FLOOR);
      };
      for (const e of events) {
        if (e.type === "hit") {
          // Straw men don't bleed — deployable-target hits skip the decals.
          if (!isDeployableId(e.targetId)) blood.splatter(e.x, e.y, e.damage, e.lethal, now);
          if (e.lethal) {
            // The kill spray fires out of the victim's BACK — away from the
            // killer. The victim auto-faces their attacker, so if the killer's
            // position isn't in the view (seat gone), -facing is the same line.
            const victim = view?.players.find((p) => p.id === e.targetId);
            const attacker = view?.players.find((p) => p.id === e.attackerId);
            const dx = attacker ? e.x - attacker.x : victim ? -Math.cos(victim.facing) : 1;
            const dy = attacker ? e.y - attacker.y : victim ? -Math.sin(victim.facing) : 0;
            const len = Math.hypot(dx, dy) || 1;
            blood.deathBurst(e.x, e.y, dx / len, dy / len, now);
            // First Blood + Unreal-style kill chains (everyone hears them). Only
            // real players count — dummies never report a lethal hit anyway.
            if (!isDeployableId(e.targetId)) {
              const call = killStreaks.registerKill(e.attackerId, e.targetId, now);
              if (call?.firstBlood) {
                playSound("firstBlood");
                showAnnounce("FIRST BLOOD");
              } else if (call?.tier) {
                playSound("multiKill", call.tier);
                showAnnounce(MULTI_KILL_TEXT[call.tier]);
              }
            }
          }
          fxRef.current.push({
            item: { kind: "number", x: e.x, y: e.y, life: 1, text: String(e.damage), crit: e.crit, bleed: e.bleed },
            bornMs: now,
            ttlMs: NUMBER_TTL,
          });
          // Bleed ticks are ambient damage — a red number, no impact ring.
          if (!e.bleed) {
            fxRef.current.push({ item: { kind: "ring", x: e.x, y: e.y, life: 1 }, bornMs: now, ttlMs: RING_TTL });
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
              const weapon = view?.players.find((p) => p.id === e.attackerId)?.weapon;
              playSound("weaponStrike", weapon ?? undefined, undefined, gainAt(e.x, e.y));
            }
          }
        } else if (e.type === "shoot") {
          // the bow twang / staff whoosh, on release
          playSound("weaponFire", e.weapon, undefined, gainAt(e.x, e.y));
        } else if (e.type === "death") {
          const dp = view?.players.find((p) => p.id === e.playerId);
          playSound("death", undefined, undefined, dp ? gainAt(dp.x, dp.y) : 1);
        } else if (e.type === "cast") {
          if (e.playerId === myId) playStrikeHaptic("soft"); // tactile confirm of the cast
          const caster = view?.players.find((p) => p.id === e.playerId);
          // every cast is audible — the tell is information — but fades with distance
          playSound("abilityCast", e.ability, undefined, caster ? gainAt(caster.x, caster.y) : 1);
          if (caster) {
            // The cast flash: the ability's icon pops above the caster —
            // "they just pressed this button". The ONLY way enemy kits show
            // (pvp-loadout-flow.md); allies and self flash too, one language.
            fxRef.current.push({
              item: { kind: "castFlash", x: caster.x, y: caster.y - CAST_FLASH_RISE_FROM, life: 1, ability: e.ability },
              bornMs: now,
              ttlMs: CAST_FLASH_TTL,
            });
            // Tremor also fractures the sand where the caster stood.
            if (e.ability === "tremor") cracks.add(caster.x, caster.y, TREMOR.radius, now);
          }
        } else if (e.type === "harpoon") {
          // The chain flash: caster → hook point, gone in a blink.
          fxRef.current.push({
            item: { kind: "line", x: e.fromX, y: e.fromY, x2: e.toX, y2: e.toY, life: 1 },
            bornMs: now,
            ttlMs: 260,
          });
          playSound("harpoonWhip", undefined, undefined, gainAt(e.fromX, e.fromY));
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
            item: { kind: "number", x: e.x, y: e.y, life: 1, text: `+${e.amount}`, heal: true },
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
          playSound("roundEnd", e.winnerTeam === 0 ? "draw" : e.winnerTeam === myTeam ? "win" : "loss");
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
        client.sendInput(stick.dir.x * stick.magnitude, stick.dir.y * stick.magnitude, [
          ...castRequests.current,
        ]);
        castRequests.current.fill(false);
      },
      onRender: () => {
        const now = performance.now();
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
          blood.update(view.players, now);
          cracks.update(now);
          pulses.update(view.players, now);
          picture.value = recordArena({
            view,
            config: client.welcome.config,
            myId: client.welcome.playerId,
            screenW: w,
            screenH: h,
            insetTop: insets.top,
            insetBottom: insets.bottom,
            fx: fx.map((f) => f.item),
            blood: blood.decals,
            cracks: cracks.decals,
            pulses,
            nowMs: now,
            atlas,
            abilityIcons,
          });

          // Ability buttons: name them from the snapshot's slot list (pick
          // order), re-record a face only when its clock or state moved.
          const me = view.players.find((p) => p.id === client.welcome!.playerId);
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
            const frac = Math.min(1, Math.max(0, slot.cd / def.cooldown));
            const active = slot.active > 0;
            const key = `${slot.id}:${frac}:${active}:${slot.charges}`;
            if (key !== lastButtonKeys.current[i]) {
              lastButtonKeys.current[i] = key;
              overlays[i]!.value = recordAbilityButton(frac, active, slot.charges, def.charges);
            }
          }
        }

        // HUD — cheap derive, setState only when something visible changed.
        const myTeam = client.welcome?.team ?? 1;
        const round = view?.round;
        const phase = round?.phase ?? "countdown";
        // The whole enemy TEAM must be gone — one teammate-of-theirs dropping
        // out of a 3v3 is not "finish them".
        const enemies = client.roomState?.players.filter((p) => p.team !== myTeam) ?? [];
        const enemyGone = enemies.length > 0 && enemies.every((p) => !p.connected);
        let banner: string | null = null;
        let countdown: number | null = null;
        if (client.status === "closed") banner = "connection lost";
        else if (round && phase === "countdown") countdown = Math.max(1, Math.ceil(round.timer));
        else if (round && phase === "roundEnd")
          banner = round.lastWinner === 0 ? "nobody survives" : round.lastWinner === myTeam ? "round to you" : "round to them";
        else if (round && phase === "matchEnd") banner = round.lastWinner === myTeam ? "VICTORY" : "DEFEAT";
        else if (phase === "active" && now < fightBannerUntil.current) banner = "FIGHT";
        else if (phase === "active" && enemyGone)
          banner = enemies.length === 1 ? "opponent disconnected — finish them" : "enemies disconnected — finish them";

        // A soft tick on each new pre-round digit (roundStart already boomed).
        if (countdown !== null && countdown !== lastCountdown.current) playSound("countdownTick");
        lastCountdown.current = countdown;

        const next: HudState = {
          phase,
          countdown,
          wins: round ? round.wins : [0, 0],
          banner,
          lost: client.status === "closed",
        };
        const key = JSON.stringify(next);
        if (key !== hudKey.current) {
          hudKey.current = key;
          setHud(next);
        }
      },
    },
    { step: TICK_DT, maxStep: TICK_DT }, // pinned rate: no adaptive tiers on the client
  );

  const myTeam = client.welcome?.team ?? 1;

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        layoutRef.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
      }}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={picture} />
      </Canvas>

      {/* score */}
      <View style={[styles.scoreRow, { top: insets.top + 12 }]} pointerEvents="none">
        <Text style={[styles.score, myTeam === 1 ? styles.mine : styles.theirs]}>{hud.wins[0]}</Text>
        <Text style={styles.scoreDash}>—</Text>
        <Text style={[styles.score, myTeam === 2 ? styles.mine : styles.theirs]}>{hud.wins[1]}</Text>
      </View>

      {/* kill announcements (First Blood / DOUBLE KILL …) — sits below the score,
          clear of the centre countdown/banner */}
      {announce ? (
        <View style={[styles.announceWrap, { top: insets.top + 70 }]} pointerEvents="none">
          <Text style={styles.announceText}>{announce}</Text>
        </View>
      ) : null}

      {/* centre banner / countdown */}
      {hud.countdown !== null ? (
        <View style={styles.centre} pointerEvents="none">
          <Text style={styles.countdown}>{hud.countdown}</Text>
          <Text style={styles.teamHint}>you are {myTeam === 1 ? "RED" : "BLUE"}</Text>
        </View>
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
      <View
        style={[styles.controlsRow, lefty && styles.controlsLefty, { bottom: insets.bottom + 24 }]}
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

      {onQuit ? (
        <Pressable onPress={onQuit} style={[styles.quitChip, { top: insets.top + 10 }]} hitSlop={12}>
          <Text style={styles.quitText}>✕</Text>
        </Pressable>
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
  mine: { color: "#f0e8d8" },
  theirs: { color: "#8a7f70" },
  centre: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  announceWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
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
  teamHint: { fontSize: 15, color: "#f0e8d8", opacity: 0.8, marginTop: 4 },
  banner: { fontSize: 34, fontWeight: "900", color: "#f0e8d8", letterSpacing: 2, textAlign: "center" },
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
  buttonsCol: { justifyContent: "flex-end", paddingBottom: 0, paddingHorizontal: 12, gap: 14 },
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
  leaveWrap: { position: "absolute", bottom: 260, alignSelf: "center" },
  leave: { backgroundColor: "#8c2f2f", borderRadius: 8, paddingHorizontal: 28, paddingVertical: 12 },
  leaveText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1 },
});
