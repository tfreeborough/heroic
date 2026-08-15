/**
 * The codex CONTENT block — flavour quote, hint line, then weapon stat bars
 * or ability chips. Extracted from the War Table's codex sheet (RoomScreen)
 * so the Armory's item sheet renders the identical card body
 * (bits-store.md: one codex, two doors) — the wrapping sheet/CTA stays each
 * screen's own.
 */
import { StyleSheet, Text, View } from "react-native";
import type { AbilityId, WeaponId } from "@heroic/blood-in-the-sand-sim";
import { ABILITY_CODEX, C_BONE, C_GOLD, C_MUTED, WEAPON_CODEX, weaponBars } from "./catalogue";
import type { IconId } from "./icons";

export const CodexBody = ({ id, isWeapon }: { id: IconId; isWeapon: boolean }) =>
  isWeapon ? (
    <>
      <Text style={styles.cardQuote}>{`“${WEAPON_CODEX[id as WeaponId].quote}”`}</Text>
      <Text style={styles.cardHint}>{WEAPON_CODEX[id as WeaponId].hint}</Text>
      <View style={styles.bars}>
        {weaponBars(id as WeaponId).map((bar) => (
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
  ) : (
    <>
      <Text style={styles.cardQuote}>{`“${ABILITY_CODEX[id as AbilityId].quote}”`}</Text>
      <Text style={styles.cardHint}>{ABILITY_CODEX[id as AbilityId].hint}</Text>
      <View style={styles.chips}>
        {ABILITY_CODEX[id as AbilityId].chips.slice(0, 4).map((chip) => (
          <View key={chip.label} style={styles.chip}>
            <Text style={styles.chipLabel}>{chip.label}</Text>
            <Text style={styles.chipValue}>{chip.value}</Text>
          </View>
        ))}
      </View>
    </>
  );

const styles = StyleSheet.create({
  cardQuote: {
    color: "#c9bfae",
    fontSize: 11.5,
    lineHeight: 16,
    fontStyle: "italic",
    marginTop: 8,
  },
  cardHint: { color: C_MUTED, fontSize: 10, marginTop: 4 },
  bars: { alignSelf: "stretch", marginTop: 10, gap: 5 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { width: 46, color: C_MUTED, fontSize: 8, fontWeight: "800", letterSpacing: 1.2 },
  barTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "#16130f", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3, backgroundColor: C_GOLD },
  barValue: { width: 52, textAlign: "right", color: C_BONE, fontSize: 9, fontWeight: "700", fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 10 },
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
});
