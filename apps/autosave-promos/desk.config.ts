/**
 * Autosave's entry in the Desk (apps/desk): the ASCII save-screen channel,
 * @autosave.ascii (docs/design/save-point-channel.md). No footage: every
 * video is made from a picture in public/saves.
 */
import type { GameConfig } from "../desk/game";
import { FORMATS, FPS } from "./src/formats";

const NAME = "Autosave";

/** Cut at a word so a long memory still makes a title. */
const short = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n - 1) > 0 ? s.lastIndexOf(" ", n - 1) : n - 1)}…`);

/** The posting queue's words: the title is YouTube's; the description is <tagline> - <journal>. */
const draft = (_template: string, props: Record<string, unknown>) => {
  const slot = Number(props.slot) || 1;
  const text = (k: string) => (typeof props[k] === "string" ? (props[k] as string).trim() : "");
  const memory = text("memory").replace(/[.\s]+$/, "") || "Somewhere";
  const title = text("title") || short(memory, 70);
  const lead = text("tagline") || `${memory}.`;
  const journal = text("journal");
  return {
    title: `Save ${String(slot).padStart(2, "0")}: ${title}`,
    description: journal ? `${lead} - ${journal}` : lead,
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
