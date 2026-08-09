/**
 * The Chronicle (achievements.md § the codex, Tom 2026-08-04): the deeds
 * screen as a scrolling illuminated codex — one chapter per thematic family
 * (ACHIEVEMENT_CHAPTERS, content-owned in the sim package), each deed a
 * rich entry row. The 2D pan/zoom map was retired the same day: three
 * polish passes made it tidier, never richer — BITS's premium feel comes
 * from art + typography + beats, and a codex is built from exactly those.
 *
 * Reveal rules carry over: unlocked = full entry (icon, title, description,
 * rewards); frontier (parent unlocked) = faded icon + title + milestone
 * progress; deeper = collapsed into a single "N deeds lie beyond" row per
 * stretch, so mystery reads as depth rather than spam.
 *
 * On entry, anything unlocked that this device never celebrated replays the
 * unlock ceremony first — the moment is delayed, never skipped.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Image,
  LayoutAnimation,
  SectionList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ACHIEVEMENT_CHAPTERS,
  ACHIEVEMENT_DEFS,
  itemDisplayName,
  type BitsAchievementDef,
} from "@heroic/blood-in-the-sand-sim";
import { visibility } from "@heroic/achievements";
import { playSound } from "../audio";
import { loadCelebratedDeeds } from "../deeds/celebrated";
import { DEED_ICONS } from "../deeds/deedIcons";
import { getWornTitle, setWornTitle } from "../deeds/wornTitle";
import { setEntitlements } from "../deeds/entitlements";
import { devFlags } from "../dev";
import { ensureIdentity, fetchAchievements, type AchievementsMe } from "../net/api";
import { DeedReplayOverlay } from "./DeedCards";
import { DISPLAY_FONT } from "../typography";

export interface DeedsScreenProps {
  onBack: () => void;
}


const DEFS_BY_ID = new Map<string, BitsAchievementDef>(ACHIEVEMENT_DEFS.map((d) => [d.id, d]));

/** The dev preview's fake state (bits-dev-menu.md): "all" unlocks the whole
 * chronicle; "some" unlocks the root + every chain's first tier with
 * counters faked ~60% toward each next tier so progress bars render.
 * Session-only, client-side, never written anywhere. */
const previewState = (mode: "some" | "all"): { unlocked: Set<string>; counters: Record<string, number> } => {
  if (mode === "all") return { unlocked: new Set(ACHIEVEMENT_DEFS.map((d) => d.id)), counters: {} };
  const roots = new Set(ACHIEVEMENT_DEFS.filter((d) => d.parent === null).map((d) => d.id));
  const unlocked = new Set(
    ACHIEVEMENT_DEFS.filter((d) => d.parent === null || roots.has(d.parent)).map((d) => d.id),
  );
  const counters: Record<string, number> = {};
  for (const def of ACHIEVEMENT_DEFS) {
    if (def.trigger.kind !== "milestone" || !unlocked.has(def.id)) continue;
    counters[def.trigger.counter] = Math.max(counters[def.trigger.counter] ?? 0, def.trigger.threshold);
  }
  const nextLocked: Record<string, number> = {};
  for (const def of ACHIEVEMENT_DEFS) {
    if (def.trigger.kind !== "milestone" || unlocked.has(def.id)) continue;
    const cur = counters[def.trigger.counter] ?? 0;
    if (def.trigger.threshold > cur) {
      nextLocked[def.trigger.counter] = Math.min(nextLocked[def.trigger.counter] ?? Infinity, def.trigger.threshold);
    }
  }
  for (const [counter, next] of Object.entries(nextLocked)) {
    const cur = counters[counter] ?? 0;
    counters[counter] = cur + Math.floor((next - cur) * 0.6);
  }
  return { unlocked, counters };
};

/** Rising gold embers behind the chronicle — the candlelight (same
 * native-driven pattern as the title screen's motes). */
const EMBER_COUNT = 16;

const Ember = ({ w, h, seed }: { w: number; h: number; seed: number }) => {
  const t = useRef(new Animated.Value(0)).current;
  const x0 = (((seed * 89) % 100) / 100) * w;
  const y0 = h * 0.3 + (((seed * 53) % 100) / 100) * h * 0.65;
  const dur = 11000 + ((seed * 131) % 8) * 1500;
  const size = 2 + (seed % 3);
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
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: seed % 5 === 0 ? "#fff3d0" : seed % 2 === 0 ? "#f2cd6e" : "#e8c87a",
        opacity: t.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 0.42, 0.3, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -(60 + (seed % 4) * 18)] }) },
          {
            translateX: t.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, (seed % 2 === 0 ? 1 : -1) * (8 + (seed % 3) * 5), (seed % 2 === 0 ? 1 : -1) * (14 + (seed % 3) * 7)],
            }),
          },
        ],
      }}
    />
  );
};

/** One tier's resolved display state. */
interface TierEntry {
  def: BitsAchievementDef;
  state: "unlocked" | "frontier" | "hidden";
  unlockedAt?: number;
}

/** One codex block: a lone deed, or a whole chain — head + indented tiers
 * (achievements.md § the codex hierarchy, Tom 2026-08-04: tiers read as a
 * family under a faint spine, not five equal siblings; hidden tiers are
 * slim ??? rows so the ladder's HEIGHT shows without spoiling anything). */
type CodexBlock =
  | { kind: "single"; key: string; entry: TierEntry }
  | { kind: "chain"; key: string; entries: TierEntry[] };

interface Chapter {
  title: string;
  done: number;
  total: number;
  data: CodexBlock[];
}


/** Explicit reward lines (Tom, 2026-08-04): say WHAT was earned, by name —
 * the deed's own title for title rewards, the item's name for spoils. */
const RewardMarks = ({ def }: { def: BitsAchievementDef }) => {
  if (!def.rewards || def.rewards.length === 0) return null;
  return (
    <>
      {def.rewards.map((r, i) => (
        <Text key={i} style={styles.rewardLine}>
          {r.kind === "glory"
            ? `Earned ${r.amount} Glory`
            : r.kind === "title"
              ? `Earned the title “${def.title}”`
              : `Unlocked “${itemDisplayName(r.itemId)}”`}
        </Text>
      ))}
    </>
  );
};

/** The equip picker (achievements.md § wearing titles): unlocked deeds that
 * crown a title get a WEAR pill; the worn one shows WORN and taps back to
 * bare. Device-local — the claim rides the next room join. */
const WearButton = ({ id, worn, onWear }: { id: string; worn: boolean; onWear: (id: string) => void }) => (
  <Pressable onPress={() => onWear(id)} hitSlop={8}>
    <View style={[styles.wearPill, worn && styles.wearPillOn]}>
      <Text style={[styles.wearText, worn && styles.wearTextOn]}>{worn ? "WORN ✦" : "WEAR"}</Text>
    </View>
  </Pressable>
);

const crownsTitle = (def: BitsAchievementDef): boolean => def.rewards?.some((r) => r.kind === "title") ?? false;

const ProgressBar = ({ def, counters }: { def: BitsAchievementDef; counters: Record<string, number> }) => {
  if (def.trigger.kind !== "milestone") return null;
  const value = Math.min(counters[def.trigger.counter] ?? 0, def.trigger.threshold);
  return (
    <>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.round((value / def.trigger.threshold) * 100)}%` }]} />
      </View>
      <Text style={styles.progressText}>{`${value} / ${def.trigger.threshold}`}</Text>
    </>
  );
};

interface WearProps {
  worn: string;
  onWear: (id: string) => void;
}

/** A full-size entry — chain heads and lone deeds. */
const HeadRow = ({ entry, counters, worn, onWear }: { entry: TierEntry; counters: Record<string, number> } & WearProps) => {
  const { def, state } = entry;
  const icon = DEED_ICONS[def.icon];
  if (state === "hidden") {
    return (
      <View style={styles.row}>
        <View style={[styles.iconWell, styles.iconWellLocked]}>
          <Text style={styles.mysteryGlyph}>?</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.titleMystery}>???</Text>
        </View>
      </View>
    );
  }
  if (state === "unlocked") {
    return (
      <View style={styles.row}>
        <View style={styles.iconWell}>
          {icon != null && <Image source={icon} style={styles.icon} resizeMode="contain" />}
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{def.title}</Text>
          <Text style={styles.desc}>{def.description}</Text>
          <RewardMarks def={def} />
          {crownsTitle(def) && <WearButton id={def.id} worn={worn === def.id} onWear={onWear} />}
        </View>
        {entry.unlockedAt !== undefined && (
          <Text style={styles.date}>
            {new Date(entry.unlockedAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </Text>
        )}
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <View style={[styles.iconWell, styles.iconWellLocked]}>
        {icon != null && <Image source={icon} style={[styles.icon, styles.iconGhost]} resizeMode="contain" />}
      </View>
      <View style={styles.copy}>
        <Text style={styles.titleLocked}>{def.title}</Text>
        <ProgressBar def={def} counters={counters} />
      </View>
    </View>
  );
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"] as const;

/** An indented tier under a chain head — a roman NUMERAL chip instead of
 * the family icon (the emblem lives once, on the head; a ladder of
 * identical icons read as wallpaper — Tom, 2026-08-04): unlocked = numeral
 * + title + one-liner; the next earnable tier = name + progress; anything
 * past it = a slim numbered ??? rung. */
const TierRow = ({ entry, tier, counters, worn, onWear }: { entry: TierEntry; tier: number; counters: Record<string, number> } & WearProps) => {
  const { def, state } = entry;
  const numeral = ROMAN[tier] ?? `${tier + 1}`;
  if (state === "hidden") {
    return (
      <View style={styles.tierRow}>
        <View style={[styles.tierChip, styles.tierChipHidden]}>
          <Text style={styles.tierChipTextHidden}>{numeral}</Text>
        </View>
        <Text style={styles.tierMystery}>???</Text>
      </View>
    );
  }
  if (state === "unlocked") {
    return (
      <View style={styles.tierRow}>
        <View style={styles.tierChip}>
          <Text style={styles.tierChipText}>{numeral}</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.tierTitle}>{def.title}</Text>
          <Text style={styles.tierDesc}>{def.description}</Text>
          <RewardMarks def={def} />
          {crownsTitle(def) && <WearButton id={def.id} worn={worn === def.id} onWear={onWear} />}
        </View>
        {entry.unlockedAt !== undefined && (
          <Text style={styles.date}>
            {new Date(entry.unlockedAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </Text>
        )}
      </View>
    );
  }
  return (
    <View style={styles.tierRow}>
      <View style={[styles.tierChip, styles.tierChipLocked]}>
        <Text style={styles.tierChipTextLocked}>{numeral}</Text>
      </View>
      <View style={styles.copy}>
        <Text style={styles.tierTitleLocked}>{def.title}</Text>
        <ProgressBar def={def} counters={counters} />
      </View>
    </View>
  );
};

/** A block's entrance: a quiet fade-and-rise on mount (the codex premium
 * pass — rows arrive like entries being penned, never pop). Runs on screen
 * entry, on scroll-in, and on chapter expand alike; the stagger is capped
 * so deep scrolling never feels laggy. Native-driven, so it costs nothing
 * on the JS thread. */
const BlockReveal = ({ index, children }: { index: number; children: ReactNode }) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: 280,
      delay: Math.min(index, 6) * 45,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [t, index]);
  return (
    <Animated.View
      style={{
        opacity: t,
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
};

const Block = ({ block, counters, worn, onWear }: { block: CodexBlock; counters: Record<string, number> } & WearProps) => {
  if (block.kind === "single") {
    return (
      <View style={styles.block}>
        <HeadRow entry={block.entry} counters={counters} worn={worn} onWear={onWear} />
      </View>
    );
  }
  return (
    <View style={styles.block}>
      <HeadRow entry={block.entries[0]!} counters={counters} worn={worn} onWear={onWear} />
      {/* The tier ladder: indented under a faint spine, numbered from II
          (the head is tier I). */}
      <View style={styles.tierBlock}>
        <View style={styles.tierSpine} />
        {block.entries.slice(1).map((entry, i) => (
          <TierRow key={entry.def.id} entry={entry} tier={i + 1} counters={counters} worn={worn} onWear={onWear} />
        ))}
      </View>
    </View>
  );
};

export const DeedsScreen = ({ onBack }: DeedsScreenProps) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Session dev flag, read once per mount — re-enter the screen to apply.
  const preview = useMemo(() => (devFlags.deedsPreview ? previewState(devFlags.deedsPreview) : null), []);
  const [me, setMe] = useState<AchievementsMe | null | "loading">("loading");
  const [replay, setReplay] = useState<string[] | null>(null);
  // The worn title (deeds/wornTitle.ts) — mirrored into state so the pills
  // re-render; the module global is what the join path reads.
  const [worn, setWorn] = useState(getWornTitle());
  const onWear = (id: string): void => {
    playSound("uiTap");
    setWornTitle(worn === id ? "" : id); // tap the worn one → go bare
    setWorn(getWornTitle());
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      const identity = await ensureIdentity();
      const data = identity ? await fetchAchievements(identity) : null;
      if (!live) return;
      setMe(data);
      // The authoritative entitlement refresh (bits-secret-items.md) —
      // replaces the device cache wholesale (it must be able to SHRINK
      // after a dev DB reset).
      if (data) setEntitlements(data.entitlements.map((e) => e.itemId));
      if (data && data.unlocks.length > 0) {
        const celebrated = await loadCelebratedDeeds();
        if (!live) return;
        const missed = data.unlocks.map((u) => u.id).filter((id) => !celebrated.has(id));
        if (missed.length > 0) setReplay(missed);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const unlocked = useMemo(
    () => preview?.unlocked ?? new Set(me !== "loading" && me !== null ? me.unlocks.map((u) => u.id) : []),
    [me, preview],
  );
  const counters = preview?.counters ?? (me !== "loading" && me !== null ? me.counters : {});
  const unlockedAt = useMemo(() => {
    const map = new Map<string, number>();
    if (me !== "loading" && me !== null) for (const u of me.unlocks) map.set(u.id, u.unlockedAt);
    return map;
  }, [me]);
  const earnedCount = useMemo(() => ACHIEVEMENT_DEFS.filter((d) => unlocked.has(d.id)).length, [unlocked]);

  // Chapters → blocks: consecutive same-icon deeds form a CHAIN (head +
  // indented tier ladder); everything else is a lone entry.
  const chapters = useMemo<Chapter[]>(() => {
    const vis = visibility(ACHIEVEMENT_DEFS, unlocked);
    return ACHIEVEMENT_CHAPTERS.map((chapter) => {
      const blocks: CodexBlock[] = [];
      let run: TierEntry[] = [];
      const flushRun = (): void => {
        if (run.length === 0) return;
        if (run.length === 1) blocks.push({ kind: "single", key: run[0]!.def.id, entry: run[0]! });
        else blocks.push({ kind: "chain", key: run[0]!.def.id, entries: run });
        run = [];
      };
      let done = 0;
      for (const id of chapter.ids) {
        const def = DEFS_BY_ID.get(id);
        if (!def) continue;
        const state = vis.get(id)!;
        if (state === "unlocked") done += 1;
        const entry: TierEntry = { def, state, unlockedAt: unlockedAt.get(id) };
        if (run.length > 0 && run[run.length - 1]!.def.icon !== def.icon) flushRun();
        run.push(entry);
      }
      flushRun();
      return { title: chapter.title, done, total: chapter.ids.length, data: blocks };
    });
  }, [unlocked, unlockedAt]);

  // Collapsible chapters (Tom, 2026-08-04) — session-only, all open on
  // entry; the header keeps its earned count while folded.
  const [collapsedChapters, setCollapsedChapters] = useState<ReadonlySet<string>>(new Set());
  const toggleChapter = (title: string): void => {
    playSound("uiTap");
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };
  const sections = useMemo(
    () => chapters.map((c) => (collapsedChapters.has(c.title) ? { ...c, data: [] } : c)),
    [chapters, collapsedChapters],
  );

  const ready = preview !== null || (me !== "loading" && me !== null);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {Array.from({ length: EMBER_COUNT }, (_, i) => (
        <Ember key={i} w={width} h={height} seed={i + 7} />
      ))}
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            playSound("uiBack");
            onBack();
          }}
          hitSlop={12}
        >
          <Text style={styles.back}>‹ BACK</Text>
        </Pressable>
        <Text style={styles.screenTitle}>DEEDS</Text>
        <Text style={styles.progress}>{ready ? `${earnedCount} / ${ACHIEVEMENT_DEFS.length}` : ""}</Text>
      </View>

      {ready ? (
        <SectionList
          sections={sections}
          keyExtractor={(block) => block.key}
          renderItem={({ item, index }) => (
            <BlockReveal index={index}>
              <Block block={item} counters={counters} worn={worn} onWear={onWear} />
            </BlockReveal>
          )}
          renderSectionHeader={({ section }) => (
            <Pressable onPress={() => toggleChapter(section.title)} hitSlop={6}>
              <View style={styles.chapterHead}>
                <Text style={styles.chapterChevron}>{collapsedChapters.has(section.title) ? "▸" : "▾"}</Text>
                <Text style={styles.chapterTitle}>{section.title.toUpperCase()}</Text>
                <Text style={styles.chapterCount}>{`${(section as Chapter).done} / ${(section as Chapter).total}`}</Text>
              </View>
            </Pressable>
          )}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32, paddingHorizontal: 20 }}
          showsVerticalScrollIndicator={false}
        />
      ) : me === "loading" ? (
        <View style={styles.centre}>
          <Text style={styles.note}>Unrolling the chronicle…</Text>
        </View>
      ) : (
        <View style={styles.centre}>
          <Text style={styles.note}>
            The chronicle needs the arena account service — check your connection and come back.
          </Text>
        </View>
      )}

      {/* No replay during a preview — fake unlocks must never celebrate. */}
      {replay && preview === null && <DeedReplayOverlay deeds={replay} onDone={() => setReplay(null)} />}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  back: { color: "#8a7f70", fontSize: 13, fontWeight: "800", letterSpacing: 2 },
  screenTitle: {
    fontFamily: DISPLAY_FONT,
    color: "#e8d9b8",
    fontSize: 22,
    letterSpacing: 5,
  },
  progress: {
    color: "#8a7f70",
    fontSize: 13, fontWeight: "800",
    letterSpacing: 1,
    fontVariant: ["tabular-nums"],
    minWidth: 58,
    textAlign: "right",
  },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  note: { color: "#8a7f70", fontSize: 14, fontWeight: "700", textAlign: "center", lineHeight: 21 },

  chapterHead: { flexDirection: "row", alignItems: "baseline", gap: 12, marginTop: 30, marginBottom: 12 },
  chapterChevron: { color: "#8a6d44", fontSize: 13, fontWeight: "900", width: 16 },
  chapterTitle: {
    fontFamily: DISPLAY_FONT,
    color: "#e8c87a",
    fontSize: 17,
    letterSpacing: 3,
  },
  chapterCount: {
    color: "#8a7f70",
    fontSize: 12, fontWeight: "800",
    letterSpacing: 1,
    fontVariant: ["tabular-nums"],
    marginLeft: "auto",
  },

  /** A chain (or lone deed) is one block — real air between blocks so a
   * head never crowds the previous family's tail. */
  block: { marginBottom: 26 },
  row: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  /** The indented tier ladder under a chain head. */
  tierBlock: { marginTop: 14, marginLeft: 25, paddingLeft: 27, gap: 14 },
  tierSpine: {
    position: "absolute",
    left: 0,
    top: 2,
    bottom: 2,
    width: 1,
    backgroundColor: "#2e2820",
  },
  tierRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  tierChip: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: 6,
    borderRadius: 7,
    backgroundColor: "#2a2318",
    borderWidth: 1,
    borderColor: "#8a6d44",
    alignItems: "center",
    justifyContent: "center",
  },
  tierChipLocked: { backgroundColor: "#1a1611", borderColor: "#4a3f30", borderStyle: "dashed" },
  tierChipHidden: { backgroundColor: "transparent", borderColor: "#2e2820", borderStyle: "dashed" },
  tierChipText: { fontFamily: DISPLAY_FONT, color: "#e8c87a", fontSize: 12 },
  tierChipTextLocked: { fontFamily: DISPLAY_FONT, color: "#8a7f70", fontSize: 12 },
  tierChipTextHidden: { fontFamily: DISPLAY_FONT, color: "#4a4034", fontSize: 12 },
  tierTitle: { fontFamily: DISPLAY_FONT, color: "#e8d9b8", fontSize: 13, letterSpacing: 1 },
  tierTitleLocked: { fontFamily: DISPLAY_FONT, color: "#8a7f70", fontSize: 13, letterSpacing: 1 },
  tierDesc: { color: "#a89a83", fontSize: 11, lineHeight: 15 },
  tierMystery: { color: "#4a4034", fontSize: 12, fontWeight: "800", letterSpacing: 3, alignSelf: "center" },
  mysteryGlyph: { color: "#5a4c38", fontSize: 22, fontWeight: "900" },
  titleMystery: { fontFamily: DISPLAY_FONT, color: "#5a4c38", fontSize: 15, letterSpacing: 2 },
  iconWell: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: "#221c14",
    borderWidth: 1,
    borderColor: "#3a3126",
    alignItems: "center",
    justifyContent: "center",
  },
  iconWellLocked: { backgroundColor: "#1a1611", borderStyle: "dashed" },
  icon: { width: 42, height: 42 },
  iconGhost: { opacity: 0.3 },
  copy: { flex: 1, gap: 3 },
  title: { fontFamily: DISPLAY_FONT, color: "#e8d9b8", fontSize: 15, letterSpacing: 1 },
  titleLocked: { fontFamily: DISPLAY_FONT, color: "#8a7f70", fontSize: 15, letterSpacing: 1 },
  desc: { color: "#a89a83", fontSize: 12, lineHeight: 17 },
  rewardLine: { color: "#e8c87a", fontSize: 11, fontWeight: "800", letterSpacing: 0.3, marginTop: 3 },
  wearPill: {
    alignSelf: "flex-start",
    marginTop: 7,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#5a4c38",
    backgroundColor: "#221c14",
  },
  wearPillOn: { borderColor: "#b3925e", backgroundColor: "#31281a" },
  wearText: { color: "#8a7f70", fontSize: 10, fontWeight: "900", letterSpacing: 2 },
  wearTextOn: { color: "#e8c87a" },
  date: { color: "#5a4c38", fontSize: 10, fontWeight: "700", marginTop: 2 },

  barTrack: { height: 4, borderRadius: 2, backgroundColor: "#2a241c", marginTop: 6, overflow: "hidden" },
  barFill: { height: 4, borderRadius: 2, backgroundColor: "#a8854f" },
  progressText: {
    color: "#8a7f70",
    fontSize: 10, fontWeight: "800",
    fontVariant: ["tabular-nums"],
    marginTop: 3,
  },

});
