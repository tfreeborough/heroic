/**
 * Chapter card art for the Chronicle shelf (achievements.md § The Chronicle
 * v2), keyed by `AchievementChapter.id`. Same shape as MODE_ART: a forged
 * landscape PNG when one lands (null until then — the forge owes all 13
 * subjects), and a painted ramp + glow stand-in so a card never reads as a
 * hole. The stand-in also carries the chapter's emblem (its first deed's
 * icon, large and ghosted) so the shelf isn't thirteen identical slabs.
 */
export interface ChapterArt {
  image: number | null;
  ramp: [string, string, string];
  glow: string;
  glowAt: [number, number];
}

const FALLBACK: ChapterArt = {
  image: null,
  ramp: ["#1d1712", "#2a2018", "#3a2c1c"],
  glow: "rgba(232,200,122,0.18)",
  glowAt: [0.8, 0.2],
};

export const CHAPTER_ART: Record<string, ChapterArt> = {
  "the-pit": { image: null, ramp: ["#2a1410", "#5a2a1a", "#8a4a26"], glow: "rgba(255,190,120,0.30)", glowAt: [0.8, 0.2] },
  "brothers-in-arms": { image: null, ramp: ["#141a24", "#1e2a3a", "#2c3a4a"], glow: "rgba(150,190,255,0.28)", glowAt: [0.8, 0.2] },
  "good-company": { image: null, ramp: ["#1c1a12", "#3a3218", "#5a4a20"], glow: "rgba(255,220,140,0.28)", glowAt: [0.8, 0.2] },
  "six-enter": { image: null, ramp: ["#1a1216", "#3a1e2a", "#5a2a36"], glow: "rgba(255,140,170,0.26)", glowAt: [0.8, 0.2] },
  "party-tricks": { image: null, ramp: ["#12181a", "#1c3034", "#264a4a"], glow: "rgba(140,255,230,0.24)", glowAt: [0.8, 0.2] },
  "the-kill": { image: null, ramp: ["#200c0c", "#4a1414", "#7a1e1e"], glow: "rgba(255,90,70,0.32)", glowAt: [0.8, 0.2] },
  "the-arsenal": { image: null, ramp: ["#16161a", "#26262e", "#3a3a44"], glow: "rgba(220,225,240,0.26)", glowAt: [0.8, 0.2] },
  "offensive-arts": { image: null, ramp: ["#241208", "#4a2410", "#7a3a14"], glow: "rgba(255,160,60,0.32)", glowAt: [0.8, 0.2] },
  "defensive-arts": { image: null, ramp: ["#0e1a1c", "#183034", "#22484a"], glow: "rgba(120,220,220,0.28)", glowAt: [0.8, 0.2] },
  "support-arts": { image: null, ramp: ["#101a10", "#1c301c", "#2a4a2a"], glow: "rgba(150,255,150,0.26)", glowAt: [0.8, 0.2] },
  glory: { image: null, ramp: ["#241a08", "#4a3510", "#8a6d20"], glow: "rgba(255,220,110,0.36)", glowAt: [0.8, 0.2] },
  "blood-and-mercy": { image: null, ramp: ["#1e0e14", "#3a1a26", "#5a2a3a"], glow: "rgba(255,150,190,0.28)", glowAt: [0.8, 0.2] },
  "the-blood-tide": { image: null, ramp: ["#1a0808", "#3a0e10", "#6a1418"], glow: "rgba(255,60,60,0.34)", glowAt: [0.8, 0.2] },
};

export const chapterArt = (id: string): ChapterArt => CHAPTER_ART[id] ?? FALLBACK;
