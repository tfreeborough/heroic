// The level-up talent pick — a transparent modal over the frozen Game (the
// Pause mechanism: being on top unfocuses the Game, whose pausedRef stops the
// sim). Everything derives live from CharacterContext, never route params:
// picks chain when a kill grants several levels, so after each pick the same
// mounted screen recomputes the next pick's level and offers. The offers are
// seeded per character + pick level (core), so backing out, restarting the
// app, or reopening always shows the same three cards.

import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  CLASSES,
  computeEffectiveStats,
  nextOffers,
  nextPickLevel,
  pendingPicks,
  talentModifierSources,
  type TalentRarity,
} from "@heroic/core";
import type { RootStackParamList } from "../navigation/types";
import { useCharacter } from "../character/CharacterContext";
import { IMPLEMENTED_TALENT_HANDLERS } from "../game/talentHandlers";
import { UI } from "../ui/theme";

// Rarity dressing (talent-catalogue.md): one colour language with equipment.
// Capstone tiers dress gold regardless of chain rarity. Wave D adds the full
// treatment (glow, deal-in, stings); this is the minimum legible version.
const RARITY_BORDER: Record<TalentRarity, string> = {
  common: UI.panelBorder,
  rare: "#4d8fd1",
  epic: "#9a6fd8",
};
const CAPSTONE_GOLD = UI.accent;

type Props = NativeStackScreenProps<RootStackParamList, "TalentPick">;

export const TalentPickScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const { active, takeTalent } = useCharacter();

  const owed = active ? pendingPicks(active.level, active.talents.length) : 0;

  // The single dismissal path: when nothing is owed (last pick taken, or a
  // stale open), pop back to the frozen run. An effect, not render-time
  // navigation; the focus guard stops a double pop. Card presses only mutate
  // the record — takeTalent no-ops once picks run out, so a double-tap can't
  // over-take, and this effect fires exactly once when owed hits zero.
  useEffect(() => {
    if (owed === 0 && navigation.isFocused()) navigation.goBack();
  }, [owed, navigation]);

  if (!active || owed === 0) return null;

  const pickLevel = nextPickLevel(active.talents.length);
  // Luck nudges Rare+ offer odds — read off the same effective-stat pipeline
  // combat uses, so Fortune tiers and (later) gear luck count immediately.
  const klass = CLASSES[active.classId];
  const eff = computeEffectiveStats(klass.base, active.level, talentModifierSources(active.talents));
  const offers = nextOffers({
    characterId: active.id,
    talents: active.talents,
    weights: klass.offerWeights,
    luck: eff.luck,
    implementedHandlers: IMPLEMENTED_TALENT_HANDLERS,
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.titleBlock}>
        <Text style={styles.kicker}>Level {pickLevel}</Text>
        <Text style={styles.title}>Choose a Talent</Text>
        {owed > 1 && <Text style={styles.queued}>{owed} picks waiting</Text>}
      </View>

      <View style={styles.cards}>
        {offers.map((tier) => {
          const border = tier.capstone ? CAPSTONE_GOLD : RARITY_BORDER[tier.rarity];
          return (
            <Pressable
              key={tier.id}
              onPress={() => takeTalent(tier.id)}
              style={({ pressed }) => [styles.card, { borderColor: border }, pressed && styles.cardPressed]}
            >
              <Text style={[styles.cardLabel, tier.capstone && { color: CAPSTONE_GOLD }]}>
                {tier.label}
              </Text>
              <Text style={styles.cardDesc}>{tier.description}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // The Pause scrim: the frozen run stays visible underneath.
  root: {
    flex: 1,
    backgroundColor: "rgba(8, 10, 14, 0.9)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  titleBlock: {
    alignItems: "center",
    marginBottom: 28,
  },
  kicker: {
    fontFamily: UI.font,
    color: UI.accent,
    fontSize: 18,
    letterSpacing: 2,
    marginBottom: 4,
  },
  title: {
    fontFamily: UI.font,
    color: UI.text,
    fontSize: 34,
  },
  queued: {
    color: UI.textDim,
    fontSize: 13,
    marginTop: 6,
  },
  cards: {
    gap: 14,
  },
  card: {
    backgroundColor: UI.panel,
    borderColor: UI.panelBorder,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 22,
  },
  cardPressed: {
    borderColor: UI.accent,
    opacity: 0.85,
  },
  cardLabel: {
    fontFamily: UI.font,
    color: UI.text,
    fontSize: 22,
  },
  cardDesc: {
    color: UI.textDim,
    fontSize: 13.5,
    marginTop: 2,
  },
});
