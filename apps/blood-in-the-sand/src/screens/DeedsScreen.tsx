/**
 * The Chronicle v2 — the shelf (achievements.md § The Chronicle v2, Tom
 * 2026-09-10: the 186-deed single scroll was "a chore… overwhelming, not the
 * celebration it should be"). Two levels:
 *
 *  1. THE SHELF (landing): the celebration band — worn title (and the
 *     title quick pick once you hold one), your latest deeds, and "nearly
 *     there" — above a two-across grid of chapter cards, each with its art,
 *     its tally and the one next-up deed inside.
 *  2. THE CHAPTER PAGE: one chapter's codex — head rows, indented tier
 *     ladders, WEAR pills, unlock dates — under the v2 reveal rule.
 *
 * REVEAL RULE (Tom, 2026-09-11 — reversed from "the description is
 * earned"): every deed shows its emblem, title AND description from the
 * start, locked or not — a deed nobody can read is a deed nobody sets out
 * to do. The exception is a `secret` deed, which keeps its description
 * until unlocked and says so in one muted line: the handful whose punchline
 * is the reward. The next earnable tier carries its progress bar; reward
 * marks stay unlocked-only. No ??? rows, no dashed ? wells.
 *
 * On entry, anything unlocked that this device never celebrated replays the
 * unlock ceremony first — the moment is delayed, never skipped.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas, LinearGradient, RadialGradient, Rect, vec } from "@shopify/react-native-skia";
import {
  ACHIEVEMENT_CHAPTERS,
  ACHIEVEMENT_DEFS,
  itemDisplayName,
  type AchievementChapter,
  type BitsAchievementDef,
} from "@heroic/blood-in-the-sand-sim";
import { latestUnlocks, nearlyThere, visibility, type NodeVisibility } from "@heroic/achievements";
import { playSound } from "../audio";
import { loadCelebratedDeeds } from "../deeds/celebrated";
import { chapterArt } from "../deeds/chapterArt";
import { DEED_ICONS } from "../deeds/deedIcons";
import { getWornTitle, setWornTitle } from "../deeds/wornTitle";
import { setEntitlements } from "../deeds/entitlements";
import { ensureIdentity, fetchAchievements, type AchievementsMe } from "../net/api";
import { Embers } from "../components/Embers";
import { ScreenHeader, ScreenSign } from "../components/ScreenHeader";
import { useBackClose } from "../components/sheetGestures";
import { TitleSheet, type TitleOption } from "../components/TitleSheet";
import { DeedReplayOverlay } from "./DeedCards";
import { DISPLAY_FONT } from "../typography";

export interface DeedsScreenProps {
  onBack: () => void;
  /** The header purse → the Armory. */
  onArmory: () => void;
}

const DEFS_BY_ID = new Map<string, BitsAchievementDef>(ACHIEVEMENT_DEFS.map((d) => [d.id, d]));
const CHAPTER_OF = new Map<string, AchievementChapter>();
for (const c of ACHIEVEMENT_CHAPTERS) for (const id of c.ids) CHAPTER_OF.set(id, c);

/** The band's strip widths. */
const LATEST_LIMIT = 4;
const NEARLY_LIMIT = 3;
/** Chapter-page focus: where the tapped block lands, as a fraction of the
 * viewport from the top. The last block in a chapter can't sit that high —
 * the scroll simply clamps to the end and the block lands lower, still in
 * full view. */
const FOCUS_VIEW_POSITION = 0.15;
/** What a locked secret deed says instead of its description. */
const SECRET_LINE = "A secret deed — how it's earned is told when it's earned.";

/** One tier's resolved display state. */
interface TierEntry {
  def: BitsAchievementDef;
  state: NodeVisibility;
  unlockedAt?: number;
}

/** One codex block: a lone deed, or a whole chain — head + indented tiers
 * (achievements.md § the codex hierarchy, Tom 2026-08-04: tiers read as a
 * family under a faint spine, not five equal siblings). */
type CodexBlock =
  | { kind: "single"; key: string; entry: TierEntry }
  | { kind: "chain"; key: string; entries: TierEntry[] };

interface Chapter {
  id: string;
  title: string;
  done: number;
  total: number;
  /** The chapter's emblem — its first deed's icon. */
  icon: number | null;
  /** The first deed still to earn, in reading order (frontier before deeper). */
  nextUp: BitsAchievementDef | null;
  data: CodexBlock[];
}

type View2 = { kind: "shelf" } | { kind: "chapter"; id: string; focus?: string };

const crownsTitle = (def: BitsAchievementDef): boolean => def.rewards?.some((r) => r.kind === "title") ?? false;

const shortDate = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// ── Row pieces (the chapter page) ──────────────────────────────────────────

/** Explicit reward lines (Tom, 2026-08-04): say WHAT was earned, by name —
 * the deed's own title for title rewards, the item's name for spoils.
 * Unlocked rows only — on a locked row this is exactly the spoiler the
 * reveal rule protects. */
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

/** The equip pill (achievements.md § wearing titles): unlocked deeds that
 * crown a title get WEAR; the worn one shows WORN and taps back to bare. */
const WearButton = ({ id, worn, onWear }: { id: string; worn: boolean; onWear: (id: string) => void }) => (
  <Pressable onPress={() => onWear(id)} hitSlop={8}>
    <View style={[styles.wearPill, worn && styles.wearPillOn]}>
      <Text style={[styles.wearText, worn && styles.wearTextOn]}>{worn ? "WORN ✦" : "WEAR"}</Text>
    </View>
  </Pressable>
);

/** A locked row's "how" (the reveal rule, header comment): the description
 * in a dimmer ink, or — on a secret deed — one muted line saying the how is
 * withheld, so a bare title never reads as a missing string. */
const LockedDescription = ({ def, style }: { def: BitsAchievementDef; style: object }) => (
  <Text style={[style, def.secret && styles.descSecret]}>{def.secret ? SECRET_LINE : def.description}</Text>
);

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

/** A full-size entry — chain heads and lone deeds. Locked = ghosted emblem
 * + dim title (+ the bar when it's the next earnable tier). */
const HeadRow = ({ entry, counters, worn, onWear }: { entry: TierEntry; counters: Record<string, number> } & WearProps) => {
  const { def, state } = entry;
  const icon = DEED_ICONS[def.icon];
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
        {entry.unlockedAt !== undefined && <Text style={styles.date}>{shortDate(entry.unlockedAt)}</Text>}
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
        <LockedDescription def={def} style={styles.descLocked} />
        {state === "frontier" && <ProgressBar def={def} counters={counters} />}
      </View>
    </View>
  );
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"] as const;

/** An indented tier under a chain head — a roman NUMERAL chip instead of
 * the family icon (the emblem lives once, on the head; a ladder of
 * identical icons read as wallpaper — Tom, 2026-08-04). */
const TierRow = ({ entry, tier, counters, worn, onWear }: { entry: TierEntry; tier: number; counters: Record<string, number> } & WearProps) => {
  const { def, state } = entry;
  const numeral = ROMAN[tier] ?? `${tier + 1}`;
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
        {entry.unlockedAt !== undefined && <Text style={styles.date}>{shortDate(entry.unlockedAt)}</Text>}
      </View>
    );
  }
  return (
    <View style={styles.tierRow}>
      <View style={[styles.tierChip, styles.tierChipLocked]}>
        <Text style={styles.tierChipTextLocked}>{numeral}</Text>
      </View>
      {/* Sits level with the numeral chip when it's a bare name; a
          progress bar underneath simply grows the column. */}
      <View style={[styles.copy, styles.copyLevel]}>
        <Text style={styles.tierTitleLocked}>{def.title}</Text>
        <LockedDescription def={def} style={styles.tierDescLocked} />
        {state === "frontier" && <ProgressBar def={def} counters={counters} />}
      </View>
    </View>
  );
};

/** An entrance: a quiet fade-and-rise on mount (rows arrive like entries
 * being penned, never pop). The stagger is capped so deep scrolling never
 * feels laggy. Native-driven. */
const Reveal = ({
  index,
  children,
  style,
  onLayout,
}: {
  index: number;
  children: ReactNode;
  style?: object;
  onLayout?: (e: LayoutChangeEvent) => void;
}) => {
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
      onLayout={onLayout}
      style={[
        style,
        {
          opacity: t,
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
};

const Block = ({ block, counters, worn, onWear, focused }: { block: CodexBlock; counters: Record<string, number>; focused: boolean } & WearProps) => {
  const body =
    block.kind === "single" ? (
      <HeadRow entry={block.entry} counters={counters} worn={worn} onWear={onWear} />
    ) : (
      <>
        <HeadRow entry={block.entries[0]!} counters={counters} worn={worn} onWear={onWear} />
        {/* The tier ladder: indented under a faint spine, numbered from II
            (the head is tier I). */}
        <View style={styles.tierBlock}>
          <View style={styles.tierSpine} />
          {block.entries.slice(1).map((entry, i) => (
            <TierRow key={entry.def.id} entry={entry} tier={i + 1} counters={counters} worn={worn} onWear={onWear} />
          ))}
        </View>
      </>
    );
  return <View style={[styles.block, focused && styles.blockFocused]}>{body}</View>;
};

// ── The shelf ──────────────────────────────────────────────────────────────

/** A chapter card: painted ramp + glow (forged art when it lands), the
 * chapter emblem ghosted large, the name, the tally bar, and the next-up
 * deed. A finished chapter wears a gilt frame. */
const ChapterCard = ({ chapter, onOpen }: { chapter: Chapter; onOpen: (id: string) => void }) => {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [pressed, setPressed] = useState(false);
  const art = chapterArt(chapter.id);
  const complete = chapter.total > 0 && chapter.done === chapter.total;
  const nextIcon = chapter.nextUp ? DEED_ICONS[chapter.nextUp.icon] : null;
  return (
    <Pressable
      onPress={() => onOpen(chapter.id)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={styles.cardFill}
    >
      <View
        style={[styles.card, complete && styles.cardComplete, pressed && styles.cardPressed]}
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {art.image !== null ? (
          <Image source={art.image} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} />
        ) : (
          box && (
            <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
              <Rect x={0} y={0} width={box.w} height={box.h}>
                <LinearGradient start={vec(0, box.h)} end={vec(box.w, 0)} colors={art.ramp} />
              </Rect>
              <Rect x={0} y={0} width={box.w} height={box.h}>
                <RadialGradient
                  c={vec(box.w * art.glowAt[0], box.h * art.glowAt[1])}
                  r={box.w * 0.6}
                  colors={[art.glow, "rgba(0,0,0,0)"]}
                />
              </Rect>
            </Canvas>
          )
        )}
        {art.image === null && chapter.icon != null && (
          <Image source={chapter.icon} resizeMode="contain" style={styles.cardEmblem} />
        )}
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
            {chapter.title.toUpperCase()}
          </Text>
          <View style={styles.cardTallyRow}>
            <View style={styles.cardBarTrack}>
              <View
                style={[
                  styles.cardBarFill,
                  complete && styles.cardBarFillComplete,
                  { width: `${Math.round((chapter.done / Math.max(1, chapter.total)) * 100)}%` },
                ]}
              />
            </View>
            <Text style={[styles.cardTally, complete && styles.cardTallyComplete]}>
              {complete ? "ALL" : `${chapter.done} / ${chapter.total}`}
            </Text>
          </View>
          {chapter.nextUp ? (
            <View style={styles.cardNext}>
              <View style={styles.cardNextWell}>
                {nextIcon != null && <Image source={nextIcon} style={styles.cardNextIcon} resizeMode="contain" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardNextLabel}>NEXT</Text>
                <Text style={styles.cardNextTitle} numberOfLines={1}>
                  {chapter.nextUp.title}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={styles.cardDone}>CHAPTER CLOSED</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
};

interface BandProps {
  earned: number;
  total: number;
  worn: string;
  titles: readonly TitleOption[];
  /** The nearest title-crowning deed still to earn — the hint when bare-handed. */
  firstTitleDeed: BitsAchievementDef | null;
  latest: { def: BitsAchievementDef; unlockedAt: number }[];
  nearly: { def: BitsAchievementDef; value: number; threshold: number }[];
  onPickTitle: () => void;
  onGoTo: (id: string) => void;
}

/** The celebration band — who you are here, before any chapter. */
const Band = ({ earned, total, worn, titles, firstTitleDeed, latest, nearly, onPickTitle, onGoTo }: BandProps) => {
  const wornDef = worn ? DEFS_BY_ID.get(worn) : undefined;
  const wornIcon = wornDef ? DEED_ICONS[wornDef.icon] : null;
  const hasTitles = titles.length > 0;
  return (
    <View style={styles.band}>
      <ScreenSign title="DEEDS" right={<Text style={styles.progress}>{`${earned} / ${total}`}</Text>} />

      {/* The worn title — the quick pick once you hold one. */}
      <Pressable onPress={hasTitles ? onPickTitle : undefined} disabled={!hasTitles}>
        <View style={[styles.titleSlot, hasTitles && styles.titleSlotLive]}>
          <View style={[styles.titleWell, wornDef && styles.titleWellOn]}>
            {wornIcon != null ? (
              <Image source={wornIcon} style={styles.titleIcon} resizeMode="contain" />
            ) : (
              <Text style={styles.titleWellGlyph}>✦</Text>
            )}
          </View>
          <View style={styles.copy}>
            {wornDef ? (
              <>
                <Text style={styles.titleLabel}>WEARING</Text>
                <Text style={styles.titleText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {wornDef.title}
                </Text>
              </>
            ) : hasTitles ? (
              <>
                <Text style={styles.titleLabel}>NO TITLE WORN</Text>
                <Text style={styles.titleHint}>{`${titles.length} earned — tap to wear one`}</Text>
              </>
            ) : (
              <>
                <Text style={styles.titleLabel}>NO TITLE YET</Text>
                <Text style={styles.titleHint}>
                  {firstTitleDeed
                    ? `Earn “${firstTitleDeed.title}” to wear a title under your name`
                    : "Deeds crown titles you wear under your name"}
                </Text>
              </>
            )}
          </View>
          {hasTitles && <Text style={styles.titleChevron}>›</Text>}
        </View>
      </Pressable>

      {latest.length > 0 && (
        <View style={styles.bandSection}>
          <Text style={styles.bandLabel}>LATEST DEEDS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.latestStrip}>
            {latest.map(({ def, unlockedAt }) => {
              const icon = DEED_ICONS[def.icon];
              return (
                <Pressable key={def.id} onPress={() => onGoTo(def.id)}>
                  <View style={styles.latestCard}>
                    <View style={styles.latestWell}>
                      {icon != null && <Image source={icon} style={styles.latestIcon} resizeMode="contain" />}
                    </View>
                    <Text style={styles.latestTitle} numberOfLines={2}>
                      {def.title}
                    </Text>
                    <Text style={styles.latestDate}>{shortDate(unlockedAt)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {nearly.length > 0 && (
        <View style={styles.bandSection}>
          <Text style={styles.bandLabel}>{latest.length > 0 ? "NEARLY THERE" : "WHERE TO START"}</Text>
          {nearly.map(({ def, value, threshold }) => {
            const icon = DEED_ICONS[def.icon];
            return (
              <Pressable key={def.id} onPress={() => onGoTo(def.id)}>
                <View style={styles.nearlyRow}>
                  <View style={[styles.iconWell, styles.iconWellLocked, styles.nearlyWell]}>
                    {icon != null && <Image source={icon} style={[styles.nearlyIcon, styles.iconGhost]} resizeMode="contain" />}
                  </View>
                  <View style={styles.copy}>
                    <Text style={styles.nearlyTitle} numberOfLines={1}>
                      {def.title}
                    </Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.round((value / threshold) * 100)}%` }]} />
                    </View>
                  </View>
                  <Text style={styles.nearlyCount}>{`${value} / ${threshold}`}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text style={[styles.bandLabel, styles.shelfLabel]}>THE CHRONICLE</Text>
    </View>
  );
};

/** Android back on a chapter page → the shelf (mounted only there, so it
 * outranks App's navigation handler — sheetGestures' newest-first rule). */
const ChapterBack = ({ onBack }: { onBack: () => void }) => {
  useBackClose(onBack);
  return null;
};

// ── The screen ─────────────────────────────────────────────────────────────

export const DeedsScreen = ({ onBack, onArmory }: DeedsScreenProps) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [me, setMe] = useState<AchievementsMe | null | "loading">("loading");
  const [replay, setReplay] = useState<string[] | null>(null);
  const [view, setView] = useState<View2>({ kind: "shelf" });
  const [titleSheet, setTitleSheet] = useState(false);
  // The worn title (deeds/wornTitle.ts) — mirrored into state so the pills
  // re-render; the module global is what the join path reads.
  const [worn, setWorn] = useState(getWornTitle());
  const onWear = (id: string): void => {
    playSound("uiTap");
    setWornTitle(worn === id ? "" : id); // tap the worn one → go bare
    setWorn(getWornTitle());
  };
  const onPickTitle = (id: string): void => {
    setWornTitle(id);
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

  const ready = me !== "loading" && me !== null;
  const unlocked = useMemo(() => new Set(ready ? me.unlocks.map((u) => u.id) : []), [me, ready]);
  const counters = ready ? me.counters : {};
  const unlockedAt = useMemo(() => {
    const map = new Map<string, number>();
    if (ready) for (const u of me.unlocks) map.set(u.id, u.unlockedAt);
    return map;
  }, [me, ready]);
  const vis = useMemo(() => visibility(ACHIEVEMENT_DEFS, unlocked), [unlocked]);
  const earnedCount = useMemo(() => ACHIEVEMENT_DEFS.filter((d) => unlocked.has(d.id)).length, [unlocked]);

  // Chapters → blocks: consecutive same-icon deeds form a CHAIN (head +
  // indented tier ladder); everything else is a lone entry.
  const chapters = useMemo<Chapter[]>(
    () =>
      ACHIEVEMENT_CHAPTERS.map((chapter) => {
        const blocks: CodexBlock[] = [];
        let run: TierEntry[] = [];
        const flushRun = (): void => {
          if (run.length === 0) return;
          if (run.length === 1) blocks.push({ kind: "single", key: run[0]!.def.id, entry: run[0]! });
          else blocks.push({ kind: "chain", key: run[0]!.def.id, entries: run });
          run = [];
        };
        let done = 0;
        let nextUp: BitsAchievementDef | null = null;
        let firstHidden: BitsAchievementDef | null = null;
        let icon: number | null = null;
        for (const id of chapter.ids) {
          const def = DEFS_BY_ID.get(id);
          if (!def) continue;
          if (icon === null) icon = DEED_ICONS[def.icon] ?? null;
          const state = vis.get(id)!;
          if (state === "unlocked") done += 1;
          else if (state === "frontier" && nextUp === null) nextUp = def;
          else if (state === "hidden" && firstHidden === null) firstHidden = def;
          const entry: TierEntry = { def, state, unlockedAt: unlockedAt.get(id) };
          if (run.length > 0 && run[run.length - 1]!.def.icon !== def.icon) flushRun();
          run.push(entry);
        }
        flushRun();
        return {
          id: chapter.id,
          title: chapter.title,
          done,
          total: chapter.ids.length,
          icon,
          nextUp: nextUp ?? firstHidden,
          data: blocks,
        };
      }),
    [vis, unlockedAt],
  );

  // The band's ingredients.
  const titles = useMemo<TitleOption[]>(
    () =>
      ACHIEVEMENT_DEFS.filter((d) => unlocked.has(d.id) && crownsTitle(d)).map((d) => ({
        id: d.id,
        title: d.title,
        icon: DEED_ICONS[d.icon] ?? null,
        chapter: CHAPTER_OF.get(d.id)?.title ?? "",
      })),
    [unlocked],
  );
  const firstTitleDeed = useMemo(
    () => ACHIEVEMENT_DEFS.find((d) => crownsTitle(d) && vis.get(d.id) === "frontier") ?? null,
    [vis],
  );
  const latest = useMemo(
    () =>
      latestUnlocks(ready ? me.unlocks : [], LATEST_LIMIT)
        .map((u) => ({ def: DEFS_BY_ID.get(u.id), unlockedAt: u.unlockedAt }))
        .filter((u): u is { def: BitsAchievementDef; unlockedAt: number } => u.def !== undefined),
    [me, ready],
  );
  const nearly = useMemo(() => nearlyThere(ACHIEVEMENT_DEFS, vis, counters, NEARLY_LIMIT), [vis, counters]);

  const openChapter = (id: string, focus?: string): void => {
    playSound("uiConfirm");
    setView({ kind: "chapter", id, focus });
  };
  const goTo = (deedId: string): void => {
    const chapter = CHAPTER_OF.get(deedId);
    if (chapter) openChapter(chapter.id, deedId);
  };
  const toShelf = (): void => {
    playSound("uiBack");
    setView({ kind: "shelf" });
  };

  const current = view.kind === "chapter" ? chapters.find((c) => c.id === view.id) ?? null : null;

  // Focus: land the tapped deed's block near the top of the chapter page.
  //
  // A chapter is 1–17 blocks, so the page is a plain ScrollView with every
  // block mounted — NOT a FlatList (Tom, 2026-09-11: "I pressed Tidecaller
  // and it didn't come into view", the last block of its chapter).
  // Virtualized, the aim depended on whether the target happened to be
  // rendered and measured yet: a miss fell back to an average row height,
  // and a single row versus a five-tier ladder differ several-fold, so deep
  // deeds landed in the right neighbourhood and no further. Here each block
  // reports its own `y` through onLayout and the scroll goes to a MEASURED
  // offset, re-aimed whenever that block or the viewport is measured again
  // (art loading, fonts, rotation) until the player takes the scroll over.
  const scrollRef = useRef<ScrollView>(null);
  const blockTops = useRef(new Map<number, number>());
  const viewportH = useRef(0);
  const contentH = useRef(0);
  const pendingFocus = useRef<number | null>(null);
  const focusIndex =
    current && view.kind === "chapter" && view.focus
      ? current.data.findIndex((b) => (b.kind === "single" ? b.entry.def.id === view.focus : b.entries.some((e) => e.def.id === view.focus)))
      : -1;
  /** Aim, once the pieces of the sum have been measured. The last block of
   * a chapter can't sit at FOCUS_VIEW_POSITION — there isn't that much page
   * below it — so the target is clamped to the bottom of the content and it
   * lands lower, fully in view, rather than overscrolling and bouncing. */
  const aimAtFocus = (): void => {
    const index = pendingFocus.current;
    if (index === null) return;
    const top = blockTops.current.get(index);
    if (top === undefined || viewportH.current === 0) return;
    const wanted = Math.max(0, top - viewportH.current * FOCUS_VIEW_POSITION);
    // Content height arrives on its own beat; until it does, aim unclamped
    // and let onContentSizeChange re-aim.
    const y = contentH.current > 0 ? Math.min(wanted, Math.max(0, contentH.current - viewportH.current)) : wanted;
    scrollRef.current?.scrollTo({ y, animated: false });
  };
  // Measurements belong to one chapter's blocks — drop them when the page
  // changes. Declared FIRST so a chapter switch clears before the aim below
  // can read a stale `y` from the chapter we just left.
  useEffect(() => {
    blockTops.current.clear();
    contentH.current = 0;
  }, [current?.id]);
  useEffect(() => {
    pendingFocus.current = focusIndex > 0 ? focusIndex : null;
    // A chapter already on screen is already measured; a fresh one aims
    // from its blocks' onLayout instead. The viewport height is the screen's
    // and survives either way.
    aimAtFocus();
  }, [focusIndex, view]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      {/* the candlelight — rising gold embers (shared with the Primer) */}
      <Embers w={width} h={height} count={16} seed={7} />
      <ScreenHeader
        style={styles.header}
        onBack={() => {
          if (view.kind === "chapter") toShelf();
          else {
            playSound("uiBack");
            onBack();
          }
        }}
        onPurse={() => {
          playSound("uiTap");
          onArmory();
        }}
      />
      {!ready ? (
        <View style={styles.centre}>
          <Text style={styles.note}>
            {me === "loading"
              ? "Unrolling the chronicle…"
              : "The chronicle needs the arena account service — check your connection and come back."}
          </Text>
        </View>
      ) : current ? (
        <>
          <ChapterBack onBack={toShelf} />
          <ScrollView
            key={current.id}
            ref={scrollRef}
            onLayout={(e) => {
              viewportH.current = e.nativeEvent.layout.height;
              aimAtFocus();
            }}
            onContentSizeChange={(_w, h) => {
              contentH.current = h;
              aimAtFocus();
            }}
            // The player's own scroll wins: one drag and we stop re-aiming.
            onScrollBeginDrag={() => {
              pendingFocus.current = null;
            }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 32, paddingHorizontal: 20 }}
            showsVerticalScrollIndicator={false}
          >
            <ScreenSign
              title={current.title.toUpperCase()}
              right={<Text style={styles.progress}>{`${current.done} / ${current.total}`}</Text>}
              style={styles.chapterSign}
            />
            {current.data.map((block, index) => (
              <Reveal
                key={block.key}
                index={index}
                // Measured against the content, not the screen — Reveal's
                // own rise is a transform and never moves this.
                onLayout={(e) => {
                  blockTops.current.set(index, e.nativeEvent.layout.y);
                  if (index === pendingFocus.current) aimAtFocus();
                }}
              >
                <Block
                  block={block}
                  counters={counters}
                  worn={worn}
                  onWear={onWear}
                  focused={view.kind === "chapter" && view.focus !== undefined && index === focusIndex}
                />
              </Reveal>
            ))}
          </ScrollView>
        </>
      ) : (
        <FlatList
          data={chapters}
          keyExtractor={(c) => c.id}
          numColumns={2}
          columnWrapperStyle={styles.shelfRow}
          ListHeaderComponent={
            <Band
              earned={earnedCount}
              total={ACHIEVEMENT_DEFS.length}
              worn={worn}
              titles={titles}
              firstTitleDeed={firstTitleDeed}
              latest={latest}
              nearly={nearly}
              onPickTitle={() => {
                playSound("uiTap");
                setTitleSheet(true);
              }}
              onGoTo={goTo}
            />
          }
          renderItem={({ item, index }) => (
            <Reveal index={index} style={styles.cardSlot}>
              <ChapterCard chapter={item} onOpen={(id) => openChapter(id)} />
            </Reveal>
          )}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32, paddingHorizontal: 20 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {titleSheet && (
        <TitleSheet titles={titles} worn={worn} onPick={onPickTitle} onClose={() => setTitleSheet(false)} />
      )}
      {replay && <DeedReplayOverlay deeds={replay} onDone={() => setReplay(null)} />}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210" },
  header: { paddingHorizontal: 20 },
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

  // ── the band ──
  band: { marginBottom: 6 },
  bandSection: { marginTop: 18 },
  bandLabel: { color: "#8a6d44", fontSize: 11, fontWeight: "900", letterSpacing: 3, marginBottom: 10 },
  shelfLabel: { marginTop: 26, marginBottom: 4 },
  titleSlot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2e2820",
    backgroundColor: "#1a1611",
  },
  titleSlotLive: { borderColor: "#5a4c38", backgroundColor: "#1d1913" },
  titleWell: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#221c14",
    borderWidth: 1,
    borderColor: "#3a3126",
    alignItems: "center",
    justifyContent: "center",
  },
  titleWellOn: { borderColor: "#b3925e" },
  titleIcon: { width: 46, height: 46 },
  titleWellGlyph: { color: "#4a4034", fontSize: 22 },
  titleLabel: { color: "#8a7f70", fontSize: 10, fontWeight: "900", letterSpacing: 2.5 },
  titleText: { fontFamily: DISPLAY_FONT, color: "#e8c87a", fontSize: 20, letterSpacing: 1.5, marginTop: 2 },
  titleHint: { color: "#a89a83", fontSize: 12, lineHeight: 16, marginTop: 3 },
  titleChevron: { color: "#8a6d44", fontSize: 26, fontWeight: "800", marginRight: 4 },

  latestStrip: { gap: 10, paddingRight: 20 },
  latestCard: {
    width: 104,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3a3126",
    backgroundColor: "#1d1913",
    alignItems: "center",
    gap: 6,
  },
  latestWell: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: "#221c14",
    alignItems: "center",
    justifyContent: "center",
  },
  latestIcon: { width: 46, height: 46 },
  latestTitle: { fontFamily: DISPLAY_FONT, color: "#e8d9b8", fontSize: 11, letterSpacing: 0.5, textAlign: "center", minHeight: 30 },
  latestDate: { color: "#5a4c38", fontSize: 9, fontWeight: "800", letterSpacing: 1 },

  nearlyRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  nearlyWell: { width: 40, height: 40, borderRadius: 8 },
  nearlyIcon: { width: 32, height: 32 },
  nearlyTitle: { fontFamily: DISPLAY_FONT, color: "#c9b891", fontSize: 13, letterSpacing: 1 },
  nearlyCount: { color: "#8a7f70", fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"], minWidth: 54, textAlign: "right" },

  // ── the shelf ──
  shelfRow: { gap: 12 },
  cardSlot: { flex: 1, marginBottom: 12 },
  cardFill: { flex: 1 },
  card: {
    height: 168,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#5a4c38",
    overflow: "hidden",
    backgroundColor: "#1d1712",
  },
  cardComplete: { borderColor: "#d99a41", borderWidth: 1.5 },
  cardPressed: { transform: [{ scale: 0.98 }] },
  cardEmblem: { position: "absolute", right: -14, top: -10, width: 96, height: 96, opacity: 0.16 },
  cardCopy: { flex: 1, justifyContent: "flex-end", padding: 12, gap: 6 },
  cardTitle: {
    fontFamily: DISPLAY_FONT,
    color: "#f5ede0",
    fontSize: 15,
    letterSpacing: 2,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  cardTallyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardBarTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(0,0,0,0.45)", overflow: "hidden" },
  cardBarFill: { height: 3, borderRadius: 2, backgroundColor: "#a8854f" },
  cardBarFillComplete: { backgroundColor: "#d99a41" },
  cardTally: { color: "#c9b891", fontSize: 10, fontWeight: "900", letterSpacing: 1, fontVariant: ["tabular-nums"] },
  cardTallyComplete: { color: "#d99a41" },
  cardNext: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  cardNextWell: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardNextIcon: { width: 22, height: 22, opacity: 0.6 },
  cardNextLabel: { color: "#8a7f70", fontSize: 8, fontWeight: "900", letterSpacing: 2 },
  cardNextTitle: { fontFamily: DISPLAY_FONT, color: "#e8d9b8", fontSize: 11, letterSpacing: 0.5 },
  cardDone: { color: "#d99a41", fontSize: 9, fontWeight: "900", letterSpacing: 2, marginTop: 2 },

  // ── the chapter page ──
  chapterSign: { marginBottom: 8 },
  /** A chain (or lone deed) is one block — real air between blocks so a
   * head never crowds the previous family's tail. */
  block: { marginBottom: 26, borderRadius: 12, marginHorizontal: -8, padding: 8 },
  blockFocused: { backgroundColor: "rgba(232,200,122,0.06)" },
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
  tierChipLocked: { backgroundColor: "#1a1611", borderColor: "#4a3f30" },
  tierChipText: { fontFamily: DISPLAY_FONT, color: "#e8c87a", fontSize: 12 },
  tierChipTextLocked: { fontFamily: DISPLAY_FONT, color: "#8a7f70", fontSize: 12 },
  tierTitle: { fontFamily: DISPLAY_FONT, color: "#e8d9b8", fontSize: 13, letterSpacing: 1 },
  tierTitleLocked: { fontFamily: DISPLAY_FONT, color: "#8a7f70", fontSize: 13, letterSpacing: 1 },
  tierDesc: { color: "#a89a83", fontSize: 11, lineHeight: 15 },
  tierDescLocked: { color: "#7a6f60", fontSize: 11, lineHeight: 15 },
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
  iconWellLocked: { backgroundColor: "#1a1611", borderColor: "#2e2820" },
  icon: { width: 42, height: 42 },
  iconGhost: { opacity: 0.35 },
  copy: { flex: 1, gap: 3 },
  copyLevel: { minHeight: 30, justifyContent: "center" },
  title: { fontFamily: DISPLAY_FONT, color: "#e8d9b8", fontSize: 15, letterSpacing: 1 },
  titleLocked: { fontFamily: DISPLAY_FONT, color: "#8a7f70", fontSize: 15, letterSpacing: 1 },
  desc: { color: "#a89a83", fontSize: 12, lineHeight: 17 },
  descLocked: { color: "#7a6f60", fontSize: 12, lineHeight: 17 },
  descSecret: { fontStyle: "italic" },
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
