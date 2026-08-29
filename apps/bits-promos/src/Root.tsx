import type * as React from "react";
import { Composition } from "remotion";
import { FPS, VERTICAL } from "./brand";
import { GameplayClip } from "./GameplayClip";
import { Spotlight, spotlightSeconds } from "./Spotlight";

/**
 * Everything renders vertical 1080×1920 — the one format TikTok, Reels and
 * Shorts all take natively.
 */
export const Root: React.FC = () => (
  <>
    <Composition
      id="WeaponSpotlight"
      component={Spotlight}
      durationInFrames={FPS * 9}
      fps={FPS}
      {...VERTICAL}
      defaultProps={{ kind: "weapon" as const, id: "blade" }}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(spotlightSeconds(props) * FPS) })}
    />
    <Composition
      id="AbilitySpotlight"
      component={Spotlight}
      durationInFrames={FPS * 9}
      fps={FPS}
      {...VERTICAL}
      defaultProps={{ kind: "ability" as const, id: "sinkhole" }}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(spotlightSeconds(props) * FPS) })}
    />
    <Composition
      id="GameplayClip"
      component={GameplayClip}
      durationInFrames={FPS * 15}
      fps={FPS}
      {...VERTICAL}
      defaultProps={{
        clip: "",
        hook: "He had one HP left. Then the Harpoon.",
        durationSeconds: 12,
        startFrom: 0,
        muted: false,
      }}
      calculateMetadata={({ props }) => ({
        // clip body + 3s end card
        durationInFrames: Math.round((props.durationSeconds + 3) * FPS),
      })}
    />
  </>
);
