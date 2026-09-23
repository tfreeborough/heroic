import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// Studio's canvas "interactivity" is a design mode: clicking the picture
// selects and drags elements instead of pressing them. Our templates are code,
// and the Footage compositions carry real buttons (SYNC, MARK IN/OUT, SAVE)
// that need the click, so it's off.
Config.setInteractivityEnabled(false);

// CI / headless boxes can point at a system Chromium instead of letting
// Remotion download its own headless shell.
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}
