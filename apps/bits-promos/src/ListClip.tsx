import type * as React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import type { Playable } from "@heroic/voiceover";
import { SANS, palette } from "./brand";
import { BrandMark, SignOff, chromeTop, clamp, goldText, useType } from "./cinematic";
import { Backdrop, MusicBed, Outro, useFormat } from "./components";
import { clipSrc } from "./GameplayClip";
import { HOOK_TIMING, HookCard, isLoop } from "./HookClip";
import { Stage, useSequence, useSourceAspect, useStage } from "./stage";
import { VoiceLayer, useBed, useVoice, voiceProps } from "./voice";
import { LIST_TIMING, type Window, filledItems, itemTimes, mergeWindows, numberOf, windowLevel } from "./listTiming";

export { LIST_TIMING, filledItems, itemTimes, markerWarning, numberOf } from "./listTiming";

/**
 * A list clip: "3 mistakes I made making my game". The maker talks over an
 * edit; the title is the hook on frame 0; when it lifts, the list shows with
 * every slot numbered and blank, and each item lands on a marker dropped in
 * the Desk's editor, big first, then into its slot. The list comes and goes:
 * it's up for a few seconds after the title and for `showFor` from each
 * marker, with the footage dimmed behind it, and the footage has the frame
 * to itself in between. It counts down by default, so #1 is still blank
 * every time the list comes back, until the end.
 * Design: docs/design/desk-list-clip.md.
 */
export const listClipSchema = z.object({
  clip: z
    .string()
    .describe('A Desk edit (e.g. "sequences/devlog-1.json"), whose markers time the items, or a recording (the items are then spaced evenly). Empty = placeholder.'),
  hook: z.string().describe('The title, and the hook: on screen from the very first frame (e.g. "3 mistakes I made making my game"). In the Desk, add several and each renders as its own video'),
  items: z.array(z.string()).describe("The items, in the order you say them. Each lands on the next marker"),
  order: z.enum(["down", "up"]).optional().describe("down (default): the first item you say is the highest number and the last is #1. up: 1 first"),
  titleFor: z.number().min(1).max(10).optional().describe("Seconds the title stays up big before it becomes the list's header (default 3; cut short if the first marker comes sooner)"),
  hold: z.number().min(0.5).max(5).optional().describe("Seconds each item stays big before it settles into its slot (default 1.5; shorter if the next marker comes sooner)"),
  showFor: z.number().min(3).max(60).optional().describe("Seconds the list stays up from each marker before it fades away with the dim behind it (default 9). It stays up if the next marker comes first"),
  dim: z.number().min(0).max(0.9).optional().describe("How dark the footage goes behind the title and the list, 0 to 0.9 (default 0.6)"),
  look: z.enum(["bold", "gold"]).optional().describe("How the title is set: bold white sans with a crimson bar (default), or the game's tracked gold caps"),
  durationSeconds: z.number().min(1).describe("Seconds of footage (plus the end card, if it has one). In the Desk, leave empty for the rest of the edit"),
  startFrom: z.number().min(0).optional().describe("Seconds into the edit to start from"),
  muted: z.boolean().optional().describe("Drop the footage's own sound"),
  music: z.string().optional().describe("A song from the game (public/music/), played under the whole video"),
  musicFrom: z.number().min(0).optional().describe("Seconds into the song to start from"),
  musicVolume: z.number().min(0).max(1).optional().describe("The song's level, 0 to 1 (default 0.8)"),
  videoVolume: z.number().min(0).max(1).optional().describe("The footage's own sound, 0 to 1 (default 1)"),
  cropTop: z.number().min(0).max(0.4).optional().describe("Fraction of the recording's height to shave off the top (a plain recording only; an edit frames each shot itself)"),
  cropBottom: z.number().min(0).max(0.4).optional().describe("Fraction of the recording's height to shave off the bottom"),
  ending: z.enum(["loop", "signoff", "pitch"]).optional().describe("How it closes: loop (default) clears the list and drops the title back in for the replay; or the developer's sign-off, or the pitch"),
  push: z.number().min(0).max(0.1).optional().describe("A slow push-in on the footage (default 0)"),
  sourceAspect: z.number().min(0.2).max(5).optional().describe("The recording's width ÷ height; the Desk fills this"),
  format: z.enum(["vertical", "square", "landscape"]).optional().describe("Output shape: 9:16 (default), 1:1 or 16:9"),
  ...voiceProps,
});
export type ListClipProps = z.infer<typeof listClipSchema>;

export const listClipDurationSeconds = (p: Pick<ListClipProps, "durationSeconds" | "ending">): number => p.durationSeconds + (isLoop(p.ending) ? 0 : HOOK_TIMING.outro);

/** Sizes for a list of `n`, at the shape's type scale. */
const rowSize = (n: number, k: number) => Math.round((n <= 3 ? 54 : n <= 5 ? 46 : 38) * k);
/** The numbers: heavy sans, since Cinzel's 1 reads as an I. */
const numberText = (size: number): React.CSSProperties => ({ fontFamily: SANS, fontWeight: 900, fontSize: size, lineHeight: 1.05, letterSpacing: -size * 0.02 });
/** A line that would run past two lines at full size steps down. Roughly 0.52em a character in Inter's heavy weights. */
const fit = (text: string, size: number, width: number) => {
  const perLine = width / (size * 0.52);
  return text.length > perLine * 2 ? Math.max(Math.round(size * 0.78), Math.round((size * perLine * 2) / text.length)) : size;
};
/** The band the list and the arriving item sit in: under the brand mark, clear of the captions. Px in from the top and the bottom. */
const band = (format: string, height: number, k: number) =>
  format === "vertical" ? { top: chromeTop(format) + Math.round(84 * k), bottom: Math.round(height * 0.38) } : format === "square" ? { top: 100, bottom: Math.round(height * 0.26) } : { top: 90, bottom: Math.round(height * 0.2) };

const GOLD_PLATE = `linear-gradient(155deg, ${palette.bone} 0%, ${palette.sand} 42%, #a8843a 100%)`;

type Slot = { number: number; text: string; at: number };

/**
 * The list: the title as a header, then a plate for every slot, #1 at the
 * top. A plate is a dashed outline with a hollow number until its item
 * lands; then it fills, the number turns gold and the words wipe in, with
 * the plate lit gold while it's the one being talked about. `level` is how
 * much of the list shows (it comes and goes with the dim behind it).
 */
const ListPanel: React.FC<{ title: string; slots: Slot[]; settle: number[]; level: number }> = ({ title, slots, settle, level }) => {
  const frame = useCurrentFrame();
  const { format, width, height } = useFormat();
  const { box, column } = useStage();
  const k = useType();
  const n = slots.length;
  const size = rowSize(n, k);
  const chip = Math.round(size * 1.45);
  const padX = Math.round(size * 0.36);
  const padY = Math.round(size * 0.28);
  const gap = Math.round(size * 0.42);
  const radius = Math.round(size * 0.34);
  const line = Math.max(2, Math.round(3 * k));
  const panelW = column ? box.x - 120 : format === "landscape" ? Math.min(1100, width - 200) : width - Math.round(128 * k);
  const textW = panelW - padX * 2 - chip - gap;
  // The item being talked about: the latest to have landed.
  let current = -1;
  slots.forEach((s, i) => {
    if (frame >= s.at && (current < 0 || s.at >= slots[current]!.at)) current = i;
  });
  if (level <= 0) return null;

  const list = (
    <div style={{ width: panelW, display: "flex", flexDirection: "column", gap: Math.round(size * 0.26), opacity: level, transform: `translateY(${(1 - level) * 14}px) scale(${0.97 + 0.03 * level})` }}>
      <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: Math.round(size * 1.08), lineHeight: 1.1, letterSpacing: -size * 0.01, color: palette.bone, textShadow: "0 3px 0 rgba(20,10,4,0.9), 0 6px 20px rgba(0,0,0,0.6)", textWrap: "balance" } as React.CSSProperties}>{title}</div>
      <div style={{ width: Math.round(140 * k), height: Math.round(8 * k), background: palette.crimson, boxShadow: "0 3px 0 rgba(20,10,4,0.8)", marginBottom: Math.round(size * 0.2) }} />
      {slots.map((s, i) => {
        const landed = settle[i] ?? Infinity;
        const wipe = interpolate(frame, [landed, landed + 10], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
        const lit = i === current ? interpolate(frame, [landed, landed + 6], [0, 1], clamp) : 0;
        const fs = fit(s.text, size, textW);
        return (
          <div key={s.number} style={{ position: "relative", display: "flex", alignItems: "center", gap, padding: `${padY}px ${padX}px`, borderRadius: radius }}>
            {/* the plate: an outline while blank, filled once landed, gold while it's the one being talked about */}
            <div style={{ position: "absolute", inset: 0, borderRadius: radius, border: `${line}px dashed rgba(242,233,212,0.24)`, background: "rgba(242,233,212,0.03)", opacity: 1 - wipe }} />
            <div style={{ position: "absolute", inset: 0, borderRadius: radius, background: "linear-gradient(rgba(242,233,212,0.08), rgba(242,233,212,0.08)), rgba(20,10,4,0.62)", boxShadow: `inset 0 0 0 ${line}px rgba(242,233,212,0.16)`, opacity: wipe * (1 - lit) }} />
            <div style={{ position: "absolute", inset: 0, borderRadius: radius, background: "linear-gradient(90deg, rgba(220,185,111,0.3), rgba(220,185,111,0.1)), rgba(20,10,4,0.62)", boxShadow: `inset 0 0 0 ${line}px ${palette.sand}, 0 10px 34px rgba(0,0,0,0.4)`, opacity: lit }} />
            <div style={{ position: "relative", flexShrink: 0, width: chip, height: chip, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: Math.round(radius * 0.8), border: `${line}px solid rgba(242,233,212,0.3)`, opacity: 1 - wipe }} />
              <div style={{ position: "absolute", inset: 0, borderRadius: Math.round(radius * 0.8), background: GOLD_PLATE, boxShadow: "inset 0 -4px 0 rgba(74,53,32,0.35), 0 4px 0 rgba(20,10,4,0.7)", opacity: wipe }} />
              <div style={{ position: "relative", ...numberText(Math.round(size * 0.98)), color: wipe > 0.5 ? palette.night : "rgba(242,233,212,0.5)" }}>{s.number}</div>
            </div>
            {/* one line high while blank, so the blanks don't give away which items are long; it opens as the words come in */}
            <div style={{ position: "relative", flex: 1, minHeight: Math.round(size * 1.12), maxHeight: Math.round(size * 1.15 * (1 + 2 * wipe)), overflow: "hidden", display: "flex", alignItems: "center" }}>
              <div
                style={{
                  fontFamily: SANS,
                  fontWeight: 800,
                  fontSize: fs,
                  lineHeight: 1.12,
                  letterSpacing: -fs * 0.01,
                  color: palette.bone,
                  textShadow: "0 3px 0 rgba(20,10,4,0.9), 0 6px 18px rgba(0,0,0,0.6)",
                  clipPath: `inset(-20% ${(1 - wipe) * 100}% -20% 0)`,
                  textWrap: "balance",
                } as React.CSSProperties}
              >
                {s.text}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  if (column) {
    return (
      <div style={{ position: "absolute", left: 90, top: 0, bottom: 0, width: panelW, display: "flex", alignItems: "center" }}>
        {list}
      </div>
    );
  }
  const at = band(format, height, k);
  return <div style={{ position: "absolute", left: 0, width, top: at.top, bottom: at.bottom, display: "flex", alignItems: "center", justifyContent: "center" }}>{list}</div>;
};

/** An item arriving: its number and words, big where the list sits, then it gives way to the list with its plate filled. */
const ItemCard: React.FC<{ number: number; text: string; hold: number }> = ({ number, text, hold }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { format, width, height } = useFormat();
  const { box, column } = useStage();
  const k = useType();
  const settle = Math.round(LIST_TIMING.settle * fps);
  const inP = interpolate(frame, [0, 9], [0, 1], { easing: Easing.out(Easing.back(1.6)), ...clamp });
  const away = interpolate(frame, [hold, hold + settle], [0, 1], { easing: Easing.in(Easing.cubic), ...clamp });
  const sweep = interpolate(frame, [2, 30], [0, 1], { easing: Easing.inOut(Easing.quad), ...clamp });
  const maxW = column ? box.w + box.x - 60 : Math.min(box.w, width) - Math.round(110 * k);
  const size = Math.round((text.length > 60 ? 54 : text.length > 34 ? 64 : 76) * k);
  const at = band(format, height, k);
  const centreY = column ? height / 2 : at.top + (height - at.top - at.bottom) / 2;
  return (
    <div style={{ position: "absolute", left: 0, width, top: centreY, display: "flex", justifyContent: "center", opacity: inP * (1 - away), transform: `translateY(calc(-50% - ${away * 70 * k}px)) scale(${(0.85 + 0.15 * inP) * (1 - away * 0.25)})` }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: Math.round(14 * k), maxWidth: maxW }}>
        <div style={{ ...numberText(Math.round(170 * k)), ...goldText(sweep), filter: "drop-shadow(0 5px 0 rgba(20,10,4,0.9))" }}>#{number}</div>
        <div style={{ width: Math.round(160 * k * inP), height: Math.round(8 * k), background: palette.crimson, boxShadow: "0 3px 0 rgba(20,10,4,0.8)", marginBottom: Math.round(8 * k) }} />
        <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: size, lineHeight: 1.08, letterSpacing: -size * 0.01, color: palette.bone, textAlign: "center", textShadow: "0 3px 0 rgba(20,10,4,0.9), 0 6px 24px rgba(0,0,0,0.6)", textWrap: "balance" } as React.CSSProperties}>{text}</div>
      </div>
    </div>
  );
};

export const ListClip: React.FC<ListClipProps> = ({ clip, hook: title, items, order = "down", titleFor = LIST_TIMING.titleFor, hold = LIST_TIMING.hold, showFor = LIST_TIMING.showFor, dim = LIST_TIMING.dim, look = "bold", startFrom = 0, muted = false, music, musicFrom, musicVolume, videoVolume = 1, cropTop, cropBottom, ending, push, sourceAspect, voice, voiceData, captions, voiceVolume, duck, sequenceData }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const loop = isLoop(ending);
  const bodyEnd = loop ? durationInFrames : durationInFrames - Math.round(HOOK_TIMING.outro * fps);
  const dip = Math.round(HOOK_TIMING.dip * fps);
  const bodyOut = loop ? 1 : interpolate(frame, [bodyEnd - dip, bodyEnd], [1, 0], clamp);
  const src = clip ? clipSrc(clip) : null;
  const aspect = useSourceAspect(src, sourceAspect);
  const track = useSequence(src, (sequenceData as Playable | undefined) ?? null);
  const spoken = useVoice({ voice, voiceData, duck }, track, startFrom, bodyEnd, fps);
  const bed = useBed(track, { music, musicFrom, musicVolume });
  const clipVolume = loop ? (f: number) => spoken.duck(f) * videoVolume * interpolate(f, [bodyEnd - 4, bodyEnd], [1, 0], clamp) : (f: number) => spoken.duck(f) * videoVolume * interpolate(f, [bodyEnd - fps * 0.8, bodyEnd], [1, 0], clamp);

  const list = filledItems(items);
  const n = list.length;
  const times = itemTimes(n, (track?.markers ?? []).map((m) => m.at), { startFrom, seconds: bodyEnd / fps, titleFor });
  const at = times.map((s) => Math.round(s * fps));
  // The title gives way to the first item if it comes sooner.
  const titleUntil = Math.max(Math.round(LIST_TIMING.minTitle * fps), Math.min(Math.round(titleFor * fps), (at[0] ?? Infinity) - 6, bodyEnd - 12));
  // Each item holds big until its hold is up or the next one's nearly due; then it settles into its slot.
  const settleF = Math.round(LIST_TIMING.settle * fps);
  const holds = at.map((a, i) => Math.max(8, Math.min(Math.round(hold * fps), (at[i + 1] ?? bodyEnd) - a - settleF)));
  const settled = at.map((a, i) => a + holds[i]! + Math.round(settleF * 0.6));
  const slots: Slot[] = list.map((text, i) => ({ number: numberOf(i, n, order), text, at: settled[i]! })).sort((a, b) => a.number - b.number);
  const settleBySlot = slots.map((s) => s.at);

  // A loop clears the list and drops the title back in over the last frames, landing on frame zero.
  const returnAt = loop ? bodyEnd - HOOK_TIMING.returnFrames : undefined;
  const chromeEnd = loop ? bodyEnd - HOOK_TIMING.returnFrames : bodyEnd;
  const chrome = loop ? interpolate(frame, [chromeEnd - 10, chromeEnd], [1, 0], clamp) : 1;

  // The list isn't up the whole time: it shows blank after the title, then
  // again from each item's marker for `showFor`, and the footage is dimmed
  // behind it (and behind the title) so the words read over anything.
  const gap = Math.round(LIST_TIMING.gap * fps);
  const shown = mergeWindows(
    [[titleUntil, titleUntil + Math.round(LIST_TIMING.intro * fps)] as Window, ...at.map((a): Window => [a, a + Math.round(showFor * fps)])].map(([a, b]): Window => [Math.min(a, chromeEnd), Math.min(b, chromeEnd)]),
    gap,
  );
  const dimmed = mergeWindows([...(title ? [[0, titleUntil] as Window] : []), ...(n ? shown : []), ...(title && returnAt !== undefined ? [[returnAt, bodyEnd] as Window] : [])], gap);
  const dimLevel = windowLevel(frame, dimmed, { in: 10, out: 16, hardFrom: 0, hardTo: loop ? bodyEnd : undefined });
  // The list steps aside while an item is up big, and comes back with its plate filled.
  const big = Math.max(0, ...at.map((a, i) => interpolate(frame, [a - 6, a, a + holds[i]!, a + holds[i]! + settleF], [0, 1, 1, 0], clamp)));
  const listLevel = windowLevel(frame, shown, { in: 10, out: 16 }) * (1 - big);

  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      <MusicBed music={bed.music} from={bed.from} level={bed.level} loop={loop} duck={spoken.duck} />
      <Sequence durationInFrames={bodyEnd}>
        <AbsoluteFill style={{ opacity: bodyOut }}>
          {src ? (
            <Stage src={src} startFrom={Math.round(startFrom * fps)} muted={muted} cropTop={cropTop} cropBottom={cropBottom} aspect={aspect} volume={clipVolume} push={push} sequence={track}>
              <AbsoluteFill style={{ backgroundColor: "rgb(10,5,2)", opacity: dim * dimLevel }} />
              <AbsoluteFill style={{ opacity: chrome }}>
                <BrandMark from={titleUntil} />
              </AbsoluteFill>
              {n ? <ListPanel title={title} slots={slots} settle={settleBySlot} level={listLevel} /> : null}
              {title ? <HookCard hook={title} until={titleUntil} look={look} returnAt={returnAt} /> : null}
              <VoiceLayer voice={spoken} captions={captions} volume={voiceVolume} />
              {list.map((text, i) =>
                at[i]! < chromeEnd ? (
                  <Sequence key={i} from={at[i]!} durationInFrames={holds[i]! + settleF} layout="none">
                    <ItemCard number={numberOf(i, n, order)} text={text} hold={holds[i]!} />
                  </Sequence>
                ) : null,
              )}
            </Stage>
          ) : (
            <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
              <Backdrop glow={0.3} />
              <div style={{ fontFamily: SANS, fontSize: 40, color: palette.steel, textAlign: "center", padding: "0 90px" }}>Pick an edit and set the clip prop</div>
            </AbsoluteFill>
          )}
        </AbsoluteFill>
      </Sequence>
      {loop ? null : <Sequence from={bodyEnd}>{ending === "pitch" ? <Outro /> : <SignOff />}</Sequence>}
    </AbsoluteFill>
  );
};
