/**
 * OTA update glue (expo-updates). Two consumers:
 *  - HomeScreen's "update ready" pill: expo-updates stages new JS in the
 *    background (on launch, and on foreground via the hook below);
 *    useUpdateReady() flips true once a bundle is staged, and restartToApply()
 *    applies it — a JS reload, not a reinstall, so it's instant.
 *  - App's protocol-mismatch screen: fetchAndApplyUpdate() pulls the fix on
 *    demand. A protocol bump is a JS change, so OTA IS the fix — unless the
 *    player is a whole store build behind ("none": their runtimeVersion no
 *    longer receives our updates and only TestFlight/Play can help).
 *
 * Everything no-ops when Updates.isEnabled is false (dev client / Metro),
 * where JS comes from the bundler and there is nothing to fetch.
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

/** True once a new JS bundle is downloaded and waiting for a reload. */
export function useUpdateReady(): boolean {
  const { isUpdatePending } = Updates.useUpdates();
  // Launch-time check+download is automatic; foregrounding is the other
  // moment a player comes back after we've shipped something while they
  // were away. useUpdates() observes the staging, no state of our own.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void stageAvailableUpdate();
    });
    return () => sub.remove();
  }, []);
  return isUpdatePending;
}

/** Apply the staged bundle now (tears down and relaunches the JS world). */
export function restartToApply(): void {
  void Updates.reloadAsync();
}

/** Silent check+download; failures (offline, server down) just mean the
 * update pill doesn't appear — never surfaced to the player. */
async function stageAvailableUpdate(): Promise<void> {
  if (!Updates.isEnabled) return;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    /* next foreground retries */
  }
}

export type UpdateAttempt = "reloading" | "none" | "failed";

/**
 * The mismatch screen's UPDATE NOW: fetch whatever is published for this
 * binary and reload into it. "none" = nothing newer exists over the air
 * (player needs the next store build); "failed" = network trouble, retryable.
 */
export async function fetchAndApplyUpdate(): Promise<UpdateAttempt> {
  if (!Updates.isEnabled) return "none";
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return "none";
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
    return "reloading";
  } catch {
    return "failed";
  }
}
