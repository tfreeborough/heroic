/**
 * The loadout bottom sheet (design iterated with Tom via the HTML mock,
 * 2026-07-12): weapon grid or category-grouped ability grid with a 3-slot
 * TRAY pinned on top (tap a card → next free slot; tap a tray slot → clear;
 * list dims at 3/3), and a per-item "?" codex — quote → brief overview →
 * stat bars / raw effect chips, all copy from catalogue.ts (no counterplay
 * prose, numbers derived from sim config where they exist there).
 *
 * Deliberately self-contained: an absolutely-positioned overlay + RN Animated
 * slide, no Modal (a second native root fights gesture-handler on Android).
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  ABILITIES,
  LOADOUT_ABILITY_COUNT,
  WEAPONS,
  WEAPON_IDS,
  type AbilityCategory,
  type AbilityId,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";
import {
  ABILITY_CODEX,
  abilitiesByCategory,
  categoryOf,
  CATEGORY_META,
  C_BONE,
  C_GOLD,
  C_MUTED,
  WEAPON_CODEX,
  weaponBars,
  weaponChips,
  type CodexChip,
} from "./catalogue";
import { LoadoutIcon, type IconId } from "./icons";

export type SheetMode = "weapon" | "ability";

export interface LoadoutSheetProps {
  mode: SheetMode;
  weapon: WeaponId | null;
  abilities: AbilityId[];
  onPickWeapon: (weapon: WeaponId) => void;
  /** The full hand each change (idempotent — mirrors the wire message). */
  onPickAbilities: (abilities: AbilityId[]) => void;
  onClose: () => void;
}

const SLIDE_MS = 260;

export const LoadoutSheet = (props: LoadoutSheetProps) => {
  const { mode, weapon, abilities, onPickWeapon, onPickAbilities, onClose } = props;
  /** null = the list; an id = that entry's codex page. */
  const [codexId, setCodexId] = useState<IconId | null>(null);
  const slide = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: SLIDE_MS, useNativeDriver: true }).start();
  }, [slide]);

  const close = (): void => {
    Animated.timing(slide, { toValue: 1, duration: SLIDE_MS, useNativeDriver: true }).start(() => onClose());
  };

  const pickWeapon = (id: WeaponId): void => {
    onPickWeapon(id);
    setTimeout(close, 250); // let the gold border land, then dismiss
  };

  const toggleAbility = (id: AbilityId): void => {
    const i = abilities.indexOf(id);
    if (i >= 0) onPickAbilities(abilities.filter((a) => a !== id));
    else if (abilities.length < LOADOUT_ABILITY_COUNT) onPickAbilities([...abilities, id]);
  };

  const handFull = abilities.length === LOADOUT_ABILITY_COUNT;

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 640] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={close} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.grabber} />
        <View style={styles.head}>
          <Text style={styles.title}>
            {mode === "weapon" ? "CHOOSE YOUR WEAPON" : "CHOOSE 3 ABILITIES"}
            {mode === "ability" ? (
              <Text style={styles.count}>{`  ${abilities.length}/${LOADOUT_ABILITY_COUNT}`}</Text>
            ) : null}
          </Text>
          <Pressable onPress={close} hitSlop={10}>
            <Text style={styles.close}>CLOSE ✕</Text>
          </Pressable>
        </View>

        {mode === "ability" ? (
          <View style={styles.tray}>
            {Array.from({ length: LOADOUT_ABILITY_COUNT }, (_, i) => {
              const id = abilities[i];
              if (!id) {
                return (
                  <View key={i} style={styles.traySlot}>
                    <Text style={styles.trayN}>{i + 1}</Text>
                    <Text style={styles.trayEmpty}>+</Text>
                  </View>
                );
              }
              return (
                <Pressable key={i} onPress={() => toggleAbility(id)} style={[styles.traySlot, styles.trayFilled]}>
                  <Text style={[styles.trayN, styles.trayNFilled]}>{i + 1}</Text>
                  <Text style={styles.trayRemove}>✕</Text>
                  <LoadoutIcon id={id} size={22} color={CATEGORY_META[categoryOf(id)].color} />
                  <Text style={styles.trayName}>{ABILITIES[id].name.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {codexId !== null ? (
          <CodexPage
            id={codexId}
            picked={codexId in WEAPONS ? weapon === codexId : abilities.includes(codexId as AbilityId)}
            handFull={handFull}
            onBack={() => setCodexId(null)}
            onEquip={() => {
              if (codexId in WEAPONS) pickWeapon(codexId as WeaponId);
              else toggleAbility(codexId as AbilityId);
            }}
          />
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {mode === "weapon" ? (
              <View style={styles.grid}>
                {WEAPON_IDS.map((id) => (
                  <Card
                    key={id}
                    id={id}
                    name={WEAPONS[id].name.toUpperCase()}
                    hint={WEAPON_CODEX[id].hint}
                    color={C_GOLD}
                    picked={weapon === id}
                    pickedLabel="EQUIPPED"
                    dim={false}
                    onPress={() => pickWeapon(id)}
                    onInfo={() => setCodexId(id)}
                  />
                ))}
              </View>
            ) : (
              (["offensive", "defensive", "support"] as AbilityCategory[]).map((cat) => (
                <View key={cat}>
                  <View style={styles.catHead}>
                    <View style={[styles.catDot, { backgroundColor: CATEGORY_META[cat].color }]} />
                    <Text style={[styles.catLabel, { color: CATEGORY_META[cat].color }]}>
                      {CATEGORY_META[cat].label}
                    </Text>
                    <View style={styles.catRule} />
                  </View>
                  <View style={styles.grid}>
                    {abilitiesByCategory(cat).map((id) => {
                      const picked = abilities.includes(id);
                      return (
                        <Card
                          key={id}
                          id={id}
                          name={ABILITIES[id].name.toUpperCase()}
                          hint={ABILITY_CODEX[id].hint}
                          color={CATEGORY_META[cat].color}
                          picked={picked}
                          pickedLabel={`№${abilities.indexOf(id) + 1}`}
                          cd={`CD ${ABILITIES[id].cooldown}s`}
                          dim={!picked && handFull}
                          onPress={() => toggleAbility(id)}
                          onInfo={() => setCodexId(id)}
                        />
                      );
                    })}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
};

// ── Card ───────────────────────────────────────────────────────────────────

interface CardProps {
  id: IconId;
  name: string;
  hint: string;
  color: string;
  picked: boolean;
  pickedLabel: string;
  cd?: string;
  dim: boolean;
  onPress: () => void;
  onInfo: () => void;
}

const Card = ({ id, name, hint, color, picked, pickedLabel, cd, dim, onPress, onInfo }: CardProps) => (
  <Pressable
    onPress={dim ? undefined : onPress}
    style={[styles.card, picked && styles.cardPicked, dim && styles.cardDim]}
  >
    <View style={styles.cardRow}>
      <LoadoutIcon id={id} size={24} color={color} />
      <Text style={styles.cardName}>{name}</Text>
    </View>
    <Text style={styles.cardHint}>{hint}</Text>
    <View style={styles.cardMeta}>
      {cd ? <Text style={styles.cdChip}>{cd}</Text> : null}
      {picked ? <Text style={styles.pickedChip}>{pickedLabel}</Text> : null}
    </View>
    <Pressable onPress={onInfo} hitSlop={8} style={styles.qmark}>
      <Text style={styles.qmarkText}>?</Text>
    </Pressable>
  </Pressable>
);

// ── Codex ──────────────────────────────────────────────────────────────────

interface CodexPageProps {
  id: IconId;
  picked: boolean;
  handFull: boolean;
  onBack: () => void;
  onEquip: () => void;
}

const CodexPage = ({ id, picked, handFull, onBack, onEquip }: CodexPageProps) => {
  const isWeapon = id in WEAPONS;
  const name = isWeapon ? WEAPONS[id as WeaponId].name : ABILITIES[id as AbilityId].name;
  const codex = isWeapon ? WEAPON_CODEX[id as WeaponId] : ABILITY_CODEX[id as AbilityId];
  const chips: CodexChip[] = isWeapon ? weaponChips(id as WeaponId) : ABILITY_CODEX[id as AbilityId].chips;
  const color = isWeapon ? C_GOLD : CATEGORY_META[categoryOf(id as AbilityId)].color;
  const catLabel = isWeapon
    ? "WEAPON"
    : `${CATEGORY_META[categoryOf(id as AbilityId)].label} · CD ${ABILITIES[id as AbilityId].cooldown}s`;
  const equipBlocked = !isWeapon && !picked && handFull;
  const equipLabel = isWeapon
    ? picked
      ? "✓ EQUIPPED"
      : `EQUIP ${name.toUpperCase()}`
    : picked
      ? "✓ PICKED — TAP TO REMOVE"
      : equipBlocked
        ? "LOADOUT FULL"
        : "ADD TO LOADOUT";

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      <Pressable onPress={onBack} hitSlop={8} style={styles.cdxBack}>
        <Text style={styles.cdxBackText}>{`‹ ALL ${isWeapon ? "WEAPONS" : "ABILITIES"}`}</Text>
      </Pressable>
      <View style={styles.cdxHero}>
        <LoadoutIcon id={id} size={52} color={color} />
        <View style={styles.cdxHeroText}>
          <Text style={styles.cdxName}>{name.toUpperCase()}</Text>
          <Text style={[styles.catChip, { color, borderColor: color }]}>{catLabel}</Text>
        </View>
      </View>
      <View style={styles.cdxQuote}>
        <Text style={styles.cdxQuoteText}>{`“${codex.quote}”`}</Text>
      </View>
      <Text style={styles.cdxSection}>WHAT IT DOES</Text>
      <Text style={styles.cdxBody}>{codex.desc}</Text>

      {isWeapon ? (
        <>
          <Text style={styles.cdxSection}>STATS</Text>
          {weaponBars(id as WeaponId).map((bar) => (
            <View key={bar.label} style={styles.statBar}>
              <Text style={styles.statLabel}>{bar.label}</Text>
              <View style={styles.statTrack}>
                <View style={[styles.statFill, { width: `${Math.round(bar.frac * 100)}%` }]} />
              </View>
              <Text style={styles.statValue}>{bar.display}</Text>
            </View>
          ))}
        </>
      ) : null}

      <Text style={styles.cdxSection}>{isWeapon ? "EFFECTS" : "THE NUMBERS"}</Text>
      <View style={styles.chips}>
        {chips.map((chip) => (
          <View key={chip.label} style={styles.chip}>
            <Text style={styles.chipLabel}>{chip.label}</Text>
            <Text style={styles.chipValue}>{chip.value}</Text>
          </View>
        ))}
      </View>

      <Pressable
        onPress={equipBlocked ? undefined : onEquip}
        style={[styles.equip, picked && styles.equipPicked, equipBlocked && styles.equipBlocked]}
      >
        <Text style={[styles.equipText, picked && styles.equipTextPicked, equipBlocked && styles.equipTextBlocked]}>
          {equipLabel}
        </Text>
      </Pressable>
    </ScrollView>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(6,5,4,0.62)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "86%",
    backgroundColor: "#181511",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "#2e2820",
  },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#3a332a", alignSelf: "center", marginTop: 10 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
  },
  title: { color: C_BONE, fontSize: 15, fontWeight: "900", letterSpacing: 2 },
  count: { color: C_GOLD },
  close: { color: C_MUTED, fontSize: 13, fontWeight: "800", letterSpacing: 1 },

  tray: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  traySlot: {
    flex: 1,
    minHeight: 58,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#3a332a",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 7,
  },
  trayFilled: { borderStyle: "solid", borderColor: C_GOLD, backgroundColor: "#26201a" },
  trayN: { position: "absolute", top: 4, left: 7, fontSize: 9, fontWeight: "900", color: "#4a4238" },
  trayNFilled: { color: C_GOLD },
  trayRemove: { position: "absolute", top: 3, right: 6, color: C_MUTED, fontSize: 10, fontWeight: "800" },
  trayEmpty: { color: "#4a4238", fontSize: 16, fontWeight: "300" },
  trayName: { fontSize: 8.5, fontWeight: "800", letterSpacing: 0.5, color: C_BONE, textAlign: "center" },

  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 28 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, marginBottom: 8 },
  catDot: { width: 8, height: 8, borderRadius: 2 },
  catLabel: { fontSize: 11, fontWeight: "900", letterSpacing: 3 },
  catRule: { flex: 1, height: 1, backgroundColor: "#2e2820" },

  card: {
    width: "48.5%",
    backgroundColor: "#1d1915",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#1d1915",
    padding: 10,
    gap: 6,
  },
  cardPicked: { borderColor: C_GOLD, backgroundColor: "#26201a" },
  cardDim: { opacity: 0.38 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 22 },
  cardName: { color: C_BONE, fontSize: 12.5, fontWeight: "800", letterSpacing: 0.6, flexShrink: 1 },
  cardHint: { color: C_MUTED, fontSize: 10.5, lineHeight: 14, minHeight: 28 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  cdChip: {
    color: C_MUTED,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: "#2e2820",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: "hidden",
  },
  pickedChip: { color: C_GOLD, fontSize: 9, fontWeight: "900", letterSpacing: 1.5, marginLeft: "auto" },
  qmark: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#3a332a",
    alignItems: "center",
    justifyContent: "center",
  },
  qmarkText: { color: C_MUTED, fontSize: 12, fontWeight: "800" },

  cdxBack: { paddingVertical: 6, marginTop: 2 },
  cdxBackText: { color: C_MUTED, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  cdxHero: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 8 },
  cdxHeroText: { gap: 5 },
  cdxName: { color: C_BONE, fontSize: 21, fontWeight: "900", letterSpacing: 1.5 },
  catChip: {
    alignSelf: "flex-start",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    overflow: "hidden",
  },
  cdxQuote: {
    marginTop: 14,
    padding: 11,
    borderLeftWidth: 3,
    borderLeftColor: "#6e150e",
    backgroundColor: "rgba(110,21,14,0.08)",
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  cdxQuoteText: { color: "#c9bfae", fontSize: 12.5, lineHeight: 19, fontStyle: "italic" },
  cdxSection: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 3, marginTop: 18, marginBottom: 7 },
  cdxBody: { color: "#cfc6b5", fontSize: 12.5, lineHeight: 20 },

  statBar: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 7 },
  statLabel: { width: 62, color: C_MUTED, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  statTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: "#221e19", overflow: "hidden" },
  statFill: { height: "100%", borderRadius: 3, backgroundColor: C_BONE },
  statValue: { width: 64, textAlign: "right", color: C_BONE, fontSize: 10.5, fontWeight: "700" },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "#2e2820",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  chipLabel: { color: C_MUTED, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  chipValue: { color: C_BONE, fontSize: 10.5, fontWeight: "700" },

  equip: { marginTop: 20, borderRadius: 9, paddingVertical: 12, alignItems: "center", backgroundColor: C_GOLD },
  equipPicked: { backgroundColor: "#26201a", borderWidth: 1.5, borderColor: C_GOLD },
  equipBlocked: { backgroundColor: "#221e19" },
  equipText: { color: "#241a0c", fontSize: 13, fontWeight: "900", letterSpacing: 2 },
  equipTextPicked: { color: C_GOLD },
  equipTextBlocked: { color: "#6a6053" },
});
