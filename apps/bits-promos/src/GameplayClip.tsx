import type * as React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CINZEL, palette } from "./brand";
import { Backdrop, EndCard } from "./components";
import { CTA } from "./data/copy";

export type GameplayClipProps = {
  /** File under public/clips/, e.g. "harpoon-triple.mp4". Empty = placeholder. */
  clip: string;
  /** The first-second hook — the reason a scroller stops. */
  hook: string;
  /** Seconds of gameplay to show (trim your recording to the good bit first). */
  durationSeconds: number;
  /** Seconds into the clip to start from. */
  startFrom?: number;
  muted?: boolean;
};

const Watermark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      bottom: 48,
      left: 48,
      display: "flex",
      alignItems: "center",
      gap: 20,
      opacity: 0.9,
    }}
  >
    <Img
      src={staticFile("assets/app-icon.png")}
      style={{ width: 84, height: 84, borderRadius: 20 }}
    />
    <span
      style={{
        fontFamily: CINZEL,
        fontWeight: 700,
        fontSize: 30,
        color: palette.bone,
        textShadow: "0 3px 12px rgba(0,0,0,0.9)",
        letterSpacing: 2,
      }}
    >
      {CTA.title}
    </span>
  </div>
);

/**
 * Wraps a raw screen recording in the brand: hook banner up top, watermark,
 * branded end card. Record on-device, AirDrop the file into public/clips/,
 * render — that's the whole pipeline.
 */
export const GameplayClip: React.FC<GameplayClipProps> = ({
  clip,
  hook,
  startFrom = 0,
  muted = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const endCardFrames = Math.round(fps * 3);
  const bodyEnd = durationInFrames - endCardFrames;

  const bannerIn = spring({ frame, fps, config: { damping: 13, stiffness: 150 } });
  const bannerOut = interpolate(frame, [fps * 3, fps * 3.5], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bodyFade = interpolate(frame, [bodyEnd - 10, bodyEnd], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      <Sequence durationInFrames={bodyEnd}>
        <AbsoluteFill style={{ opacity: bodyFade }}>
          {clip ? (
            <OffthreadVideo
              src={staticFile(`clips/${clip}`)}
              startFrom={Math.round(startFrom * fps)}
              muted={muted}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <AbsoluteFill
              style={{ justifyContent: "center", alignItems: "center", gap: 24 }}
            >
              <Backdrop glow={0.3} />
              <div
                style={{
                  fontFamily: CINZEL,
                  fontWeight: 700,
                  fontSize: 44,
                  color: palette.steel,
                  textAlign: "center",
                  padding: "0 90px",
                }}
              >
                Drop a screen recording in public/clips/ and set the clip prop
              </div>
            </AbsoluteFill>
          )}
          {/* Hook banner — on screen for the first ~3.5s, then gone. */}
          <div
            style={{
              position: "absolute",
              top: 140,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              opacity: bannerIn * bannerOut,
              transform: `translateY(${(1 - bannerIn) * -80}px)`,
            }}
          >
            <div
              style={{
                fontFamily: CINZEL,
                fontWeight: 700,
                fontSize: 54,
                lineHeight: 1.2,
                textAlign: "center",
                color: palette.bone,
                background: "rgba(20,10,4,0.82)",
                border: `4px solid ${palette.crimson}`,
                padding: "28px 44px",
                margin: "0 60px",
                boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
              }}
            >
              {hook}
            </div>
          </div>
          <Watermark />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={bodyEnd}>
        <Backdrop glow={0.6} />
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
