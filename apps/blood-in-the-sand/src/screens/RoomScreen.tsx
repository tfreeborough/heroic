/**
 * The Arming (docs/design/pvp-loadout-flow.md, mock-approved 2026-07-15): a
 * guided wizard — weapon → one screen per ability, one decision each — then
 * the lobby, where the server's own 5s countdown starts the match once every
 * seat is armed. Nobody presses START; the host's only control is the
 * force-start backstop for AFK stragglers.
 *
 * Layout per approved mock: roster ticker (who's armed — never WHAT they
 * picked) · socket strip (◆①②③, tap to revisit) · snap carousel with codex
 * content (ability steps open on a category gate) · CHOOSE → stamp + the icon
 * flies into its socket → auto-advance → lobby (the full-screen "YOU ARE
 * ARMED" splash was cut 2026-07-17 — pure ceremony by the tenth arming).
 * Returning players get SAME ARMS (last loadout, one tap; CHOOSE ANEW clears).
 *
 * The wizard owns its picks LOCALLY and sends the full state on every choose
 * (idempotent messages) — roomState round-trips never race a fast picker.
 * Works identically for ArenaClient and PracticeClient via LobbyClient.
 */
import { Fragment, useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import {
  ABILITIES,
  FORCE_START_GRACE_SECONDS,
  LOADOUT_ABILITY_COUNT,
  LOBBY_COUNTDOWN_SECONDS,
  WEAPONS,
  type AbilityCategory,
  type AbilityId,
  type RoomStatePlayer,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";
import type { LobbyClient } from "../net/connection";
import { playStrikeHaptic } from "../game/haptics";
import { playSound, unlockAudio, warmCombatAudio } from "../audio";
import { LoadoutIcon, type IconId } from "../loadout/icons";
import {
  ABILITY_CODEX,
  abilitiesByCategory,
  categoryOf,
  CATEGORY_META,
  C_BONE,
  C_GOLD,
  C_MUTED,
  sortedWeaponIds,
  WEAPON_CODEX,
  weaponBars,
} from "../loadout/catalogue";
import { loadLastLoadout, saveLastLoadout, type SavedLoadout } from "../settings";

export interface RoomScreenProps {
  /** ArenaClient for real rooms; PracticeClient drives the same flow offline. */
  client: LobbyClient;
  onLeave: () => void;
}

// The wizard walks one slot per screen: slot 0 = the weapon, then one per
// ability. Everything below derives from LOADOUT_ABILITY_COUNT so the flow
// tracks the loadout size (two abilities as of 2026-07-16).
const SLOT_COUNT = LOADOUT_ABILITY_COUNT + 1; // weapon + abilities
const SLOT_INDICES = Array.from({ length: SLOT_COUNT }, (_, i) => i);
const ABILITY_INDICES = Array.from({ length: LOADOUT_ABILITY_COUNT }, (_, i) => i);
const ROMAN = ["I", "II", "III", "IV", "V"];
const OF_TOTAL = ROMAN[SLOT_COUNT - 1]!; // "III" at two abilities (weapon + 2)
const SOCKET_LABELS = ["◆", "①", "②", "③", "④"];
// Button names run top→bottom down the in-game column, teaching the layout.
const BUTTON_POSITIONS =
  LOADOUT_ABILITY_COUNT <= 1
    ? ["ONLY"]
    : ["TOP", ...Array.from({ length: LOADOUT_ABILITY_COUNT - 2 }, () => "MIDDLE"), "BOTTOM"];
const STEP_TITLES = ["CHOOSE YOUR WEAPON", ...BUTTON_POSITIONS.map((p) => `YOUR ${p} BUTTON`)];
const CATEGORY_DESC: Record<AbilityCategory, string> = {
  offensive: "pressure, damage, and drags",
  defensive: "escapes, armour, misdirection",
  support: "auras and zones for your team",
};
const CARD_W = 250;
const CARD_GAP = 14;
/** Below this window height (iPhone SE = 667pt) the lobby renders COMPACT:
 * tighter rows/headers, a smaller socket strip, and multiple open seats
 * collapsed into one row — a full 4v4 roster otherwise overflows. */
const COMPACT_LOBBY_HEIGHT = 700;
const FLY_MS = 460;
const LAND_BEAT_MS = 320;
/** How long a host-handoff toast stays up before it fades out. */
const NOTICE_MS = 5000;

// Allegiance colours (bits-bot-backfill.md § team identity): your side is
// always FRIEND blue, the enemy always FOE red — never absolute team numbers.
const C_FRIEND = "#4da3d9";
const C_FOE = "#d94141";

/** The wizard's local draft: weapon + partial hand, filled in step order. */
interface Picks {
  weapon: WeaponId | null;
  hand: AbilityId[];
}

interface WizardState {
  step: number; // 0 = weapon, 1..LOADOUT_ABILITY_COUNT = abilities
  cat: AbilityCategory | null; // ability steps: null = the category gate
  /** true = a single-slot edit from the lobby (returns straight there). */
  edit: boolean;
}

interface FlyState {
  icon: IconId;
  from: { x: number; y: number; size: number };
  to: { x: number; y: number; size: number };
}

const slotComplete = (picks: Picks, i: number): boolean =>
  i === 0 ? picks.weapon !== null : picks.hand[i - 1] !== undefined;

const allComplete = (picks: Picks): boolean =>
  picks.weapon !== null && picks.hand.length === LOADOUT_ABILITY_COUNT;

export const RoomScreen = ({ client, onLeave }: RoomScreenProps) => {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const welcome = client.welcome;

  // The countdown + roster live in snapshots, which don't re-render this
  // screen on their own — tick it while mounted (the lobby is short-lived).
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(force, 250);
    return () => clearInterval(id);
  }, []);

  // The lobby is the calm before the fight — pre-load every mid-combat clip
  // now so no ability cast or first clash pays a native audio load mid-frame.
  useEffect(() => {
    warmCombatAudio();
  }, []);

  // ── Wizard state (local picks are the source of truth while arming) ──────
  // Seed from the client so a remount mid-lobby (already armed) lands in the
  // lobby view, not a fresh wizard.
  const [picks, setPicks] = useState<Picks>(() => ({
    weapon: client.myWeapon,
    hand: [...client.myAbilities],
  }));
  const [wizard, setWizard] = useState<WizardState | null>(() =>
    client.myWeapon !== null && client.myAbilities.length === LOADOUT_ABILITY_COUNT
      ? null
      : { step: 0, cat: null, edit: false },
  );
  const [rib, setRib] = useState<SavedLoadout | null>(null);
  // Bumped each time the player BECOMES armed — the lobby's arsenal box glints
  // once per bump: the slim successor to the deleted full-screen armed splash.
  const [armedStamp, setArmedStamp] = useState(0);
  // Leaving always confirms (Tom 2026-07-17): a mistap doesn't just exit YOU —
  // removePlayer cancels the whole room's arming countdown and frees the seat.
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [fly, setFly] = useState<FlyState | null>(null);
  const flyT = useRef(new Animated.Value(0)).current;
  const [landedSlot, setLandedSlot] = useState<number | null>(null);
  const socketRefs = useRef<(View | null)[]>(SLOT_INDICES.map(() => null));
  const focusedIconRef = useRef<View | null>(null);

  // The card picker is a full-screen TAKEOVER above the ticker/sockets (Tom
  // 2026-07-17 — in-flow cards squished small screens). On CHOOSE it fades
  // out so the flying icon lands on a VISIBLE socket; a fresh carousel
  // (step/category change) resets the fade.
  const pickerOpen = wizard !== null && (wizard.step === 0 || wizard.cat !== null);
  const pickerFade = useRef(new Animated.Value(1)).current;
  const [pickerFading, setPickerFading] = useState(false);
  useEffect(() => {
    if (pickerOpen) {
      pickerFade.setValue(1);
      setPickerFading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the picker identity
  }, [wizard?.step, wizard?.cat]);

  // The SAME ARMS offer — once, on entering an unarmed lobby.
  const startedUnarmed = useRef(wizard !== null);
  useEffect(() => {
    if (!startedUnarmed.current) return;
    let live = true;
    void loadLastLoadout().then((saved) => {
      if (live && saved) setRib(saved);
    });
    return () => {
      live = false;
    };
  }, []);

  // Host force-start grace clock — refs must sit above the welcome guard.
  const graceSince = useRef<{ key: string; atMs: number }>({ key: "", atMs: 0 });
  // The overlay coordinate space: fly endpoints are measured relative to this
  // (collapsable={false} keeps it a real native node on Android).
  const rootRef = useRef<View | null>(null);

  // ── The arming countdown, from the snapshot stream ───────────────────────
  const view = client.buffer.sample(performance.now());
  const timer = client.phase === "lobby" ? (view?.round.timer ?? 0) : 0;
  // Host-handoff toast: shown for a few seconds after it lands. The 250ms
  // roster tick already re-renders us, so it fades itself without extra state.
  const notice =
    client.notice !== null && performance.now() - client.notice.atMs < NOTICE_MS
      ? client.notice.text
      : null;
  const timerCeil = Math.ceil(timer);
  // While the countdown runs, the 250ms roster tick is too coarse — digits
  // land up to a quarter-second late and the tick sound drifts off the true
  // second boundaries (why the lobby count felt slower than the in-game 3·2·1,
  // which samples per frame). Re-render at snapshot rate for the short count.
  const counting = timer > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(force, 1000 / 30);
    return () => clearInterval(id);
  }, [counting]);
  const lastTick = useRef(0);
  useEffect(() => {
    if (timer > 0 && timerCeil !== lastTick.current) {
      lastTick.current = timerCeil;
      playSound("countdownTick");
    }
    if (timer <= 0) lastTick.current = 0;
  }, [timer, timerCeil]);

  // A bot-filled countdown that collapses while we're STILL in the lobby was
  // vetoed (cancelStart, or a joiner over the bots) — a normal completion
  // leaves the lobby phase and never trips this. The notice says who; the
  // sting says something happened even if you weren't reading.
  const hasBots = client.roomState?.players.some((p) => p.bot) ?? false;
  const wasCancellable = useRef(false);
  useEffect(() => {
    const cancellable = timer > 0 && hasBots;
    if (wasCancellable.current && !cancellable && client.phase === "lobby") playSound("startCancelled");
    wasCancellable.current = cancellable;
  });

  const commit = useCallback(
    (next: Picks): void => {
      setPicks(next);
      if (next.weapon !== null) client.setWeapon(next.weapon);
      client.setAbilities(next.hand);
    },
    [client],
  );

  const armedNow = useCallback(
    (final: Picks): void => {
      saveLastLoadout({ weapon: final.weapon!, abilities: final.hand });
      playStrikeHaptic("heavy");
      playSound("uiConfirm"); // TODO a real "you are armed" fanfare via Asset Forge
      setWizard(null);
      setArmedStamp((s) => s + 1);
    },
    [],
  );

  // ── Choose: stamp → fly to socket → advance ──────────────────────────────
  const advance = useCallback(
    (w: WizardState, after: Picks): void => {
      if (w.edit) {
        setWizard(null); // single-slot edit: straight back to the lobby
        return;
      }
      // The walk always fills in order (run-it-back CHANGE starts from
      // scratch, so there is no prefilled walk): next empty slot, or armed.
      const nextEmpty = SLOT_INDICES.find((i) => !slotComplete(after, i));
      if (nextEmpty !== undefined) {
        setWizard({ step: nextEmpty, cat: null, edit: false });
      } else {
        armedNow(after);
      }
    },
    [armedNow],
  );

  const catOfSlot = (p: Picks, step: number): AbilityCategory | null => {
    const id = step > 0 ? p.hand[step - 1] : undefined;
    return id ? categoryOf(id) : null;
  };

  // Choosing an ability plays its actual cast sound (harpoon brings its chain
  // whip along, as in-game) — the pick doubles as an ear-training moment, so
  // the tell is already familiar the first time an enemy fires it for real.
  const playChooseSound = (w: WizardState, id: IconId): void => {
    if (w.step === 0) {
      playSound("uiConfirm");
      return;
    }
    playSound("abilityCast", id);
    if (id === "harpoon") playSound("harpoonWhip");
  };

  const choose = (w: WizardState, id: IconId): void => {
    unlockAudio();
    const after: Picks =
      w.step === 0
        ? { ...picks, weapon: id as WeaponId }
        : { ...picks, hand: replaceSlot(picks.hand, w.step - 1, id as AbilityId) };
    const kept = w.step === 0 ? picks.weapon === id : picks.hand[w.step - 1] === id;
    commit(after);
    if (kept) {
      if (w.step === 0) playSound("uiTap");
      else playChooseSound(w, id);
      advance(w, after);
      return;
    }
    playStrikeHaptic("heavy");
    playChooseSound(w, id);
    // The picker takeover fades out NOW so the flying icon lands on a visible
    // socket (the overlay covers the strip while browsing).
    setPickerFading(true);
    Animated.timing(pickerFade, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    // The moment: the chosen icon flies from the card into its socket. All
    // THREE rects (root, icon, socket) are measured the same way — on-screen
    // window coords — and the root's origin is subtracted, so the fly's
    // coordinates live in the overlay's own space no matter what padding,
    // status bars, or the carousel's scroll offset are doing. (measureLayout
    // reads the layout tree, which ignores scroll — icons launched from
    // off-screen; measureInWindow alone drifted by the root's old padding.)
    const iconEl = focusedIconRef.current;
    const sockEl = socketRefs.current[w.step];
    const rootEl = rootRef.current;
    if (iconEl && sockEl && rootEl) {
      rootEl.measureInWindow((rx, ry) => {
        iconEl.measureInWindow((ix, iy, iw) => {
          sockEl.measureInWindow((sx, sy, sw) => {
            setFly({
              icon: id,
              from: { x: ix - rx, y: iy - ry, size: iw },
              to: { x: sx - rx + sw * 0.13, y: sy - ry + sw * 0.13, size: sw * 0.74 },
            });
            flyT.setValue(0);
            Animated.timing(flyT, {
              toValue: 1,
              duration: FLY_MS,
              easing: Easing.bezier(0.5, 0, 0.2, 1),
              useNativeDriver: true,
            }).start(() => {
              setFly(null);
              setLandedSlot(w.step);
              playStrikeHaptic("light");
              setTimeout(() => setLandedSlot(null), 500);
              setTimeout(() => advance(w, after), LAND_BEAT_MS);
            });
          });
        });
      });
    } else {
      setTimeout(() => advance(w, after), LAND_BEAT_MS);
    }
  };

  const replaceSlot = (hand: AbilityId[], i: number, id: AbilityId): AbilityId[] => {
    const next = [...hand];
    next[i] = id;
    return next;
  };

  const jumpToSlot = (i: number, edit: boolean): void => {
    playSound("uiTap");
    setWizard({ step: i, cat: catOfSlot(picks, i), edit });
  };

  const askLeave = useCallback((): void => {
    playSound("uiTap");
    setConfirmLeave(true);
  }, []);

  // Consume-once: the glint fires on the FIRST lobby render after an arming
  // and never on later remounts (closing a socket edit re-mounts LobbyView —
  // replaying the shine there would read as a glitch, not a moment).
  const glintShown = useRef(0);
  const glintKey = wizard === null && armedStamp !== glintShown.current ? armedStamp : 0;
  useEffect(() => {
    if (glintKey !== 0) glintShown.current = glintKey;
  });

  // The wizard's ✕ closes the WIZARD, never the room (Tom 2026-07-17): mid-
  // arming, "✕" means "put the cards down", and the lobby behind it has its
  // own leave. Picks already committed stay committed — resume via a socket.
  const closeWizard = useCallback((): void => {
    playSound("uiBack");
    setWizard(null);
  }, []);

  // ── Run it back ───────────────────────────────────────────────────────────
  const ribYes = (saved: SavedLoadout): void => {
    unlockAudio();
    const final: Picks = { weapon: saved.weapon, hand: [...saved.abilities] };
    commit(final);
    setRib(null);
    armedNow(final);
  };
  // CHANGE starts from scratch (Tom 2026-07-16): committing the old loadout
  // here would ARM you server-side — with everyone else ready, the countdown
  // would start while you're still browsing, giving you ~5s to "change".
  // Staying unarmed holds the match until the wizard is walked again.
  const ribChange = (): void => {
    unlockAudio();
    playSound("uiTap");
    setPicks({ weapon: null, hand: [] });
    setRib(null);
    setWizard({ step: 0, cat: null, edit: false });
  };

  if (!welcome) return null;

  const players = client.roomState?.players ?? [];
  const myTeam = welcome.team;
  const capacity = welcome.teamSize * 2;
  const me = players.find((p) => p.id === welcome.playerId);
  const meArmed = me?.armed ?? allComplete(picks);

  // Host force-start (bits-bot-backfill.md). With EMPTY seats it shows the
  // moment the host is armed — bots fill the gaps, so even a lone host can
  // launch. In a FULL room it stays the AFK backstop: only after the grace,
  // so a straggler gets a fair window to arm. Client-side gate only — the
  // sim re-checks everything.
  const unarmed = players.filter((p) => !p.armed);
  const emptySeats = capacity - players.length;
  const forceCond =
    client.isHost &&
    meArmed &&
    players.every((p) => p.connected) &&
    (emptySeats > 0 || unarmed.length > 0);
  // Keyed on the roster AND who's unarmed: any join/leave or arming restarts
  // the grace clock (the sim clears `forced` on membership changes too).
  const graceKey = forceCond ? `${players.length}:${unarmed.map((p) => p.id).join(",")}` : "";
  if (graceSince.current.key !== graceKey) graceSince.current = { key: graceKey, atMs: performance.now() };
  const showForceStart =
    forceCond &&
    (emptySeats > 0 || performance.now() - graceSince.current.atMs > FORCE_START_GRACE_SECONDS * 1000);

  return (
    // The root carries NO padding: overlays (veil/rib/fly) are its absolute
    // children, and Yoga offsets absolute children by parent padding (unlike
    // CSS) — padded, overlays sat off-centre and the fly missed.
    <View ref={rootRef} collapsable={false} style={styles.root}>
      <View style={[styles.content, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 8 }]}>
        {/* The room-leave ✕ rides the roster row, clear of everything below.
            Wizard mode hides it — there the stepHead ✕ (close wizard) is the
            only ✕ on screen, so the two never sit stacked. */}
        <View style={styles.tickerRow}>
          <View style={styles.tickerFill}>
            <RosterTicker players={players} myId={welcome.playerId} myTeam={myTeam} capacity={capacity} />
          </View>
          {wizard === null ? <LeaveX onPress={askLeave} /> : null}
        </View>

      {wizard !== null ? (
        <>
          <SocketStrip
            picks={picks}
            current={wizard.step}
            landed={landedSlot}
            refs={socketRefs}
            onTap={(i) => {
              if (slotComplete(picks, i) || i === wizard.step) jumpToSlot(i, wizard.edit);
            }}
          />
          {timer > 0 ? (
            <Text style={styles.wizardCountdown}>{`MATCH STARTS IN ${timerCeil} — picks stay live`}</Text>
          ) : null}
          {!pickerOpen ? (
            // The category gates render in-flow, under the socket strip; the
            // card carousel itself is the full-screen takeover further down.
            <WizardStep
              key={`${wizard.step}:${wizard.cat ?? "-"}`}
              wizard={wizard}
              picks={picks}
              screenW={screenW}
              focusedIconRef={focusedIconRef}
              onGate={(cat) => {
                unlockAudio();
                playSound("uiTap");
                playStrikeHaptic("soft");
                setWizard({ ...wizard, cat });
              }}
              onBackToGates={() => {
                playSound("uiBack");
                setWizard({ ...wizard, cat: null });
              }}
              onChoose={(id) => choose(wizard, id)}
              onClose={closeWizard}
            />
          ) : null}
        </>
      ) : (
        <LobbyView
          client={client}
          players={players}
          myId={welcome.playerId}
          myTeam={myTeam}
          capacity={capacity}
          picks={picks}
          roomName={welcome.roomName}
          roomCode={welcome.roomCode}
          socketRefs={socketRefs}
          showForceStart={showForceStart}
          unarmedCount={unarmed.length}
          // Armed: a socket tap is a one-slot edit (straight back to the
          // lobby). Holes left (the wizard's ✕ can dismiss mid-walk): resume
          // the walk — advance keeps going until the arming completes.
          onEditSlot={(i) => jumpToSlot(i, allComplete(picks))}
          lastWinner={view?.round.lastWinner ?? 0}
          wins={view?.round.wins ?? [0, 0]}
          glintKey={glintKey}
        />
      )}
      </View>

      {/* The card picker: a full-screen takeover above the ticker/sockets so
          the cards get the whole viewport (in-flow they squished small
          screens). Fades out on CHOOSE while the icon flies to its socket;
          rib/fly render later, so they stay above it. */}
      {wizard !== null && pickerOpen ? (
        <Animated.View
          pointerEvents={pickerFading ? "none" : "auto"}
          style={[
            styles.pickerOverlay,
            { opacity: pickerFade, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 8 },
          ]}
        >
          {timer > 0 ? (
            <Text style={styles.wizardCountdown}>{`MATCH STARTS IN ${timerCeil} — picks stay live`}</Text>
          ) : null}
          <WizardStep
            key={`${wizard.step}:${wizard.cat ?? "-"}`}
            wizard={wizard}
            picks={picks}
            screenW={screenW}
            focusedIconRef={focusedIconRef}
            onGate={() => {}}
            onBackToGates={() => {
              playSound("uiBack");
              setWizard({ ...wizard, cat: null });
            }}
            onChoose={(id) => choose(wizard, id)}
            onClose={closeWizard}
          />
        </Animated.View>
      ) : null}

      {timer > 0 && wizard === null ? (
        <CountdownVeil
          left={timer}
          onLeave={askLeave}
          // The veto (any seated player, bot-filled starts only): the server
          // dismisses the bots and stops the count; the room hears who did it.
          onCancel={
            hasBots && client.cancelStart
              ? () => {
                  playSound("uiBack");
                  client.cancelStart?.();
                }
              : null
          }
        />
      ) : null}

      {rib !== null && wizard !== null ? (
        <RunItBack saved={rib} onYes={() => ribYes(rib)} onChange={ribChange} onLeave={askLeave} />
      ) : null}

      {confirmLeave ? (
        <ConfirmLeave
          onStay={() => {
            playSound("uiBack");
            setConfirmLeave(false);
          }}
          onLeave={() => {
            playSound("uiBack");
            onLeave();
          }}
        />
      ) : null}

      {fly !== null ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: fly.from.x,
            top: fly.from.y,
            transform: [
              {
                translateX: flyT.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, fly.to.x + fly.to.size / 2 - (fly.from.x + fly.from.size / 2)],
                }),
              },
              {
                translateY: flyT.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, fly.to.y + fly.to.size / 2 - (fly.from.y + fly.from.size / 2)],
                }),
              },
              { scale: flyT.interpolate({ inputRange: [0, 1], outputRange: [1, fly.to.size / fly.from.size] }) },
            ],
          }}
        >
          <LoadoutIcon id={fly.icon} size={fly.from.size} />
        </Animated.View>
      ) : null}

      {notice !== null ? (
        <View pointerEvents="none" style={[styles.notice, { top: insets.top + 8 }]}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}
    </View>
  );
};

// ── Roster ticker ────────────────────────────────────────────────────────────

const RosterTicker = ({
  players,
  myId,
  myTeam,
  capacity,
}: {
  players: RoomStatePlayer[];
  myId: number;
  myTeam: number;
  capacity: number;
}) => {
  const ordered = [...players].sort((a, b) => (a.team === myTeam ? 0 : 1) - (b.team === myTeam ? 0 : 1));
  return (
    <View style={styles.ticker}>
      {ordered.map((p) => (
        <View
          key={p.id}
          style={[
            styles.tickerChip,
            p.id === myId && styles.tickerMe,
            p.team !== myTeam && styles.tickerEnemy,
            p.armed && styles.tickerArmed,
          ]}
        >
          <View style={[styles.tickerDot, p.armed && styles.tickerDotArmed]} />
          <Text style={[styles.tickerName, (p.armed || p.id === myId) && styles.tickerNameLit]}>
            {p.name.toUpperCase()}
            {p.connected ? "" : " ⌁"}
          </Text>
        </View>
      ))}
      {players.length < capacity ? (
        <View style={[styles.tickerChip, styles.tickerEnemy]}>
          <Text style={styles.tickerName}>{`${players.length}/${capacity}…`}</Text>
        </View>
      ) : null}
    </View>
  );
};

// ── Socket strip ─────────────────────────────────────────────────────────────

interface SocketStripProps {
  picks: Picks;
  current: number | null;
  landed: number | null;
  refs: React.MutableRefObject<(View | null)[]>;
  onTap: (i: number) => void;
  /** Socket edge in pt — the lobby passes a smaller one on short screens. */
  size?: number;
  /** The lobby's armed "YOUR ARSENAL" reading: the rib-row treatment (padded
   * bordered box, weapon walled off from the abilities by a divider). The
   * wizard strip stays bare — mid-arming the sockets ARE the progress bar. */
  separated?: boolean;
  /** Non-zero (and changing) = play the one-shot glint: a gold border flash +
   * light sweep. The slim successor to the deleted armed splash. */
  glintKey?: number;
}

const SocketStrip = ({ picks, current, landed, refs, onTap, size = 72, separated = false, glintKey = 0 }: SocketStripProps) => {
  // Two drivers: the sweep band rides the native driver; borderColor can't, so
  // it gets its own JS-driven value. Both idle at 0 = invisible/normal border.
  const glintT = useRef(new Animated.Value(0)).current;
  const borderT = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!glintKey) return;
    glintT.setValue(0);
    borderT.setValue(1);
    Animated.parallel([
      Animated.timing(glintT, {
        toValue: 1,
        duration: 800,
        delay: 120,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(borderT, { toValue: 0, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: false }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot per arming stamp
  }, [glintKey]);

  return (
  <Animated.View
    style={[
      styles.sockets,
      separated && styles.socketsArsenal,
      separated && {
        borderColor: borderT.interpolate({ inputRange: [0, 1], outputRange: ["#3a332a", C_GOLD] }),
      },
    ]}
  >
    {SLOT_INDICES.map((i) => {
      const id: IconId | null = i === 0 ? picks.weapon : (picks.hand[i - 1] ?? null);
      return (
        <Fragment key={i}>
          {separated && i === 1 ? <View style={styles.socketSep} /> : null}
          <Pressable onPress={() => onTap(i)}>
            <View
              ref={(el) => {
                refs.current[i] = el;
              }}
              style={[
                styles.socket,
                { width: size, height: size },
                id !== null && styles.socketFull,
                i === current && id === null && styles.socketNow,
                i === landed && styles.socketLanded,
              ]}
            >
              <Text style={[styles.socketN, id !== null && styles.socketNFull]}>{SOCKET_LABELS[i]}</Text>
              {id !== null ? <LoadoutIcon id={id} size={Math.round(size * (40 / 72))} /> : null}
            </View>
          </Pressable>
        </Fragment>
      );
    })}
    {separated ? (
      // The glint: a soft bone-light band sweeping the box once. Clipped to
      // the rounded rect; overshoots the widest (non-compact) box so the exit
      // is always off-edge. Invisible whenever glintT rests at 0 or 1.
      <View pointerEvents="none" style={styles.glintClip}>
        <Animated.View
          style={[
            styles.glintBand,
            {
              opacity: glintT.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.3, 0.3, 0] }),
              transform: [
                { translateX: glintT.interpolate({ inputRange: [0, 1], outputRange: [-90, 360] }) },
                { rotate: "18deg" },
              ],
            },
          ]}
        />
      </View>
    ) : null}
  </Animated.View>
  );
};

// ── Wizard step (gates or carousel) ─────────────────────────────────────────

interface WizardStepProps {
  wizard: WizardState;
  picks: Picks;
  screenW: number;
  focusedIconRef: React.MutableRefObject<View | null>;
  onGate: (cat: AbilityCategory) => void;
  onBackToGates: () => void;
  onChoose: (id: IconId) => void;
  /** The step ✕: dismisses the wizard back to the lobby — leaving the ROOM
   * lives on the lobby/rib/veil ✕, behind the confirm. */
  onClose: () => void;
}

const WizardStep = (props: WizardStepProps) => {
  const { wizard, picks, screenW, focusedIconRef, onGate, onBackToGates, onChoose, onClose } = props;
  const gates = wizard.step > 0 && wizard.cat === null;

  // Slide the pane in on step/category changes (the component is keyed on both).
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [slide]);

  /** Abilities still free for this step within a category. */
  const freeIn = (cat: AbilityCategory): AbilityId[] =>
    abilitiesByCategory(cat).filter((a) => !picks.hand.includes(a) || a === picks.hand[wizard.step - 1]);

  const options: IconId[] = wizard.step === 0 ? sortedWeaponIds() : wizard.cat !== null ? freeIn(wizard.cat) : [];

  return (
    <Animated.View
      style={[
        styles.pane,
        {
          opacity: slide,
          transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }],
        },
      ]}
    >
      <View style={styles.stepHead}>
        <View style={styles.stepHeadText}>
          <Text style={styles.stepEyebrow}>
            {`STEP ${ROMAN[wizard.step]} OF ${OF_TOTAL}${wizard.step > 0 ? ` · ABILITY ${wizard.step}` : ""}`}
          </Text>
          <Text style={styles.stepTitle}>{STEP_TITLES[wizard.step]}</Text>
        </View>
        {wizard.step > 0 ? <ButtonColumnHint slot={wizard.step - 1} picks={picks} /> : null}
        <LeaveX onPress={onClose} />
      </View>

      {gates ? (
        <View style={styles.gates}>
          {(["offensive", "defensive", "support"] as AbilityCategory[]).map((cat) => {
            const free = freeIn(cat);
            const meta = CATEGORY_META[cat];
            return (
              <Pressable
                key={cat}
                onPress={() => free.length > 0 && onGate(cat)}
                style={[styles.gate, free.length === 0 && styles.gateEmpty]}
              >
                <View style={styles.gateText}>
                  <Text style={[styles.gateLabel, { color: meta.color }]}>{meta.label}</Text>
                  <Text style={styles.gateDesc}>{CATEGORY_DESC[cat]}</Text>
                </View>
                <View style={styles.gateIcons}>
                  {free.slice(0, 4).map((a) => (
                    <LoadoutIcon key={a} id={a} size={28} />
                  ))}
                </View>
                <Text style={styles.gateChev}>›</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <PickCarousel
          key={options.join(",")}
          options={options}
          isWeapon={wizard.step === 0}
          initial={wizard.step === 0 ? picks.weapon : (picks.hand[wizard.step - 1] ?? null)}
          screenW={screenW}
          category={wizard.cat}
          focusedIconRef={focusedIconRef}
          onBackToGates={wizard.step > 0 ? onBackToGates : null}
          onChoose={onChoose}
        />
      )}
    </Animated.View>
  );
};

/** The in-game button column, with the slot being filled glowing — the wizard
 * teaches the controls: pick order IS button order. */
const ButtonColumnHint = ({ slot, picks }: { slot: number; picks: Picks }) => (
  <View style={styles.btnCol}>
    {ABILITY_INDICES.map((i) => (
      <View
        key={i}
        style={[styles.btnColSlot, i === slot && styles.btnColLit, i !== slot && picks.hand[i] !== undefined && styles.btnColDone]}
      />
    ))}
  </View>
);

// ── Carousel ────────────────────────────────────────────────────────────────

interface PickCarouselProps {
  options: IconId[];
  isWeapon: boolean;
  initial: IconId | null;
  screenW: number;
  category: AbilityCategory | null;
  focusedIconRef: React.MutableRefObject<View | null>;
  onBackToGates: (() => void) | null;
  onChoose: (id: IconId) => void;
}

const PickCarousel = (props: PickCarouselProps) => {
  const { options, isWeapon, initial, screenW, category, focusedIconRef, onBackToGates, onChoose } = props;
  const snap = CARD_W + CARD_GAP;
  const sidePad = (screenW - CARD_W) / 2;
  const initialIdx = Math.max(0, initial !== null ? options.indexOf(initial) : 0);
  const [focusIdx, setFocusIdx] = useState(initialIdx);
  const scrollX = useRef(new Animated.Value(initialIdx * snap)).current;
  const scrollRef = useRef<ScrollView | null>(null);

  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: true,
    listener: (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const i = Math.max(0, Math.min(options.length - 1, Math.round(e.nativeEvent.contentOffset.x / snap)));
      setFocusIdx((prev) => {
        if (prev !== i) {
          playSound("uiTap");
          playStrikeHaptic("soft");
        }
        return i;
      });
    },
  });

  const focused = options[focusIdx]!;
  const keeping = initial !== null && focused === initial;
  const meta = category !== null ? CATEGORY_META[category] : null;

  return (
    <View style={styles.carouselWrap}>
      {onBackToGates !== null && meta !== null ? (
        <Pressable onPress={onBackToGates} style={styles.catBack} hitSlop={8}>
          <Text style={styles.catBackText}>
            {"‹ ALL CATEGORIES · "}
            <Text style={{ color: meta.color }}>{meta.label}</Text>
          </Text>
        </Pressable>
      ) : null}

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={snap}
        decelerationRate="fast"
        contentOffset={{ x: initialIdx * snap, y: 0 }}
        contentContainerStyle={{ paddingHorizontal: sidePad, alignItems: "center", gap: CARD_GAP }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.carousel}
      >
        {options.map((id, i) => {
          const inputRange = [(i - 1) * snap, i * snap, (i + 1) * snap];
          const scale = scrollX.interpolate({ inputRange, outputRange: [0.88, 1, 0.88], extrapolate: "clamp" });
          const opacity = scrollX.interpolate({ inputRange, outputRange: [0.42, 1, 0.42], extrapolate: "clamp" });
          return (
            <Animated.View key={id} style={[styles.card, { transform: [{ scale }], opacity }]}>
              <Pressable
                onPress={() => {
                  if (i !== focusIdx) scrollRef.current?.scrollTo({ x: i * snap, animated: true });
                }}
                style={styles.cardInner}
              >
                <View
                  ref={(el) => {
                    if (i === focusIdx) focusedIconRef.current = el;
                  }}
                  collapsable={false}
                >
                  <LoadoutIcon id={id} size={116} />
                </View>
                {isWeapon ? (
                  <WeaponCardBody id={id as WeaponId} />
                ) : (
                  <AbilityCardBody id={id as AbilityId} />
                )}
              </Pressable>
            </Animated.View>
          );
        })}
      </Animated.ScrollView>

      <View style={styles.dots}>
        {options.map((id, i) => (
          <View key={id} style={[styles.dot, i === focusIdx && styles.dotOn]} />
        ))}
      </View>

      <Pressable onPress={() => onChoose(focused)} style={[styles.cta, keeping && styles.ctaGhost]}>
        <Text style={[styles.ctaText, keeping && styles.ctaGhostText]}>
          {keeping
            ? `KEEP ${nameOf(focused)}`
            : initial !== null
              ? `SWAP TO ${nameOf(focused)}`
              : `CHOOSE ${nameOf(focused)}`}
        </Text>
      </Pressable>
    </View>
  );
};

const nameOf = (id: IconId): string =>
  (id in WEAPONS ? WEAPONS[id as WeaponId].name : ABILITIES[id as AbilityId].name).toUpperCase();

const WeaponCardBody = ({ id }: { id: WeaponId }) => (
  <>
    <Text style={styles.cardName}>{WEAPONS[id].name.toUpperCase()}</Text>
    <Text style={styles.cardQuote}>{`“${WEAPON_CODEX[id].quote}”`}</Text>
    <Text style={styles.cardHint}>{WEAPON_CODEX[id].hint}</Text>
    <View style={styles.bars}>
      {weaponBars(id).map((bar) => (
        <View key={bar.label} style={styles.bar}>
          <Text style={styles.barLabel}>{bar.label}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.round(bar.frac * 100)}%` }]} />
          </View>
          <Text style={styles.barValue}>{bar.display}</Text>
        </View>
      ))}
    </View>
  </>
);

const AbilityCardBody = ({ id }: { id: AbilityId }) => {
  const meta = CATEGORY_META[categoryOf(id)];
  return (
    <>
      <Text style={styles.cardName}>{ABILITIES[id].name.toUpperCase()}</Text>
      <Text style={[styles.cardCat, { color: meta.color, borderColor: meta.color }]}>
        {`${meta.label} · CD ${ABILITIES[id].cooldown}S`}
      </Text>
      <Text style={styles.cardQuote}>{`“${ABILITY_CODEX[id].quote}”`}</Text>
      <Text style={styles.cardHint}>{ABILITY_CODEX[id].hint}</Text>
      <View style={styles.chips}>
        {ABILITY_CODEX[id].chips.slice(0, 3).map((chip) => (
          <View key={chip.label} style={styles.chip}>
            <Text style={styles.chipLabel}>{chip.label}</Text>
            <Text style={styles.chipValue}>{chip.value}</Text>
          </View>
        ))}
      </View>
    </>
  );
};

// ── Leave (✕ + confirm) ─────────────────────────────────────────────────────

/** The exit control: a ✕ tucked in the top-right header, deliberately out of
 * the bottom action zone — the old bottom-centre "LEAVE ROOM" text sat right
 * under CHOOSE/force-start and a mistap cancelled the whole room's countdown.
 * `style` lets full-screen overlays (rib, countdown veil) float their own copy
 * top-right: whatever covers the screen, an exit stays reachable. */
const LeaveX = ({ onPress, style }: { onPress: () => void; style?: StyleProp<ViewStyle> }) => (
  <Pressable onPress={onPress} hitSlop={10} style={[styles.leaveX, style]}>
    <Text style={styles.leaveXGlyph}>✕</Text>
  </Pressable>
);

const ConfirmLeave = ({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) => (
  <View style={styles.rib}>
    <Text style={styles.splashEyebrow}>LEAVE THE ROOM</Text>
    <Text style={styles.ribTitle}>QUIT THE SAND?</Text>
    <Text style={styles.leaveSub}>your seat is given up — any start countdown stops</Text>
    <View style={styles.ribButtons}>
      <Pressable onPress={onStay} style={styles.cta}>
        <Text style={styles.ctaText}>STAY</Text>
      </Pressable>
      <Pressable onPress={onLeave} style={[styles.cta, styles.ctaGhost]}>
        <Text style={[styles.ctaText, styles.leaveConfirmText]}>LEAVE ROOM</Text>
      </Pressable>
    </View>
  </View>
);

// ── Run it back ─────────────────────────────────────────────────────────────

const RunItBack = ({
  saved,
  onYes,
  onChange,
  onLeave,
}: {
  saved: SavedLoadout;
  onYes: () => void;
  onChange: () => void;
  onLeave: () => void;
}) => {
  const insets = useSafeAreaInsets();
  return (
  <View style={styles.rib}>
    <LeaveX onPress={onLeave} style={[styles.leaveXFloat, { top: insets.top + 18 }]} />
    <Text style={styles.splashEyebrow}>WELCOME BACK, GLADIATOR</Text>
    <Text style={styles.ribTitle}>TAKE UP THE SAME ARMS?</Text>
    <View style={styles.ribRow}>
      <LoadoutIcon id={saved.weapon} size={44} />
      <View style={styles.ribSep} />
      {saved.abilities.map((a) => (
        <LoadoutIcon key={a} id={a} size={38} />
      ))}
    </View>
    <View style={styles.ribButtons}>
      <Pressable onPress={onYes} style={styles.cta}>
        <Text style={styles.ctaText}>SAME ARMS ✓</Text>
      </Pressable>
      <Pressable onPress={onChange} style={[styles.cta, styles.ctaGhost]}>
        <Text style={[styles.ctaText, styles.ctaGhostText]}>CHOOSE ANEW</Text>
      </Pressable>
    </View>
  </View>
  );
};

// ── Lobby (armed) ───────────────────────────────────────────────────────────

interface LobbyViewProps {
  client: LobbyClient;
  players: RoomStatePlayer[];
  myId: number;
  myTeam: number;
  /** Total seats (2 × teamSize) — empty-seat rows pad each side to half this. */
  capacity: number;
  picks: Picks;
  roomName: string;
  roomCode: string;
  socketRefs: React.MutableRefObject<(View | null)[]>;
  showForceStart: boolean;
  unarmedCount: number;
  onEditSlot: (i: number) => void;
  lastWinner: number;
  wins: [number, number] | number[];
  /** Non-zero on the first lobby render after an arming — the arsenal box
   * glints once, then RoomScreen marks the stamp shown and passes 0. */
  glintKey: number;
}

const LobbyView = (props: LobbyViewProps) => {
  const { client, players, myId, myTeam, capacity, picks, roomName, roomCode } = props;
  const teamNames = client.welcome?.teamNames ?? ["Team 1", "Team 2"];
  // Short screens (iPhone SE) can't fit a 4v4 roster at full size — tighten
  // everything and collapse the open-seat padding into single rows.
  const compact = useWindowDimensions().height < COMPACT_LOBBY_HEIGHT;

  // The code IS the share artifact: tapping it copies, the label confirms.
  const [codeCopied, setCodeCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const copyCode = (): void => {
    playSound("uiTap");
    void Clipboard.setStringAsync(roomCode);
    setCodeCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCodeCopied(false), 1400);
  };
  const teamCap = capacity / 2;
  const mine = players.filter((p) => p.team === myTeam);
  const theirs = players.filter((p) => p.team !== myTeam);
  const emptySeats = capacity - players.length;
  // SWITCH SIDE rides the enemy team's open-seat row: hop into the seat you
  // can see (real rooms only — practice is always full, so it never shows).
  // Hidden while you're ALONE: the lobby renders viewer-relative (YOUR TEAM
  // always on top), so a solo hop changes nothing on screen — and balanced
  // join assignment seats the next joiner opposite you either way. The
  // control only means something once there's someone to be across from.
  const switchSide =
    client.switchTeam && players.length > 1 && theirs.length < teamCap
      ? () => {
          playSound("uiTap");
          client.switchTeam?.();
        }
      : undefined;
  const lastMatch =
    props.lastWinner !== 0
      ? `last match: ${props.lastWinner === myTeam ? "you won" : "you lost"} ${Math.max(...props.wins)}–${Math.min(...props.wins)}`
      : null;

  return (
    <View style={styles.lobby}>
      <View style={[styles.lobbyHead, compact && tight.lobbyHead]}>
        <Text style={[styles.roomName, compact && tight.roomName]}>{roomName}</Text>
        <Pressable onPress={copyCode} hitSlop={10}>
          <Text style={styles.roomCode}>{codeCopied ? "COPIED ✓" : roomCode}</Text>
        </Pressable>
      </View>

      {/* Faction names are the absolute identity; colour is the allegiance
          cue — your side always blue, the enemy always red, matching the
          match (bits-bot-backfill.md § team identity). */}
      <TeamHeader label={teamNames[myTeam - 1]} color={C_FRIEND} you compact={compact} />
      {mine.map((p) => (
        <PlayerRow key={p.id} p={p} isMe={p.id === myId} hostId={client.hostId} own compact={compact} />
      ))}
      <OpenSeats count={teamCap - mine.length} compact={compact} />
      <TeamHeader label={teamNames[2 - myTeam]} color={C_FOE} compact={compact} />
      {theirs.map((p) => (
        <PlayerRow key={p.id} p={p} isMe={false} hostId={client.hostId} own={false} compact={compact} />
      ))}
      <OpenSeats count={teamCap - theirs.length} compact={compact} onSwitch={switchSide} />

      <TeamHeader label="YOUR ARSENAL" color={C_MUTED} compact={compact} />
      <SocketStrip
        picks={picks}
        current={null}
        landed={null}
        refs={props.socketRefs}
        onTap={props.onEditSlot}
        size={compact ? 54 : 72}
        separated
        glintKey={props.glintKey}
      />
      <Text style={[styles.arsenalHint, compact && tight.arsenalHint]}>tap a socket to change that pick</Text>

      {lastMatch ? <Text style={[styles.lastMatch, compact && tight.lastMatch]}>{lastMatch}</Text> : null}

      <View style={styles.lobbyFoot}>
        {props.showForceStart ? (
          <Pressable
            onPress={() => {
              playSound("uiConfirm");
              client.forceStart();
            }}
            style={styles.forceStart}
          >
            <Text style={styles.forceStartText}>
              {emptySeats > 0
                ? `⚑ START NOW — ${emptySeats} BOT${emptySeats === 1 ? "" : "S"} STEP IN`
                : `⚑ START NOW — AUTO-ARM ${props.unarmedCount} GLADIATOR${props.unarmedCount === 1 ? "" : "S"}`}
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.waitingText, compact && tight.waitingText]}>
            waiting for every gladiator to arm…
          </Text>
        )}
      </View>
    </View>
  );
};

/** Dashed placeholder rows padding a team list to its capacity. Random team
 * assignment means a joiner can land on either side — both lists pad. On
 * compact screens several empties collapse into one "N open seats" row.
 * With `onSwitch` (the enemy side, when it has room) the first row is the
 * SWITCH SIDE control: you hop into the seat you can see. */
const OpenSeats = ({ count, compact, onSwitch }: { count: number; compact: boolean; onSwitch?: () => void }) => {
  if (count <= 0) return null;
  const rows = compact && count > 1 ? 1 : count;
  const label = compact && count > 1 ? `${count} open seats…` : "open seat…";
  return (
    <>
      {Array.from({ length: rows }, (_, i) =>
        i === 0 && onSwitch ? (
          <Pressable key={i} onPress={onSwitch} style={[styles.openSeat, compact && tight.openSeat]}>
            <Text style={styles.openSeatText}>
              {label}
              <Text style={styles.switchSide}>{"  ⇄ TAP TO SWITCH SIDE"}</Text>
            </Text>
          </Pressable>
        ) : (
          <View key={i} style={[styles.openSeat, compact && tight.openSeat]}>
            <Text style={styles.openSeatText}>{label}</Text>
          </View>
        ),
      )}
    </>
  );
};

const TeamHeader = ({
  label,
  color,
  you = false,
  compact,
}: {
  label: string;
  color: string;
  /** Marks the viewer's own side — a small "(YOU)" tag beside the faction. */
  you?: boolean;
  compact?: boolean;
}) => (
  <View style={[styles.teamHead, compact && tight.teamHead]}>
    <Text style={[styles.teamLabel, { color }]}>{label.toUpperCase()}</Text>
    {you ? <Text style={styles.teamYou}>YOU</Text> : null}
    <View style={styles.teamRule} />
  </View>
);

const PlayerRow = ({
  p,
  isMe,
  hostId,
  own,
  compact,
}: {
  p: RoomStatePlayer;
  isMe: boolean;
  hostId: number | null;
  own: boolean;
  compact?: boolean;
}) => (
  <View style={[styles.playerRow, compact && tight.playerRow, !p.connected && styles.playerGone]}>
    <Text style={[styles.playerName, compact && tight.playerName]}>
      {p.id === hostId ? "♛ " : ""}
      {p.name}
      {p.bot ? <Text style={styles.botTag}>{"  BOT"}</Text> : null}
      {isMe ? " (you)" : ""}
      {p.connected ? "" : " — reconnecting…"}
    </Text>
    <View style={styles.playerRight}>
      {own && p.weapon !== null ? (
        <View style={styles.pickIcons}>
          <LoadoutIcon id={p.weapon} size={compact ? 17 : 19} />
          {(p.abilities ?? []).length > 0 ? <View style={styles.pickSep} /> : null}
          {(p.abilities ?? []).map((id) => (
            <LoadoutIcon key={id} id={id} size={compact ? 17 : 19} />
          ))}
        </View>
      ) : p.armed ? (
        <Text style={styles.playerArmed}>⚔ ARMED</Text>
      ) : (
        <Text style={styles.playerStatus}>choosing…</Text>
      )}
    </View>
  </View>
);

// ── Countdown veil ──────────────────────────────────────────────────────────

const CountdownVeil = ({
  left,
  onLeave,
  onCancel,
}: {
  left: number;
  onLeave: () => void;
  /** Non-null on a bot-filled start: any gladiator's veto (bits-bot-backfill.md). */
  onCancel: (() => void) | null;
}) => {
  const insets = useSafeAreaInsets();
  const n = Math.ceil(left);
  const frac = Math.max(0, Math.min(1, left / LOBBY_COUNTDOWN_SECONDS));
  const color = n <= 3 ? "#d94141" : C_GOLD;
  const track = Skia.Path.Circle(70, 70, 62);
  const arc = Skia.PathBuilder.Make()
    .addArc({ x: 8, y: 8, width: 124, height: 124 }, -90, 360 * frac)
    .detach();
  return (
    // box-none, not none: the ✕ must stay pressable while everything else
    // passes touches through.
    <View style={styles.veil} pointerEvents="box-none">
      <LeaveX onPress={onLeave} style={[styles.leaveXFloat, { top: insets.top + 18 }]} />
      <Text style={styles.veilEyebrow}>{onCancel ? "BOTS FILL THE EMPTY SEATS" : "ALL GLADIATORS ARMED"}</Text>
      <View style={styles.veilRing}>
        <Canvas style={styles.veilCanvas}>
          <Path path={track} style="stroke" strokeWidth={5} color="#221e19" />
          <Path path={arc} style="stroke" strokeWidth={5} color={color} strokeCap="round" />
        </Canvas>
        <View style={styles.veilNumWrap}>
          <Text style={[styles.veilNum, n <= 3 && { color: "#d94141" }]}>{n}</Text>
        </View>
      </View>
      {onCancel ? (
        <>
          <Text style={styles.veilSub}>rather wait for real players? any gladiator may cancel</Text>
          <Pressable onPress={onCancel} style={[styles.cta, styles.ctaGhost, styles.veilCancel]}>
            <Text style={[styles.ctaText, styles.ctaGhostText]}>CANCEL THE START</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.veilSub}>the match starts itself — no one presses anything</Text>
      )}
    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210" },
  content: { flex: 1 },
  // Host-handoff toast — a slim banner pinned to the top, above every sub-view.
  notice: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C_GOLD,
    backgroundColor: "#1d1915ee",
  },
  noticeText: {
    color: "#e8dcc4",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.3,
    textAlign: "center",
  },
  /** The card-picker takeover. Near-opaque so the chrome reads as "behind a
   * layer", not gone; its own safe-area padding (the root stays unpadded —
   * the Yoga absolute-child rule). */
  pickerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(16,13,11,0.97)",
  },

  tickerRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 14 },
  tickerFill: { flex: 1 },
  // Left-aligned, not centred: the leave ✕ anchors the row's right edge, and
  // centred chips floated oddly beside it (Tom 2026-07-17).
  ticker: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-start", paddingHorizontal: 14 },
  tickerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "#2e2820",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tickerMe: { borderColor: "#4a4034" },
  tickerEnemy: { borderStyle: "dashed" },
  tickerArmed: { borderColor: "#4a4034" },
  tickerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#3a332a" },
  tickerDotArmed: { backgroundColor: C_GOLD },
  tickerName: { color: C_MUTED, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
  tickerNameLit: { color: "#c9bfae" },

  sockets: { flexDirection: "row", gap: 10, paddingHorizontal: 22, marginTop: 14 },
  /** The rib-row treatment for the lobby arsenal (mirrors `ribRow`): the box
   * hugs its content and the divider walls the weapon off from the hand. */
  socketsArsenal: {
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#1d1915",
    borderWidth: 1,
    borderColor: "#3a332a",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  socketSep: { width: 1, alignSelf: "stretch", marginVertical: 8, backgroundColor: "#3a332a" },
  glintClip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    overflow: "hidden",
  },
  glintBand: { position: "absolute", top: -24, bottom: -24, width: 54, backgroundColor: C_BONE },
  socket: {
    flex: 0,
    width: 72,
    height: 72,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#3a332a",
    alignItems: "center",
    justifyContent: "center",
  },
  socketFull: { borderStyle: "solid", borderColor: "#6a5636", backgroundColor: "#26201a" },
  socketNow: { borderColor: C_GOLD },
  socketLanded: { borderColor: C_GOLD, transform: [{ scale: 1.06 }] },
  socketN: { position: "absolute", top: 4, left: 7, fontSize: 9, fontWeight: "900", color: "#4a4238", letterSpacing: 1 },
  socketNFull: { color: C_GOLD },

  wizardCountdown: {
    color: C_GOLD,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    textAlign: "center",
    marginTop: 10,
    fontVariant: ["tabular-nums"],
  },

  pane: { flex: 1, minHeight: 0 },
  stepHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingTop: 16, gap: 14 },
  stepHeadText: { flex: 1, gap: 5 },
  stepEyebrow: { color: C_GOLD, fontSize: 9, fontWeight: "800", letterSpacing: 4 },
  stepTitle: { color: C_BONE, fontSize: 21, fontWeight: "900", letterSpacing: 2 },
  btnCol: { gap: 4 },
  btnColSlot: { width: 17, height: 17, borderRadius: 5, borderWidth: 1.5, borderColor: "#3a332a" },
  btnColLit: { borderColor: C_GOLD, backgroundColor: "rgba(217,154,65,0.22)" },
  btnColDone: { backgroundColor: "#2e2820", borderColor: "#2e2820" },

  gates: { flex: 1, justifyContent: "center", gap: 12, paddingHorizontal: 24 },
  gate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "#1d1915",
    borderWidth: 1.5,
    borderColor: "#2e2820",
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 17,
  },
  gateEmpty: { opacity: 0.35 },
  gateText: { flex: 1, gap: 4 },
  gateLabel: { fontSize: 12, fontWeight: "900", letterSpacing: 2.5 },
  gateDesc: { color: C_MUTED, fontSize: 10.5, fontStyle: "italic" },
  gateIcons: { flexDirection: "row", gap: 4 },
  gateChev: { color: "#4a4238", fontSize: 16, fontWeight: "700" },

  carouselWrap: { flex: 1, minHeight: 0 },
  catBack: { paddingHorizontal: 24, paddingTop: 8 },
  catBackText: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 2 },
  carousel: { flexGrow: 1 },
  card: { width: CARD_W },
  cardInner: {
    backgroundColor: "#1d1915",
    borderWidth: 1.5,
    borderColor: "#2e2820",
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  cardName: { color: C_BONE, fontSize: 16, fontWeight: "900", letterSpacing: 2.5, marginTop: 4 },
  cardCat: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 2,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 6,
    overflow: "hidden",
  },
  cardQuote: {
    color: "#c9bfae",
    fontSize: 11.5,
    lineHeight: 16,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 8,
    minHeight: 32,
  },
  cardHint: { color: C_MUTED, fontSize: 10, textAlign: "center", marginTop: 4 },
  bars: { alignSelf: "stretch", marginTop: 10, gap: 5 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { width: 46, color: C_MUTED, fontSize: 8, fontWeight: "800", letterSpacing: 1.2 },
  barTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "#16130f", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3, backgroundColor: C_GOLD },
  barValue: { width: 52, textAlign: "right", color: C_BONE, fontSize: 9, fontWeight: "700", fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 5, justifyContent: "center", marginTop: 10 },
  chip: {
    flexDirection: "row",
    gap: 4,
    borderWidth: 1,
    borderColor: "#3a332a",
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  chipLabel: { color: C_MUTED, fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  chipValue: { color: C_BONE, fontSize: 9, fontWeight: "700" },

  dots: { flexDirection: "row", gap: 6, justifyContent: "center", paddingVertical: 8 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#3a332a" },
  dotOn: { backgroundColor: C_GOLD, transform: [{ scale: 1.3 }] },

  cta: {
    marginHorizontal: 22,
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: C_GOLD,
  },
  ctaText: { color: "#241a0c", fontSize: 13, fontWeight: "900", letterSpacing: 2.5 },
  ctaGhost: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: "#3a332a" },
  ctaGhostText: { color: C_MUTED },

  // letterSpacing adds a trailing space after the LAST glyph, so tracked text
  // centres visually left — the negative marginRight trims it back out.
  // (Named for the armed splash it once headlined; the rib + leave-confirm
  // overlays still set their eyebrows in it.)
  splashEyebrow: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 4, marginRight: -4, textAlign: "center" },

  rib: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,8,6,0.96)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  ribTitle: {
    color: C_BONE,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 3,
    marginRight: -3,
    textAlign: "center",
    marginTop: 10,
    marginBottom: 20,
  },
  ribRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#1d1915",
    borderWidth: 1,
    borderColor: "#3a332a",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 22,
  },
  ribSep: { width: 1, height: 30, backgroundColor: "#3a332a" },
  ribButtons: { alignSelf: "stretch", gap: 10, marginTop: 26 },

  lobby: { flex: 1, paddingHorizontal: 22, paddingTop: 12 },
  lobbyHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 6 },
  roomName: { color: C_BONE, fontSize: 22, fontWeight: "900", letterSpacing: 1 },
  roomCode: { color: C_GOLD, fontSize: 10, fontWeight: "900", letterSpacing: 2.5 },
  teamHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, marginBottom: 4 },
  teamLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 2.5 },
  // The "(YOU)" tag on your own faction header — muted so the faction name
  // leads and the tag just confirms which side is yours.
  teamYou: {
    color: "#0f0d0b",
    backgroundColor: "#8a9bb0",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: "hidden",
  },
  teamRule: { flex: 1, height: 1, backgroundColor: "#2e2820" },
  playerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  playerGone: { opacity: 0.45 },
  playerName: { color: C_BONE, fontSize: 13.5, fontWeight: "700", flexShrink: 1 },
  playerRight: { marginLeft: "auto" },
  pickIcons: { flexDirection: "row", alignItems: "center", gap: 5 },
  pickSep: { width: 1, height: 14, backgroundColor: "#3a332a", marginHorizontal: 3 },
  playerArmed: { color: "#b39763", fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  playerStatus: { color: C_MUTED, fontSize: 12, fontStyle: "italic" },
  openSeat: {
    borderColor: "#2e2820",
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginVertical: 2,
  },
  openSeatText: { color: "#6b6257", fontSize: 13, fontStyle: "italic" },
  // The SWITCH SIDE affordance riding the enemy side's first open-seat row.
  // Neutral gold, deliberately NOT red/blue: you're crossing sides, so a
  // team colour here would fight the allegiance cue rather than read as "move".
  switchSide: { color: C_GOLD, fontSize: 11, fontWeight: "800", fontStyle: "normal", letterSpacing: 1 },
  // The roster's bot marker — muted so a bot reads as furniture, not a rival.
  botTag: { color: "#6b6154", fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  arsenalHint: { color: "#6b6257", fontSize: 10, fontStyle: "italic", marginTop: 8, marginLeft: 2 },
  lastMatch: { color: C_MUTED, fontSize: 13, marginTop: 18, textAlign: "center" },
  lobbyFoot: { marginTop: "auto", paddingBottom: 6 },
  waitingText: { color: C_MUTED, fontSize: 13, textAlign: "center", paddingVertical: 14, fontStyle: "italic" },
  forceStart: {
    borderWidth: 1.5,
    borderColor: "#d94141",
    backgroundColor: "rgba(110,21,14,0.16)",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  forceStartText: { color: "#d94141", fontSize: 11.5, fontWeight: "900", letterSpacing: 1.5 },

  veil: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(8,6,5,0.9)",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  veilEyebrow: { color: C_GOLD, fontSize: 11, fontWeight: "900", letterSpacing: 4, marginRight: -4, textAlign: "center" },
  veilRing: { width: 140, height: 140 },
  veilCanvas: { width: 140, height: 140 },
  /** Flex-centred wrapper, not a lineHeight hack: iOS ignores
   * textAlignVertical and sat the digit low in the 140pt line box. */
  veilNumWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  veilNum: {
    textAlign: "center",
    includeFontPadding: false, // Android: extra ascent padding would off-centre the flex centring
    color: C_BONE,
    fontSize: 52,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  veilSub: { color: C_MUTED, fontSize: 12, fontStyle: "italic" },
  veilCancel: { marginTop: 18 },

  leaveX: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: "#3a332a",
    alignItems: "center",
    justifyContent: "center",
  },
  leaveXGlyph: { color: C_MUTED, fontSize: 12, fontWeight: "900", includeFontPadding: false },
  /** Overlay placement (rib/veil): float top-right; `top` comes from insets. */
  leaveXFloat: { position: "absolute", right: 22 },
  leaveSub: { color: C_MUTED, fontSize: 12, fontStyle: "italic", textAlign: "center" },
  leaveConfirmText: { color: "#d94141" },
});

/** Compact-lobby overrides, layered over `styles` when the window is shorter
 * than COMPACT_LOBBY_HEIGHT — same design, tighter vertical rhythm. */
const tight = StyleSheet.create({
  lobbyHead: { marginTop: 2 },
  roomName: { fontSize: 17 },
  teamHead: { marginTop: 9, marginBottom: 2 },
  playerRow: { paddingVertical: 3 },
  playerName: { fontSize: 12.5 },
  openSeat: { paddingVertical: 4, marginVertical: 1 },
  arsenalHint: { marginTop: 4 },
  lastMatch: { marginTop: 8, fontSize: 12 },
  waitingText: { paddingVertical: 8, fontSize: 12 },
});
