// Settings: audio volumes (master/music/SFX) + mute, and the left-handed control
// layout toggle. Reads and writes the shared settings store; the running game
// picks these up live (volumes) or on next launch.

import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useSettings } from "../settings/SettingsContext";
import { Slider } from "../ui/Slider";
import { UI } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

export const SettingsScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const { settings, update } = useSettings();

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.back}>
            <Text style={styles.backGlyph}>{"<"}</Text>
          </Pressable>
          <Text style={styles.title}>Settings</Text>
        </View>

        <Text style={styles.section}>Audio</Text>
        <View style={styles.panel}>
          <VolumeRow
            label="Master"
            value={settings.masterVolume}
            onChange={(v) => update({ masterVolume: v })}
          />
          <VolumeRow
            label="Music"
            value={settings.musicVolume}
            onChange={(v) => update({ musicVolume: v })}
          />
          <VolumeRow
            label="Sound Effects"
            value={settings.sfxVolume}
            onChange={(v) => update({ sfxVolume: v })}
          />
          <ToggleRow
            label="Mute"
            description="Silence all audio"
            value={settings.muted}
            onChange={(v) => update({ muted: v })}
          />
        </View>

        <Text style={styles.section}>Controls</Text>
        <View style={styles.panel}>
          <ToggleRow
            label="Left-handed layout"
            description="Movement stick on the left, action buttons on the right"
            value={settings.leftHanded}
            onChange={(v) => update({ leftHanded: v })}
          />
        </View>

        <Text style={styles.section}>Diagnostics</Text>
        <View style={styles.panel}>
          <ToggleRow
            label="Performance overlay"
            description="Show JS frame timing (fps / sim / record) over the game"
            value={settings.showPerfOverlay}
            onChange={(v) => update({ showPerfOverlay: v })}
          />
          <ToggleRow
            label="Disable fog of war"
            description="Skip the fog blur + mist layers (test their GPU cost)"
            value={settings.disableFog}
            onChange={(v) => update({ disableFog: v })}
          />
          <ToggleRow
            label="Disable drifting mist"
            description="Flat fog and void pits, no per-pixel mist shader"
            value={settings.disableMist}
            onChange={(v) => update({ disableMist: v })}
          />
          <ToggleRow
            label="Skip scene render"
            description="Draw nothing — isolates the present/UI cost from scene drawing"
            value={settings.disableSceneRender}
            onChange={(v) => update({ disableSceneRender: v })}
          />
        </View>
      </ScrollView>
    </View>
  );
};

const VolumeRow = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) => (
  <View style={styles.volumeRow}>
    <View style={styles.volumeLabelRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.percent}>{Math.round(value * 100)}%</Text>
    </View>
    <Slider value={value} onChange={onChange} />
  </View>
);

const ToggleRow = ({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) => (
  <View style={styles.toggleRow}>
    <View style={styles.toggleText}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: UI.track, true: UI.accent }}
      thumbColor={UI.knob}
    />
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: UI.bg,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: {
    fontFamily: UI.font,
    color: UI.text,
    fontSize: 30,
  },
  title: {
    fontFamily: UI.font,
    color: UI.text,
    fontSize: 28,
    marginLeft: 8,
  },
  section: {
    fontFamily: UI.font,
    color: UI.accent,
    fontSize: 16,
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 10,
    marginLeft: 4,
  },
  panel: {
    backgroundColor: UI.panel,
    borderWidth: 1,
    borderColor: UI.panelBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 16,
  },
  volumeRow: {
    paddingVertical: 8,
  },
  volumeLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowLabel: {
    fontFamily: UI.font,
    color: UI.text,
    fontSize: 18,
  },
  percent: {
    fontFamily: UI.font,
    color: UI.textDim,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  toggleText: {
    flex: 1,
    paddingRight: 16,
  },
  description: {
    color: UI.textDim,
    fontSize: 13,
    marginTop: 2,
  },
});
