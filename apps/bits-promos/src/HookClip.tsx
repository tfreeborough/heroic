import type * as React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { CINZEL, SANS, palette } from "./brand";
import { BrandMark, LowerThird, SignOff, chromeTop, clamp, goldText, useType } from "./cinematic";
import { Backdrop, MusicBed, Outro, RecChip, useFormat } from "./components";
import { clipSrc } from "./GameplayClip";
import { DEV } from "./data/copy";
import { Stage, useSourceAspect, useStage } from "./stage";

/** The props panel / Desk form for a hook clip. Every field described. */
export const hookClipSchema = z.object({
  clip: z
    .string()
    .describe('The recording, as a path under public/ (e.g. "footage/VID_1.mp4"); a bare filename means public/clips/. Empty = placeholder.'),
  hook: z
    .string()
    .describe('The hook: on screen from the very first frame, big (e.g. "He had 1 HP. Then the Harpoon."). In the Desk, several hooks separated by | render as separate videos to test against each other'),
  hookFor: z.number().min(1).max(10).optional().describe("Seconds the hook stays up before it lifts off (default 3 — the scroll decision window)"),
  look: z.enum(["bold", "gold"]).optional().describe("How the hook is set: bold white sans with a crimson bar (default), or the game's tracked gold caps"),
  follow: z.string().optional().describe('An optional second line on the lower third once the hook lifts (e.g. "Nothing is aimed. Everything is a telegraph.")'),
  durationSeconds: z.number().min(1).describe("Seconds of gameplay before the end card — in the Desk, leave empty for the rest of the clip"),
  startFrom: z.number().min(0).optional().describe("Seconds into the recording to start from — start ON the action, one second before the payoff, never on the setup"),
  muted: z.boolean().optional().describe("Drop the recording's own audio"),
  music: z.string().optional().describe("A song from the game (public/music/), played under the whole video. Record with Battle music off in Settings"),
  musicFrom: z.number().min(0).optional().describe("Seconds into the song to start from (the songs build, so the heavy part is usually 60s+ in)"),
  musicVolume: z.number().min(0).max(1).optional().describe("The song's level, 0 to 1 (default 0.8; the recording plays at 1)"),
  cropTop: z.number().min(0).max(0.4).optional().describe("Fraction of the recording's height to shave off the top (status strip)"),
  cropBottom: z.number().min(0).max(0.4).optional().describe("Fraction of the recording's height to shave off the bottom (nav bar)"),
  ending: z.enum(["signoff", "pitch"]).optional().describe("How it closes: the developer's sign-off (default) or the feature-list pitch the spotlights use"),
  push: z.number().min(0).max(0.1).optional().describe("A slow push-in on the footage, as a fraction (default 0 = still — pixel art crawls under a zoom; 0.03 if you want it anyway)"),
  sourceAspect: z.number().min(0.2).max(5).optional().describe("The recording's width ÷ height; the Desk fills this from the sidecar, a CLI render reads the file"),
  format: z.enum(["vertical", "square", "landscape"]).optional().describe("Output shape: 9:16 (default), 1:1 or 16:9"),
});
export type HookClipProps = z.infer<typeof hookClipSchema>;

/**
 * The cut, in seconds. There is no title beat: the hook is on the first
 * frame, holds for `hookFor` (default below), lifts, and the optional
 * follow line takes the lower third. `outro` matches the match clip's so
 * the Desk's timing holds.
 */
export const HOOK_TIMING = { outro: 6, hookFor: 3.0, followAfter: 0.3, followFor: 4.0, dip: 0.4 } as const;

/** Total length: the cut plus the end card. */
export const hookClipDurationSeconds = (p: Pick<HookClipProps, "durationSeconds">): number => p.durationSeconds + HOOK_TIMING.outro;

/** The Desk's field can carry several hooks: "a | b | c" → three videos. */
export const splitHooks = (hook: string): string[] =>
  hook
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The hook card: fully legible on frame zero (that frame is also the
 * cover), a quick settle rather than an entrance, a scrim so it reads on
 * busy pixel art, then it lifts off at `until`. Sits in the upper part of
 * the footage — clear of the platforms' header above and their caption /
 * buttons below — or in the column beside the play in landscape.
 */
const HookCard: React.FC<{ hook: string; until: number; look: "bold" | "gold" }> = ({ hook, until, look }) => {
  const frame = useCurrentFrame();
  const { format, width, height } = useFormat();
  const { box, column } = useStage();
  const k = useType();
  const settle = interpolate(frame, [0, 8], [1.05, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const bar = interpolate(frame, [0, 14], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const sweep = interpolate(frame, [4, 50], [0, 1], { easing: Easing.inOut(Easing.quad), ...clamp });
  const out = interpolate(frame, [until, until + 10], [0, 1], { easing: Easing.in(Easing.cubic), ...clamp });
  const show = 1 - out;
  const gold = look === "gold";
  const long = hook.length > 40;
  const size = Math.round((gold ? (long ? 60 : 76) : long ? 64 : 80) * k);
  const maxWidth = column ? box.x - 120 : Math.min(box.w, width) - Math.round(90 * k);

  const text: React.CSSProperties = gold
    ? { fontFamily: CINZEL, fontWeight: 700, fontSize: size, lineHeight: 1.1, letterSpacing: size * 0.04, textTransform: "uppercase", ...goldText(sweep) }
    : { fontFamily: SANS, fontWeight: 800, fontSize: size, lineHeight: 1.08, letterSpacing: -size * 0.01, color: palette.bone, textShadow: "0 3px 0 rgba(20,10,4,0.9), 0 6px 24px rgba(0,0,0,0.6)" };

  const block = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: column ? "flex-start" : "center",
        gap: Math.round(20 * k),
        maxWidth,
        opacity: show,
        transform: `scale(${settle}) translateY(${-out * 30}px)`,
        transformOrigin: column ? "left center" : "center",
      }}
    >
      <div style={{ ...text, textAlign: column ? "left" : "center", textWrap: "balance" } as React.CSSProperties}>{hook}</div>
      <div
        style={{
          width: Math.round((gold ? 220 : 160) * k * bar),
          height: Math.round((gold ? 2 : 8) * k),
          background: gold ? `linear-gradient(90deg, ${palette.sand}, rgba(220,185,111,0.2))` : palette.crimson,
          boxShadow: gold ? undefined : "0 3px 0 rgba(20,10,4,0.8)",
          alignSelf: column ? "flex-start" : "center",
        }}
      />
    </div>
  );

  if (column) {
    return (
      <div style={{ position: "absolute", left: 90, top: 0, bottom: 0, width: box.x - 120, display: "flex", alignItems: "center" }}>
        {block}
      </div>
    );
  }
  const top = format === "vertical" ? Math.round(height * 0.2) : box.y + Math.round(box.h * 0.1);
  return (
    <div style={{ position: "absolute", left: 0, width, top, display: "flex", justifyContent: "center" }}>
      {/* a scrim band so the words read on any frame of pixel art */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: width * 1.2,
          height: Math.round(420 * k),
          transform: "translate(-50%, -50%)",
          background: "radial-gradient(ellipse at 50% 50%, rgba(20,10,4,0.7) 0%, rgba(20,10,4,0.45) 40%, rgba(20,10,4,0) 70%)",
          opacity: show,
        }}
      />
      {block}
    </div>
  );
};

/**
 * A match clip built for the scroll: the footage is playing AND the hook
 * is on screen at frame zero — there is no title screen for the viewer to
 * thumb past. The hook holds three seconds and lifts; the brand mark, REC
 * chip and an optional follow line on the lower third take over; the
 * audio eases into a dip; then the developer's sign-off. The footage never
 * moves (pixel art crawls under a zoom); the blurred fill breathes.
 *
 * It is the match clip's sibling, kept separate so hook experiments never
 * disturb the premium cut. Everything after the hook is the same grammar.
 */
export const HookClip: React.FC<HookClipProps> = ({ clip, hook, hookFor = HOOK_TIMING.hookFor, look = "bold", follow, startFrom = 0, muted = false, music, musicFrom, musicVolume, cropTop, cropBottom, ending = "signoff", push, sourceAspect }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { format } = useFormat();
  const bodyEnd = durationInFrames - Math.round(HOOK_TIMING.outro * fps);
  const dip = Math.round(HOOK_TIMING.dip * fps);
  const bodyOut = interpolate(frame, [bodyEnd - dip, bodyEnd], [1, 0], clamp);
  const hookUntil = Math.min(Math.round(hookFor * fps), bodyEnd - 12);
  const followAt = hookUntil + Math.round(HOOK_TIMING.followAfter * fps);
  const src = clip ? clipSrc(clip) : null;
  const aspect = useSourceAspect(src, sourceAspect);
  const clipVolume = (f: number) => interpolate(f, [bodyEnd - fps * 0.8, bodyEnd], [1, 0], clamp);
  // The Desk may hand over "a | b | c" for a preview; a render always gets one.
  const line = splitHooks(hook)[0] ?? hook;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      <MusicBed music={music} from={musicFrom} level={musicVolume} />
      <Sequence durationInFrames={bodyEnd}>
        <AbsoluteFill style={{ opacity: bodyOut }}>
          {src ? (
            <Stage src={src} startFrom={Math.round(startFrom * fps)} muted={muted} cropTop={cropTop} cropBottom={cropBottom} aspect={aspect} volume={clipVolume} push={push}>
              <BrandMark from={hookUntil} />
              <RecChip from={hookUntil + 6} top={chromeTop(format)} />
              {line ? <HookCard hook={line} until={hookUntil} look={look} /> : null}
              {follow ? <LowerThird kicker={DEV.matchClip.real} line={follow} at={followAt} until={followAt + Math.round(HOOK_TIMING.followFor * fps)} /> : null}
            </Stage>
          ) : (
            <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
              <Backdrop glow={0.3} />
              <div style={{ fontFamily: SANS, fontSize: 40, color: palette.steel, textAlign: "center", padding: "0 90px" }}>
                Pick a recording and set the clip prop
              </div>
            </AbsoluteFill>
          )}
        </AbsoluteFill>
      </Sequence>
      <Sequence from={bodyEnd}>{ending === "pitch" ? <Outro /> : <SignOff />}</Sequence>
    </AbsoluteFill>
  );
};
