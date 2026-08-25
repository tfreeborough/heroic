/**
 * The feedback form (bits-feedback.md): kind pills, a message, an optional
 * reply address, SEND. Reports land in the database stamped with the device
 * identity and the running version; the stamps are listed under the form so
 * nothing rides along that the player can't see. The email door is the
 * fallback — offered whenever the server can't be reached, which is exactly
 * when "the game is down" reports get written.
 */
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { playSound, unlockAudio, type BitsSoundEvent } from "../audio";
import { ScreenHeader, ScreenSign } from "../components/ScreenHeader";
import { ensureIdentity, sendFeedback, storedIdentity, type FeedbackReport, type FeedbackResult } from "../net/api";
import { loadContactEmail, saveContactEmail } from "../settings";
import { SUPPORT_EMAIL, contextLines, deviceContext, openSupportEmail } from "../support";

export interface FeedbackScreenProps {
  onBack: () => void;
  /** The header purse → the Armory. */
  onArmory: () => void;
  /** The stored gladiator name ("" if never claimed) — stamped on the report. */
  playerName: string;
}

type Kind = FeedbackReport["kind"];

const KINDS: { id: Kind; label: string; prompt: string }[] = [
  { id: "bug", label: "BUG", prompt: "What happened, and what did you expect instead?" },
  { id: "idea", label: "IDEA", prompt: "What would make the sand better?" },
  { id: "other", label: "OTHER", prompt: "Say anything." },
];

const MESSAGE_MAX = 2000;

const withTap = (event: BitsSoundEvent, fn: () => void) => (): void => {
  unlockAudio();
  playSound(event);
  fn();
};

export const FeedbackScreen = ({ onBack, onArmory, playerName }: FeedbackScreenProps) => {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  // The last SEND's answer: "sent" swaps the form for the thanks plate; the
  // two failures keep the draft in place with a line under the button.
  const [outcome, setOutcome] = useState<FeedbackResult | null>(null);

  // The anonymous id, for the "sent with this report" list — the server
  // stamps it from the bearer token, this just shows the player what it is.
  const [playerId, setPlayerId] = useState<string | null>(null);

  useEffect(() => {
    void loadContactEmail().then(setEmail);
    void storedIdentity().then((identity) => setPlayerId(identity?.playerId ?? null));
  }, []);

  const canSend = message.trim().length > 0 && !sending;

  const send = async (): Promise<void> => {
    if (!canSend) return;
    setSending(true);
    setOutcome(null);
    const trimmedEmail = email.trim();
    saveContactEmail(trimmedEmail);
    const identity = await ensureIdentity();
    const result: FeedbackResult = identity
      ? await sendFeedback(identity, {
          kind,
          message: message.trim(),
          contactEmail: trimmedEmail,
          playerName,
          ...deviceContext(),
        })
      : "unavailable";
    setSending(false);
    setOutcome(result);
    if (result === "sent") playSound("uiConfirm");
  };

  const emailDoor = withTap("uiTap", () => {
    void openSupportEmail(playerName);
  });

  if (outcome === "sent") {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom }]}>
        <ScreenHeader onBack={onBack} onPurse={onArmory} />
        <ScreenSign title="FEEDBACK" />
        <View style={styles.thanks}>
          <Text style={styles.thanksTitle}>Received.</Text>
          <Text style={styles.thanksBody}>
            Thank you — every report gets read. {email.trim() ? "I'll reply if I need more." : ""}
          </Text>
          <Pressable
            onPress={withTap("uiTap", () => {
              setMessage("");
              setOutcome(null);
            })}
            style={styles.ghost}
          >
            <Text style={styles.ghostText}>SEND ANOTHER</Text>
          </Pressable>
          <Pressable onPress={withTap("uiTap", onBack)} style={styles.ghost}>
            <Text style={styles.ghostText}>BACK</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const prompt = KINDS.find((k) => k.id === kind)?.prompt ?? "";

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top + 16 }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScreenHeader onBack={onBack} onPurse={onArmory} />
      <ScreenSign title="FEEDBACK" />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.kinds}>
          {KINDS.map((k) => {
            const on = k.id === kind;
            return (
              <Pressable
                key={k.id}
                onPress={withTap("uiTap", () => setKind(k.id))}
                style={[styles.kind, on && styles.kindOn]}
              >
                <Text style={[styles.kindText, on && styles.kindTextOn]}>{k.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          style={styles.message}
          value={message}
          onChangeText={(t) => setMessage(t.slice(0, MESSAGE_MAX))}
          placeholder={prompt}
          placeholderTextColor="#6b6257"
          multiline
          textAlignVertical="top"
          autoCorrect
          maxLength={MESSAGE_MAX}
        />
        <Text style={styles.counter}>
          {message.length}/{MESSAGE_MAX}
        </Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Email (optional) — so I can reply</Text>
          <TextInput
            style={styles.emailInput}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#6b6257"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            maxLength={200}
          />
        </View>

        <Pressable
          onPress={() => {
            unlockAudio();
            void send();
          }}
          style={[styles.send, !canSend && styles.sendOff]}
        >
          <Text style={styles.sendText}>{sending ? "SENDING…" : "SEND"}</Text>
        </Pressable>

        {outcome === "unavailable" ? (
          <View style={styles.failure}>
            <Text style={styles.failureText}>Couldn't reach the server — your draft is still here.</Text>
            <Pressable onPress={emailDoor} hitSlop={8}>
              <Text style={styles.failureDoor}>EMAIL ME INSTEAD</Text>
            </Pressable>
          </View>
        ) : outcome === "rejected" ? (
          <View style={styles.failure}>
            <Text style={styles.failureText}>The server didn't accept that — try a shorter message.</Text>
          </View>
        ) : null}

        {/* Every stamp that rides with the report, in the open. */}
        <View style={styles.attached}>
          <Text style={styles.attachedTitle}>Sent with this report</Text>
          {contextLines(playerName, playerId).map((line) => (
            <Text key={line} style={styles.attachedLine}>
              {line}
            </Text>
          ))}
        </View>

        <View style={styles.contact}>
          <Text style={styles.contactText}>Rather write directly?</Text>
          <Pressable onPress={emailDoor} hitSlop={8}>
            <Text style={styles.contactDoor}>{SUPPORT_EMAIL.toUpperCase()}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingHorizontal: 20 },
  scroll: { paddingTop: 20, gap: 14 },

  kinds: { flexDirection: "row", gap: 8 },
  kind: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3a332a",
    backgroundColor: "#1d1915",
  },
  kindOn: { borderColor: "#e0503c", backgroundColor: "#3a1a16" },
  kindText: { color: "#8a7f70", fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  kindTextOn: { color: "#f5ede0" },

  message: {
    backgroundColor: "#221e19",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    color: "#f0e8d8",
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 150,
  },
  counter: { color: "#564e43", fontSize: 11, textAlign: "right", marginTop: -8 },

  field: { gap: 6 },
  fieldLabel: { color: "#8a7f70", fontSize: 12 },
  emailInput: {
    backgroundColor: "#221e19",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    color: "#f0e8d8",
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  send: {
    backgroundColor: "#8c2f2f",
    borderColor: "#e0503c",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  sendOff: { opacity: 0.4 },
  sendText: { color: "#f5ede0", fontWeight: "900", letterSpacing: 3, fontSize: 15 },

  failure: { gap: 8, alignItems: "center" },
  failureText: { color: "#c96a4a", fontSize: 13, textAlign: "center" },
  failureDoor: { color: "#e8c87a", fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },

  attached: {
    backgroundColor: "#1d1915",
    borderRadius: 8,
    padding: 14,
    gap: 3,
    marginTop: 8,
  },
  attachedTitle: { color: "#8a7f70", fontSize: 12, marginBottom: 3 },
  attachedLine: { color: "#564e43", fontSize: 11, letterSpacing: 0.5 },

  contact: { alignItems: "center", gap: 6, marginTop: 8 },
  contactText: { color: "#8a7f70", fontSize: 12 },
  contactDoor: { color: "#e8c87a", fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },

  thanks: { marginTop: 40, gap: 14, alignItems: "stretch" },
  thanksTitle: { color: "#f0e8d8", fontSize: 24, fontWeight: "800", textAlign: "center" },
  thanksBody: { color: "#8a7f70", fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 12 },
  ghost: {
    backgroundColor: "rgba(43,30,18,0.55)",
    borderColor: "rgba(58,45,30,0.9)",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  ghostText: { color: "#f0e4c8", fontWeight: "800", letterSpacing: 2, fontSize: 13 },
});
