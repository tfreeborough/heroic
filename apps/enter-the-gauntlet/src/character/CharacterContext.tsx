// The character store — the roster hydrated from device storage once on
// launch, plus the three progression mutators the game calls: create a
// character, bank XP from a kill, take a talent pick. Persistence mirrors
// SettingsContext (debounced, guarded on `loaded`).
//
// Every mutator uses functional setState. This is load-bearing for gainXp: an
// explosion can kill several enemies inside one sim step — before React
// re-renders — so a captured-value merge would silently drop all but the last
// kill's XP.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { applyXp, eligibleTiers, pendingPicks, type ClassId } from "@heroic/core";
import {
  EMPTY_ROSTER,
  loadRoster,
  newCharacter,
  saveRoster,
  type CharacterRecord,
  type CharacterRoster,
} from "./character";

interface CharacterContextValue {
  roster: CharacterRoster;
  /** The character being played; null until one is created (or after a wipe). */
  active: CharacterRecord | null;
  /** False until the persisted roster has loaded — gate Continue on this. */
  loaded: boolean;
  /** Start a fresh level-1 character and make it active. */
  createCharacter: (classId: ClassId) => void;
  /** Bank kill XP into the active character, folding in any level-ups. */
  gainXp: (amount: number) => void;
  /** Take one owed talent pick. Ignored if nothing is owed or the tier isn't eligible. */
  takeTalent: (tierId: string) => void;
}

const CharacterContext = createContext<CharacterContextValue | null>(null);

/** Apply `change` to the active record, leaving the rest of the roster untouched. */
const mutateActive = (
  roster: CharacterRoster,
  change: (c: CharacterRecord) => CharacterRecord,
): CharacterRoster => ({
  ...roster,
  characters: roster.characters.map((c) => (c.id === roster.activeId ? change(c) : c)),
});

export const CharacterProvider = ({ children }: { children: ReactNode }) => {
  const [roster, setRoster] = useState<CharacterRoster>(EMPTY_ROSTER);
  const [loaded, setLoaded] = useState(false);

  // Hydrate once on launch (the settings-hydration argument: the menu renders
  // fine on the empty roster, and Continue is gated on `loaded`).
  useEffect(() => {
    let alive = true;
    loadRoster().then((r) => {
      if (!alive) return;
      setRoster(r);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Debounced persistence: the XP trickle collapses into occasional writes,
  // and a level-up or talent pick still hits disk within 250ms. Guarded on
  // `loaded` so the initial empty state can't overwrite a stored roster.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => saveRoster(roster), 250);
    return () => clearTimeout(t);
  }, [roster, loaded]);

  const mutators = useMemo(
    () => ({
      createCharacter: (classId: ClassId) =>
        setRoster((prev) => {
          const record = newCharacter(classId);
          return { characters: [...prev.characters, record], activeId: record.id };
        }),
      gainXp: (amount: number) =>
        setRoster((prev) =>
          mutateActive(prev, (c) => {
            const r = applyXp(c.level, c.xp, amount);
            return { ...c, level: r.level, xp: r.xp };
          }),
        ),
      takeTalent: (tierId: string) =>
        setRoster((prev) =>
          mutateActive(prev, (c) => {
            const owed = pendingPicks(c.level, c.talents.length) > 0;
            const eligible = eligibleTiers(c.talents).some((t) => t.id === tierId);
            return owed && eligible ? { ...c, talents: [...c.talents, tierId] } : c;
          }),
        ),
    }),
    [],
  );

  const value = useMemo(
    () => ({
      roster,
      active: roster.characters.find((c) => c.id === roster.activeId) ?? null,
      loaded,
      ...mutators,
    }),
    [roster, loaded, mutators],
  );
  return <CharacterContext.Provider value={value}>{children}</CharacterContext.Provider>;
};

export const useCharacter = (): CharacterContextValue => {
  const ctx = useContext(CharacterContext);
  if (!ctx) throw new Error("useCharacter must be used within a CharacterProvider");
  return ctx;
};
