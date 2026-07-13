/**
 * Device-local player settings (AsyncStorage). Settings are read at the point
 * of use (e.g. GameScreen loads lefty mode on mount — i.e. at match start),
 * so the settings page never needs to push state into live screens.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Lefty mode: buttons on the LEFT, the movement region fills from the right. */
const KEY_LEFTY = "bits.lefty";

export const loadLefty = async (): Promise<boolean> => (await AsyncStorage.getItem(KEY_LEFTY)) === "1";

export const saveLefty = (on: boolean): void => {
  void AsyncStorage.setItem(KEY_LEFTY, on ? "1" : "0");
};
