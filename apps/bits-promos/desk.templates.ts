/**
 * The templates the Desk's Make screen offers for Blood in the Sand. Each is
 * a real Remotion composition from src/ — the same component, schema and
 * duration the render uses, so the in-page preview IS the video. Browser
 * only (desk.config.ts lazy-loads it).
 */
import type { DeskTemplate, VoicePreview } from "../desk/game";
import { GameplayClip, gameplayClipDurationSeconds, gameplayClipSchema } from "./src/GameplayClip";
import { HookClip, hookClipDurationSeconds, hookClipSchema, isLoop } from "./src/HookClip";
import { ListClip, listClipDurationSeconds, listClipSchema } from "./src/ListClip";
import { filledItems, markerWarning, numberOf } from "./src/listTiming";
import { Spotlight, spotlightSchema, spotlightSeconds } from "./src/Spotlight";
import { MUSIC_LEVEL } from "./src/components";
import { EDITOR_ONLY, voiceDefaults } from "./src/voice";
import roster from "./src/data/roster.json";
import { AttentionTest, attentionSchema, attentionSeconds } from "./src/experiments/attention/AttentionTest";

const weaponIds = roster.weapons.map((w) => ({ value: w.id, label: w.name }));
const spotlightClipProps: DeskTemplate["clipProps"] = (clip, clipSeconds, facts) => ({
  clip,
  clipSeconds: Math.min(8, Math.floor(clipSeconds)),
  clipStartFrom: 0,
  sourceAspect: facts && facts.width && facts.height ? facts.width / facts.height : undefined,
});
const abilityIds = roster.abilities.map((a) => ({ value: a.id, label: a.name }));
/** The game's battle songs (synced into public/music/ by `bun run sync`). */
const songs = roster.music.map((m) => ({ value: m.file, label: m.name }));
/** In every template's defaults, so a picked song and levels survive a template switch. */
const musicDefaults = { music: "", musicFrom: 0, musicVolume: MUSIC_LEVEL, videoVolume: 1 };

export const TEMPLATES: DeskTemplate[] = [
  {
    id: "GameplayClip",
    label: "Match clip",
    blurb: "A moment from a real match, dressed: gold title over the cold open, a broadcast lower third, the developer's sign-off.",
    component: GameplayClip,
    schema: gameplayClipSchema,
    seconds: (p) => gameplayClipDurationSeconds(p as { durationSeconds: number }),
    clipProps: (clip, clipSeconds, facts) => ({
      clip,
      durationSeconds: Math.min(12, Math.floor(clipSeconds)),
      startFrom: 0,
      sourceAspect: facts && facts.width && facts.height ? facts.width / facts.height : undefined,
    }),
    clipKey: "clip",
    uncapped: { durationKey: "durationSeconds", startKey: "startFrom" },
    defaults: { title: "Match point", line: "", durationSeconds: 12, startFrom: 0, muted: false, cropTop: 0, cropBottom: 0, ending: "signoff", push: 0, ...musicDefaults, ...voiceDefaults },
    options: { music: songs },
    needsClip: true,
    voice: true,
    hide: ["clip", "format", "sourceAspect", ...EDITOR_ONLY],
  },
  {
    id: "HookClip",
    label: "Hook clip",
    blurb: "A match clip built for the scroll: the hook is on screen from the first frame, no title beat, and by default no end card either: it loops straight back into the hook. Add several hooks and one press renders each as its own video.",
    component: HookClip,
    schema: hookClipSchema,
    seconds: (p) => hookClipDurationSeconds(p as never),
    clipProps: (clip, clipSeconds, facts) => ({
      clip,
      durationSeconds: Math.min(12, Math.floor(clipSeconds)),
      startFrom: 0,
      sourceAspect: facts && facts.width && facts.height ? facts.width / facts.height : undefined,
    }),
    clipKey: "clip",
    uncapped: { durationKey: "durationSeconds", startKey: "startFrom" },
    defaults: { hook: "", hookFor: 3, look: "bold", follow: "", durationSeconds: 12, startFrom: 0, muted: false, cropTop: 0, cropBottom: 0, ending: "loop", tail: "", loopBlend: 0.3, push: 0, ...musicDefaults, ...voiceDefaults },
    options: { music: songs },
    needsClip: true,
    variants: { key: "hook", suffix: "hook", placeholder: "He had 1 HP. Then the Harpoon." },
    // Loops live on being replayed, and a long one rarely is.
    warn: (p, typed) => {
      if (!isLoop(p.ending as never)) return undefined;
      const s = Math.round(Number(p.durationSeconds));
      if (typed.durationSeconds === undefined || typed.durationSeconds === "") return `No duration set, so this loop runs ${s}s to the end of the clip. Loops work best at 7–15s, ending on the payoff.`;
      if (s > 20) return `This loop is ${s}s. Loops work best at 7–15s, ending on the payoff.`;
      return undefined;
    },
    voice: true,
    hide: ["clip", "format", "sourceAspect", ...EDITOR_ONLY],
  },
  {
    id: "ListClip",
    label: "List clip",
    blurb: "You talking through a list (\"3 mistakes I made making my game\"). The title is the hook on the first frame, then the list shows with every slot blank, and each item lands on a marker you drop in the editor (M). The list fades away between items and the footage dims behind it while it's up. It counts down, so #1 stays blank until the end.",
    component: ListClip,
    schema: listClipSchema,
    seconds: (p) => listClipDurationSeconds(p as never),
    clipProps: (clip, _clipSeconds, facts) => ({
      clip,
      // Blank = the whole edit: a list runs as long as you talk.
      durationSeconds: undefined,
      startFrom: 0,
      sourceAspect: facts && facts.width && facts.height ? facts.width / facts.height : undefined,
    }),
    clipKey: "clip",
    uncapped: { durationKey: "durationSeconds", startKey: "startFrom" },
    defaults: { hook: "", items: [""], order: "down", titleFor: 3, hold: 1.5, showFor: 9, dim: 0.6, look: "bold", durationSeconds: undefined, startFrom: 0, muted: false, cropTop: 0, cropBottom: 0, ending: "loop", push: 0, ...musicDefaults, ...voiceDefaults },
    options: { music: songs },
    needsClip: true,
    variants: { key: "hook", suffix: "title", placeholder: "3 mistakes I made making my game" },
    lists: [
      {
        key: "items",
        label: "items, in the order you say them",
        placeholder: "I built a map editor before I had a game",
        hint: "Each lands on the next marker in the edit. Keep them short enough to read at a glance; long ones wrap to two lines and then shrink.",
        number: (i, n, p) => `#${numberOf(i, n, p.order === "up" ? "up" : "down")}`,
      },
    ],
    // Only the markers inside the stretch of the edit this video plays count.
    warn: (p, _typed, clip) => {
      const from = Number(p.startFrom) || 0;
      const to = from + (Number(p.durationSeconds) || Infinity);
      return markerWarning(filledItems(p.items).length, clip?.markers?.filter((m) => m >= from && m < to).length);
    },
    voice: true,
    hide: ["clip", "format", "sourceAspect", ...EDITOR_ONLY],
  },
  {
    id: "WeaponSpotlight",
    label: "Weapon spotlight",
    blurb: "One weapon, forged: it slams in over the footage, the sim's numbers count up on a spec plate, the tagline follows.",
    component: Spotlight,
    schema: spotlightSchema,
    seconds: (p) => spotlightSeconds(p as never),
    clipProps: spotlightClipProps,
    clipKey: "clip",
    uncapped: { durationKey: "clipSeconds", startKey: "clipStartFrom" },
    defaults: { kind: "weapon", id: weaponIds[0]?.value ?? "blade", muted: false, cropTop: 0, cropBottom: 0, ending: "pitch", ...musicDefaults },
    options: { id: weaponIds, music: songs },
    hide: ["clip", "format", "kind", "sourceAspect"],
  },
  {
    id: "AbilitySpotlight",
    label: "Ability spotlight",
    blurb: "One ability, as a rite: it rises into a gold bloom, the cooldown ring draws, the charges light up, the tagline follows.",
    component: Spotlight,
    schema: spotlightSchema,
    seconds: (p) => spotlightSeconds(p as never),
    clipProps: spotlightClipProps,
    clipKey: "clip",
    uncapped: { durationKey: "clipSeconds", startKey: "clipStartFrom" },
    defaults: { kind: "ability", id: abilityIds[0]?.value ?? "sinkhole", muted: false, cropTop: 0, cropBottom: 0, ending: "pitch", ...musicDefaults },
    options: { id: abilityIds, music: songs },
    hide: ["clip", "format", "kind", "sourceAspect"],
  },
  {
    id: "AttentionTest",
    label: "Experiment · attention test",
    blurb: "The attention-span test: a bar up the left edge, a big 'still here' count with checkpoint bands as it drops, one fact at a time while you talk, revealed in two parts (on an edit, they land on your M markers), the match graded from black to colour, and the accelerating score. Generate the score for the length first: bun run attention:score -- --seconds N.",
    component: AttentionTest,
    schema: attentionSchema,
    seconds: (p) => attentionSeconds(p as { durationSeconds: number }),
    clipProps: (clip, clipSeconds, facts) => ({
      clip,
      durationSeconds: Math.min(90, Math.floor(clipSeconds)),
      startFrom: 0,
      sourceAspect: facts && facts.width && facts.height ? facts.width / facts.height : undefined,
    }),
    clipKey: "clip",
    uncapped: { durationKey: "durationSeconds", startKey: "startFrom" },
    defaults: { hook: "I'm running an experiment on attention. You're in it.", hookFor: 3, intro: 18, curve: 1.6, floor: 1, facts: [], reveal: 2.4, endHold: 2.5, final: "Comment 100 if you made it. Or the % where you nearly swiped.", credit: "That was one match of Blood in the Sand, my mobile game. It's free on the App Store and Google Play, just search the name.", score: true, drumsLevel: 0.9, padLevel: 0.15, padDuck: 0.15, crowdLevel: 0.6, quakeLevel: 0.7, shake: 10, videoVolume: 0.3, muted: false, cropTop: 0, cropBottom: 0, ...voiceDefaults, captions: "regular" },
    variants: { key: "hook", suffix: "hook", placeholder: "I'm running an experiment on attention. You're in it." },
    lists: [{ key: "facts", label: "Facts", placeholder: "A fact about attention, one per row", hint: "Optional (none by default). In speaking order; on an edit they land on your M markers, otherwise they spread evenly from the end of the intro to the cut. Checkpoint pills fire as the count falls through 50, 25, 10 and 3" }],
    needsClip: true,
    voice: true,
    hide: ["clip", "format", "sourceAspect", "checkpoints", ...EDITOR_ONLY],
  },
];

/**
 * What the Desk's editor plays while you cut, record and edit: the hook
 * clip with no hook, as long as the cut, no end card. It's the video a
 * voiced clip most likely becomes, so the captions sit exactly where they
 * will. The editor adds `segments` + `slide` (the cut), the crop, `muted`,
 * `voiceData` and `captions`.
 */
export const VOICE_PREVIEW: VoicePreview = {
  component: HookClip,
  props: (clip, clipSeconds, facts) => ({
    clip,
    hook: "",
    follow: "",
    tail: "",
    durationSeconds: clipSeconds,
    startFrom: 0,
    muted: false,
    cropTop: facts.cropTop,
    cropBottom: facts.cropBottom,
    ending: "loop",
    loopBlend: 0,
    push: 0,
    sourceAspect: facts.width && facts.height ? facts.width / facts.height : undefined,
    ...musicDefaults,
    ...voiceDefaults,
  }),
};
