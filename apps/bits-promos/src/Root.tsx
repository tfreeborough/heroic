import type * as React from "react";
import { Composition } from "remotion";
import { FPS, VERTICAL } from "./brand";
import { CLIP_TIMING, GameplayClip } from "./GameplayClip";
import { Spotlight, spotlightSeconds } from "./Spotlight";
import { APPLE_SHOT_SIZE, DevNote, FEATURE_SIZE, FeatureGraphic, SHOT_SIZE, StoreShot } from "./Store";
import { STORE_SHOTS } from "./data/store";

/**
 * Everything renders vertical 1080×1920 — the one format TikTok, Reels and
 * Shorts all take natively. Every video is intro → footage with one card → outro.
 */
export const Root: React.FC = () => (
  <>
    <Composition
      id="WeaponSpotlight"
      component={Spotlight}
      durationInFrames={FPS * 13}
      fps={FPS}
      {...VERTICAL}
      defaultProps={{ kind: "weapon" as const, id: "blade" }}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(spotlightSeconds(props) * FPS) })}
    />
    <Composition
      id="AbilitySpotlight"
      component={Spotlight}
      durationInFrames={FPS * 13}
      fps={FPS}
      {...VERTICAL}
      defaultProps={{ kind: "ability" as const, id: "sinkhole" }}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(spotlightSeconds(props) * FPS) })}
    />
    <Composition
      id="GameplayClip"
      component={GameplayClip}
      durationInFrames={FPS * 17}
      fps={FPS}
      {...VERTICAL}
      defaultProps={{
        clip: "",
        title: "Match point",
        line: "He had one HP left. Then the Harpoon.",
        durationSeconds: 12,
        startFrom: 0,
        muted: false,
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.round((props.durationSeconds + CLIP_TIMING.outro) * FPS),
      })}
    />
    {/* Store listing stills (bun run render:store) — one frame each. */}
    <Composition id="FeatureGraphic" component={FeatureGraphic} durationInFrames={1} fps={FPS} {...FEATURE_SIZE} />
    <Composition id="DevNote" component={DevNote} durationInFrames={1} fps={FPS} {...SHOT_SIZE} />
    <Composition id="StoreShot" component={StoreShot} durationInFrames={1} fps={FPS} {...SHOT_SIZE} defaultProps={STORE_SHOTS[0]!} />
    {/* The same cards at App Store Connect's 6.5" iPhone size (bun run render:store -- --apple). */}
    <Composition id="DevNoteApple" component={DevNote} durationInFrames={1} fps={FPS} {...APPLE_SHOT_SIZE} />
    <Composition id="StoreShotApple" component={StoreShot} durationInFrames={1} fps={FPS} {...APPLE_SHOT_SIZE} defaultProps={STORE_SHOTS[0]!} />
  </>
);
