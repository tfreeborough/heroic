/**
 * The templates the Desk's Make screen offers for Blood in the Sand. Each is
 * a real Remotion composition from src/ — the same component, schema and
 * duration the render uses, so the in-page preview IS the video. Browser
 * only (desk.config.ts lazy-loads it).
 */
import type { DeskTemplate } from "../desk/game";
import { GameplayClip, gameplayClipDurationSeconds, gameplayClipSchema } from "./src/GameplayClip";
import { HookClip, hookClipDurationSeconds, hookClipSchema, isLoop } from "./src/HookClip";
import { Spotlight, spotlightSchema, spotlightSeconds } from "./src/Spotlight";
import { MUSIC_LEVEL } from "./src/components";
import roster from "./src/data/roster.json";

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
/** In every template's defaults, so a picked song survives a template switch. */
const musicDefaults = { music: "", musicFrom: 0, musicVolume: MUSIC_LEVEL };

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
    defaults: { title: "Match point", line: "", durationSeconds: 12, startFrom: 0, muted: false, cropTop: 0, cropBottom: 0, ending: "signoff", push: 0, ...musicDefaults },
    options: { music: songs },
    needsClip: true,
    hide: ["clip", "format", "sourceAspect"],
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
    defaults: { hook: "", hookFor: 3, look: "bold", follow: "", durationSeconds: 12, startFrom: 0, muted: false, cropTop: 0, cropBottom: 0, ending: "loop", tail: "", loopBlend: 0.3, push: 0, ...musicDefaults },
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
    hide: ["clip", "format", "sourceAspect"],
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
];
