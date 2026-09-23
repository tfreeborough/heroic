/**
 * The templates the Desk's Make screen offers for Blood in the Sand. Each is
 * a real Remotion composition from src/ — the same component, schema and
 * duration the render uses, so the in-page preview IS the video. Browser
 * only (desk.config.ts lazy-loads it).
 */
import type { DeskTemplate } from "../desk/game";
import { GameplayClip, gameplayClipDurationSeconds, gameplayClipSchema } from "./src/GameplayClip";
import { Spotlight, spotlightSchema, spotlightSeconds } from "./src/Spotlight";
import roster from "./src/data/roster.json";

const weaponIds = roster.weapons.map((w) => ({ value: w.id, label: w.name }));
const spotlightClipProps: DeskTemplate["clipProps"] = (clip, clipSeconds, facts) => ({
  clip,
  clipSeconds: Math.min(8, Math.floor(clipSeconds)),
  clipStartFrom: 0,
  sourceAspect: facts && facts.width && facts.height ? facts.width / facts.height : undefined,
});
const abilityIds = roster.abilities.map((a) => ({ value: a.id, label: a.name }));

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
    defaults: { title: "Match point", line: "", durationSeconds: 12, startFrom: 0, muted: false, cropTop: 0, cropBottom: 0, ending: "signoff", push: 0 },
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
    defaults: { kind: "weapon", id: weaponIds[0]?.value ?? "blade", muted: false, cropTop: 0, cropBottom: 0, ending: "pitch" },
    options: { id: weaponIds },
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
    defaults: { kind: "ability", id: abilityIds[0]?.value ?? "sinkhole", muted: false, cropTop: 0, cropBottom: 0, ending: "pitch" },
    options: { id: abilityIds },
    hide: ["clip", "format", "kind", "sourceAspect"],
  },
];
