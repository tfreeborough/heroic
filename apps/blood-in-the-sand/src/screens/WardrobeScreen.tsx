/**
 * The wardrobe (bits-cosmetics.md § F2) — where you put a cosmetic on.
 * Its own place on purpose (Tom, 2026-09-19): cosmetics are set-and-forget,
 * the War Table is per-match, and the Armory never shows what you own.
 *
 * Laid out for three slots — finisher, blood, trail — but only FINISHER has
 * shipped, so only it is drawn: no "coming soon" shelves.
 *
 *  - The hero is a poster with a real match playing in it (FinisherPoster →
 *    the scripted kill): an archer drops a foe and what you wear plays over
 *    the body, blood and all. Finishers can't be tried in practice, so this
 *    is where an owner SEES what they're wearing. It is the screen's ONE
 *    live preview (the renderer allows one); tiles are stills.
 *  - Tiles: NONE + every finisher you OWN; tap to wear. It's a claim the
 *    server re-checks at every seat (wornFinisher.ts), so this screen trusts
 *    the local entitlement cache and nothing worse than "bare" can follow.
 *  - The earned one shows locked until it's yours, naming its deed — the
 *    free player's taste. Unbought ones are NOT listed; that's the Armory's
 *    job, one quiet door away.
 */
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ACHIEVEMENT_DEFS,
  DEED_FINISHERS,
  FINISHER_IDS,
  FINISHER_NONE,
  finisherEntitlement,
  ownableFinisher,
  type BitsAchievementDef,
  type FinisherId,
  type OwnableFinisherId,
} from "@heroic/blood-in-the-sand-sim";
import { playSound, unlockAudio } from "../audio";
import { FinisherPoster } from "../components/FinisherPoster";
import { FinisherTile } from "../components/FinisherTile";
import { ScreenHeader, ScreenSign } from "../components/ScreenHeader";
import { getEntitlements } from "../deeds/entitlements";
import { getWornFinisher, setWornFinisher } from "../deeds/wornFinisher";
import { FINISHER_CATALOGUE } from "../game/finisherStage";
import { playStrikeHaptic } from "../game/haptics";
import { C_GOLD, C_MUTED } from "../loadout/catalogue";
import { tileTextStyles } from "../loadout/ItemTile";

/** Working names — Tom's pass (bits-cosmetics.md § open questions). */
export const WARDROBE_NAME = "WARDROBE";

export interface WardrobeScreenProps {
  onBack: () => void;
  /** The header purse and the "more" door → the Armory. */
  onArmory: () => void;
  /** The locked earnable's tile → the deeds board. */
  onDeeds: () => void;
}

/** The deed that pays an item, for the locked tile's "how". */
const deedPaying = (itemId: string): BitsAchievementDef | undefined =>
  ACHIEVEMENT_DEFS.find((d) => (d.rewards ?? []).some((r) => r.kind === "entitlement" && r.itemId === itemId));

export const WardrobeScreen = ({ onBack, onArmory, onDeeds }: WardrobeScreenProps) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [worn, setWorn] = useState<FinisherId>(getWornFinisher());

  const { owned, earnable } = useMemo(() => {
    const entitled = getEntitlements();
    const ids = FINISHER_IDS.map(ownableFinisher).filter((id): id is OwnableFinisherId => id !== null);
    return {
      owned: ids.filter((id) => entitled.has(finisherEntitlement(id))),
      earnable: ids.filter((id) => DEED_FINISHERS.has(id) && !entitled.has(finisherEntitlement(id))),
    };
  }, []);
  // A worn finisher the cache no longer vouches for (a dev DB reset, another
  // device's purchase not synced yet) still shows as worn — the server is
  // the referee, and hiding it would make it impossible to take off.
  const tiles: FinisherId[] = [FINISHER_NONE, ...owned, ...(worn !== FINISHER_NONE && !owned.includes(worn) ? [worn] : [])];

  const wear = (id: FinisherId): void => {
    unlockAudio();
    if (id === worn) return;
    playSound(id === FINISHER_NONE ? "uiBack" : "uiConfirm");
    playStrikeHaptic("soft");
    setWornFinisher(id);
    setWorn(id);
  };

  // Tall on purpose: the preview runs at the match's own zoom, and a match
  // is a portrait thing — but never so tall the tiles fall off a small phone.
  const heroW = width - 40;
  const heroH = Math.round(Math.min(heroW * 1.02, height * 0.44));
  const tileW = Math.floor((width - 40 - 18) / 3);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <ScreenHeader onBack={onBack} onPurse={onArmory} />
      <ScreenSign title={WARDROBE_NAME} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        {/* The hero: what you're wearing, played for you in a real match. */}
        <FinisherPoster id={worn} width={heroW} height={heroH} live sound eyebrow={worn === FINISHER_NONE ? "WEARING" : "WORN"} />

        <Text style={styles.slotTitle}>FINISHER</Text>
        <View style={styles.grid}>
          {tiles.map((id) => (
            <FinisherTile
              key={id}
              id={id}
              width={tileW}
              current={id === worn}
              onPress={() => wear(id)}
              sub={<Text style={tileTextStyles.sub}>{id === worn ? "WORN" : id === FINISHER_NONE ? "GO BARE" : "WEAR"}</Text>}
            />
          ))}
          {earnable.map((id) => {
            const deed = deedPaying(finisherEntitlement(id));
            return (
              <FinisherTile
                key={id}
                id={id}
                width={tileW}
                locked
                onPress={() => {
                  unlockAudio();
                  playSound("uiTap");
                  onDeeds();
                }}
                sub={<Text style={tileTextStyles.sub}>{deed ? "EARNED · DEEDS ›" : "EARNED"}</Text>}
              />
            );
          })}
        </View>
        {earnable.map((id) => {
          const deed = deedPaying(finisherEntitlement(id));
          return deed ? (
            <Text key={id} style={styles.earnLine}>
              {`${FINISHER_CATALOGUE[id].name} is earned, not sold: the “${deed.title}” deed. ${deed.description}`}
            </Text>
          ) : null;
        })}

        <Text style={styles.footNote}>What you wear is set when you take your seat, so a change shows from your next match.</Text>
        <Pressable
          onPress={() => {
            unlockAudio();
            playSound("uiConfirm");
            onArmory();
          }}
          style={styles.armoryDoor}
          hitSlop={8}
        >
          <Text style={styles.armoryDoorText}>More in the Armory ›</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingHorizontal: 20 },
  scroll: { gap: 14 },
  slotTitle: { color: C_MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 3, marginTop: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  earnLine: { color: "#a08a55", fontSize: 11.5, lineHeight: 17 },
  footNote: { color: "#8a8071", fontSize: 11, lineHeight: 16, marginTop: 6 },
  armoryDoor: { alignSelf: "flex-start", paddingVertical: 6 },
  armoryDoorText: { color: C_GOLD, fontSize: 13, fontWeight: "800", letterSpacing: 0.4 },
});
