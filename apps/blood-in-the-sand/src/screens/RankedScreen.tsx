/**
 * The ranked home (bits-ranked.md § the ranked screen) — what the RANKED card
 * opens. Not a queueing spinner: your standing, the bracket cards (1v1 live
 * in Season I, future brackets shown locked for aspiration), the live queue
 * population, and the queue/cancel flow. When a match is found the server
 * seats us itself — the welcome flips the app into the room flow and this
 * screen simply stops rendering; after the match, roomClosed lands us back
 * here with the settlement banner still up.
 *
 * Bracket-card art is owed to the Forge — cards paint the mode-select
 * gradient fallback until the PNGs land.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas, LinearGradient, RadialGradient, Rect, vec } from "@shopify/react-native-skia";
import { playSound, unlockAudio } from "../audio";
import { GloryPill } from "../components/GloryPill";
import {
  ensureIdentity,
  fetchRankedMe,
  revalidateIdentity,
  type Identity,
  type RankedBracketStanding,
} from "../net/api";
import type { ArenaClient } from "../net/connection";

export interface RankedScreenProps {
  client: ArenaClient;
  playerName: string;
  onBack: () => void;
}

const DISPLAY_FONT = Platform.select({ ios: "Copperplate", default: "serif" });

/** How often to refresh the population display while NOT queued (the server
 * pushes queueStatus every matcher beat once we are). */
const QUEUE_INFO_POLL_MS = 5000;

const formatWait = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** The painted stand-in until the Forge delivers bracket art — the same
 * ramp+glow language as the pre-art mode cards. */
const BracketArt = ({ w, h, locked }: { w: number; h: number; locked: boolean }) => (
  <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
    <Rect x={0} y={0} width={w} height={h}>
      <LinearGradient
        start={vec(0, h)}
        end={vec(w, 0)}
        colors={locked ? ["#1a1512", "#241c14", "#2c2318"] : ["#3a1c12", "#6e2f1a", "#a35a26"]}
      />
    </Rect>
    <Rect x={0} y={0} width={w} height={h}>
      <RadialGradient
        c={vec(w * 0.8, h * 0.2)}
        r={w * 0.5}
        colors={[locked ? "rgba(232,200,122,0.08)" : "rgba(255,214,140,0.45)", "rgba(0,0,0,0)"]}
      />
    </Rect>
  </Canvas>
);

export const RankedScreen = ({ client, playerName, onBack }: RankedScreenProps) => {
  const insets = useSafeAreaInsets();
  const [identity, setIdentity] = useState<Identity | null | "loading">("loading");
  const [standing, setStanding] = useState<RankedBracketStanding | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;

  // Identity + standing. The settlement key re-fetches the standing after a
  // match so the header always shows the post-match number even if the
  // ceremony banner is dismissed.
  const settlementKey = client.rankedResult?.matchId ?? "";
  useEffect(() => {
    let live = true;
    void (async () => {
      // Revalidate before queueing: a stored identity the backend no longer
      // knows (dev DB reset) self-heals into a fresh registration here,
      // instead of every queueJoin bouncing off "sign-in failed".
      const stored = await ensureIdentity();
      const id = stored ? await revalidateIdentity(stored) : null;
      if (!live) return;
      setIdentity(id);
      if (!id) return;
      const me = await fetchRankedMe(id);
      if (live && me) setStanding(me.brackets.find((b) => b.bracket === "1v1") ?? null);
    })();
    return () => {
      live = false;
    };
  }, [settlementKey]);

  // The population display: ask immediately, then poll gently while idle.
  useEffect(() => {
    client.refreshQueueInfo();
    const timer = setInterval(() => {
      if (!client.queued) client.refreshQueueInfo();
    }, QUEUE_INFO_POLL_MS);
    return () => clearInterval(timer);
  }, [client]);

  // The queued state breathes — searching should feel alive.
  useEffect(() => {
    if (!client.queued) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [client.queued, pulse]);


  const oneVOne = client.queueStatus.find((b) => b.bracket === "1v1");
  const queueSize = oneVOne?.size ?? 0;
  const waitedSec = oneVOne?.waitedSec;
  const settlement = client.lastSettlement;
  // Placing until /ranked/me proves otherwise — the fresh-player-correct default.
  const placing = standing === null || standing.placementsLeft > 0;
  const played = standing ? standing.wins + standing.losses : 0;

  // The wait timer counts on the LOCAL clock — smooth by definition. The
  // server's waitedSec is floored AND arrives on a 2s beat, so it routinely
  // disagrees with local elapsed by up to ~2s; treating that as drift is what
  // made the digits jump. Anchor once on entry, and re-anchor only on a REAL
  // discontinuity (a void's re-queue that preserved earned wait). The 250ms
  // tick outpaces the second boundary so the display can never skip a digit.
  const waitAnchor = useRef<number | null>(null);
  const [, tickWait] = useReducer((x: number) => x + 1, 0);
  if (waitedSec === undefined) {
    waitAnchor.current = null;
  } else {
    const nowMs = performance.now();
    if (waitAnchor.current === null) {
      waitAnchor.current = nowMs - waitedSec * 1000;
    } else if (Math.abs((nowMs - waitAnchor.current) / 1000 - waitedSec) > 2.5) {
      waitAnchor.current = nowMs - waitedSec * 1000;
    }
  }
  useEffect(() => {
    if (!client.queued) return;
    const timer = setInterval(tickWait, 250);
    return () => clearInterval(timer);
  }, [client.queued]);
  const displayWait =
    waitAnchor.current === null ? 0 : Math.max(0, Math.floor((performance.now() - waitAnchor.current) / 1000));

  const canQueue = identity !== null && identity !== "loading" && !client.queued;

  const enterQueue = (): void => {
    if (identity === null || identity === "loading") return;
    unlockAudio();
    playSound("uiConfirm"); // queue_match_found sting owed to the Forge
    client.queueRanked(playerName, identity.token);
  };

  const leaveQueue = (): void => {
    unlockAudio();
    playSound("uiBack");
    client.queueLeave();
  };

  const back = (): void => {
    unlockAudio();
    playSound("uiBack");
    if (client.queued) client.queueLeave(); // v1 rule: leaving the screen leaves the line
    onBack();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={12} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.season}>RANKED</Text>
        <GloryPill />
      </View>

      {/* Your standing. During PLACEMENTS (first 10 matches — and the safe
          default while /ranked/me loads) rank and rating stay hidden: the
          panel sells the reveal instead of showing a meaningless 1500. */}
      {placing ? (
        <View style={styles.standing}>
          <View style={styles.standingLeft}>
            <Text style={styles.tier}>PLACEMENTS</Text>
            <Text style={styles.record}>
              {standing
                ? `${standing.placementsLeft} match${standing.placementsLeft === 1 ? "" : "es"} until your rank is forged · 1v1`
                : "1v1"}
            </Text>
          </View>
          <Text style={styles.rating}>{standing ? `${played}/${played + standing.placementsLeft}` : "—"}</Text>
        </View>
      ) : (
        <View style={styles.standing}>
          <View style={styles.standingLeft}>
            <Text style={styles.tier}>{standing!.tier.toUpperCase()}</Text>
            <Text style={styles.record}>{`${standing!.wins}W · ${standing!.losses}L · 1v1`}</Text>
          </View>
          <Text style={styles.rating}>{standing!.rating}</Text>
        </View>
      )}

      {/* The last match's settlement, held until the next queue entry. */}
      {settlement && (
        <View style={[styles.settle, settlement.won ? styles.settleWin : styles.settleLoss]}>
          <Text style={[styles.settleTitle, settlement.won ? styles.settleTitleWin : styles.settleTitleLoss]}>
            {settlement.won ? "VICTORY" : "DEFEAT"}
          </Text>
          <Text style={styles.settleLine}>
            {settlement.mine.placement
              ? `PLACEMENT ${settlement.mine.placement.number} OF ${settlement.mine.placement.of} · +${settlement.mine.glory} GLORY`
              : `${settlement.mine.before} → ${settlement.mine.after} (${settlement.mine.delta >= 0 ? "+" : ""}${settlement.mine.delta}) · ${settlement.mine.tier.toUpperCase()} · +${settlement.mine.glory} GLORY`}
          </Text>
        </View>
      )}

      <View style={styles.cards}>
        {/* 1v1 — Season I's one live bracket. A populated queue is the card's
            best advert: the count sits big beside the copy (its own layout
            column — never overlapping). An empty queue advertises nothing. */}
        <View style={styles.card} onLayout={() => {}}>
          <CardBody
            locked={false}
            aside={
              queueSize > 0 ? (
                <View style={styles.queueBadge}>
                  <Text style={styles.queueBadgeNum}>{queueSize}</Text>
                  <Text style={styles.queueBadgeLabel}>IN QUEUE</Text>
                </View>
              ) : null
            }
          >
            <Text style={styles.cardTitle}>1v1</Text>
            <Text style={styles.cardPitch}>One life a round. First to three rounds. Your rating on the line.</Text>
            {client.queued ? (
              <View style={styles.queueRow}>
                <Animated.Text style={[styles.searching, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }]}>
                  SEARCHING · {formatWait(displayWait)}
                </Animated.Text>
                <Pressable onPress={leaveQueue} style={[styles.cta, styles.ctaGhost]}>
                  <Text style={styles.ctaText}>CANCEL</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={enterQueue}
                style={[styles.cta, !canQueue && styles.ctaDisabled]}
                disabled={!canQueue}
              >
                <Text style={styles.ctaText}>QUEUE FOR 1v1</Text>
              </Pressable>
            )}
          </CardBody>
        </View>

        {/* Future brackets — closed doors are part of the sell. */}
        <View style={[styles.card, styles.cardLocked]}>
          <CardBody locked>
            <Text style={[styles.cardTitle, styles.cardTitleDim]}>2v2</Text>
            <Text style={[styles.cardPitch, styles.cardPitchDim]}>A future season. Bring a friend.</Text>
          </CardBody>
        </View>
      </View>

      {identity === null && (
        <Text style={styles.note}>Ranked needs the arena account service — check your connection and retry.</Text>
      )}
      {client.lastError && <Text style={styles.error}>{client.lastError}</Text>}
    </View>
  );
};

/** Measured wrapper so the painted art always fills the card. `aside` renders
 * as its own column beside the copy (the queue count) — real layout, so the
 * two can never overlap. */
const CardBody = ({
  locked,
  aside = null,
  children,
}: {
  locked: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) => {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  return (
    <View
      style={styles.cardFill}
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {box && <BracketArt w={box.w} h={box.h} locked={locked} />}
      {box && (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Rect x={0} y={0} width={box.w} height={box.h}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(box.w, 0)}
              colors={["rgba(10,6,4,0.85)", "rgba(10,6,4,0.55)", "rgba(10,6,4,0)"]}
              positions={[0, 0.42, 0.72]}
            />
          </Rect>
        </Canvas>
      )}
      <View style={styles.cardCopy}>
        <View style={styles.cardMain}>{children}</View>
        {aside}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingHorizontal: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingBottom: 14,
  },
  back: { width: 44, paddingVertical: 2 },
  backText: { color: "#8a7f70", fontSize: 26, fontWeight: "800", lineHeight: 28 },
  season: {
    fontFamily: DISPLAY_FONT,
    color: "#e8c87a",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 4,
  },
  standing: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#8a6d44",
    borderRadius: 14,
    backgroundColor: "#1d1712",
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 12,
  },
  // flex: 1 so the long placement copy wraps INSIDE the panel instead of
  // shoving the number out of the row; the number never shrinks.
  standingLeft: { gap: 3, flex: 1, paddingRight: 14 },
  tier: {
    fontFamily: DISPLAY_FONT,
    color: "#f5ede0",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 3,
  },
  record: { color: "#8a7f70", fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  rating: { color: "#e8c87a", fontSize: 34, fontWeight: "900", letterSpacing: 1, flexShrink: 0 },
  settle: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
    gap: 2,
  },
  settleWin: { borderColor: "#7a5f36", backgroundColor: "#221c11" },
  settleLoss: { borderColor: "#5a3030", backgroundColor: "#1e1412" },
  settleTitle: { fontFamily: DISPLAY_FONT, fontSize: 14, fontWeight: "900", letterSpacing: 3 },
  settleTitleWin: { color: "#e8c87a" },
  settleTitleLoss: { color: "#c96a5a" },
  settleLine: { color: "#d9cbb4", fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
  cards: { flex: 1, gap: 12 },
  card: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#8a6d44",
    overflow: "hidden",
    backgroundColor: "#1d1712",
  },
  cardLocked: { borderColor: "#4a3b26", maxHeight: 110 },
  cardFill: { flex: 1 },
  cardCopy: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  cardMain: { flex: 1, justifyContent: "center", gap: 6, paddingRight: 12 },
  cardTitle: {
    fontFamily: DISPLAY_FONT,
    color: "#f5ede0",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 3,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  cardTitleDim: { color: "#cfc4b0" },
  cardPitch: { color: "#d9cbb4", fontSize: 13, lineHeight: 18, maxWidth: 260 },
  cardPitchDim: { color: "#8d8272" },
  // The live-population count: a static layout column beside the copy.
  queueBadge: { alignItems: "center", flexShrink: 0 },
  queueBadgeNum: {
    fontFamily: DISPLAY_FONT,
    color: "#e8c87a",
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: 1,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  queueBadgeLabel: {
    color: "#d9cbb4",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2.5,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Searching state stacks: timer line, CANCEL beneath — a column, so it
  // shares the row with the queue-count aside without ever crowding it.
  queueRow: { alignItems: "flex-start", gap: 10, marginTop: 8 },
  searching: { color: "#e8c87a", fontSize: 14, fontWeight: "900", letterSpacing: 2 },
  cta: {
    alignSelf: "flex-start",
    backgroundColor: "#8c2f2f",
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 26,
    marginTop: 8,
  },
  ctaGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#8a6d44", marginTop: 0 },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1.5, fontSize: 13 },
  note: { color: "#8a7f70", fontSize: 12, textAlign: "center", marginTop: 12, lineHeight: 17 },
  error: { color: "#e0503c", fontSize: 13, textAlign: "center", marginTop: 12 },
});
