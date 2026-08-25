/**
 * The summons (bits-ranked.md § Queue roaming & match accept, protocol v30).
 * A pairing no longer drops the player into a lobby: this sheet rises over
 * WHATEVER screen they're roaming — the Armory, Deeds, the title screen —
 * and asks for a yes within the window. The summons sting + a heavy haptic
 * play here now (this is the real "match found" moment; the room mount that
 * used to carry them is silent).
 *
 * Four faces, one component, driven by `client.pendingMatch`:
 *   unanswered  → MATCH FOUND · ring counting down · ACCEPT / DECLINE
 *   accepted    → the ring keeps counting · WAITING FOR THE OTHERS · N OF M
 *   fell through, innocent → AN OPPONENT DIDN'T ANSWER — back in line (the
 *                 header pill picks the count up again underneath)
 *   fell through, dodged   → YOU MISSED THE MATCH — queue locked
 * The two farewells hold ~2.5s, then `onDismissed(dodged)` — App clears the
 * summons and, for a dodge, lands on RankedScreen where the lockout shows.
 *
 * Vocabulary borrowed from the arming countdown veil (RoomScreen): the same
 * dark ground, the same ring, the same red under three seconds.
 */
import { useEffect, useReducer, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { playSound, unlockAudio } from "../audio";
import { playStrikeHaptic } from "../game/haptics";
import type { ArenaClient } from "../net/connection";
import { DISPLAY_FONT } from "../typography";

/** How long a farewell face holds before the sheet dismisses itself. */
const FAREWELL_MS = 2500;
/** The last N seconds tick audibly while the answer is still owed. */
const TICK_UNDER_SEC = 5;

const C_GOLD = "#e8c87a";
const C_BONE = "#f5ede0";
const C_MUTED = "#8a7f70";
const C_RED = "#d94141";

export interface MatchAcceptSheetProps {
  client: ArenaClient;
  onDismissed: (dodged: boolean) => void;
}

export const MatchAcceptSheet = ({ client, onDismissed }: MatchAcceptSheetProps) => {
  const insets = useSafeAreaInsets();
  const pending = client.pendingMatch;
  const [, tick] = useReducer((x: number) => x + 1, 0);

  // The summons: sting + haptic once, on the rise.
  useEffect(() => {
    unlockAudio();
    playSound("queueMatchFound");
    playStrikeHaptic("heavy");
  }, []);

  // A 100ms clock for the ring — smooth arc, and the second boundary is
  // never skipped for the tick sound below.
  const settled = pending?.outcome !== null;
  useEffect(() => {
    if (settled) return;
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [settled]);

  // The farewell holds, then hands back to App.
  const outcome = pending?.outcome ?? null;
  const dodged = outcome?.dodged ?? false;
  useEffect(() => {
    if (outcome === null) return;
    const timer = setTimeout(() => onDismissed(dodged), FAREWELL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per outcome
  }, [outcome]);

  const left =
    pending === null ? 0 : Math.max(0, pending.acceptSec - (performance.now() - pending.readyAtMs) / 1000);
  const n = Math.ceil(left);

  // Audible last seconds while OUR answer is still owed — after accepting,
  // the others' clock is theirs to sweat.
  const lastTicked = useRef(-1);
  useEffect(() => {
    if (pending === null || pending.mine !== "pending" || pending.outcome !== null) return;
    if (n <= TICK_UNDER_SEC && n > 0 && n !== lastTicked.current) {
      lastTicked.current = n;
      playSound("countdownTick");
    }
  });

  if (pending === null) return null;

  const frac = Math.max(0, Math.min(1, left / pending.acceptSec));
  const urgent = n <= 3;
  const color = urgent ? C_RED : C_GOLD;
  const track = Skia.Path.Circle(70, 70, 62);
  const arc = Skia.PathBuilder.Make()
    .addArc({ x: 8, y: 8, width: 124, height: 124 }, -90, 360 * frac)
    .detach();

  const accept = (): void => {
    unlockAudio();
    playSound("uiConfirm");
    client.acceptMatch();
  };
  const decline = (): void => {
    unlockAudio();
    playSound("uiBack");
    client.declineMatch();
  };

  const bracket = pending.bracket.toUpperCase();

  return (
    <View style={[styles.veil, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {outcome !== null ? (
        // ── the farewell ──
        <>
          <Text style={[styles.eyebrow, dodged && styles.eyebrowRed]}>
            {dodged ? "YOU MISSED THE MATCH" : "AN OPPONENT DIDN'T ANSWER"}
          </Text>
          <Text style={styles.title}>{dodged ? "SUMMONS IGNORED" : "BACK IN LINE"}</Text>
          <Text style={styles.sub}>
            {dodged
              ? `the queue is locked for ${outcome.lockoutSec ?? 30} seconds`
              : "your place and your wait are kept — the search goes on"}
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.eyebrow}>{`MATCH FOUND · ${bracket}`}</Text>
          <View style={styles.ring}>
            <Canvas style={styles.canvas}>
              <Path path={track} style="stroke" strokeWidth={5} color="#221e19" />
              <Path path={arc} style="stroke" strokeWidth={5} color={color} strokeCap="round" />
            </Canvas>
            <View style={styles.numWrap}>
              <Text style={[styles.num, urgent && { color: C_RED }]}>{n}</Text>
            </View>
          </View>
          {pending.mine === "accepted" ? (
            <>
              <Text style={styles.title}>WAITING FOR THE OTHERS</Text>
              <Text style={styles.sub}>{`${pending.accepted} of ${pending.players} accepted`}</Text>
            </>
          ) : (
            <>
              <Text style={styles.title}>THE SAND CALLS</Text>
              <Text style={styles.sub}>answer the summons or lose your place</Text>
              <View style={styles.buttons}>
                <Pressable onPress={accept} style={styles.accept}>
                  <Text style={styles.acceptText}>ACCEPT</Text>
                </Pressable>
                <Pressable onPress={decline} hitSlop={8} style={styles.decline}>
                  <Text style={styles.declineText}>DECLINE</Text>
                </Pressable>
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  veil: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(8,6,5,0.94)",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    paddingHorizontal: 32,
  },
  eyebrow: { color: C_GOLD, fontSize: 11, fontWeight: "900", letterSpacing: 4, marginRight: -4, textAlign: "center" },
  eyebrowRed: { color: C_RED },
  ring: { width: 140, height: 140 },
  canvas: { width: 140, height: 140 },
  /** Flex-centred wrapper, not a lineHeight hack: iOS ignores
   * textAlignVertical and sat the digit low in the 140pt line box. */
  numWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  num: {
    textAlign: "center",
    includeFontPadding: false,
    color: C_BONE,
    fontSize: 52,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  title: { fontFamily: DISPLAY_FONT, color: C_BONE, fontSize: 22, letterSpacing: 4, textAlign: "center" },
  sub: { color: C_MUTED, fontSize: 12, fontStyle: "italic", textAlign: "center", marginTop: -8 },
  buttons: { alignItems: "center", gap: 16, marginTop: 10 },
  // The brand red, spent on the one button that matters.
  accept: {
    backgroundColor: "#8c2f2f",
    borderRadius: 10,
    paddingVertical: 16,
    paddingHorizontal: 56,
  },
  acceptText: { color: C_BONE, fontWeight: "900", letterSpacing: 3, fontSize: 16 },
  decline: { paddingVertical: 8, paddingHorizontal: 16 },
  declineText: { color: C_MUTED, fontWeight: "800", letterSpacing: 2, fontSize: 12 },
});
