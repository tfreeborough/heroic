/**
 * Blood in the Sand's entry in the Desk (apps/desk). Paths are this
 * package's; templates come from desk.templates.ts, loaded only in the
 * browser.
 */
import type { GameConfig } from "../desk/game";
import { FORMATS, FPS } from "./src/formats";

const config: GameConfig = {
  id: "bits",
  name: "Blood in the Sand",
  icon: "assets/app-icon.png",
  root: import.meta.dir,
  remotionEntry: "src/index.ts",
  publicDir: "public",
  footageDir: "public/footage",
  rendersDir: "out/desk",
  prepare: [["bun", "scripts/sync-assets.ts"]],
  fps: FPS,
  formats: FORMATS,
  drive: {
    footageFolderId: "1xslGjrceWPdqsBq11wU2wL7OLVi9-h-7",
    footageRemote: "gdrive-footage",
    // Heroic/BITS by id (drive.file scope can't see UI-made folders by path — see README).
    uploadTarget: "gdrive,root_folder_id=1BKUER-5XJJa2kRZZ1NwaTlPl080niB5Q:Promos/Desk",
  },
  templates: () => import("./desk.templates"),
};
export default config;
