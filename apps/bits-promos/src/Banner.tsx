import type * as React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { CINZEL, SANS, ditherOverlay, palette } from "./brand";

/**
 * The Free the Borough Games YouTube channel banner (bun run render:banner).
 *
 * YouTube shows a different crop of the same 2560×1440 upload per device:
 * TVs the whole thing, desktop a 2560×423 strip through the middle, phones
 * only the centre 1546×423. So everything that has to be read sits inside
 * that centre box; the rest is the arena painting for the bigger screens.
 * `guides` draws those crops on top for checking, never for upload.
 */
export const BANNER_SIZE = { width: 2560, height: 1440 } as const;
const SAFE = { width: 1546, height: 423 } as const;
const SAFE_TOP = (BANNER_SIZE.height - SAFE.height) / 2;
const SAFE_LEFT = (BANNER_SIZE.width - SAFE.width) / 2;

const BANNER = {
  name: "Free the Borough",
  sub: "Games",
  line: "Making the games I wish I'd had growing up",
  credit: "Blood in the Sand, out now on iPhone and Android",
};

// The title painting is 1024×1536 portrait; at 2.5× it spans the width and
// this offset parks the arches behind the desktop strip with the sun above.
const ART_SCALE = BANNER_SIZE.width / 1024;
const ART_TOP = SAFE_TOP - 330 * ART_SCALE;

export type BannerProps = { guides?: boolean };

export const ChannelBanner: React.FC<BannerProps> = ({ guides = false }) => (
  <AbsoluteFill style={{ backgroundColor: palette.night, overflow: "hidden" }}>
    <Img
      src={staticFile("assets/home.png")}
      style={{
        position: "absolute",
        left: 0,
        top: ART_TOP,
        width: BANNER_SIZE.width,
        height: 1536 * ART_SCALE,
        imageRendering: "pixelated",
      }}
    />
    {/* Ink wash across the strip so the words sit on dark, feathered out to the art. */}
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, rgba(20,10,4,0) 0%, rgba(20,10,4,0) 26%, rgba(20,10,4,0.72) 38%, rgba(20,10,4,0.82) 50%, rgba(20,10,4,0.72) 62%, rgba(20,10,4,0) 76%, rgba(20,10,4,0) 100%)`,
      }}
    />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse 50% 32% at 50% 50%, rgba(20,10,4,0.5) 0%, rgba(20,10,4,0) 100%)" }} />
    <AbsoluteFill style={ditherOverlay} />

    <div
      style={{
        position: "absolute",
        left: SAFE_LEFT,
        top: SAFE_TOP,
        width: SAFE.width,
        height: SAFE.height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontFamily: CINZEL,
          fontWeight: 700,
          fontSize: 116,
          whiteSpace: "nowrap",
          lineHeight: 0.95,
          color: palette.bone,
          letterSpacing: 6,
          textShadow: "0 7px 0 rgba(40,20,8,0.9), 0 16px 40px rgba(0,0,0,0.6)",
        }}
      >
        {BANNER.name}
      </div>
      <div
        style={{
          fontFamily: CINZEL,
          fontWeight: 700,
          fontSize: 48,
          lineHeight: 1,
          color: palette.sand,
          letterSpacing: 24,
          marginTop: 6,
          marginRight: -24, // letter-spacing trails the last glyph; pull it back to centre
          textShadow: "0 4px 0 rgba(40,20,8,0.9), 0 12px 28px rgba(0,0,0,0.6)",
        }}
      >
        {BANNER.sub}
      </div>
      <div style={{ width: 150, height: 6, background: palette.crimson, margin: "22px 0 22px", boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }} />
      <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 48, color: palette.bone, textShadow: "0 3px 10px rgba(0,0,0,0.8)" }}>
        {BANNER.line}
      </div>
      <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 28, letterSpacing: 1, color: palette.sand, marginTop: 22, textShadow: "0 2px 8px rgba(0,0,0,0.85)" }}>
        {BANNER.credit}
      </div>
    </div>

    {guides ? <Guides /> : null}
  </AbsoluteFill>
);

const Guides: React.FC = () => (
  <>
    <Crop label="desktop strip (2560 × 423)" left={0} width={BANNER_SIZE.width} color="#3fa9f5" />
    <Crop label="phone safe area (1546 × 423)" left={SAFE_LEFT} width={SAFE.width} color="#ff3b6b" />
  </>
);

const Crop: React.FC<{ label: string; left: number; width: number; color: string }> = ({ label, left, width, color }) => (
  <div style={{ position: "absolute", left, top: SAFE_TOP, width, height: SAFE.height, border: `4px dashed ${color}`, boxSizing: "border-box" }}>
    <div style={{ position: "absolute", left: 12, top: 8, fontFamily: SANS, fontWeight: 700, fontSize: 26, color }}>{label}</div>
  </div>
);
