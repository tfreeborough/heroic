import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas, Picture } from "@shopify/react-native-skia";
import { useSharedValue } from "react-native-reanimated";
import { useKeepAwake } from "expo-keep-awake";
import { STICK_ZERO, useGameLoop, type StickSample } from "@heroic/engine";
import { TICK_DT, type RoundPhase } from "@heroic/blood-in-the-sand-sim";
import type { GameClient } from "../net/connection";
import { BloodField } from "../game/blood";
import { playStrikeHaptic, WEAPON_HAPTIC } from "../game/haptics";
import { DASH_READY_PICTURE, DashButton, recordDashButton } from "../game/DashButton";
import { EMPTY_ARENA_PICTURE, recordArena, type FxItem } from "../game/render";
import { useArenaAtlas } from "../game/tilesets";
import { FloatingStick } from "../game/FloatingStick";
import { StatusPulses } from "../game/statusRings";
import { loadLefty } from "../settings";

const NUMBER_TTL = 750;
const RING_TTL = 380;
const FIGHT_BANNER_TTL = 900;

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
  const picture = useSharedValue(EMPTY_ARENA_PICTURE);
  const dashOverlay = useSharedValue(DASH_READY_PICTURE);
  const layoutRef = useRef({ w: 0, h: 0 });
  const fxRef = useRef<AgedFx[]>([]);
  // Blood persists across rounds (the arena remembers); a new match remounts
  // this screen via the lobby, which is what wipes the floor clean.
  const bloodRef = useRef<BloodField | null>(null);
  bloodRef.current ??= new BloodField();
  const blood = bloodRef.current;
  const fightBannerUntil = useRef(0);
  const stickRef = useRef<StickSample>(STICK_ZERO);
  const dashRequest = useRef(false);
  const lastDashFrac = useRef(0);
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

  useEffect(() => {
    client.onEvents = (events) => {
      const now = performance.now();
      const myId = client.welcome?.playerId ?? null;
      for (const e of events) {
        if (e.type === "hit") {
          blood.splatter(e.x, e.y, e.damage, e.lethal, now);
          if (e.lethal) {
            // The kill spray fires out of the victim's BACK — away from the
            // killer. The victim auto-faces their attacker, so if the killer's
            // position isn't in the view (seat gone), -facing is the same line.
            const view = client.buffer.sample(now);
            const victim = view?.players.find((p) => p.id === e.targetId);
            const attacker = view?.players.find((p) => p.id === e.attackerId);
            const dx = attacker ? e.x - attacker.x : victim ? -Math.cos(victim.facing) : 1;
            const dy = attacker ? e.y - attacker.y : victim ? -Math.sin(victim.facing) : 0;
            const len = Math.hypot(dx, dy) || 1;
            blood.deathBurst(e.x, e.y, dx / len, dy / len, now);
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
        } else if (e.type === "dash") {
          if (e.playerId === myId) playStrikeHaptic("soft"); // tactile confirm of the roll
        } else if (e.type === "fightStart") {
          fightBannerUntil.current = now + FIGHT_BANNER_TTL;
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
        // One input per sim tick (30Hz): stick dir × magnitude + the dash tap
        // (consumed here; the server latches it so a between-tick press holds).
        const stick = stickRef.current;
        client.sendInput(stick.dir.x * stick.magnitude, stick.dir.y * stick.magnitude, dashRequest.current);
        dashRequest.current = false;
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
          pulses.update(view.players, now);
          picture.value = recordArena({
            view,
            config: client.welcome.config,
            myId: client.welcome.playerId,
            screenW: w,
            screenH: h,
            fx: fx.map((f) => f.item),
            blood: blood.decals,
            pulses,
            nowMs: now,
            atlas,
          });

          // Dash button clock: re-record only while the fraction is moving.
          const me = view.players.find((p) => p.id === client.welcome!.playerId);
          const frac = me ? Math.min(1, Math.max(0, me.dashCd / client.welcome.config.dashCooldown)) : 0;
          if (frac !== lastDashFrac.current) {
            lastDashFrac.current = frac;
            dashOverlay.value = frac > 0 ? recordDashButton(frac) : DASH_READY_PICTURE;
          }
        }

        // HUD — cheap derive, setState only when something visible changed.
        const myTeam = client.welcome?.team ?? 1;
        const round = view?.round;
        const phase = round?.phase ?? "countdown";
        const enemyGone =
          client.roomState?.players.some((p) => p.id !== client.welcome?.playerId && !p.connected) ?? false;
        let banner: string | null = null;
        let countdown: number | null = null;
        if (client.status === "closed") banner = "connection lost";
        else if (round && phase === "countdown") countdown = Math.max(1, Math.ceil(round.timer));
        else if (round && phase === "roundEnd")
          banner = round.lastWinner === 0 ? "nobody survives" : round.lastWinner === myTeam ? "round to you" : "round to them";
        else if (round && phase === "matchEnd") banner = round.lastWinner === myTeam ? "VICTORY" : "DEFEAT";
        else if (phase === "active" && now < fightBannerUntil.current) banner = "FIGHT";
        else if (phase === "active" && enemyGone) banner = "opponent disconnected — finish them";

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
        <FloatingStick onChange={(sample) => (stickRef.current = sample)} />
        <View style={styles.buttonsCol}>
          <DashButton overlay={dashOverlay} onPress={() => (dashRequest.current = true)} />
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
  // A column with room for the power buttons to come (grows upward).
  buttonsCol: { justifyContent: "flex-end", paddingBottom: 48, paddingHorizontal: 12, gap: 14 },
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
