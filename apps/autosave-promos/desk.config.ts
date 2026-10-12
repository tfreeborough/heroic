/**
 * Autosave's entry in the Desk (apps/desk): the ASCII save-screen channel,
 * @autosave.ascii (docs/design/save-point-channel.md). No footage: every
 * video is made from a picture in public/saves.
 */
import type { GameConfig } from "../desk/game";
import { FORMATS, FPS } from "./src/formats";

const NAME = "Autosave";

/** The posting queue's words, from the one line (the tagline): YouTube's title is
 * "Save 07: <tagline>", the description (TikTok's caption) is <tagline> - <journal>.
 * Never the memory: post words show from the first second, the memory is the reveal. */
const draft = (_template: string, props: Record<string, unknown>) => {
  const slot = `Save ${String(Number(props.slot) || 1).padStart(2, "0")}`;
  const text = (k: string) => (typeof props[k] === "string" ? (props[k] as string).trim() : "");
  const line = text("tagline");
  const journal = text("journal");
  return {
    title: line ? `${slot}: ${line}` : slot,
    description: [line, journal].filter(Boolean).join(" - "),
  };
};

const config: GameConfig = {
  id: "autosave",
  name: NAME,
  icon: "icon.png",
  root: import.meta.dir,
  remotionEntry: "src/index.ts",
  publicDir: "public",
  // No recordings on this channel; the folder exists so the Desk's screens have somewhere to look.
  footageDir: "public/footage",
  rendersDir: "out/desk",
  bundleWatch: ["../../packages/ascii-build/src"],
  prepare: [["bun", "scripts/sync-library.ts"]],
  fps: FPS,
  formats: FORMATS,
  drive: {
    // No footage folder yet (nothing to record). Renders go to Autosave/Desk, a folder rclone makes itself.
    footageFolderId: "",
    footageRemote: "gdrive-autosave-footage",
    uploadTarget: "gdrive:Autosave/Desk",
  },
  templates: () => import("./desk.templates"),
  post: { draft },
  // No footage and no scripts on this channel: a save starts on its own tab.
  hideTabs: ["clips", "scripts"],
  tabs: [
    { id: "saves", label: "Saves", load: () => import("./desk.saves") },
    { id: "hints", label: "Hints", load: () => import("./desk.hints") },
  ],
};
export default config;
