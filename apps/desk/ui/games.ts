/** The browser side of the registry: a game's templates, loaded on demand. */
import type { DeskTemplate, VoicePreview } from "../game";
import { GAMES } from "../games";

export const loadTemplates = async (gameId: string): Promise<DeskTemplate[]> => {
  const g = GAMES.find((x) => x.id === gameId);
  if (!g) return [];
  return (await g.templates()).TEMPLATES;
};

/** What the Voice screen plays, if the game's templates take voice-overs. */
export const loadVoicePreview = async (gameId: string): Promise<VoicePreview | undefined> => {
  const g = GAMES.find((x) => x.id === gameId);
  return g ? (await g.templates()).VOICE_PREVIEW : undefined;
};
