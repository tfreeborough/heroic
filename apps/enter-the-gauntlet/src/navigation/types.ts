// The app's screen graph. Kept in its own module so screens can type their
// navigation/route props against it without importing the navigator (which would
// create an import cycle — the navigator imports the screens).

export type RootStackParamList = {
  Menu: undefined;
  Settings: undefined;
  Game: undefined;
  /**
   * The in-game pause menu — the same MenuScreen component, presented as a
   * transparent modal *over* the live Game (which stays mounted, so closing it
   * resumes the exact run). MenuScreen switches to pause mode on this route name.
   */
  Pause: undefined;
};
