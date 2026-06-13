import type { Vec2 } from "../../math/vec2";
import { seek } from "../steering";
import { beyondAggro, ZERO_VELOCITY, type CommonConfig } from "../perception";
import type { Archetype } from "../runtime";

/**
 * The relentless walker (the zombie's archetype). One state, no transitions:
 * head straight at the player, forever. Stands down only when the player is
 * beyond aggro.
 */
export interface ChaserConfig extends CommonConfig {
  /** Beyond this distance to the player the chaser idles. */
  aggroRadius: number;
}

type ChaserState = Record<string, never>;

export const chaser: Archetype<ChaserConfig, ChaserState> = {
  id: "chaser",
  initState: () => ({}),
  tick: (_state, config, p): Vec2 =>
    beyondAggro(p, config.aggroRadius) ? ZERO_VELOCITY : seek(p.selfPos, p.playerPos, config.speed),
};
