/**
 * The contact door (bits-feedback.md): who to reach and how. One address,
 * one place — Settings' CONTACT row and the feedback form's fallback both
 * come through here. The mail app opens prefilled with the same version
 * context the feedback form attaches, so an email report is as debuggable
 * as a database one.
 */
import { Alert, Linking, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";
import { storedIdentity } from "./net/api";
import { runningVersion } from "./updates";

export const SUPPORT_EMAIL = "tfreeborough@gmail.com";

export interface DeviceContext {
  /** `ios` / `android`. */
  platform: string;
  osVersion: string;
  /** The Settings footer's two lines (runningVersion()). */
  appBinary: string;
  appBundle: string;
}

/** What the device is running — attached to every report, listed under the
 * form so nothing is sent that the player can't see. */
export const deviceContext = (): DeviceContext => {
  const version = runningVersion();
  return {
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    appBinary: version.binary,
    appBundle: version.bundle,
  };
};

/** The context as the lines a human reads — the email footer and the
 * form's "attached" note share this. `playerId` is the anonymous identity
 * (Tom, 2026-08-24: every report and email must carry it — it's the key
 * to the wallet, the ledger, and the ranked history when a purchase or a
 * match goes wrong); null while the device has none yet. */
export const contextLines = (playerName: string, playerId: string | null): string[] => {
  const ctx = deviceContext();
  return [
    `${ctx.platform} ${ctx.osVersion}`,
    ctx.appBinary,
    ctx.appBundle,
    ...(playerName ? [`gladiator: ${playerName}`] : []),
    `player: ${playerId ?? "none yet"}`,
  ];
};

const supportMailto = (playerName: string, playerId: string | null): string => {
  const subject = encodeURIComponent("Blood in the Sand");
  // A blank body to write in, then the stamps below a rule — the player
  // writes at the top, the context rides underneath untouched.
  const body = encodeURIComponent(`\n\n\n—\n${contextLines(playerName, playerId).join("\n")}`);
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
};

/**
 * Open the mail app addressed to support. When no mail app is configured
 * (simulators, some Androids) the tap falls back to showing the address
 * with a COPY button — the player still leaves with a way to write.
 */
export const openSupportEmail = async (playerName: string): Promise<void> => {
  // Read-only: the email must never wait on a registration round-trip.
  const playerId = (await storedIdentity())?.playerId ?? null;
  try {
    await Linking.openURL(supportMailto(playerName, playerId));
  } catch {
    Alert.alert("No mail app", `Email me at ${SUPPORT_EMAIL}`, [
      {
        text: "Copy address",
        onPress: () => {
          void Clipboard.setStringAsync(SUPPORT_EMAIL);
        },
      },
      { text: "OK", style: "cancel" },
    ]);
  }
};
