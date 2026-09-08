import type * as React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useVideoConfig } from "remotion";
import { CINZEL, SANS, ditherOverlay, palette } from "./brand";
import { Backdrop } from "./components";
import { DEV_NOTE, FEATURE, type StoreShotSpec } from "./data/store";

/** Google Play's feature graphic slot. It also becomes the header of the
 * listing on some surfaces (cropped, rounded), so nothing important sits
 * near the edges. */
export const FEATURE_SIZE = { width: 1024, height: 500 } as const;
/** Phone screenshots: 9:16, within Google's 320–3840px bounds. */
export const SHOT_SIZE = { width: 1080, height: 1920 } as const;
/** App Store Connect's 6.5" iPhone slot (the one it demands): 1284×2778
 * or 1242×2688 only. Same card, a taller frame under the caption band. */
export const APPLE_SHOT_SIZE = { width: 1284, height: 2778 } as const;

/**
 * The screenshot layouts are authored at 1080 wide. Any composition size
 * renders the same logical card scaled to its width, with the extra height
 * (Apple's 9:19.5) going to the phone frame / the gaps. Wrap the card in
 * `<Scaled>` and lay out against `useCanvas()`'s logical width/height.
 */
const LOGICAL_W = SHOT_SIZE.width;
const useCanvas = () => {
  const { width, height } = useVideoConfig();
  const scale = width / LOGICAL_W;
  return { scale, w: LOGICAL_W, h: height / scale };
};
const Scaled: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { scale, w, h } = useCanvas();
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
      {children}
    </div>
  );
};

/**
 * 1024×500: the title-screen arena painting cropped to its wall-and-sand
 * band, the name on the left over an ink wash, the helmet on the right
 * feathered into the sand so its square icon ground disappears.
 */
export const FeatureGraphic: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: palette.night, overflow: "hidden" }}>
    <Img
      src={staticFile("assets/home.png")}
      style={{ position: "absolute", left: 0, top: -400, width: 1024, height: 1536, imageRendering: "pixelated" }}
    />
    <AbsoluteFill
      style={{
        background: `linear-gradient(90deg, rgba(20,10,4,0.92) 0%, rgba(20,10,4,0.78) 38%, rgba(20,10,4,0.15) 62%, rgba(20,10,4,0) 80%)`,
      }}
    />
    <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(20,10,4,0.25) 0%, rgba(20,10,4,0) 30%, rgba(20,10,4,0.55) 100%)` }} />
    <AbsoluteFill style={ditherOverlay} />

    <Img
      src={staticFile("assets/app-icon.png")}
      style={{
        position: "absolute",
        right: 22,
        top: 40,
        width: 470,
        height: 470,
        imageRendering: "pixelated",
        WebkitMaskImage: "radial-gradient(circle at 50% 52%, black 38%, transparent 66%)",
        maskImage: "radial-gradient(circle at 50% 52%, black 38%, transparent 66%)",
      }}
    />

    <div style={{ position: "absolute", left: 64, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: CINZEL,
          fontWeight: 700,
          fontSize: 118,
          lineHeight: 0.92,
          color: "#c9382b",
          letterSpacing: 2,
          textShadow: "0 6px 0 rgba(60,10,6,0.9), 0 14px 32px rgba(0,0,0,0.6)",
        }}
      >
        {FEATURE.title[0]}
      </div>
      <div
        style={{
          fontFamily: CINZEL,
          fontWeight: 700,
          fontSize: 62,
          lineHeight: 1,
          color: palette.bone,
          letterSpacing: 5,
          marginTop: 10,
          textShadow: "0 4px 0 rgba(40,20,8,0.9), 0 12px 28px rgba(0,0,0,0.6)",
        }}
      >
        {FEATURE.title[1]}
      </div>
      <div style={{ width: 120, height: 5, background: palette.sand, margin: "22px 0 18px", boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }} />
      <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 25, color: palette.bone, maxWidth: 600, lineHeight: 1.3, textShadow: "0 2px 6px rgba(0,0,0,0.7)" }}>
        {FEATURE.line}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        {FEATURE.chips.map((c) => (
          <span
            key={c}
            style={{
              fontFamily: SANS,
              fontWeight: 800,
              fontSize: 17,
              letterSpacing: 2,
              color: palette.sand,
              border: `2px solid ${palette.sand}`,
              padding: "6px 14px",
              background: "rgba(20,10,4,0.55)",
            }}
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  </AbsoluteFill>
);

/**
 * 1080×1920 store screenshot: a caption band up top, the phone capture
 * framed beneath on the arena backdrop. Feed it a clip (+ `at`) or a PNG
 * straight from a phone — the same card either way.
 */
export const StoreShot: React.FC<StoreShotSpec> = ({ headline, line, src, at = 0, cropTop = 0, cropBottom = 0 }) => {
  const { fps } = useVideoConfig();
  const { w, h } = useCanvas();
  const keep = Math.max(0.2, 1 - cropTop - cropBottom);
  // Source captures are ~9:19.7 phones; after the chrome crop the kept
  // band is ~0.506 wide-to-tall. Fit the frame to the room under the band,
  // never wider than the card with a margin either side.
  const bandH = 400;
  const pad = 70;
  const frameW = Math.min(Math.round((h - bandH - pad) * (874 / 1920) / keep), w - 2 * pad);
  const frameH = Math.round((frameW * keep) / (874 / 1920));
  const shared: React.CSSProperties = {
    position: "absolute",
    left: 0,
    width: "100%",
    top: `${(-cropTop / keep) * 100}%`,
    height: `${(1 / keep) * 100}%`,
    objectFit: "contain",
  };
  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      <Backdrop glow={0.55} />
      <Scaled>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: bandH, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 70px", textAlign: "center" }}>
          <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 92, lineHeight: 1.02, color: palette.bone, whiteSpace: "pre-line", textShadow: "0 6px 0 rgba(40,20,8,0.9), 0 14px 30px rgba(0,0,0,0.6)" }}>
            {headline.toUpperCase()}
          </div>
          <div style={{ width: 110, height: 5, background: palette.crimson, margin: "22px 0 18px" }} />
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 40, lineHeight: 1.25, color: palette.sand, maxWidth: 900 }}>{line}</div>
        </div>
        <div
          style={{
            position: "absolute",
            left: (w - frameW) / 2,
            top: bandH + Math.max(0, (h - bandH - pad - frameH) / 2),
            width: frameW,
            height: frameH,
            overflow: "hidden",
            borderRadius: 40,
            border: `3px solid rgba(220,185,111,0.55)`,
            boxShadow: "0 40px 90px rgba(0,0,0,0.65), 0 0 0 10px rgba(20,10,4,0.6)",
            background: palette.umber,
          }}
        >
          {src.endsWith(".mp4") ? (
            <OffthreadVideo src={staticFile(src)} startFrom={Math.round(at * fps)} muted style={shared} />
          ) : (
            <Img src={staticFile(src)} style={shared} />
          )}
        </div>
      </Scaled>
    </AbsoluteFill>
  );
};

/** 1080×1920: the closing screenshot — the helmet, then a note from Tom. */
export const DevNote: React.FC = () => {
  const { w, h } = useCanvas();
  // Authored for 1920 tall; a taller canvas splits the spare height above
  // the helmet and below the card so the footer never floats off alone.
  const shift = Math.max(0, (h - SHOT_SIZE.height) / 2);
  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      <Backdrop glow={0.7} />
      <Scaled>
        <Img
          src={staticFile("assets/app-icon.png")}
          style={{
            position: "absolute",
            left: (w - 520) / 2,
            top: 90 + shift,
            width: 520,
            height: 520,
            imageRendering: "pixelated",
            WebkitMaskImage: "radial-gradient(circle at 50% 52%, black 40%, transparent 68%)",
            maskImage: "radial-gradient(circle at 50% 52%, black 40%, transparent 68%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 70,
            right: 70,
            top: 640 + shift,
            background: palette.ink,
            borderLeft: `8px solid ${palette.crimson}`,
            padding: "54px 60px 58px 54px",
            boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
          }}
        >
          <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 66, color: palette.bone, lineHeight: 1.05, marginBottom: 34 }}>
            {DEV_NOTE.heading}
          </div>
          {DEV_NOTE.paragraphs.map((t) => (
            <div key={t} style={{ fontFamily: SANS, fontWeight: 500, fontSize: 42, lineHeight: 1.38, color: palette.bone, marginBottom: 30 }}>
              {t}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 14 }}>
            <span style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 52, color: palette.sand }}>— {DEV_NOTE.signoff}</span>
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 92, textAlign: "center" }}>
          <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 40, letterSpacing: 6, color: palette.sand }}>{DEV_NOTE.studio.toUpperCase()}</div>
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 32, color: palette.steel, marginTop: 14, letterSpacing: 1 }}>
            {DEV_NOTE.handle}
          </div>
        </div>
      </Scaled>
    </AbsoluteFill>
  );
};
