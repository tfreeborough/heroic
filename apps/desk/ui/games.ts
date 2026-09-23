/** The browser side of the registry: a game's templates, loaded on demand. */
import type { DeskTemplate } from "../game";
import { GAMES } from "../games";

export const loadTemplates = async (gameId: string): Promise<DeskTemplate[]> => {
  const g = GAMES.find((x) => x.id === gameId);
  if (!g) return [];
  return (await g.templates()).TEMPLATES;
};
