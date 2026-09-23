/** Every game the Desk knows. Adding one = a desk.config.ts in its promos package + a line here. */
import type { GameConfig } from "./game";
import bits from "bits-promos/desk.config";

export const GAMES: GameConfig[] = [bits];

export const gameById = (id: string): GameConfig | undefined => GAMES.find((g) => g.id === id);
