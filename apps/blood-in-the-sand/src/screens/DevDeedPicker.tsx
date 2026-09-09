/**
 * The dev menu's deed granter (bits-dev-menu.md § deeds): every deed on
 * every board, grouped by chapter, one tap = the API records it exactly as
 * a settle would (rewards included) and the entitlement cache refreshes.
 * Dev API only (STORE_DEV_TOOLS=1) — against production the call is a
 * silent no-op, the row just doesn't tick.
 */
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { ACHIEVEMENT_CHAPTERS, ACHIEVEMENT_DEFS } from "@heroic/blood-in-the-sand-sim";
import { setEntitlements } from "../deeds/entitlements";
import { devGrantDeed, ensureIdentity, fetchAchievements } from "../net/api";

const BY_ID = new Map(ACHIEVEMENT_DEFS.map((d) => [d.id, d]));

export const DevDeedPicker = ({ onClose }: { onClose: () => void }) => {
  const [query, setQuery] = useState("");
  const [granted, setGranted] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const chapters = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ACHIEVEMENT_CHAPTERS.map((c) => ({
      title: c.title,
      defs: c.ids
        .map((id) => BY_ID.get(id))
        .filter((d): d is NonNullable<typeof d> => d !== undefined)
        .filter((d) => q === "" || d.title.toLowerCase().includes(q) || d.id.includes(q)),
    })).filter((c) => c.defs.length > 0);
  }, [query]);

  const grant = (id: string) => {
    if (busy) return;
    setBusy(id);
    void (async () => {
      try {
        const identity = await ensureIdentity();
        if (!identity || !(await devGrantDeed(identity, id))) return;
        const me = await fetchAchievements(identity);
        if (me) setEntitlements(me.entitlements.map((e) => e.itemId));
        setGranted((prev) => new Set(prev).add(id));
      } finally {
        setBusy(null);
      }
    })();
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title}>GRANT DEED</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="filter by name or id"
        placeholderTextColor="#6b6257"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.filter}
      />
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {chapters.map((c) => (
          <View key={c.title}>
            <Text style={styles.chapter}>{c.title.toUpperCase()}</Text>
            {c.defs.map((d) => (
              <Pressable key={d.id} onPress={() => grant(d.id)} style={styles.row}>
                <Text style={styles.rowTitle}>
                  {granted.has(d.id) ? "✓ " : busy === d.id ? "… " : ""}
                  {d.title}
                </Text>
                <Text style={styles.rowId}>{d.id}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 60,
    bottom: 60,
    backgroundColor: "#1d1a16",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: "#6b6257", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  close: { color: "#6b6257", fontSize: 12, fontWeight: "800" },
  filter: {
    backgroundColor: "#2a241e",
    color: "#f5ede0",
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 12,
  },
  list: { flex: 1 },
  chapter: { color: "#6b6257", fontSize: 10, fontWeight: "800", letterSpacing: 2, marginTop: 10, marginBottom: 4 },
  row: { backgroundColor: "#3a332a", borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 4 },
  rowTitle: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  rowId: { color: "#6b6257", fontSize: 10 },
});
