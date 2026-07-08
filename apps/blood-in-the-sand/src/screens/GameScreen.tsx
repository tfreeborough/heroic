import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { Canvas, Picture } from "@shopify/react-native-skia";
import { useSharedValue } from "react-native-reanimated";
import { useKeepAwake } from "expo-keep-awake";
import { STICK_ZERO, useGameLoop, type StickSample } from "@heroic/engine";
import { TICK_DT, type RoundPhase } from "@heroic/blood-in-the-sand-sim";
import type { ArenaClient } from "../net/connection";
import { DASH_READY_PICTURE, DashButton, recordDashButton } from "../game/DashButton";
import { EMPTY_ARENA_PICTURE, recordArena, type FxItem } from "../game/render";
import { Thumbstick } from "../game/Thumbstick";

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

const INITIAL_HUD: HudState = { phase: "waiting", countdown: null, wins: [0, 0], banner: "connecting…", lost: false };

export interface GameScreenProps {
  client: ArenaClient;
  onLeave: () => void;
}

/**
 * The match screen. The client never simulates: `onRender` samples the
 * snapshot buffer and re-records the scene picture; `onStep` is the fixed
 * 30Hz cadence that sends input (wired in the input pass).
 */
export const GameScreen = ({ client, onLeave }: GameScreenProps) => {
  useKeepAwake();
  const picture = useSharedValue(EMPTY_ARENA_PICTURE);
  const dashOverlay = useSharedValue(DASH_READY_PICTURE);
  const layoutRef = useRef({ w: 0, h: 0 });
  const fxRef = useRef<AgedFx[]>([]);
  const fightBannerUntil = useRef(0);
  const stickRef = useRef<StickSample>(STICK_ZERO);
  const dashRequest = useRef(false);
  const lastDashFrac = useRef(0);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const hudKey = useRef("");

  useEffect(() => {
    client.onEvents = (events) => {
      const now = performance.now();
      for (const e of events) {
        if (e.type === "hit") {
          fxRef.current.push({
            item: { kind: "number", x: e.x, y: e.y, life: 1, text: String(e.damage), crit: e.crit },
            bornMs: now,
            ttlMs: NUMBER_TTL,
          });
          fxRef.current.push({ item: { kind: "ring", x: e.x, y: e.y, life: 1 }, bornMs: now, ttlMs: RING_TTL });
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
          picture.value = recordArena({
            view,
            config: client.welcome.config,
            myId: client.welcome.playerId,
            screenW: w,
            screenH: h,
            fx: fx.map((f) => f.item),
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
        const phase = round?.phase ?? "waiting";
        let banner: string | null = null;
        let countdown: number | null = null;
        if (client.status === "closed") banner = "connection lost";
        else if (phase === "waiting") banner = "waiting for opponent…";
        else if (round && phase === "countdown") countdown = Math.max(1, Math.ceil(round.timer));
        else if (round && phase === "roundEnd")
          banner = round.lastWinner === 0 ? "nobody survives" : round.lastWinner === myTeam ? "round to you" : "round to them";
        else if (round && phase === "matchEnd") banner = round.lastWinner === myTeam ? "VICTORY" : "DEFEAT";
        else if (phase === "active" && now < fightBannerUntil.current) banner = "FIGHT";

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

      {/* controls */}
      <View style={styles.stickWrap}>
        <Thumbstick size={190} onChange={(sample) => (stickRef.current = sample)} />
      </View>
      <View style={styles.dashWrap}>
        <DashButton overlay={dashOverlay} onPress={() => (dashRequest.current = true)} />
      </View>

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
  stickWrap: { position: "absolute", left: 20, bottom: 36 },
  dashWrap: { position: "absolute", right: 28, bottom: 84 },
  leaveWrap: { position: "absolute", bottom: 260, alignSelf: "center" },
  leave: { backgroundColor: "#8c2f2f", borderRadius: 8, paddingHorizontal: 28, paddingVertical: 12 },
  leaveText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1 },
});
