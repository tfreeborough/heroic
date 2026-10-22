import type * as React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CINZEL, SANS, ditherOverlay, palette } from "./brand";
import { Embers, Eyebrow, Rule, clamp, goldText } from "./cinematic";
import { Backdrop, MusicBed } from "./components";
import { BANNER_CAPTION, BANNER_STILL, DEV_NOTE, FEATURE, PREVIEW_BEATS, PREVIEW_END, PREVIEW_MUSIC, type Focus, type PreviewBeat, type StoreShotSpec } from "./data/store";

/** Google Play's feature graphic slot. It also becomes the header of the
 * listing on some surfaces (cropped, rounded) and the cover of the promo
 * video, so nothing important sits near the edges. */
export const FEATURE_SIZE = { width: 1024, height: 500 } as const;
/** Phone screenshots: 9:16, within Google's 320–3840px bounds. */
export const SHOT_SIZE = { width: 1080, height: 1920 } as const;
/** App Store Connect's 6.5" iPhone slot (the one it demands): 1284×2778
 * or 1242×2688 only. Same card, a taller frame under the caption band. */
export const APPLE_SHOT_SIZE = { width: 1284, height: 2778 } as const;
/** App previews: App Store Connect takes 886×1920 for every current
 * iPhone class; Google wants a landscape YouTube video. */
export const PREVIEW_SIZES = {
  apple: { width: 886, height: 1920 },
  play: { width: 1920, height: 1080 },
} as const;
export type PreviewPlatform = keyof typeof PREVIEW_SIZES;
/** Apple's Asset Library (2026-10): the product page header is 21:9, the
 * search results card 3:2 (1920×1280 up to 3840×2560). Image or video. */
export const BANNER_SIZES = {
  header: { width: 3840, height: 1646 },
  search: { width: 3840, height: 2560 },
} as const;
export type BannerPlacement = keyof typeof BANNER_SIZES;

/**
 * The screenshot layouts are authored at 1080 wide. Any composition size
 * renders the same logical card scaled to its width, with the extra height
 * (Apple's 9:19.5) going to the footage. Wrap the card in `<Scaled>` and
 * lay out against `useCanvas()`'s logical width/height.
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

/** The phone recordings' shape when a spec doesn't say. */
const PHONE = 874 / 1920;

/**
 * A recording covering a box: the status strip and nav bar shaved, the
 * kept picture scaled to cover the box, then pushed in by `zoom` about
 * `focus` so the fight (not the empty sand around it) is what the box
 * shows. Never leaves an edge of the picture showing. `at` picks the frame
 * (a still) or the start (a video); `volume` is the video's own sound.
 */
const CoverFootage: React.FC<{
  src: string;
  at?: number;
  aspect?: number;
  cropTop?: number;
  cropBottom?: number;
  zoom?: number;
  focus?: Focus;
  box: { w: number; h: number };
  volume?: (frame: number) => number;
  blur?: number;
}> = ({ src, at = 0, aspect = PHONE, cropTop = 0, cropBottom = 0, zoom = 1, focus = [0.5, 0.5], box, volume, blur }) => {
  const { fps } = useVideoConfig();
  const keep = Math.max(0.2, 1 - cropTop - cropBottom);
  const shown = aspect / keep;
  const w0 = Math.max(box.w, box.h * shown);
  const w = w0 * zoom;
  const h = w / shown;
  const left = Math.min(0, Math.max(box.w - w, 0.5 * box.w - focus[0] * w));
  const top = Math.min(0, Math.max(box.h - h, 0.5 * box.h - focus[1] * h));
  const media: React.CSSProperties = {
    position: "absolute",
    left: 0,
    width: "100%",
    top: `${(-cropTop / keep) * 100}%`,
    height: `${(1 / keep) * 100}%`,
    objectFit: "fill",
  };
  return (
    <div style={{ position: "absolute", left, top, width: w, height: h, overflow: "hidden", filter: blur ? `blur(${blur}px) brightness(0.45)` : undefined }}>
      {src.endsWith(".png") ? (
        <Img src={staticFile(src)} style={media} />
      ) : (
        <OffthreadVideo src={staticFile(src)} startFrom={Math.round(at * fps)} muted={!volume} volume={volume} style={media} />
      )}
    </div>
  );
};

/**
 * 1080×1920 store screenshot: the footage fills the card, zoomed onto the
 * action, with the caption over an ink wash up top. Feed it a clip (+ `at`)
 * or a PNG straight from a phone — the same card either way.
 */
export const StoreShot: React.FC<StoreShotSpec> = ({ headline, headlineSize = 96, line, src, at, aspect = PHONE, cropTop = 0, cropBottom = 0, zoom, focus, framed }) => {
  const { w, h } = useCanvas();
  // A framed menu screen sits under the caption: the kept picture as wide
  // as the card allows, rounded and edged like a phone, its bottom running
  // off the card (menus keep what matters at the top).
  const bandH = 700;
  const pad = 64;
  const keep = Math.max(0.2, 1 - cropTop - cropBottom);
  const shown = aspect / keep;
  const frameW = w - 2 * pad;
  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      <Scaled>
        {framed ? (
          <>
            <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
              <Backdrop glow={0.55} />
            </div>
            <div
              style={{
                position: "absolute",
                left: (w - frameW) / 2,
                top: bandH,
                width: frameW,
                height: Math.round(frameW / shown),
                overflow: "hidden",
                borderRadius: 40,
                border: "3px solid rgba(220,185,111,0.55)",
                boxShadow: "0 40px 90px rgba(0,0,0,0.65), 0 0 0 10px rgba(20,10,4,0.6)",
                background: palette.umber,
              }}
            >
              <CoverFootage src={src} at={at} aspect={aspect} cropTop={cropTop} cropBottom={cropBottom} box={{ w: frameW, h: Math.round(frameW / shown) }} />
            </div>
          </>
        ) : (
          <>
            <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden" }}>
              <CoverFootage src={src} at={at} aspect={aspect} cropTop={cropTop} cropBottom={cropBottom} zoom={zoom} focus={focus} box={{ w, h }} />
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 760, background: "linear-gradient(180deg, rgba(20,10,4,0.96) 0%, rgba(20,10,4,0.88) 40%, rgba(20,10,4,0.55) 72%, rgba(20,10,4,0) 100%)" }} />
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 260, background: "linear-gradient(0deg, rgba(20,10,4,0.7) 0%, rgba(20,10,4,0) 100%)" }} />
          </>
        )}
        <div style={{ position: "absolute", left: 0, right: 0, top: 110, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 64px", textAlign: "center" }}>
          <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: headlineSize, lineHeight: 1.02, color: palette.bone, whiteSpace: "pre-line", textShadow: "0 6px 0 rgba(40,20,8,0.9), 0 14px 30px rgba(0,0,0,0.7)" }}>
            {headline.toUpperCase()}
          </div>
          <div style={{ width: 120, height: 6, background: palette.crimson, margin: "26px 0 22px" }} />
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 40, lineHeight: 1.25, color: palette.sand, maxWidth: 940, whiteSpace: "pre-line", textShadow: "0 2px 10px rgba(0,0,0,0.8)" }}>{line}</div>
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

/* ───────────────────────── the store preview video ───────────────────────── */

/** The footage's own sound: in over a few frames, out before the cut. */
const beatVolume = (frames: number) => (f: number) =>
  interpolate(f, [0, 6, frames - 9, frames - 1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

/** A caption that lands with a spring and leaves before the cut. */
const useCaptionShow = (frames: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 4, fps, config: { damping: 16, stiffness: 110 } });
  const gone = interpolate(frame, [frames - 14, frames - 4], [0, 1], { easing: Easing.in(Easing.cubic), ...clamp });
  return { s, show: Math.min(s, 1 - gone), gone };
};

/** Portrait: the caption on an ink band low in the frame, under the fight. */
const VerticalCaption: React.FC<{ text: string; frames: number; k: number }> = ({ text, frames, k }) => {
  const { s, show, gone } = useCaptionShow(frames);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: Math.round(330 * k), display: "flex", justifyContent: "center", padding: `0 ${Math.round(56 * k)}px` }}>
      <div
        style={{
          borderLeft: `${Math.round(7 * k)}px solid ${palette.crimson}`,
          background: "linear-gradient(90deg, rgba(20,10,4,0.88) 0%, rgba(20,10,4,0.72) 70%, rgba(20,10,4,0.3) 100%)",
          padding: `${Math.round(30 * k)}px ${Math.round(48 * k)}px ${Math.round(30 * k)}px ${Math.round(36 * k)}px`,
          opacity: show,
          transform: `translateX(${(1 - s) * -40 - gone * 40}px)`,
          maxWidth: "100%",
        }}
      >
        <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: Math.round(66 * k), lineHeight: 1.1, color: palette.bone, textShadow: "0 4px 0 rgba(40,20,8,0.9), 0 10px 24px rgba(0,0,0,0.6)" }}>
          {text.toUpperCase()}
        </div>
      </div>
    </div>
  );
};

/** Landscape: the caption lives in the column left of the footage. */
const ColumnCaption: React.FC<{ text: string; frames: number; width: number }> = ({ text, frames, width }) => {
  const { s, show, gone } = useCaptionShow(frames);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width, display: "flex", alignItems: "center", padding: "0 60px 0 90px" }}>
      <div style={{ opacity: show, transform: `translateX(${(1 - s) * -40 - gone * 40}px)` }}>
        <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 70, lineHeight: 1.08, color: palette.bone, textShadow: "0 4px 0 rgba(40,20,8,0.9), 0 10px 24px rgba(0,0,0,0.6)" }}>
          {text.toUpperCase()}
        </div>
        <div style={{ width: 120, height: 6, background: palette.crimson, marginTop: 28, transform: `scaleX(${s})`, transformOrigin: "left" }} />
      </div>
    </div>
  );
};

/** The closing card: the helmet, the name, where it is, who made it. */
const PreviewEndCard: React.FC<{ platform: PreviewPlatform }> = ({ platform }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = platform === "apple" ? width / 1080 : 0.85;
  const at = (start: number, len = 14) => interpolate(frame, [start, start + len], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const icon = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const sweep = interpolate(frame, [6, 50], [0, 1], clamp);
  const iconSize = Math.round(300 * k);
  return (
    <AbsoluteFill>
      <Backdrop glow={0.6} />
      <Embers />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: Math.round(34 * k), paddingBottom: Math.round(height * 0.04) }}>
        <Img
          src={staticFile("assets/app-icon.png")}
          style={{ width: iconSize, height: iconSize, borderRadius: iconSize * 0.22, transform: `scale(${icon})`, boxShadow: "0 30px 70px rgba(0,0,0,0.6), 0 0 0 1px rgba(242,233,212,0.12)" }}
        />
        <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: Math.round(78 * k), letterSpacing: 4, textAlign: "center", lineHeight: 1.1, whiteSpace: "nowrap", opacity: at(8), ...goldText(sweep) }}>
          {PREVIEW_END.game}
        </div>
        <Rule progress={at(16, 20)} width={Math.round(200 * k)} />
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: Math.round(44 * k), color: palette.bone, textAlign: "center", opacity: at(24), transform: `translateY(${(1 - at(24)) * 16}px)` }}>
          {PREVIEW_END.line}
        </div>
        <div style={{ opacity: at(36), transform: `translateY(${(1 - at(36)) * 16}px)` }}>
          <Eyebrow text={PREVIEW_END.eyebrow} opacity={1} size={Math.round(24 * k)} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * The store preview: real match footage back to back, a line per beat,
 * then the card. `apple` = 886×1920 for App Store Connect (≤30s, footage
 * only, which this is); `play` = 1920×1080 for YouTube, the portrait
 * footage framed in the middle over a blurred fill, the line in the column
 * beside it. The cut is data: PREVIEW_BEATS in src/data/store.ts.
 */
export const StorePreview: React.FC<{ platform: PreviewPlatform }> = ({ platform }) => {
  const { fps, width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const vertical = platform === "apple";
  const k = vertical ? width / 1080 : 1;
  // Landscape: a wide window onto the fight in the middle (the picture
  // covers it and crops to the focus, so the action is big, not the whole
  // phone screen small), the line in the column to the left.
  const column = vertical ? 0 : Math.round(width * 0.305);
  const stage = vertical ? { w: width, h: height } : { w: width - column * 2, h: height };
  let start = 0;
  const beats = PREVIEW_BEATS.map((b) => {
    const seqFrom = Math.round(start * fps);
    const frames = Math.round(b.seconds * fps);
    start += b.seconds;
    return { ...b, seqFrom, frames };
  });
  const endFrom = Math.round(start * fps);
  const endFrames = Math.round(PREVIEW_END.seconds * fps);
  const fadeIn = interpolate(frame, [0, 8], [0, 1], clamp);
  const beatBox = (_b: PreviewBeat): { w: number; h: number } => stage;
  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      {beats.map((b, i) => {
        const box = beatBox(b);
        const left = Math.round((width - box.w) / 2);
        return (
          <Sequence key={`${b.src}-${i}`} from={b.seqFrom} durationInFrames={b.frames} name={b.caption || b.src}>
            {!vertical ? (
              <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
                <CoverFootage src={b.src} at={b.from} aspect={b.aspect} cropTop={b.cropTop} cropBottom={b.cropBottom} zoom={1.1} focus={b.focus} box={{ w: width, h: height }} blur={36} />
                <AbsoluteFill style={ditherOverlay} />
              </div>
            ) : null}
            <div style={{ position: "absolute", left, top: 0, width: box.w, height: box.h, overflow: "hidden", boxShadow: vertical ? undefined : "0 0 0 2px rgba(220,185,111,0.35), 0 40px 90px rgba(0,0,0,0.7)" }}>
              <CoverFootage
                src={b.src}
                at={b.from}
                aspect={b.aspect}
                cropTop={b.cropTop}
                cropBottom={b.cropBottom}
                zoom={vertical ? b.zoom : 1}
                focus={b.focus}
                box={box}
                volume={beatVolume(b.frames)}
              />
            </div>
            {vertical ? (
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: Math.round(height * 0.42), background: "linear-gradient(0deg, rgba(20,10,4,0.75) 0%, rgba(20,10,4,0.35) 45%, rgba(20,10,4,0) 100%)" }} />
            ) : null}
            {b.caption ? (vertical ? <VerticalCaption text={b.caption} frames={b.frames} k={k} /> : <ColumnCaption text={b.caption} frames={b.frames} width={column + 20} />) : null}
          </Sequence>
        );
      })}
      {!vertical ? (
        <div style={{ position: "absolute", right: 90, top: 0, bottom: 0, width: column - 90, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, opacity: frame < endFrom ? 1 : 0 }}>
          <Img src={staticFile("assets/app-icon.png")} style={{ width: 150, height: 150, borderRadius: 33, boxShadow: "0 20px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(242,233,212,0.12)" }} />
          <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 30, letterSpacing: 3, color: palette.bone, textAlign: "center", lineHeight: 1.2 }}>
            BLOOD
            <br />
            IN THE SAND
          </div>
          <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 16, letterSpacing: 2, color: palette.sand, border: `2px solid ${palette.sand}`, padding: "6px 14px", background: "rgba(20,10,4,0.55)" }}>
            FREE TO PLAY
          </span>
        </div>
      ) : null}
      <Sequence from={endFrom} durationInFrames={endFrames} name="end card">
        <PreviewEndCard platform={platform} />
      </Sequence>
      <MusicBed music={PREVIEW_MUSIC.file || undefined} from={PREVIEW_MUSIC.from} level={PREVIEW_MUSIC.level} />
      <AbsoluteFill style={{ backgroundColor: palette.night, opacity: 1 - fadeIn, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

/* ───────────────────── Apple's Asset Library placements ───────────────────── */

/** Apple's safe area for the header and search card, measured in the App
 * Store Connect preview: about 18% in from the sides, 15% top and bottom. */
const SAFE = { x: 0.18, y: 0.15 } as const;
/** Just past the fit: the recordings carry a dark column down their left edge that a wide crop would show. */
const SHAVE = 1.015;

/** The search card's line, inside the safe area, top left (the game's own round banners sit lower). */
const BannerCaption: React.FC<{ text: string; frames: number }> = ({ text, frames }) => {
  const { width, height } = useVideoConfig();
  const { s, show, gone } = useCaptionShow(frames);
  const k = width / 3840;
  return (
    <div style={{ position: "absolute", left: Math.round(width * SAFE.x), top: Math.round(height * SAFE.y), opacity: show, transform: `translateX(${(1 - s) * -40 - gone * 40}px)` }}>
      <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: Math.round(170 * k), lineHeight: 1.08, color: palette.bone, textShadow: "0 8px 0 rgba(40,20,8,0.9), 0 20px 48px rgba(0,0,0,0.7)" }}>
        {text.toUpperCase()}
      </div>
      <div style={{ width: Math.round(260 * k), height: Math.round(14 * k), background: palette.crimson, marginTop: Math.round(40 * k), transform: `scaleX(${s})`, transformOrigin: "left" }} />
    </div>
  );
};

/**
 * The header / search video: the preview beats, each cover-cropped to the
 * wide frame about its `focus` (the fight fills the strip; on a phone the
 * header is only as tall as a thumb). Loops, so no fade-in and no end
 * card; muted by default on the store, the sound is there if they tap it.
 */
export const StoreBanner: React.FC<{ placement: BannerPlacement }> = ({ placement }) => {
  const { fps, width, height } = useVideoConfig();
  let start = 0;
  const beats = PREVIEW_BEATS.map((b) => {
    const seqFrom = Math.round(start * fps);
    const frames = Math.round(b.seconds * fps);
    start += b.seconds;
    return { ...b, seqFrom, frames };
  });
  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      {beats.map((b, i) => (
        <Sequence key={`${b.src}-${i}`} from={b.seqFrom} durationInFrames={b.frames} name={b.caption || b.src}>
          <CoverFootage src={b.src} at={b.from} aspect={b.aspect} cropTop={b.cropTop} cropBottom={b.cropBottom} zoom={SHAVE} focus={b.focus} box={{ w: width, h: height }} volume={beatVolume(b.frames)} />
          {placement === "search" ? (
            <>
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: Math.round(height * 0.5), background: "linear-gradient(180deg, rgba(20,10,4,0.7) 0%, rgba(20,10,4,0.3) 50%, rgba(20,10,4,0) 100%)" }} />
              {b.caption ? <BannerCaption text={b.caption} frames={b.frames} /> : null}
            </>
          ) : null}
        </Sequence>
      ))}
      <MusicBed music={PREVIEW_MUSIC.file || undefined} from={PREVIEW_MUSIC.from} level={PREVIEW_MUSIC.level} loop />
    </AbsoluteFill>
  );
};

/** The same crop as a still: one frame, the search card with its line. */
export const StoreBannerStill: React.FC<{ placement: BannerPlacement }> = ({ placement }) => {
  const { width, height } = useVideoConfig();
  const k = width / 3840;
  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      <CoverFootage src={BANNER_STILL.src} at={BANNER_STILL.at} aspect={BANNER_STILL.aspect} zoom={SHAVE} focus={BANNER_STILL.focus} box={{ w: width, h: height }} />
      {placement === "search" ? (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: Math.round(height * 0.5), background: "linear-gradient(180deg, rgba(20,10,4,0.7) 0%, rgba(20,10,4,0.3) 50%, rgba(20,10,4,0) 100%)" }} />
          <div style={{ position: "absolute", left: Math.round(width * SAFE.x), top: Math.round(height * SAFE.y) }}>
            <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: Math.round(170 * k), lineHeight: 1.08, color: palette.bone, textShadow: "0 8px 0 rgba(40,20,8,0.9), 0 20px 48px rgba(0,0,0,0.7)" }}>
              {BANNER_CAPTION.toUpperCase()}
            </div>
            <div style={{ width: Math.round(260 * k), height: Math.round(14 * k), background: palette.crimson, marginTop: Math.round(40 * k) }} />
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  );
};
