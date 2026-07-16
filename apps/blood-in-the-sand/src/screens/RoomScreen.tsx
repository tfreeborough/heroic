/**
 * The Arming (docs/design/pvp-loadout-flow.md, mock-approved 2026-07-15): a
 * guided wizard — weapon → one screen per ability, one decision each — then
 * the lobby, where the server's own 10s countdown starts the match once every
 * seat is armed. Nobody presses START; the host's only control is the
 * force-start backstop for AFK stragglers.
 *
 * Layout per approved mock: roster ticker (who's armed — never WHAT they
 * picked) · socket strip (◆①②③, tap to revisit) · snap carousel with codex
 * content (ability steps open on a category gate) · CHOOSE → stamp + the icon
 * flies into its socket → auto-advance → "YOU ARE ARMED" splash → lobby.
 * Returning players get SAME ARMS (last loadout, one tap; CHOOSE ANEW clears).
 *
 * The wizard owns its picks LOCALLY and sends the full state on every choose
 * (idempotent messages) — roomState round-trips never race a fast picker.
 * Works identically for ArenaClient and PracticeClient via LobbyClient.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Animated, Easing, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { playSound, unlockAudio } from "../audio";
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
const SPLASH_MS = 3600;
const FLY_MS = 460;
const LAND_BEAT_MS = 320;

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
  const [splash, setSplash] = useState(false);
  const [rib, setRib] = useState<SavedLoadout | null>(null);
  const [fly, setFly] = useState<FlyState | null>(null);
  const flyT = useRef(new Animated.Value(0)).current;
  const [landedSlot, setLandedSlot] = useState<number | null>(null);
  const socketRefs = useRef<(View | null)[]>(SLOT_INDICES.map(() => null));
  const focusedIconRef = useRef<View | null>(null);

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
  const timerCeil = Math.ceil(timer);
  const lastTick = useRef(0);
  useEffect(() => {
    if (timer > 0 && timerCeil !== lastTick.current) {
      lastTick.current = timerCeil;
      playSound("countdownTick");
    }
    if (timer <= 0) lastTick.current = 0;
  }, [timer, timerCeil]);

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
      setSplash(true);
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

  const choose = (w: WizardState, id: IconId): void => {
    unlockAudio();
    const after: Picks =
      w.step === 0
        ? { ...picks, weapon: id as WeaponId }
        : { ...picks, hand: replaceSlot(picks.hand, w.step - 1, id as AbilityId) };
    const kept = w.step === 0 ? picks.weapon === id : picks.hand[w.step - 1] === id;
    commit(after);
    if (kept) {
      playSound("uiTap");
      advance(w, after);
      return;
    }
    playStrikeHaptic("heavy");
    playSound("uiConfirm");
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
  // would start while you're still browsing, giving you ~10s to "change".
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

  // Host force-start: someone's sat unarmed past the grace while the rest are
  // ready, OR the room has empty seats but everyone present is armed (the
  // partial-room launcher). Client-side gate only — the sim re-checks
  // everything, including a body on each team.
  const unarmed = players.filter((p) => !p.armed);
  const graceCond =
    client.isHost &&
    meArmed &&
    players.length >= 2 &&
    players.some((p) => p.team !== myTeam) &&
    (unarmed.length > 0 || players.length < capacity) &&
    players.every((p) => p.connected);
  // Keyed on the roster AND who's unarmed: any join/leave or arming restarts
  // the grace clock (the sim clears `forced` on membership changes too).
  const graceKey = graceCond ? `${players.length}:${unarmed.map((p) => p.id).join(",")}` : "";
  if (graceSince.current.key !== graceKey) graceSince.current = { key: graceKey, atMs: performance.now() };
  const showForceStart =
    graceCond && performance.now() - graceSince.current.atMs > FORCE_START_GRACE_SECONDS * 1000;

  return (
    // The root carries NO padding: overlays (veil/splash/rib/fly) are its
    // absolute children, and Yoga offsets absolute children by parent padding
    // (unlike CSS) — padded, the splash was off-centre and the fly missed.
    <View ref={rootRef} collapsable={false} style={styles.root}>
      <View style={[styles.content, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 8 }]}>
        <RosterTicker players={players} myId={welcome.playerId} myTeam={myTeam} capacity={capacity} />

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
          />
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
          onEditSlot={(i) => jumpToSlot(i, true)}
          lastWinner={view?.round.lastWinner ?? 0}
          wins={view?.round.wins ?? [0, 0]}
        />
      )}

        <Pressable onPress={onLeave} style={styles.leave} hitSlop={8}>
          <Text style={styles.leaveText}>LEAVE ROOM</Text>
        </Pressable>
      </View>

      {timer > 0 && wizard === null && !splash ? <CountdownVeil left={timer} /> : null}

      {rib !== null && wizard !== null && !splash ? (
        <RunItBack saved={rib} onYes={() => ribYes(rib)} onChange={ribChange} />
      ) : null}

      {splash ? <ArmedSplash picks={picks} onDone={() => setSplash(false)} /> : null}

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
}

const SocketStrip = ({ picks, current, landed, refs, onTap }: SocketStripProps) => (
  <View style={styles.sockets}>
    {SLOT_INDICES.map((i) => {
      const id: IconId | null = i === 0 ? picks.weapon : (picks.hand[i - 1] ?? null);
      return (
        <Pressable key={i} onPress={() => onTap(i)}>
          <View
            ref={(el) => {
              refs.current[i] = el;
            }}
            style={[
              styles.socket,
              id !== null && styles.socketFull,
              i === current && id === null && styles.socketNow,
              i === landed && styles.socketLanded,
            ]}
          >
            <Text style={[styles.socketN, id !== null && styles.socketNFull]}>{SOCKET_LABELS[i]}</Text>
            {id !== null ? <LoadoutIcon id={id} size={40} /> : null}
          </View>
        </Pressable>
      );
    })}
  </View>
);

// ── Wizard step (gates or carousel) ─────────────────────────────────────────

interface WizardStepProps {
  wizard: WizardState;
  picks: Picks;
  screenW: number;
  focusedIconRef: React.MutableRefObject<View | null>;
  onGate: (cat: AbilityCategory) => void;
  onBackToGates: () => void;
  onChoose: (id: IconId) => void;
}

const WizardStep = (props: WizardStepProps) => {
  const { wizard, picks, screenW, focusedIconRef, onGate, onBackToGates, onChoose } = props;
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

// ── Armed splash ────────────────────────────────────────────────────────────

const ArmedSplash = ({ picks, onDone }: { picks: Picks; onDone: () => void }) => {
  const anims = useRef(SLOT_INDICES.map(() => new Animated.Value(0))).current;
  const foot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.stagger(140, [
      ...anims.map((a) =>
        Animated.timing(a, { toValue: 1, duration: 430, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
      ),
      Animated.timing(foot, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
    const id = setTimeout(onDone, SPLASH_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- play once on mount
  }, []);

  const rise = (a: Animated.Value) => ({
    opacity: a,
    transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }],
  });

  return (
    <Pressable style={styles.splash} onPress={onDone}>
      <Text style={styles.splashEyebrow}>THE ARMING IS COMPLETE</Text>
      <Text style={styles.splashTitle}>YOU ARE ARMED</Text>
      <View style={styles.splashRule} />
      <Animated.View style={rise(anims[0]!)}>
        {picks.weapon !== null ? <LoadoutIcon id={picks.weapon} size={110} /> : null}
      </Animated.View>
      <View style={styles.splashHand}>
        {picks.hand.map((id, i) => (
          <Animated.View key={id} style={[styles.splashAbility, rise(anims[i + 1]!)]}>
            <LoadoutIcon id={id} size={64} />
            <Text style={styles.splashAbilityN}>{i + 1}</Text>
          </Animated.View>
        ))}
      </View>
      <Animated.Text style={[styles.splashFoot, { opacity: foot }]}>to the sand, gladiator</Animated.Text>
    </Pressable>
  );
};

// ── Run it back ─────────────────────────────────────────────────────────────

const RunItBack = ({ saved, onYes, onChange }: { saved: SavedLoadout; onYes: () => void; onChange: () => void }) => (
  <View style={styles.rib}>
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
}

const LobbyView = (props: LobbyViewProps) => {
  const { client, players, myId, myTeam, capacity, picks, roomName, roomCode } = props;
  const teamCap = capacity / 2;
  const mine = players.filter((p) => p.team === myTeam);
  const theirs = players.filter((p) => p.team !== myTeam);
  const emptySeats = capacity - players.length;
  const lastMatch =
    props.lastWinner !== 0
      ? `last match: ${props.lastWinner === myTeam ? "you won" : "you lost"} ${Math.max(...props.wins)}–${Math.min(...props.wins)}`
      : null;

  return (
    <View style={styles.lobby}>
      <View style={styles.lobbyHead}>
        <Text style={styles.roomName}>{roomName}</Text>
        <Text style={styles.roomCode}>{`ROOM ${roomCode}`}</Text>
      </View>

      <TeamHeader label="YOUR TEAM" color="#d94141" />
      {mine.map((p) => (
        <PlayerRow key={p.id} p={p} isMe={p.id === myId} hostId={client.hostId} own />
      ))}
      <OpenSeats count={teamCap - mine.length} />
      <TeamHeader label="ENEMY TEAM" color="#4da3d9" />
      {theirs.map((p) => (
        <PlayerRow key={p.id} p={p} isMe={false} hostId={client.hostId} own={false} />
      ))}
      <OpenSeats count={teamCap - theirs.length} />

      <TeamHeader label="YOUR ARSENAL" color={C_MUTED} />
      <SocketStrip picks={picks} current={null} landed={null} refs={props.socketRefs} onTap={props.onEditSlot} />
      <Text style={styles.arsenalHint}>tap a socket to change that pick</Text>

      {lastMatch ? <Text style={styles.lastMatch}>{lastMatch}</Text> : null}

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
              {props.unarmedCount > 0
                ? `⚑ START NOW — AUTO-ARM ${props.unarmedCount} GLADIATOR${props.unarmedCount === 1 ? "" : "S"}`
                : `⚑ START NOW — ${emptySeats} SEAT${emptySeats === 1 ? "" : "S"} EMPTY`}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.waitingText}>
            {emptySeats > 0
              ? `share the room code — the match starts once all ${capacity} gladiators are armed`
              : "waiting for every gladiator to arm…"}
          </Text>
        )}
      </View>
    </View>
  );
};

/** Dashed placeholder rows padding a team list to its capacity. Random team
 * assignment means a joiner can land on either side — both lists pad. */
const OpenSeats = ({ count }: { count: number }) => (
  <>
    {Array.from({ length: Math.max(0, count) }, (_, i) => (
      <View key={i} style={styles.openSeat}>
        <Text style={styles.openSeatText}>open seat…</Text>
      </View>
    ))}
  </>
);

const TeamHeader = ({ label, color }: { label: string; color: string }) => (
  <View style={styles.teamHead}>
    <Text style={[styles.teamLabel, { color }]}>{label}</Text>
    <View style={styles.teamRule} />
  </View>
);

const PlayerRow = ({ p, isMe, hostId, own }: { p: RoomStatePlayer; isMe: boolean; hostId: number | null; own: boolean }) => (
  <View style={[styles.playerRow, !p.connected && styles.playerGone]}>
    <Text style={styles.playerName}>
      {p.id === hostId ? "♛ " : ""}
      {p.name}
      {isMe ? " (you)" : ""}
      {p.connected ? "" : " — reconnecting…"}
    </Text>
    <View style={styles.playerRight}>
      {own && p.weapon !== null ? (
        <View style={styles.pickIcons}>
          <LoadoutIcon id={p.weapon} size={19} />
          {(p.abilities ?? []).length > 0 ? <View style={styles.pickSep} /> : null}
          {(p.abilities ?? []).map((id) => (
            <LoadoutIcon key={id} id={id} size={19} />
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

const CountdownVeil = ({ left }: { left: number }) => {
  const n = Math.ceil(left);
  const frac = Math.max(0, Math.min(1, left / LOBBY_COUNTDOWN_SECONDS));
  const color = n <= 3 ? "#d94141" : C_GOLD;
  const track = Skia.Path.Make();
  track.addCircle(70, 70, 62);
  const arc = Skia.Path.Make();
  arc.addArc({ x: 8, y: 8, width: 124, height: 124 }, -90, 360 * frac);
  return (
    <View style={styles.veil} pointerEvents="none">
      <Text style={styles.veilEyebrow}>ALL GLADIATORS ARMED</Text>
      <View style={styles.veilRing}>
        <Canvas style={styles.veilCanvas}>
          <Path path={track} style="stroke" strokeWidth={5} color="#221e19" />
          <Path path={arc} style="stroke" strokeWidth={5} color={color} strokeCap="round" />
        </Canvas>
        <Text style={[styles.veilNum, n <= 3 && { color: "#d94141" }]}>{n}</Text>
      </View>
      <Text style={styles.veilSub}>the match starts itself — no one presses anything</Text>
    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210" },
  content: { flex: 1 },

  ticker: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", paddingHorizontal: 14 },
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

  splash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,7,6,0.97)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  // letterSpacing adds a trailing space after the LAST glyph, so tracked text
  // centres visually left — the negative marginRight trims it back out.
  splashEyebrow: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 4, marginRight: -4, textAlign: "center" },
  splashTitle: {
    color: C_GOLD,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: 5,
    marginRight: -5,
    textAlign: "center",
    marginTop: 8,
  },
  splashRule: { width: 200, height: 1, backgroundColor: "#4a4034", marginVertical: 20 },
  splashHand: { flexDirection: "row", gap: 18, marginTop: 16, alignItems: "flex-end" },
  splashAbility: { alignItems: "center", gap: 6 },
  splashAbilityN: { color: "#4a4238", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  splashFoot: { color: C_MUTED, fontSize: 13, fontStyle: "italic", marginTop: 34 },

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
  veilNum: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    textAlign: "center",
    textAlignVertical: "center",
    lineHeight: 140,
    color: C_BONE,
    fontSize: 52,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  veilSub: { color: C_MUTED, fontSize: 12, fontStyle: "italic" },

  leave: { alignSelf: "center", marginTop: 10, marginBottom: 6 },
  leaveText: { color: C_MUTED, fontWeight: "700", letterSpacing: 1, fontSize: 12 },
});
