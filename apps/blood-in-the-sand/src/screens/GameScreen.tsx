import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Canvas, Picture } from "@shopify/react-native-skia";
import { useSharedValue } from "react-native-reanimated";
import { useKeepAwake } from "expo-keep-awake";
import { STICK_ZERO, useGameLoop, type StickSample } from "@heroic/engine";
import { TICK_DT, type PlayerSnapshot, type RoundPhase } from "@heroic/blood-in-the-sand-sim";
import type { GameClient } from "../net/connection";
import { BloodField } from "../game/blood";
import {
  CONTROL_SCHEMES,
  KEY_CONTROLS,
  padInput,
  SCHEME_LABEL,
  type ControlScheme,
  type PadMode,
} from "../game/controls";
import { playStrikeHaptic, WEAPON_HAPTIC } from "../game/haptics";
import { DASH_READY_PICTURE, DashButton, recordDashButton } from "../game/DashButton";
import { EMPTY_ARENA_PICTURE, recordArena, type FxItem } from "../game/render";
import { FloatingStick } from "../game/FloatingStick";
import { OrbitPad } from "../game/OrbitPad";
import { Thumbstick } from "../game/Thumbstick";

const NUMBER_TTL = 750;
const RING_TTL = 380;
const FIGHT_BANNER_TTL = 900;

/** Which side the thumbstick sits on; buttons take the other. Persisted. */
type StickSide = "left" | "right";
const KEY_STICK_SIDE = "bits.stickSide";
const DEFAULT_STICK_SIDE: StickSide = "right";

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

/** The closest living opponent — the pad's reference and the practice bot's prey. */
const nearestEnemy = (players: readonly PlayerSnapshot[], me: PlayerSnapshot): PlayerSnapshot | undefined => {
  let best: PlayerSnapshot | undefined;
  let bestD = Infinity;
  for (const p of players) {
    if (p.team === me.team || !p.alive) continue;
    const d = Math.hypot(p.x - me.x, p.y - me.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
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
  const [stickSide, setStickSide] = useState<StickSide>(DEFAULT_STICK_SIDE);
  // Control scheme under test (stick / float / pad) — the chip cycles it
  // mid-match so testers can A/B without leaving a fight. Persisted.
  const [scheme, setScheme] = useState<ControlScheme>("stick");
  const schemeRef = useRef<ControlScheme>("stick");
  const [padMode, setPadMode] = useState<PadMode | null>(null);
  const padModeRef = useRef<PadMode | null>(null);
  /** Orbit radius captured when an orbit button is engaged (see padInput). */
  const holdDistRef = useRef(0);

  useEffect(() => {
    AsyncStorage.getItem(KEY_STICK_SIDE).then((v) => {
      if (v === "left" || v === "right") setStickSide(v);
    });
    AsyncStorage.getItem(KEY_CONTROLS).then((v) => {
      if ((CONTROL_SCHEMES as readonly string[]).includes(v ?? "")) {
        setScheme(v as ControlScheme);
        schemeRef.current = v as ControlScheme;
      }
    });
  }, []);

  const flipControls = () => {
    const next: StickSide = stickSide === "right" ? "left" : "right";
    setStickSide(next);
    AsyncStorage.setItem(KEY_STICK_SIDE, next);
  };

  const clearPadMode = () => {
    padModeRef.current = null;
    setPadMode(null);
  };

  const cycleScheme = () => {
    const next = CONTROL_SCHEMES[(CONTROL_SCHEMES.indexOf(scheme) + 1) % CONTROL_SCHEMES.length]!;
    setScheme(next);
    schemeRef.current = next;
    stickRef.current = STICK_ZERO; // no ghost input from the outgoing scheme
    clearPadMode();
    AsyncStorage.setItem(KEY_CONTROLS, next);
  };

  const handlePadMode = (mode: PadMode | null) => {
    if (mode === "cw" || mode === "ccw") {
      // Lock the orbit to the spacing you engaged at.
      const view = client.buffer.sample(performance.now());
      const me = view?.players.find((p) => p.id === client.welcome?.playerId);
      const enemy = me ? nearestEnemy(view!.players, me) : undefined;
      holdDistRef.current = me && enemy ? Math.hypot(enemy.x - me.x, enemy.y - me.y) : 0;
    }
    padModeRef.current = mode;
    setPadMode(mode);
  };

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
        } else if (e.type === "roundStart") {
          clearPadMode(); // a fresh round shouldn't inherit last round's auto-run
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
        // One input per sim tick (30Hz): the scheme's steering + the dash tap
        // (consumed here; the server latches it so a between-tick press holds).
        let sx = 0;
        let sy = 0;
        if (schemeRef.current === "pad") {
          // Target-relative auto-run: resolve the engaged intent against the
          // nearest enemy's CURRENT position each tick.
          const mode = padModeRef.current;
          if (mode) {
            const view = client.buffer.sample(performance.now());
            const me = view?.players.find((p) => p.id === client.welcome?.playerId);
            const enemy = me ? nearestEnemy(view!.players, me) : undefined;
            if (me) ({ sx, sy } = padInput(mode, me, enemy, holdDistRef.current));
          }
        } else {
          const stick = stickRef.current;
          sx = stick.dir.x * stick.magnitude;
          sy = stick.dir.y * stick.magnitude;
        }
        client.sendInput(sx, sy, dashRequest.current);
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
          picture.value = recordArena({
            view,
            config: client.welcome.config,
            myId: client.welcome.playerId,
            screenW: w,
            screenH: h,
            fx: fx.map((f) => f.item),
            blood: blood.decals,
            nowMs: now,
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
      <View style={styles.scoreRow} pointerEvents="none">
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

      {/* controls — movement on stickSide, the button column on the other.
          Default stick-right; the ⇄ chip flips sides, the CTRL chip cycles
          the movement scheme (both persist). */}
      <View style={[styles.stickWrap, stickSide === "right" ? styles.onRight : styles.onLeft]}>
        {scheme === "stick" ? (
          <Thumbstick size={190} onChange={(sample) => (stickRef.current = sample)} />
        ) : scheme === "float" ? (
          <FloatingStick width={260} height={230} onChange={(sample) => (stickRef.current = sample)} />
        ) : (
          <OrbitPad mode={padMode} onMode={handlePadMode} />
        )}
      </View>
      <View style={[styles.buttonsWrap, stickSide === "right" ? styles.buttonsLeft : styles.buttonsRight]}>
        <DashButton overlay={dashOverlay} onPress={() => (dashRequest.current = true)} />
      </View>

      <Pressable onPress={flipControls} style={styles.flip} hitSlop={12}>
        <Text style={styles.flipText}>⇄</Text>
      </Pressable>
      <Pressable onPress={cycleScheme} style={[styles.flip, styles.schemeChip]} hitSlop={12}>
        <Text style={styles.flipText}>{SCHEME_LABEL[scheme]}</Text>
      </Pressable>
      {onQuit ? (
        <Pressable onPress={onQuit} style={[styles.flip, styles.quitChip]} hitSlop={12}>
          <Text style={styles.flipText}>✕</Text>
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
  stickWrap: { position: "absolute", bottom: 36 },
  onLeft: { left: 20 },
  onRight: { right: 20 },
  // A column with room for the power buttons to come (grows upward).
  buttonsWrap: { position: "absolute", bottom: 84, flexDirection: "column-reverse", gap: 14 },
  buttonsLeft: { left: 28 },
  buttonsRight: { right: 28 },
  flip: {
    position: "absolute",
    top: 54,
    left: 18,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  schemeChip: { left: 62 },
  quitChip: { left: undefined, right: 18 },
  flipText: { color: "#8a7f70", fontSize: 18, fontWeight: "700" },
  leaveWrap: { position: "absolute", bottom: 260, alignSelf: "center" },
  leave: { backgroundColor: "#8c2f2f", borderRadius: 8, paddingHorizontal: 28, paddingVertical: 12 },
  leaveText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1 },
});
