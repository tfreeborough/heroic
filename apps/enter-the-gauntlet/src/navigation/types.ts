// The app's screen graph. Kept in its own module so screens can type their
// navigation/route props against it without importing the navigator (which would
// create an import cycle — the navigator imports the screens).

export type RootStackParamList = {
  Menu: undefined;
  Settings: undefined;
  /** Pick a class on the way into a run — the seed of the character-creation flow. */
  ClassSelect: undefined;
  /** No params: the active CharacterRecord (CharacterContext) is the source of truth. */
  Game: undefined;
  /**
   * The in-game pause menu — the same MenuScreen component, presented as a
   * transparent modal *over* the live Game (which stays mounted, so closing it
   * resumes the exact run). MenuScreen switches to pause mode on this route name.
   */
  Pause: undefined;
  /**
   * The level-up talent pick — a transparent modal over the frozen Game, like
   * Pause. Paramless on purpose: picks can chain (multi-level kills), so the
   * screen derives everything live from CharacterContext instead of route
   * params that would go stale after the first pick.
   */
  TalentPick: undefined;
};
