/**
 * The title quick pick (achievements.md § The Chronicle v2 — the celebration
 * band, Tom 2026-09-10): every title this player has earned, one sheet, one
 * tap. Rises over the Deeds screen from the band's worn-title slot; the WEAR
 * pills on chapter rows remain the slow path. Device-local like the pills —
 * the pick lands on the next room join.
 */
import { useEffect, useRef } from "react";
import { Animated, Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { playSound } from "../audio";
import { C_BONE, C_GOLD, C_MUTED } from "../loadout/catalogue";
import { DISPLAY_FONT } from "../typography";
import { useBackClose, useSheetDrag } from "./sheetGestures";

export interface TitleOption {
  /** The deed id — what wornTitle stores and the join path claims. */
  id: string;
  title: string;
  icon: number | null;
  chapter: string;
}

export interface TitleSheetProps {
  titles: readonly TitleOption[];
  /** The worn deed id ("" = bare). */
  worn: string;
  onPick: (id: string) => void;
  onClose: () => void;
}

export const TitleSheet = ({ titles, worn, onPick, onClose }: TitleSheetProps) => {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  useBackClose(onClose);
  const { dragY, panHandlers } = useSheetDrag(onClose);

  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [enter]);

  const pick = (id: string): void => {
    playSound("uiTap");
    onPick(id);
    onClose();
  };

  return (
    <>
      <Animated.View style={[styles.scrim, { opacity: enter }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + 18 },
          {
            transform: [
              { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [380, 0] }) },
              { translateY: dragY },
            ],
          },
        ]}
      >
        <View {...panHandlers}>
          <View style={styles.handle} />
          <Text style={styles.title}>WEAR A TITLE</Text>
          <Text style={styles.sub}>{`${titles.length} EARNED · SHOWN UNDER YOUR NAME IN THE ARENA`}</Text>
        </View>

        <ScrollView style={{ maxHeight: height * 0.55 }} showsVerticalScrollIndicator={false}>
          {titles.map((t) => {
            const on = worn === t.id;
            return (
              <Pressable key={t.id} onPress={() => pick(on ? "" : t.id)}>
                <View style={[styles.row, on && styles.rowOn]}>
                  <View style={[styles.well, on && styles.wellOn]}>
                    {t.icon != null && <Image source={t.icon} style={styles.icon} resizeMode="contain" />}
                  </View>
                  <View style={styles.copy}>
                    <Text style={[styles.rowTitle, on && styles.rowTitleOn]} numberOfLines={1}>
                      {t.title}
                    </Text>
                    <Text style={styles.rowChapter} numberOfLines={1}>
                      {t.chapter.toUpperCase()}
                    </Text>
                  </View>
                  {on && <Text style={styles.wornMark}>WORN ✦</Text>}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable onPress={() => pick("")} hitSlop={6}>
          <View style={[styles.bare, worn === "" && styles.bareOn]}>
            <Text style={[styles.bareText, worn === "" && styles.bareTextOn]}>
              {worn === "" ? "GOING BARE ✦" : "GO BARE"}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#201b15",
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: "#3a332a",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 10,
    paddingHorizontal: 18,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#3a332a", marginBottom: 8 },
  title: { color: C_BONE, fontSize: 18, letterSpacing: 3, fontFamily: DISPLAY_FONT, textAlign: "center", marginRight: -3 },
  sub: { color: C_MUTED, fontSize: 10, fontWeight: "800", letterSpacing: 1, textAlign: "center", marginTop: 4, marginBottom: 12 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 4,
  },
  rowOn: { backgroundColor: "#2a2318" },
  well: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#221c14",
    borderWidth: 1,
    borderColor: "#3a3126",
    alignItems: "center",
    justifyContent: "center",
  },
  wellOn: { borderColor: "#8a6d44" },
  icon: { width: 32, height: 32 },
  copy: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: DISPLAY_FONT, color: "#e8d9b8", fontSize: 14, letterSpacing: 1 },
  rowTitleOn: { color: "#e8c87a" },
  rowChapter: { color: C_MUTED, fontSize: 9, fontWeight: "800", letterSpacing: 1.5 },
  wornMark: { color: C_GOLD, fontSize: 10, fontWeight: "900", letterSpacing: 2 },

  bare: {
    alignSelf: "center",
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#5a4c38",
    backgroundColor: "#221c14",
  },
  bareOn: { borderColor: "#b3925e", backgroundColor: "#31281a" },
  bareText: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 2 },
  bareTextOn: { color: "#e8c87a" },
});
