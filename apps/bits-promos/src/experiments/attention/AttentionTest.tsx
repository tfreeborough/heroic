/**
 * EXPERIMENT · the attention test.
 *
 * A video that tells the viewer they are being tested on how long they can
 * watch without swiping. A progress bar climbs the LEFT edge (the right is
 * under TikTok's button rail) with the percent riding its head. A big
 * "still watching" count sits at the top, and the moments it crosses are
 * CHECKPOINTS: full-width crimson bands in plain language ("Most people
 * swiped away here") with a whoosh. One fact at a time sits in the middle
 * band, revealed in two parts (its first sentence, then the rest a beat
 * later beneath it) so the payoff lands while the setup is still up; the
 * next fact crossfades in. (A ledger that kept the older facts compressed
 * in grey underneath was tried: confusing to the eye, and the next fact
 * arrived before you'd finished the last. Tom, 10-07.) A bot match plays underneath, graded from
 * near-black to full colour as the bar climbs, trembling more as the quake
 * grows. The score (score.ts) genuinely accelerates and then stops dead on
 * one blow that rings out in a hall under the final card.
 *
 * Second pass (10-07): the deed cards and the stands went — they looked
 * like something but meant nothing to a stranger. Nothing here needs game
 * knowledge; the game is the footage.
 *
 * The bar is eased: the displayed percent is 1 − (1 − t)^curve, so the first
 * third feels quick and the last ten percent takes its time. Everything on
 * screen keys off the DISPLAYED percent, not the clock — except the facts,
 * which land on the Desk edit's markers when it has them (press M where you
 * say each one), so a fact appears as it is spoken.
 */
import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import type { Playable } from "@heroic/voiceover";
import { CINZEL, SANS, palette } from "../../brand";
import { clamp, goldText } from "../../cinematic";
import { Backdrop, useFormat } from "../../components";
import { clipSrc } from "../../GameplayClip";
import { HookCard } from "../../HookClip";
import { Stage, useSequence, useSourceAspect } from "../../stage";
import { VoiceLayer, useVoice, voiceProps } from "../../voice";

const checkpointSchema = z.object({ viewers: z.number().min(1).max(99), text: z.string() });

export const attentionSchema = z.object({
  clip: z.string().describe('The match underneath: a recording or a Desk edit, as a path under public/ (e.g. "footage/Obelisk Brawl 1.mp4" or "sequences/attention.json"). An edit\'s markers time the facts. Empty = a plain backdrop'),
  durationSeconds: z.number().min(10).max(180).describe("Length of the test. The score must be generated for the same length: bun run attention:score -- --seconds N"),
  startFrom: z.number().min(0).optional().describe("Seconds into the recording to start from"),
  hook: z.string().optional().describe("The first three seconds, big, on frame zero (the cover). A plain first-person ask, not a dare or a slogan: 'I\'m running an experiment on attention. You\'re in it.' In the Desk, add several and each renders as its own video to test against each other"),
  hookFor: z.number().min(1).max(8).optional().describe("Seconds the hook holds (default 3)"),
  intro: z.number().min(0).max(40).optional().describe("Seconds before the first fact: room to explain the test in the voice-over while the bar and the count run (default 18: the hook plus a 15-second read). Facts then spread evenly in REAL time from here to just before the cut, however many there are"),
  curve: z.number().min(1).max(3).optional().describe("How much the bar slows as it climbs: displayed % = 1 − (1 − t)^curve. 1 = honest, 1.6 = default, 2.5 = the first third shows half the bar"),
  floor: z.number().min(0).max(20).optional().describe("Where the 'still watching' count ends up, percent (default 1: in Tom's analytics under 1% watch a video to 100%)"),
  facts: z.array(z.string()).optional().describe("The facts, in speaking order, or none at all (the default): the bar, the count and the checkpoints carry the video on their own (Tom, 10-07). On an edit they land on its markers (press M where you say each one); otherwise they spread evenly in real time from `intro` to just before the cut, so fewer facts means more time on each"),
  reveal: z.number().min(0).max(8).optional().describe("Seconds after a fact's first sentence that the rest of it appears beneath (default 2.4; 0 = all at once)"),
  checkpoints: z.array(checkpointSchema).optional().describe("Pills under the count that fire as the 'still here' count falls through a value, positive and about the viewer (e.g. 50: \"You've outlasted half the viewers\") — keyed to the COUNT, not the bar, so the words and the number always agree"),
  endHold: z.number().min(0).max(6).optional().describe("Seconds after the blow that the match's own ending plays clean, every overlay gone, before the final card fades in (default 2.5). The score's cut is 6s before the end, so the card gets the rest"),
  final: z.string().optional().describe("The card after the hold"),
  credit: z.string().optional().describe("A smaller line under it: the one place the game is named, seen only by people who finished. Blank for none"),
  score: z.boolean().optional().describe("Play the generated score (public/experiments/attention/). Off = silent under the voice"),
  drumsLevel: z.number().min(0).max(1).optional(),
  padLevel: z.number().min(0).max(1).optional(),
  padDuck: z.number().min(0).max(1).optional().describe("Where the pad (the Shepard climb) sits while you talk, as a share of its level (default 0.15, with the pad itself at 0.15 — Tom's mix, 10-08). Shallower than the general duck on purpose: the illusion is pitch motion, it survives a shallow duck and dies under a deep one. The crowd and quake use the general duck"),
  crowdLevel: z.number().min(0).max(1).optional(),
  quakeLevel: z.number().min(0).max(1).optional().describe("The earthquake rumble that grows under everything (default 0.7)"),
  shake: z.number().min(0).max(30).optional().describe("How far the footage shakes by the end, px, growing with the quake (default 10; 0 = still)"),
  videoVolume: z.number().min(0).max(1).optional().describe("The recording's own sound (default 0.3: the score carries this one)"),
  muted: z.boolean().optional(),
  cropTop: z.number().min(0).max(0.4).optional(),
  cropBottom: z.number().min(0).max(0.4).optional(),
  sourceAspect: z.number().min(0.2).max(5).optional(),
  format: z.enum(["vertical", "square", "landscape"]).optional().describe("Vertical only makes sense here; the others are accepted so the Desk is happy"),
  ...voiceProps,
});
export type AttentionProps = z.infer<typeof attentionSchema>;

export const attentionSeconds = (p: Pick<AttentionProps, "durationSeconds">) => p.durationSeconds;

/**
 * Checked against the original studies on 2026-10-07 (sources in
 * docs/design/social-experiments.md). In speaking order. Each is two
 * sentences on purpose: the first lands, the second is the reveal.
 */
export const ATTENTION_FACTS = [
  "Half the people watching a basketball video miss a woman in a gorilla suit walk through it. They were busy counting passes.",
  "Your mind is somewhere else for about 47% of your waking hours. And you're less happy when it is.",
  "Given 15 minutes alone with their thoughts, 2 in 3 men chose to give themselves electric shocks instead. Every one of them had said they'd pay to avoid the shock.",
  "Your phone drains your brainpower just by sitting on the desk. Face down and switched off, people still did worse than with it in another room.",
  "A notification you don't even look at distracts you as much as answering the call. Mistakes went up threefold.",
  "An interruption of under three seconds doubles your mistakes. Four and a half seconds triples them.",
  "You blink around 15 times a minute. Staring at a screen, you're down to about 5.",
  "You'll read about 20% of the words on a screen like this one. You've probably skipped some already.",
  "In 2004, people stayed on one screen for about two and a half minutes before switching. By 2016 it was 47 seconds.",
  "That \"goldfish have a longer attention span than you\" stat is made up. A 2015 marketing report cited a website that cited nobody.",
];
/** Positive, about the viewer's progress, never about who left (Tom, 10-08). */
export const ATTENTION_CHECKPOINTS: NonNullable<AttentionProps["checkpoints"]> = [
  { viewers: 50, text: "You've outlasted half the viewers" },
  { viewers: 25, text: "You're in the top 25%" },
  { viewers: 10, text: "You're in the top 10%" },
  { viewers: 3, text: "Top 3%. Nearly there" },
];

/** The generated score's manifest (score.ts writes it). */
type Score = { params: { seconds: number }; stopAt: number | null; hits: { t: number; w: number; layer: number; accent: boolean }[]; events?: { t: number; kind: string }[] };
const useScore = (enabled: boolean): Score | null | "missing" => {
  const [score, setScore] = useState<Score | null | "missing">(null);
  useEffect(() => {
    if (!enabled) return;
    const handle = delayRender("attention score manifest");
    fetch(staticFile("experiments/attention/score.json"))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Score) => setScore(j))
      .catch(() => setScore("missing"))
      .finally(() => continueRender(handle));
  }, [enabled]);
  return enabled ? score : "missing";
};

/** Displayed progress 0..1 for real progress t, and its inverse. */
const shown = (t: number, curve: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** curve;
const unshow = (d: number, curve: number) => 1 - (1 - d) ** (1 / curve);
/** Share of viewers "still watching" at displayed progress d, and the d at which it falls to v. */
const watching = (d: number, floor: number) => floor + (100 - floor) * (1 - d) ** 2.2;
const whenWatching = (v: number, floor: number) => 1 - (Math.max(0, Math.min(1, (v - floor) / (100 - floor)))) ** (1 / 2.2);

/** One beat's worth of punch, 0..1, decaying over a few frames after each hit. */
const usePulse = (score: Score | null | "missing", frame: number, fps: number) =>
  useMemo(() => {
    if (!score || score === "missing") return 0;
    const t = frame / fps;
    let p = 0;
    for (let i = score.hits.length - 1; i >= 0; i--) {
      const h = score.hits[i]!;
      const dt = t - h.t;
      if (dt < 0) continue;
      if (dt > 0.4) break;
      p = Math.max(p, h.w * (h.accent ? 1 : 0.5) * Math.exp(-dt * 9));
    }
    return p;
  }, [score, frame, fps]);

const SHADOW = "0 3px 0 rgba(20,10,4,0.9), 0 8px 28px rgba(0,0,0,0.65)";

// ------------------------------------------------------------------- pieces

/** The bar up the left edge, bottom to top, with the percent riding its head. */
const Bar: React.FC<{ d: number; pulse: number; top: number; bottom: number }> = ({ d, pulse, top, bottom }) => {
  const h = bottom - top;
  const fill = h * d;
  const head = bottom - fill;
  const pct = Math.floor(d * 100);
  const warm = interpolate(d, [0, 0.6, 1], [0, 0.4, 1], clamp);
  const colour = `rgb(${Math.round(154 + (163 - 154) * warm)}, ${Math.round(160 + (44 - 160) * warm)}, ${Math.round(166 + (34 - 166) * warm)})`;
  return (
    <>
      <div style={{ position: "absolute", left: 26, top, width: 20, height: h, borderRadius: 10, background: "rgba(20,10,4,0.72)", boxShadow: "inset 0 0 0 2px rgba(242,233,212,0.18)" }} />
      <div style={{ position: "absolute", left: 26, top: head, width: 20, height: fill, borderRadius: 10, background: `linear-gradient(180deg, ${palette.bone} 0%, ${colour} 60px, ${colour} 100%)`, boxShadow: `0 0 ${18 + pulse * 30}px ${colour}` }} />
      <div style={{ position: "absolute", left: 16, top: head - 20, width: 40, height: 40, borderRadius: 20, background: palette.bone, boxShadow: `0 0 ${16 + pulse * 40}px ${palette.sand}`, transform: `scale(${1 + pulse * 0.35})` }} />
      <div style={{ position: "absolute", left: 76, top: head - 44, fontFamily: CINZEL, fontWeight: 700, fontSize: 84, lineHeight: 1, color: palette.bone, textShadow: SHADOW, transform: `scale(${1 + pulse * 0.06})`, transformOrigin: "left center" }}>
        {pct}
        <span style={{ fontSize: 44, marginLeft: 6, color: palette.sand }}>%</span>
      </div>
    </>
  );
};

/** The count at the top: big, plain, and it visibly drops when a checkpoint fires. */
const Count: React.FC<{ d: number; floor: number; top: number; drop: number }> = ({ d, floor, top, drop }) => {
  const w = Math.max(floor, Math.round(watching(d, floor)));
  // left/right 0, not a hard-coded 1080: the Desk previews square and landscape too.
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, textAlign: "center", transform: `scale(${1 + drop * 0.08})`, transformOrigin: "center top" }}>
      <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 132, lineHeight: 1, color: drop > 0.2 ? palette.crimson : palette.bone, textShadow: SHADOW }}>
        {w}
        <span style={{ fontSize: 60, color: palette.sand, marginLeft: 8 }}>%</span>
      </div>
      <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 40, letterSpacing: 2, textTransform: "uppercase", color: palette.bone, marginTop: 6, textShadow: SHADOW }}>of viewers still here</div>
    </div>
  );
};

/** A checkpoint: a compact crimson pill under the count, sliding in from the left and off to the right, centred by flex so it sits right in every player. */
const Checkpoint: React.FC<{ text: string; from: number; until: number; y: number }> = ({ text, from, until, y }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame > until + 2) return null;
  const inn = interpolate(frame, [from, from + 9], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const out = interpolate(frame, [until - 8, until], [0, 1], { easing: Easing.in(Easing.cubic), ...clamp });
  const x = -900 * (1 - inn) + 900 * out;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div
        style={{
          transform: `translateX(${x}px)`,
          opacity: Math.min(inn, 1 - out * 0.6),
          maxWidth: 860,
          padding: "22px 44px",
          borderRadius: 18,
          background: palette.crimson,
          boxShadow: "0 8px 30px rgba(0,0,0,0.55), inset 0 -5px 0 rgba(20,10,4,0.45)",
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: 42,
          lineHeight: 1.1,
          color: palette.bone,
          textAlign: "center",
          textShadow: "0 2px 0 rgba(20,10,4,0.8)",
          textWrap: "balance",
        } as React.CSSProperties}
      >
        {text}
      </div>
    </div>
  );
};

/** A fact split for the reveal: its first sentence, then the rest. */
const splitFact = (fact: string): [string, string] => {
  const m = /^(.+?[.!?]["”]?)\s+(\S.*)$/s.exec(fact.trim());
  return m ? [m[1]!, m[2]!] : [fact.trim(), ""];
};

/**
 * One fact at a time: "3 / 10" small above, the first sentence big, the
 * rest arriving beneath it `reveal` frames later in the same size. The
 * previous fact fades as this one fades in.
 */
const FactCard: React.FC<{ facts: string[]; times: number[]; reveal: number; top: number }> = ({ facts, times, reveal, top }) => {
  const frame = useCurrentFrame();
  const { width } = useFormat();
  // Vertical: right of the bar's readout. Wider frames: centred.
  const left = Math.max(260, Math.round((width - 700) / 2));
  const idx = times.reduce((cur, t, i) => (frame >= t ? i : cur), -1);
  if (idx < 0) return null;
  const at = times[idx]!;
  const next = times[idx + 1];
  const inn = interpolate(frame, [at, at + 10], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const out = next !== undefined ? interpolate(frame, [next - 8, next], [1, 0], clamp) : 1;
  const show = Math.min(inn, out);
  const [first, rest] = splitFact(facts[idx]!);
  const second = rest ? interpolate(frame, [at + reveal, at + reveal + 10], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp }) : 0;
  const text: React.CSSProperties = { fontFamily: SANS, fontWeight: 800, fontSize: 50, lineHeight: 1.18, color: palette.bone, textShadow: SHADOW, textAlign: "left", textWrap: "pretty" } as React.CSSProperties;
  return (
    <div style={{ position: "absolute", left, width: 700, top, opacity: show, transform: `translateY(${(1 - inn) * 24}px)` }}>
      <div style={{ position: "absolute", left: -160, right: -140, top: -70, bottom: -70, background: "radial-gradient(ellipse at 50% 45%, rgba(20,10,4,0.74) 0%, rgba(20,10,4,0.46) 50%, rgba(20,10,4,0) 76%)", pointerEvents: "none" }} />
      <div style={{ position: "relative", fontFamily: SANS, fontWeight: 700, fontSize: 28, letterSpacing: 4, color: palette.sand, marginBottom: 14, textShadow: SHADOW }}>
        {idx + 1} / {facts.length}
      </div>
      <div style={{ position: "relative", ...text }}>{first}</div>
      {rest ? (
        <div style={{ position: "relative", ...text, marginTop: 18, opacity: second, transform: `translateY(${(1 - second) * 18}px)` }}>
          <span style={{ color: palette.sand, marginRight: 14 }}>▸</span>
          {rest}
        </div>
      ) : null}
    </div>
  );
};

// -------------------------------------------------------------- composition

export const AttentionTest: React.FC<AttentionProps> = ({
  clip,
  durationSeconds,
  startFrom = 0,
  hook = "I'm running an experiment on attention. You're in it.",
  hookFor = 3,
  intro = 18,
  curve = 1.6,
  floor = 1,
  facts = [],
  reveal = 2.4,
  checkpoints = ATTENTION_CHECKPOINTS,
  endHold = 2.5,
  final = "Comment 100 if you made it. Or the % where you nearly swiped.",
  credit = "That was one match of Blood in the Sand, my mobile game. It's free on the App Store and Google Play, just search the name.",
  score: wantScore = true,
  drumsLevel = 0.9,
  padLevel = 0.15,
  padDuck = 0.15,
  crowdLevel = 0.6,
  quakeLevel = 0.7,
  shake = 10,
  videoVolume = 0.3,
  muted = false,
  cropTop,
  cropBottom,
  sourceAspect,
  voice,
  voiceData,
  captions = "regular",
  voiceVolume,
  duck,
  sequenceData,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { height } = useFormat();
  const score = useScore(wantScore);
  const stopAt = score && score !== "missing" && score.stopAt !== null ? Math.round(score.stopAt * fps) : durationInFrames - fps * 6;
  // After the blow: the match's own ending, clean, then the card.
  const cardAt = Math.min(stopAt + Math.round(endHold * fps), durationInFrames - 12);
  // The bar reaches 100 on the cut, not the last frame: the final blow lands on a full bar.
  const d = frame >= stopAt ? 1 : shown(frame / stopAt, curve);
  const pulse = usePulse(score, frame, fps);
  const hookUntil = Math.round(hookFor * fps);

  const src = clip ? clipSrc(clip) : null;
  const aspect = useSourceAspect(src, sourceAspect);
  const track = useSequence(src, (sequenceData as Playable | undefined) ?? null);
  const spoken = useVoice({ voice, voiceData, duck }, track, startFrom, stopAt, fps);
  const clipVolume = (f: number) => spoken.duck(f) * videoVolume * interpolate(f, [cardAt - 10, cardAt + 10], [1, 0], clamp);

  // When each fact lands (frames): the edit's markers in order; the rest
  // spread evenly in REAL time (not displayed percent — that bunched them
  // early) from the end of the intro to a few seconds before the cut, so
  // however many facts there are, they cover the whole video.
  const factTimes = useMemo(() => {
    const said = facts.filter((f) => f.trim()).length;
    const markers = (track?.markers ?? [])
      .map((m) => Math.round((m.at - startFrom) * fps))
      .filter((f) => f >= 0 && f < stopAt)
      .sort((a, b) => a - b)
      .slice(0, said);
    const out = [...markers];
    const left = said - markers.length;
    if (left > 0) {
      const first = markers.length ? markers[markers.length - 1]! + fps * 3 : Math.max(hookUntil + fps, Math.round(intro * fps));
      const last = stopAt - Math.round(7 * fps);
      for (let j = 0; j < left; j++) out.push(Math.round(left === 1 ? first : first + ((last - first) * j) / (left - 1)));
    }
    return out;
  }, [track, facts, startFrom, fps, stopAt, hookUntil, intro]);

  // Checkpoints fire as the COUNT falls through their value (Tom caught the
  // bar-keyed version saying "half" while the count read 24); the count
  // flushes as each one fires.
  const bands = useMemo(
    () =>
      checkpoints
        .filter((c) => c.viewers > floor)
        .map((c) => {
          const from = Math.round(unshow(whenWatching(c.viewers, floor), curve) * stopAt);
          return { ...c, from, until: Math.min(from + Math.round(3.4 * fps), stopAt - 4) };
        })
        .filter((c) => c.until > c.from + 12)
        .sort((a, b) => a.from - b.from),
    [checkpoints, curve, stopAt, fps, floor],
  );
  const drop = useMemo(() => {
    let e = 0;
    for (const b of bands) {
      const dt = frame - b.from;
      if (dt >= 0 && dt < 18) e = Math.max(e, 1 - dt / 18);
    }
    return e;
  }, [bands, frame]);

  // The grade: near-black and drained at the start, full colour by the end;
  // the vignette opens as the bar climbs and closes again as the Tide tightens.
  const light = interpolate(d, [0, 0.15, 0.85, 1], [0.78, 0.6, 0.08, 0], clamp);
  const drain = interpolate(d, [0, 0.5, 0.9], [0.9, 0.45, 0], clamp);
  // The vignette closes as the Tide tightens, then opens right out on the cut so the ending is seen clean.
  const vignette = frame >= stopAt ? 0.25 : interpolate(d, [0, 0.3, 0.75, 1], [0.95, 0.55, 0.35, 0.8], clamp);
  const finalIn = interpolate(frame, [cardAt, cardAt + 12], [0, 1], clamp);
  // The quake in the picture: the footage trembles, more the further in,
  // with a kick on every accent. Overlays stay still so the words read.
  const tremble = shake * d * d * (frame < stopAt ? 1 : Math.max(0, 1 - (frame - stopAt) / (fps * 1.5)));
  const wob = (k: number) => Math.sin(frame * 0.9 * k + k) * 0.6 + Math.sin(frame * 2.3 * k + 2 * k) * 0.4;
  const shakeX = tremble * wob(1.0);
  const shakeY = tremble * wob(1.37) + pulse * tremble * 0.8;
  const barTop = Math.round(height * 0.33);
  const barBottom = Math.round(height * 0.71);
  // The count block is fixed pixels (132px number + caption), so what hangs
  // under it is anchored to it, not to a fraction of the height — in
  // landscape the frame is short and a fraction landed the pill on the caption.
  const countTop = Math.round(height * 0.105);
  const pillTop = countTop + 215;
  const factTop = Math.max(Math.round(height * 0.37), pillTop + 115);
  const chromeIn = hook ? interpolate(frame, [hookUntil + 4, hookUntil + 18], [0, 1], clamp) : 1;

  const overlays = (
    <>
      {/* grade */}
      <AbsoluteFill style={{ background: "#8a8a8a", mixBlendMode: "saturation", opacity: drain }} />
      <AbsoluteFill style={{ background: palette.night, opacity: light }} />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 55%, rgba(20,10,4,0) 30%, rgba(20,10,4,${vignette}) 100%)` }} />
      {/* a frame-wide thump on the accents, and a flush when a checkpoint fires */}
      <AbsoluteFill style={{ background: palette.crimson, opacity: pulse * 0.08 * Math.min(1, d * 2) + drop * 0.12 }} />
      {frame < stopAt ? (
        <>
          <AbsoluteFill style={{ opacity: chromeIn }}>
            <Count d={d} floor={floor} top={countTop} drop={drop} />
            <FactCard facts={facts.filter((f) => f.trim())} times={factTimes} reveal={Math.round(reveal * fps)} top={factTop} />
          </AbsoluteFill>
          <Bar d={d} pulse={pulse} top={barTop} bottom={barBottom} />
          {bands.map((b, i) => (
            <Checkpoint key={i} text={b.text} from={b.from} until={b.until} y={pillTop} />
          ))}
          {hook ? <HookCard hook={hook} until={hookUntil} look="bold" /> : null}
        </>
      ) : frame < cardAt ? null : (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: finalIn }}>
          {/* near-solid: the footage underneath has text of its own, and this has to read in one glance */}
          <AbsoluteFill style={{ background: palette.night, opacity: 0.96 }} />
          {/* position: relative, or the absolutely-positioned dim above paints over these (that was the "unreadable" second line) */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 150, lineHeight: 1, ...goldText(finalIn), transform: `scale(${1 + pulse * 0.08})` }}>100%</div>
            <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 44, letterSpacing: 3, textTransform: "uppercase", color: palette.sand, marginTop: 22, textShadow: SHADOW }}>you made it</div>
            <div style={{ width: 160, height: 4, background: palette.crimson, marginTop: 44 }} />
            <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 58, color: palette.bone, textAlign: "center", maxWidth: 860, marginTop: 44, lineHeight: 1.16, textShadow: SHADOW, textWrap: "balance" } as React.CSSProperties}>{final}</div>
            {credit ? (
              <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 34, color: palette.steel, textAlign: "center", maxWidth: 780, marginTop: 70, lineHeight: 1.3, textShadow: SHADOW, textWrap: "balance" } as React.CSSProperties}>{credit}</div>
            ) : null}
          </div>
        </AbsoluteFill>
      )}
      <VoiceLayer voice={spoken} captions={captions} volume={voiceVolume} />
      {score === "missing" && wantScore ? (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "14px 24px", fontFamily: SANS, fontSize: 24, color: palette.bone, background: "rgba(163,44,34,0.85)" }}>
          No score for this length: run bun run attention:score -- --seconds {durationSeconds}
        </div>
      ) : null}
      {score && score !== "missing" && score.params.seconds !== durationSeconds ? (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "14px 24px", fontFamily: SANS, fontSize: 24, color: palette.bone, background: "rgba(163,44,34,0.85)" }}>
          The score is {score.params.seconds}s, the video {durationSeconds}s: re-run bun run attention:score -- --seconds {durationSeconds}
        </div>
      ) : null}
    </>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      {score && score !== "missing" ? (
        <>
          <Audio src={staticFile("experiments/attention/drums.wav")} volume={drumsLevel} />
          {/* the pad takes a SHALLOW duck: spoken.duck(f) goes to `duck` (default 0.35), the pad only to padDuck */}
          <Audio src={staticFile("experiments/attention/pad.wav")} volume={(f) => padLevel * (1 - (1 - spoken.duck(f)) * ((1 - padDuck) / (1 - (duck ?? 0.35))))} />
          <Audio src={staticFile("experiments/attention/crowd.wav")} volume={(f) => crowdLevel * spoken.duck(f)} />
          <Audio src={staticFile("experiments/attention/reactions.wav")} volume={(f) => crowdLevel * spoken.duck(f)} />
          <Audio src={staticFile("experiments/attention/quake.wav")} volume={(f) => quakeLevel * spoken.duck(f)} />
          <Audio src={staticFile("experiments/attention/hall.wav")} volume={0.8} />
          {/* a whoosh as each checkpoint band sweeps in (score.ts copies it from the bank) */}
          {bands.map((b, i) => (
            <Sequence key={i} from={b.from} layout="none">
              <Audio src={staticFile("experiments/attention/whoosh.mp3")} volume={0.8} />
            </Sequence>
          ))}
        </>
      ) : null}
      {src ? (
        <>
          <AbsoluteFill style={{ transform: `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px) scale(${1 + Math.min(0.03, tremble / 400)})` }}>
            <Stage src={src} startFrom={Math.round(startFrom * fps)} muted={muted} cropTop={cropTop} cropBottom={cropBottom} aspect={aspect} volume={clipVolume} sequence={track} />
          </AbsoluteFill>
          {overlays}
        </>
      ) : (
        <AbsoluteFill>
          <Backdrop glow={0.35} />
          {overlays}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
