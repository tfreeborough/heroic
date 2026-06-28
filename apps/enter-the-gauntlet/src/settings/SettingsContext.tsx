// App-wide settings store. Hydrates from device storage once on launch, exposes
// the current settings plus a merge-`update`, and persists changes (debounced so
// dragging a volume slider doesn't hammer AsyncStorage). Both the Settings screen
// and the running game read from here via `useSettings`.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type GameSettings } from "./settings";

interface SettingsContextValue {
  settings: GameSettings;
  /** False until persisted settings have loaded; serve defaults meanwhile. */
  loaded: boolean;
  /** Merge a partial change into the settings (and schedule a persist). */
  update: (partial: Partial<GameSettings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  // Hydrate once on launch. The menu reads fine with defaults; New Game is several
  // taps away, so persisted values are always in place before a run actually starts.
  useEffect(() => {
    let alive = true;
    loadSettings().then((s) => {
      if (!alive) return;
      setSettings(s);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Debounced persistence. Guarded on `loaded` so the initial default-state render
  // can't write defaults over stored values before hydration resolves.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => saveSettings(settings), 250);
    return () => clearTimeout(t);
  }, [settings, loaded]);

  const update = useMemo(
    () => (partial: Partial<GameSettings>) => setSettings((prev) => ({ ...prev, ...partial })),
    [],
  );

  const value = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = (): SettingsContextValue => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
};
