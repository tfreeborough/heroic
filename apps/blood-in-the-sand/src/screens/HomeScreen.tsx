import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Blur, Canvas, Fill, Group, Oval, Path, Picture, Rect, RoundedRect, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { ARCHETYPE_IDS, DIFFICULTY_IDS } from "@heroic/blood-in-the-sand-sim";
import { ANNOUNCER_PACK_IDS, playSound, setAnnouncerPack, unlockAudio, type AnnouncerPackId, type BitsSoundEvent } from "../audio";
import { devFlags } from "../dev";
import { devGrant, devResetPurchases, ensureIdentity, fetchAchievements, fetchWallet, type Wallet } from "../net/api";
import { setEntitlements } from "../deeds/entitlements";
import { loadAnnouncerPack, saveAnnouncerPack } from "../settings";
import type { RankedResultRow } from "../net/connection";
import { DUST_EFFECT } from "./dustStorm";
import { HOME_ART } from "./homeArt";
import { bannerAnchors, buildCrowd, makeHighSunPicture, sceneAnchors, type BannerAnchor } from "./homeScene";
import { RankedCeremony } from "./RankedCeremony";
import { pickDuel, TITLE_SPRITE_SCALE, TITLE_SPRITES } from "./titleSprites";
import { DISPLAY_FONT } from "../typography";

export interface HomeScreenProps {
  /** → the mode select (bits-mode-select.md); Practice lives in there now. */
  onPlay: () => void;
  /** → the Armory (bits-store.md) — the store's front door. */
  onArmory: () => void;
  onSettings: () => void;
  /** Dev menu: start the target-dummy firing range (offline, respawning dummies). */
  onTargetDummies: () => void;
  /** Dev menu: raise the first-win account sheet on demand and re-arm its
   * once-per-install flag (bits-accounts.md). Absent = no Clerk key shipped,
   * so the row hides (the sheet can't mount without the provider). */
  onRehearseFirstWin?: () => void;
  /** A downloaded OTA update is staged — show the restart pill. */
  updateReady: boolean;
  /** Restart into the staged update (instant JS reload). */
  onApplyUpdate: () => void;
}

/** Wrap a nav handler so the tap unlocks audio (first gesture) and sounds. */
const withTap = (event: BitsSoundEvent, fn: () => void) => (): void => {
  unlockAudio();
  playSound(event);
  fn();
};

/** The secret knock: this many title taps toggles the dev menu… */
const DEV_TAPS = 5;
/** …as long as no two taps are further apart than this (slower = start over). */
const DEV_TAP_GAP_MS = 1500;

/** Dev-menu ceremony rehearsal (bits-dev-menu.md): a plausible fake
 * settlement — a win with a rank-up and a new season best, so every beat
 * (glory swell, rating count, rank-up sting, deeds) gets exercised. */
const REHEARSAL_ROW: RankedResultRow = {
  playerId: 0,
  before: 1437,
  after: 1462,
  delta: 25,
  tier: "Gladiator",
  division: 2,
  rankChange: "up",
  glory: 23,
  peak: 1462,
  newBest: true,
  placement: null,
};

/** A spread of deed shapes for the rehearsal: the root feat, an early kill
 * milestone, and a titled chain tier — three cards, three reveal flavours. */
const REHEARSAL_DEEDS = ["sworn-to-the-sand", "killing-blows-1", "ranked-wins-5"];

/** Drifting sunlit dust motes over the scene. */
const MOTE_COUNT = 14;

/** One mote: a slow diagonal drift with a fade-in/out, then respawn (loop). */
const Mote = ({ w, h, seed }: { w: number; h: number; seed: number }) => {
  const t = useRef(new Animated.Value(0)).current;
  // Deterministic-ish spread from the index; exact positions don't matter.
  const x0 = ((seed * 97) % 100) / 100 * w;
  const y0 = ((seed * 61) % 100) / 100 * h * 0.66;
  const dur = 9000 + ((seed * 137) % 7) * 1000;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [t, dur]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x0,
        top: y0,
        width: 2 + (seed % 3),
        height: 2 + (seed % 3),
        borderRadius: 2,
        backgroundColor: seed % 4 === 0 ? "#fff3d0" : "#e8d8b0",
        opacity: t.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.4, 0.4, 0] }),
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, 40 + (seed % 5) * 12] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, 18 + (seed % 3) * 10] }) },
        ],
      }}
    />
  );
};

/**
 * One swallowtail banner riding the wind — the ribbon path is rebuilt every
 * frame in a Reanimated derived value, so the cloth animates on the UI thread
 * at the display's refresh rate. (This layer used to be a ~30fps JS-thread
 * picture re-record, which read as visibly low-frame-rate cloth AND kept a
 * permanent rAF loop alive on the idle title screen — this way costs less
 * and looks better.)
 */
const BannerRibbon = ({ b, clock }: { b: BannerAnchor; clock: SharedValue<number> }) => {
  const path = useDerivedValue(() => {
    const t = clock.value;
    const topX = (u: number): number => b.x + u * 30;
    const topY = (u: number): number => b.y + u * 2 + Math.sin(t * 0.004 + b.phase + u * 3.2) * u * 3.4;
    const ribbon = Skia.PathBuilder.Make();
    ribbon.moveTo(topX(0), topY(0));
    for (let k = 1; k <= 8; k++) ribbon.lineTo(topX(k / 8), topY(k / 8));
    ribbon.lineTo(topX(1) - 6, topY(1) + 2.3); // swallowtail notch
    for (let k = 8; k >= 0; k--) ribbon.lineTo(topX(k / 8), topY(k / 8) + 7 - (k / 8) * 2.5);
    return ribbon.close().detach();
  });
  // sun-bleached red riding the wind (the scene's red, kept scarce)
  return <Path path={path} color="#8a3a2e" />;
};

/**
 * The scene's living details — the rippling banners and a stray glint
 * wandering the stands (sun off a helmet, a raised cup). All motion is
 * UI-thread Reanimated values feeding Skia props; no React re-renders.
 */
const SceneLife = ({ w, h }: { w: number; h: number }) => {
  const clock = useClock();
  const crowd = useMemo(() => buildCrowd(w, h), [w, h]);
  const anchors = useMemo(() => bannerAnchors(w, h), [w, h]);
  const glintX = useDerivedValue(() => crowd[Math.floor(clock.value / 700) % crowd.length].x);
  const glintY = useDerivedValue(() => crowd[Math.floor(clock.value / 700) % crowd.length].y);
  const glintA = useDerivedValue(() => 0.45 + 0.4 * Math.sin(clock.value * 0.02));
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {anchors.map((b, i) => (
        <BannerRibbon key={i} b={b} clock={clock} />
      ))}
      <Rect x={glintX} y={glintY} width={2.6} height={2.6} color="#fff2c8" opacity={glintA} />
    </Canvas>
  );
};

/**
 * One swallow crossing the sky — drift, bob, and wing flap are all
 * native-driver transforms, so the bird stays smooth at the display's refresh
 * rate no matter what the JS thread does (the life layer's re-record cadence
 * visibly stuttered these — fast movers can't live on a redraw loop). The
 * loop's leading delay staggers the birds and leaves natural empty-sky gaps.
 */
const Swallow = ({ w, h, i }: { w: number; h: number; i: number }) => {
  const drift = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const flap = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const flapMs = 150 + i * 35;
    const loops = [
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 2600),
          Animated.timing(drift, { toValue: 1, duration: 26000 - i * 5000, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(drift, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(bob, { toValue: 1, duration: 1900 + i * 400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bob, { toValue: 0, duration: 1900 + i * 400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(flap, { toValue: 1, duration: flapMs, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(flap, { toValue: 0, duration: flapMs, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [drift, bob, flap, i]);
  // Clockwise degrees lift a left-pointing wing and drop a right-pointing one
  // — mirrored ranges make both tips rise together on the upstroke.
  const rotL = flap.interpolate({ inputRange: [0, 1], outputRange: ["-14deg", "26deg"] });
  const rotR = flap.interpolate({ inputRange: [0, 1], outputRange: ["14deg", "-26deg"] });
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 0,
        top: h * (0.13 + i * 0.045),
        width: 12,
        height: 8,
        pointerEvents: "none",
        transform: [
          { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-45, w + 45] }) },
          { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] }) },
        ],
      }}
    >
      <Animated.View style={[styles.wing, { left: 0, transformOrigin: "100% 50%", transform: [{ rotate: rotL }] }]} />
      <Animated.View style={[styles.wing, { left: 6, transformOrigin: "0% 50%", transform: [{ rotate: rotR }] }]} />
    </Animated.View>
  );
};

/** How far the PLAY ember glow bleeds past the button on each side. */
const GLOW_SPREAD = 30;

/**
 * A real blurred glow behind PLAY — three Gaussian layers in one static Skia
 * canvas (wide deep-red bloom, hot orange core, bright ember rim). The old
 * version stacked two solid Views at low opacity, which read as hard-edged
 * boxes; actual blur is what sells "heat". The breathing rides the wrapping
 * Animated.View (opacity + scale, native driver), so the canvas never
 * re-records — same cost profile as the fake it replaces.
 */
const EmberGlow = ({ w, h, glow }: { w: number; h: number; glow: Animated.Value }) => (
  <Animated.View
    pointerEvents="none"
    style={{
      position: "absolute",
      left: -GLOW_SPREAD,
      top: -GLOW_SPREAD,
      width: w + GLOW_SPREAD * 2,
      height: h + GLOW_SPREAD * 2,
      opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
      transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1.03] }) }],
    }}
  >
    <Canvas style={{ flex: 1 }}>
      <RoundedRect x={GLOW_SPREAD} y={GLOW_SPREAD} width={w} height={h} r={12} color="rgba(217,65,44,0.5)">
        <Blur blur={16} />
      </RoundedRect>
      <RoundedRect x={GLOW_SPREAD} y={GLOW_SPREAD} width={w} height={h} r={12} color="rgba(255,122,64,0.4)">
        <Blur blur={7} />
      </RoundedRect>
      <RoundedRect
        x={GLOW_SPREAD}
        y={GLOW_SPREAD}
        width={w}
        height={h}
        r={12}
        color="rgba(255,196,128,0.55)"
        style="stroke"
        strokeWidth={1.6}
      >
        <Blur blur={2.2} />
      </RoundedRect>
    </Canvas>
  </Animated.View>
);

/** Gust cadence: a dust squall crosses every 20–30s and lasts ~9s. */
const GUST_GAP_MIN_MS = 20000;
const GUST_GAP_RANGE_MS = 10000;
const GUST_MS = 9000;
/** The dust canvas rasterizes at this fraction of screen size and the
 * compositor scales it up — the shader pays per pixel, and soft dust
 * upscaled 2x is indistinguishable, so shade a quarter of them. */
const DUST_SCALE = 0.5;

/** The live squall: the SkSL shader (dustStorm.ts) with its clock fed from a
 * Reanimated clock on the UI thread — zero React renders and zero JS-thread
 * work per frame (the previous 30fps re-record was a visible hitch source). */
const GustShader = ({ w, h }: { w: number; h: number }) => {
  const clock = useClock();
  const uniforms = useDerivedValue(() => ({
    u_res: [w * DUST_SCALE, h * DUST_SCALE],
    u_t: clock.value / 1000,
    u_prog: Math.min(clock.value / GUST_MS, 1),
  }));
  if (!DUST_EFFECT) return null;
  return (
    <Canvas
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: w * DUST_SCALE,
        height: h * DUST_SCALE,
        transformOrigin: "top left",
        transform: [{ scale: 1 / DUST_SCALE }],
      }}
    >
      <Fill>
        <Shader source={DUST_EFFECT} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
};

/**
 * The dust storm's scheduler: every 20–30s (the gap re-rolls each cycle — a
 * metronomic storm reads as a screensaver, not weather) a squall blows through
 * left-to-right, the same direction the banners fly. The shader mounts only
 * while the gust is live and UNMOUNTS after, so the idle screen pays nothing.
 */
const DustStorm = ({ w, h }: { w: number; h: number }) => {
  const [gusting, setGusting] = useState(false);
  useEffect(() => {
    const timer = setTimeout(
      () => {
        if (!gusting) playSound("titleGust");
        setGusting(!gusting);
      },
      gusting ? GUST_MS : GUST_GAP_MIN_MS + Math.random() * GUST_GAP_RANGE_MS,
    );
    return () => clearTimeout(timer);
  }, [gusting]);
  return gusting ? <GustShader w={w} h={h} /> : null;
};

/**
 * The front door: the forged home backdrop (homeArt.ts — a full-bleed
 * retro-pixel scene, bits-art-style.md) with the title at the top and the
 * two ways in at the bottom — PLAY opens the mode select (ranked / skirmish
 * / practice / story), SETTINGS is the quiet one. The forged gladiator duel
 * stands on the backdrop's sand band, with the weather layers (motes,
 * swallows, dust storm) over everything. Until the backdrop is forged
 * (HOME_ART.home null), the hand-painted Skia High Sun scene (homeScene.ts)
 * plus its geometry-bound life layers (banners, crowd glint) stand in. No
 * server needed to be here — connection concerns start behind the mode
 * select's gates.
 *
 * There's also a hidden fourth way in: tapping the title DEV_TAPS times in a
 * row toggles the dev menu, a small panel pinned to the bottom-left corner.
 * Session-only on purpose — it never persists, so a fresh launch is always
 * clean (nothing to stumble into mid-playtest). One exception: the ANNOUNCER
 * row drives a real persisted setting (settings.ts) that just has no
 * player-facing UI yet.
 */
export const HomeScreen = ({
  onPlay,
  onArmory,
  onSettings,
  onTargetDummies,
  onRehearseFirstWin,
  updateReady,
  onApplyUpdate,
}: HomeScreenProps) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [devOpen, setDevOpen] = useState(false);
  // PLAY's measured box — the ember glow canvas needs pixel dims to blur in.
  const [playBox, setPlayBox] = useState<{ w: number; h: number } | null>(null);
  // Mirror devFlags so the toggle labels re-render on tap.
  const [perfOverlay, setPerfOverlay] = useState(devFlags.perfOverlay);
  const [sfxOff, setSfxOff] = useState(devFlags.disableSfx);
  const [hapticsOff, setHapticsOff] = useState(devFlags.disableHaptics);
  const [botArchetype, setBotArchetype] = useState(devFlags.botArchetype);
  const [botDifficulty, setBotDifficulty] = useState(devFlags.botDifficulty);
  const [deedsPreview, setDeedsPreview] = useState(devFlags.deedsPreview);
  const [grantAllItems, setGrantAllItems] = useState(devFlags.grantAllItems);
  // The announcer row mirrors a PERSISTED setting (settings.ts), unlike the
  // session-only devFlags rows — App.tsx applies it on launch; this label
  // just needs the same stored value.
  const [announcer, setAnnouncer] = useState<AnnouncerPackId>("default");
  // Full post-match ceremony on fake data — see REHEARSAL_ROW above.
  const [deedRehearsal, setDeedRehearsal] = useState(false);
  // Store testing (bits-store.md): live balances shown while the menu is
  // open; the GRANT rows hit dev-only API endpoints (STORE_DEV_TOOLS=1) and
  // are inert against a production API.
  const [devWallet, setDevWallet] = useState<Wallet | null>(null);
  useEffect(() => {
    void loadAnnouncerPack().then(setAnnouncer);
  }, []);
  useEffect(() => {
    if (!devOpen) return;
    let live = true;
    void (async () => {
      const identity = await ensureIdentity();
      if (!identity || !live) return;
      const wallet = await fetchWallet(identity);
      if (live && wallet) setDevWallet(wallet);
    })();
    return () => {
      live = false;
    };
  }, [devOpen]);

  const onDevGrant = (grant: { glory?: number; signets?: number }) => (): void => {
    void (async () => {
      const identity = await ensureIdentity();
      if (!identity) return;
      const wallet = await devGrant(identity, grant);
      if (wallet) setDevWallet(wallet);
    })();
  };
  const knock = useRef({ count: 0, lastMs: 0 });

  // The forged backdrop owns the screen when it exists; the painted scene
  // (and its geometry-bound life: banners, crowd glint) is the fallback.
  const homeArt = HOME_ART["home"] ?? null;
  const scene = useMemo(() => (homeArt ? null : makeHighSunPicture(width, height)), [homeArt, width, height]);
  // Screen-fraction anchors — the duel stands on the lower sand band in both
  // the painted scene and the forged art (whose brief reserves that band).
  const anchors = useMemo(() => sceneAnchors(width, height), [width, height]);
  // Today's matchup — two random fighters from the pool, fixed for the mount.
  const [duel] = useState(pickDuel);
  // The sprite box: square art, figure fills ~90% of it, feet ~4% above the
  // bottom edge (the forge template leaves margin all round).
  const figBox = anchors.figureSize * 1.5;
  const leftBox = figBox * (TITLE_SPRITE_SCALE[duel.left] ?? 1);
  const rightBox = figBox * (TITLE_SPRITE_SCALE[duel.right] ?? 1);

  // Entrance: title, then the scene's cast, then the menu rises in.
  const entrance = useRef(new Animated.Value(0)).current;
  // The PLAY halo breathes like the rooms screen's create button.
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loops = [
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
    ];
    loops.forEach((l) => l.start());
    Animated.timing(entrance, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    return () => loops.forEach((l) => l.stop());
  }, [glow, entrance]);

  const rise = (from: number, to: number) => ({
    opacity: entrance.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: "clamp" }),
    transform: [
      {
        translateY: entrance.interpolate({ inputRange: [from, to], outputRange: [14, 0], extrapolate: "clamp" }),
      },
    ],
  });

  const onTogglePerf = (): void => {
    devFlags.perfOverlay = !devFlags.perfOverlay;
    setPerfOverlay(devFlags.perfOverlay);
  };

  const onToggleSfx = (): void => {
    devFlags.disableSfx = !devFlags.disableSfx;
    setSfxOff(devFlags.disableSfx);
  };

  const onToggleHaptics = (): void => {
    devFlags.disableHaptics = !devFlags.disableHaptics;
    setHapticsOff(devFlags.disableHaptics);
  };

  // Matchup testing (bot-brains.md step 5): cycle every practice bot through
  // a pinned archetype / difficulty; null = the normal behaviour (archetype
  // from loadout, tier from the practice lobby's pick).
  const onCycleBotArchetype = (): void => {
    const ring = [null, ...ARCHETYPE_IDS] as const;
    const next = ring[(ring.indexOf(devFlags.botArchetype) + 1) % ring.length]!;
    devFlags.botArchetype = next;
    setBotArchetype(next);
  };

  const onCycleBotDifficulty = (): void => {
    const ring = [null, ...DIFFICULTY_IDS] as const;
    const next = ring[(ring.indexOf(devFlags.botDifficulty) + 1) % ring.length]!;
    devFlags.botDifficulty = next;
    setBotDifficulty(next);
  };

  // Deed Map preview — fake unlock states for board testing without the
  // grind (achievements.md; read on DeedsScreen mount, session-only).
  const onCycleDeedsPreview = (): void => {
    const ring = [null, "some", "all"] as const;
    const next = ring[(ring.indexOf(devFlags.deedsPreview) + 1) % ring.length]!;
    devFlags.deedsPreview = next;
    setDeedsPreview(next);
  };

  // Grant every gated item this session (bits-secret-items.md) — the wizard
  // shows unearned steel in practice/skirmish; ranked still validates.
  const onToggleGrantItems = (): void => {
    devFlags.grantAllItems = !devFlags.grantAllItems;
    setGrantAllItems(devFlags.grantAllItems);
  };

  // Cycle the announcer voice — applied live + persisted, then the new pack's
  // FIRST BLOOD line plays so you hear who you just hired (the same
  // ear-training move as the wizard's ability-pick SFX).
  const onCycleAnnouncer = (): void => {
    const next = ANNOUNCER_PACK_IDS[(ANNOUNCER_PACK_IDS.indexOf(announcer) + 1) % ANNOUNCER_PACK_IDS.length]!;
    setAnnouncerPack(next);
    saveAnnouncerPack(next);
    setAnnouncer(next);
    playSound("firstBlood");
  };

  // Deliberately silent until the fifth tap — a secret shouldn't click.
  const onTitleTap = (): void => {
    const now = Date.now();
    knock.current.count = now - knock.current.lastMs <= DEV_TAP_GAP_MS ? knock.current.count + 1 : 1;
    knock.current.lastMs = now;
    if (knock.current.count >= DEV_TAPS) {
      knock.current.count = 0;
      unlockAudio();
      playSound("uiConfirm");
      setDevOpen((open) => !open);
    }
  };

  return (
    <View style={styles.root}>
      {homeArt ? (
        // Explicit window dims + style resizeMode: the backdrop always covers
        // the full screen (centre-cropped), never letterboxed.
        <Image
          source={homeArt}
          style={{ position: "absolute", top: 0, left: 0, width, height, resizeMode: "cover" }}
        />
      ) : (
        scene && (
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Picture picture={scene} />
          </Canvas>
        )
      )}
      {/* Banners + crowd glint are anchored to the PAINTED scene's geometry —
          they retire with it rather than floating over unrelated art. */}
      {!homeArt && <SceneLife w={width} h={height} />}
      {[0, 1, 2].map((i) => (
        <Swallow key={i} w={width} h={height} i={i} />
      ))}

      {Array.from({ length: MOTE_COUNT }, (_, i) => (
        <Mote key={i} w={width} h={height} seed={i + 3} />
      ))}

      {/* Contact shadows under the duel — the sprite template forbids baked
          shadows (the scene composites its own), so the scene does: a soft
          dark pool at each fighter's feet, fading in with its owner. */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { opacity: entrance.interpolate({ inputRange: [0.2, 0.6], outputRange: [0, 1], extrapolate: "clamp" }) },
        ]}
      >
        <Canvas style={StyleSheet.absoluteFill}>
          {(
            [
              [anchors.leftX, leftBox],
              [anchors.rightX, rightBox],
            ] as const
          ).map(([cx, box], i) => (
            // Two layers ground the figure (the EmberGlow recipe): a wide
            // soft pool plus a tight near-black core right under the feet —
            // one diffuse ellipse alone reads floaty.
            // Pool centre rides ~3% of the box ABOVE the figureY anchor — the
            // forged sprites carry a touch more bottom margin than the anchor
            // maths assumes, and the shadow must kiss the soles, not trail.
            <Group key={i}>
              <Oval
                x={cx - box * 0.26}
                y={anchors.figureY - box * 0.03 - box * 0.055}
                width={box * 0.52}
                height={box * 0.11}
                color="rgba(30,18,8,0.5)"
              >
                <Blur blur={5} />
              </Oval>
              <Oval
                x={cx - box * 0.16}
                y={anchors.figureY - box * 0.03 - box * 0.032}
                width={box * 0.32}
                height={box * 0.064}
                color="rgba(20,12,6,0.65)"
              >
                <Blur blur={2.5} />
              </Oval>
            </Group>
          ))}
        </Canvas>
      </Animated.View>

      {/* the duel — two random fighters from the pool over the painted sand;
          all sprites face right, so the right slot is always mirrored */}
      <Animated.Image
        source={TITLE_SPRITES[duel.left]}
        style={[
          styles.figure,
          {
            left: anchors.leftX - leftBox / 2,
            top: anchors.figureY - leftBox * 0.96,
            width: leftBox,
            height: leftBox,
            opacity: entrance.interpolate({ inputRange: [0.2, 0.6], outputRange: [0, 1], extrapolate: "clamp" }),
          },
        ]}
      />
      <Animated.Image
        source={TITLE_SPRITES[duel.right]}
        style={[
          styles.figure,
          {
            left: anchors.rightX - rightBox / 2,
            top: anchors.figureY - rightBox * 0.96,
            width: rightBox,
            height: rightBox,
            opacity: entrance.interpolate({ inputRange: [0.2, 0.6], outputRange: [0, 1], extrapolate: "clamp" }),
            transform: [{ scaleX: -1 }],
          },
        ]}
      />

      <DustStorm w={width} h={height} />

      {/* The title block is compressed into the backdrop's sky band (top ~27%
          of the art) — below it the colosseum begins and text drowns. */}
      <View style={[styles.ui, { paddingTop: insets.top + 50, paddingBottom: insets.bottom + 70 }]} pointerEvents="box-none">
        <Animated.View style={rise(0, 0.45)}>
          <Pressable onPress={onTitleTap}>
            <Text style={styles.eyebrow}>HEROIC</Text>
            <Text style={styles.wordA}>BLOOD</Text>
            <Text style={styles.wordB}>IN THE SAND</Text>
          </Pressable>
          <Text style={styles.tagline}>ONE LIFE · NO MERCY</Text>
          <View style={styles.rule}>
            <View style={styles.ruleLine} />
            <View style={styles.gem} />
            <View style={styles.ruleLine} />
          </View>
        </Animated.View>

        <View style={styles.spacer} pointerEvents="none" />

        {updateReady && (
          <Animated.View style={rise(0.3, 0.8)}>
            <Pressable onPress={withTap("uiConfirm", onApplyUpdate)} style={styles.updatePill}>
              <Text style={styles.updatePillText}>UPDATE READY · TAP TO RESTART</Text>
            </Pressable>
          </Animated.View>
        )}

        <Animated.View style={[styles.menu, rise(0.4, 1)]}>
          <View onLayout={(e) => setPlayBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
            {playBox && <EmberGlow w={playBox.w} h={playBox.h} glow={glow} />}
            <Pressable onPress={withTap("uiConfirm", onPlay)} style={styles.play}>
              <Text style={styles.playText}>PLAY</Text>
            </Pressable>
          </View>
          <Pressable onPress={withTap("uiConfirm", onArmory)} style={styles.ghost}>
            <Text style={styles.ghostText}>ARMORY</Text>
          </Pressable>
          <Pressable onPress={withTap("uiTap", onSettings)} style={styles.ghost}>
            <Text style={styles.ghostText}>SETTINGS</Text>
          </Pressable>
        </Animated.View>
      </View>

      <Text style={[styles.foot, { bottom: insets.bottom + 18 }]}>THE CROWD WAITS</Text>

      {devOpen && (
        <View style={[styles.devMenu, { bottom: insets.bottom + 16 }]}>
          <View style={styles.devHeader}>
            <Text style={styles.devTitle}>DEV</Text>
            <Pressable onPress={withTap("uiTap", () => setDevOpen(false))} hitSlop={10}>
              <Text style={styles.devClose}>✕</Text>
            </Pressable>
          </View>
          <Pressable onPress={withTap("uiConfirm", onTargetDummies)} style={styles.devButton}>
            <Text style={styles.devButtonText}>TARGET DUMMIES</Text>
          </Pressable>
          <Pressable onPress={withTap("uiTap", onTogglePerf)} style={styles.devButton}>
            <Text style={styles.devButtonText}>PERF OVERLAY {perfOverlay ? "◉ ON" : "○ OFF"}</Text>
          </Pressable>
          {/* Perf A/B: kills playSound outright (scheduler + native calls), so a
              choppy device can answer "is it the audio?" in one toggle. */}
          <Pressable onPress={withTap("uiTap", onToggleSfx)} style={styles.devButton}>
            <Text style={styles.devButtonText}>SFX {sfxOff ? "○ KILLED" : "◉ ON"}</Text>
          </Pressable>
          {/* Same A/B for the other per-moment native cost (iOS allocates a
              feedback generator per pulse). */}
          <Pressable onPress={withTap("uiTap", onToggleHaptics)} style={styles.devButton}>
            <Text style={styles.devButtonText}>HAPTICS {hapticsOff ? "○ KILLED" : "◉ ON"}</Text>
          </Pressable>
          {/* Bot-brain overrides for practice matchup testing — tap to cycle. */}
          <Pressable onPress={withTap("uiTap", onCycleBotArchetype)} style={styles.devButton}>
            <Text style={styles.devButtonText}>
              BOT BRAIN {botArchetype ? `◉ ${botArchetype.toUpperCase()}` : "○ FROM LOADOUT"}
            </Text>
          </Pressable>
          <Pressable onPress={withTap("uiTap", onCycleBotDifficulty)} style={styles.devButton}>
            <Text style={styles.devButtonText}>
              BOT TIER {botDifficulty ? `◉ ${botDifficulty.toUpperCase()}` : "○ FROM LOBBY"}
            </Text>
          </Pressable>
          {/* The announcer voice — the one PERSISTED row (a real device
              setting auditioned from here until the store exists). */}
          <Pressable onPress={withTap("uiTap", onCycleAnnouncer)} style={styles.devButton}>
            <Text style={styles.devButtonText}>
              ANNOUNCER {announcer === "default" ? "○ DEFAULT" : `◉ ${announcer.replace(/_/g, " ").toUpperCase()}`}
            </Text>
          </Pressable>
          {/* Ceremony feel-testing without earning anything (achievements.md
              § unlock ceremony) — plays every beat on fake data. */}
          <Pressable onPress={withTap("uiTap", () => setDeedRehearsal(true))} style={styles.devButton}>
            <Text style={styles.devButtonText}>DEED CEREMONY ▶</Text>
          </Pressable>
          {/* The first-win account sheet on demand (bits-accounts.md) — also
              re-arms the once-per-install flag, so the real post-win trigger
              can be re-tested after the next online win. */}
          {onRehearseFirstWin ? (
            <Pressable onPress={withTap("uiTap", onRehearseFirstWin)} style={styles.devButton}>
              <Text style={styles.devButtonText}>FIRST-WIN NUDGE ▶</Text>
            </Pressable>
          ) : null}
          {/* Deed Map preview — REAL server data / SOME (frontier on show) /
              ALL unlocked. Applies next time the deeds screen opens. */}
          <Pressable onPress={withTap("uiTap", onCycleDeedsPreview)} style={styles.devButton}>
            <Text style={styles.devButtonText}>
              DEEDS {deedsPreview ? `◉ ${deedsPreview.toUpperCase()} UNLOCKED` : "○ REAL DATA"}
            </Text>
          </Pressable>
          {/* Session grant of every gated item — the wizard shows the trident
              etc. in practice/skirmish; RANKED still checks the real ledger.
              Debug builds only: in a shipped build this row would hand out
              the Armory's paid shelf in skirmish (store-security pass). */}
          {__DEV__ ? (
            <Pressable onPress={withTap("uiTap", onToggleGrantItems)} style={styles.devButton}>
              <Text style={styles.devButtonText}>
                ITEMS {grantAllItems ? "◉ ALL GRANTED" : "○ EARNED ONLY"}
              </Text>
            </Pressable>
          ) : null}
          {/* Store testing (bits-store.md): real server balances; the grant
              rows need the API running with STORE_DEV_TOOLS=1. */}
          <Pressable onPress={withTap("uiTap", onDevGrant({}))} style={styles.devButton}>
            <Text style={styles.devButtonText}>
              WALLET {devWallet ? `${devWallet.glory.toLocaleString()} GLORY · ${devWallet.signets} SIGNET${devWallet.signets === 1 ? "" : "S"}` : "—"}
            </Text>
          </Pressable>
          <Pressable onPress={withTap("uiConfirm", onDevGrant({ glory: 500 }))} style={styles.devButton}>
            <Text style={styles.devButtonText}>GRANT 500 GLORY</Text>
          </Pressable>
          <Pressable onPress={withTap("uiConfirm", onDevGrant({ signets: 1 }))} style={styles.devButton}>
            <Text style={styles.devButtonText}>GRANT 1 SIGNET</Text>
          </Pressable>
          {/* Forget every Signet purchase (server + local cache) so the unlock
              flow can be re-tested end to end. Deed grants survive. */}
          <Pressable
            onPress={withTap("uiTap", () => {
              void (async () => {
                const identity = await ensureIdentity();
                if (!identity || !(await devResetPurchases(identity))) return;
                const me = await fetchAchievements(identity);
                if (me) setEntitlements(me.entitlements.map((e) => e.itemId));
              })();
            })}
            style={styles.devButton}
          >
            <Text style={styles.devButtonText}>RESET PURCHASES</Text>
          </Pressable>
        </View>
      )}

      {deedRehearsal && (
        <RankedCeremony
          won
          mine={REHEARSAL_ROW}
          deeds={REHEARSAL_DEEDS}
          rehearsal
          onDone={() => setDeedRehearsal(false)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210" },
  figure: { position: "absolute", resizeMode: "contain", pointerEvents: "none" },
  wing: {
    position: "absolute",
    top: 3.5,
    width: 6,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: "rgba(58,48,36,0.6)",
  },
  ui: { flex: 1, alignItems: "center", paddingHorizontal: 24 },
  // RN letterSpacing adds a trailing space — tracked centered text needs the
  // negative marginRight (the wizard's YOU ARE ARMED lesson).
  // Title palette rule (backdrop era): every line must read over BOTH the
  // bright dithered sky and, if it ever drifts low, the stone band — so the
  // supporting lines are bone-light with dark shadows, never stone-dark.
  // The eyebrow sits highest — right in the backdrop's bright sun-lit sky —
  // so it's the one line that goes DARK, with a faint pale lift beneath.
  eyebrow: {
    color: "#4a3520",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 9,
    marginRight: -9,
    marginBottom: 5,
    textShadowColor: "rgba(240,228,200,0.4)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 0,
  },
  wordA: {
    fontFamily: DISPLAY_FONT,
    color: "#a32c22",
    fontSize: 54,
    textAlign: "center",
    letterSpacing: 6,
    marginRight: -6,
    // Carved harder than before — BLOOD can sit in front of the backdrop's
    // sun, and the deep shadow is what keeps its edge there.
    textShadowColor: "rgba(30,18,8,0.65)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 2,
  },
  wordB: {
    fontFamily: DISPLAY_FONT,
    color: "#f0e4c8",
    fontSize: 23,
    textAlign: "center",
    letterSpacing: 10,
    marginRight: -10,
    marginTop: 2,
    textShadowColor: "rgba(46,28,14,0.6)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 1,
  },
  tagline: {
    color: "rgba(240,228,200,0.85)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 4,
    marginRight: -4,
    textAlign: "center",
    marginTop: 8,
    textShadowColor: "rgba(46,28,14,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  rule: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, width: 220, alignSelf: "center" },
  ruleLine: { flex: 1, height: 1, backgroundColor: "rgba(240,228,200,0.55)" },
  gem: {
    width: 7,
    height: 7,
    backgroundColor: "#8c2f2f",
    transform: [{ rotate: "45deg" }],
  },
  spacer: { flex: 1 },
  updatePill: {
    backgroundColor: "rgba(30,24,16,0.82)",
    borderColor: "#8a6d44",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginBottom: 14,
    alignSelf: "center",
  },
  updatePillText: { color: "#e8c87a", fontSize: 11, fontWeight: "800", letterSpacing: 2, marginRight: -2 },
  menu: { width: 250, gap: 12 },
  play: {
    backgroundColor: "#8c2f2f",
    borderColor: "#e0503c",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 17,
    alignItems: "center",
  },
  playText: { color: "#f5ede0", fontWeight: "900", letterSpacing: 3, fontSize: 17 },
  ghost: {
    backgroundColor: "rgba(43,30,18,0.55)",
    borderColor: "rgba(58,45,30,0.9)",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  ghostText: { color: "#f0e4c8", fontWeight: "800", letterSpacing: 2, fontSize: 13 },
  foot: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    color: "rgba(59,44,26,0.78)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    marginRight: -2,
  },
  devMenu: {
    position: "absolute",
    left: 16,
    backgroundColor: "#1d1a16",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 8,
    minWidth: 160,
  },
  devHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  devTitle: { color: "#6b6257", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  devClose: { color: "#6b6257", fontSize: 12, fontWeight: "800" },
  devButton: { backgroundColor: "#3a332a", borderRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  devButtonText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1, fontSize: 12 },
});
