import type * as React from "react";
import { Composition } from "remotion";
import { FPS, VERTICAL } from "./formats";
import { Save, saveSchema, saveSeconds } from "./Save";
import { SAVE_DEFAULTS } from "./defaults";

export const Root: React.FC = () => (
  <Composition
    id="Save"
    component={Save}
    schema={saveSchema}
    durationInFrames={FPS * 16}
    fps={FPS}
    {...VERTICAL}
    defaultProps={SAVE_DEFAULTS}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.round(saveSeconds(props) * FPS) })}
  />
);
