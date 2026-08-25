/**
 * The one header every menu screen wears (Tom, 2026-08-22: the Armory showed
 * Glory + Signets, the mode select Glory + an account ring, Deeds a count,
 * Settings a big red title — four vocabularies across seven screens). Now:
 *
 *   ‹                                            ◆ 1,240 · ◉ 2  ○
 *
 * Left: the bare back chevron. Right: the purse — Glory AND Signets, always
 * both once the wallet answers (a pair of numbers reads as "a wallet"; a lone
 * Glory number reads as "a score", and the pair teaches the second currency
 * exists before the player ever reaches the Armory). Beside it, only while
 * accounts are on and this player is UNLINKED, the restore door: an empty
 * signet ring — a seal not yet pressed — into sign-in without buying
 * anything ("new device, give me my armory"). Linked players see nothing:
 * signed-in is the quiet state.
 *
 * Between them, only while the ranked queue is running: the queue pill
 * (`IN QUEUE · 1:23`, QueueContext) — the queue follows the player around
 * the app since 2026-08-25, and this is how every screen shows it and
 * offers the way back. RankedScreen opts out (`queuePill={false}`): its
 * SEARCHING line already says it.
 *
 * No page name in the bar. A screen that wants one puts a `ScreenSign` as
 * its first content row (Deeds: name + earned count; Settings: its name) —
 * the bar is navigation + wallet and nothing else, so it never fights the
 * page for attention.
 *
 * The purse is a DOOR, not a readout: `onPurse` (normally → the Armory)
 * makes it tappable everywhere but the Armory itself. Two ways to feed it:
 * uncontrolled (default) fetches the wallet itself via useWalletInfo, with
 * the api.ts rule — renders NOTHING until a real number arrives, never a
 * loading/error state the player didn't ask for; or pass `wallet` and the
 * bar becomes a controlled readout for a screen that already owns the live
 * balance (the Armory, where purchases move it).
 */
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useWalletInfo, type Wallet } from "../net/api";
import { CLERK_PUBLISHABLE_KEY } from "../net/account";
import { DISPLAY_FONT } from "../typography";
import { AccountSheet } from "./AccountSheet";
import { QueuePill } from "./QueueContext";

export interface ScreenHeaderProps {
  onBack: () => void;
  /** The purse as a door (→ Armory). Omit for an inert readout. */
  onPurse?: () => void;
  /**
   * Controlled wallet — the screen owns the live balance. Omit and the
   * header fetches its own. `null` = controlled but not yet answered (the
   * purse stays hidden, same as uncontrolled-before-answer).
   */
  wallet?: Wallet | null;
  /**
   * A sign-in landed through the restore door. Uncontrolled headers refetch
   * by themselves; controlled ones MUST refresh their own wallet here
   * (adoption changes the identity under every balance). `adopted` = the
   * link took over another player's ledger.
   */
  onLinked?: (adopted: boolean) => void;
  /** Extra horizontal padding so the bar lands 20pt from the screen edge
   * regardless of what the screen's root already pads. */
  style?: StyleProp<ViewStyle>;
  /** The queued pill between chevron and purse (default on). */
  queuePill?: boolean;
}

export const ScreenHeader = ({ onBack, onPurse, wallet, onLinked, style, queuePill = true }: ScreenHeaderProps) => (
  <View style={[styles.bar, style]}>
    <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
      <Text style={styles.backText}>‹</Text>
    </Pressable>
    <View style={styles.middle}>{queuePill ? <QueuePill /> : null}</View>
    {wallet === undefined ? (
      <LivePurse onPress={onPurse} onLinked={onLinked} />
    ) : (
      <Purse wallet={wallet} onPress={onPurse} onLinked={onLinked} />
    )}
  </View>
);

/** Uncontrolled purse: owns its own wallet fetch. Split from Purse so the
 * controlled path never runs a second, competing fetch. */
const LivePurse = ({ onPress, onLinked }: { onPress?: () => void; onLinked?: (adopted: boolean) => void }) => {
  const { wallet, refresh } = useWalletInfo();
  return (
    <Purse
      wallet={wallet}
      onPress={onPress}
      onLinked={(adopted) => {
        refresh();
        onLinked?.(adopted);
      }}
    />
  );
};

/**
 * The purse proper: Glory · Signets in one pill, the restore door beside it.
 * Exported for the odd place that wants the wallet without the bar.
 */
export const Purse = ({
  wallet,
  onPress,
  onLinked,
}: {
  wallet: Wallet | null;
  onPress?: () => void;
  onLinked?: (adopted: boolean) => void;
}) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  if (wallet === null) return null;
  const body = (
    <>
      <View style={styles.gloryGem} />
      <Text style={styles.purseText}>{wallet.glory.toLocaleString()}</Text>
      <View style={styles.purseDivider} />
      <View style={styles.signetSeal} />
      <Text style={styles.purseText}>{wallet.signets}</Text>
    </>
  );
  // Server flag AND shipped client key — AccountSheet's Clerk hooks only
  // exist under the provider App.tsx mounts when the key is present.
  const door = wallet.accounts && !wallet.linked && CLERK_PUBLISHABLE_KEY.length > 0;
  return (
    <View style={styles.purseRow}>
      {onPress ? (
        <Pressable onPress={onPress} hitSlop={8} style={styles.pill}>
          {body}
        </Pressable>
      ) : (
        <View style={styles.pill} pointerEvents="none">
          {body}
        </View>
      )}
      {door ? (
        <Pressable onPress={() => setSheetOpen(true)} hitSlop={10} style={styles.door}>
          <View style={styles.doorRing} />
        </Pressable>
      ) : null}
      {sheetOpen ? (
        <AccountSheet
          mode="restore"
          onClose={() => setSheetOpen(false)}
          onLinked={(adopted) => {
            setSheetOpen(false);
            onLinked?.(adopted);
          }}
        />
      ) : null}
    </View>
  );
};

/**
 * The demoted page name: a screen's first content row, under the bar. The
 * display face, letter-spaced, bone-white — a sign over the door, not a
 * heading shouting from the bar. `right` is the sign's one companion slot
 * (Deeds' earned count, the room list's JOIN BY CODE).
 */
export const ScreenSign = ({ title, right, style }: { title: string; right?: ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[styles.sign, style]}>
    <Text style={styles.signText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
      {title}
    </Text>
    {right}
  </View>
);

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 14,
  },
  back: { width: 44, paddingVertical: 2 },
  middle: { flex: 1, alignItems: "center" },
  backText: { color: "#8a7f70", fontSize: 26, fontWeight: "800", lineHeight: 28 },

  purseRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderColor: "rgba(138,109,68,0.75)",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: "rgba(30,24,16,0.72)",
  },
  purseText: { color: "#e8c87a", fontSize: 11, fontWeight: "800", letterSpacing: 1, fontVariant: ["tabular-nums"] },
  purseDivider: { width: 1, height: 10, backgroundColor: "rgba(138,109,68,0.5)" },
  // The brand's rationed red, spent on one more small place.
  gloryGem: { width: 6, height: 6, backgroundColor: "#8c2f2f", transform: [{ rotate: "45deg" }] },
  // The Signet's mark: a wax dot in a gold ring — the seal before it breaks.
  signetSeal: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#e8c87a",
    backgroundColor: "#7e2020",
  },
  // The restore door: an empty signet ring — a seal not yet pressed.
  door: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderColor: "rgba(138,109,68,0.75)",
    borderWidth: 1,
    backgroundColor: "rgba(30,24,16,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  doorRing: {
    width: 10,
    height: 10,
    borderRadius: 5.5,
    borderWidth: 1.5,
    borderColor: "#e8c87a",
  },

  sign: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  signText: {
    flexShrink: 1,
    fontFamily: DISPLAY_FONT,
    color: "#e8d9b8",
    fontSize: 20,
    letterSpacing: 4,
  },
});
