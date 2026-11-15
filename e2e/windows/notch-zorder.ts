import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import { DEFAULT_NOTCH_SETTINGS } from "../../src/notch/contracts";
import { NotchWindow } from "../../electron/notch/window";

const COVER_SCRIPT = process.env.NUVO_COVER_SCRIPT ?? "";

// asynchronous, so the main process keeps running its timers while the cover is up
async function notchAboveCover(topMost: boolean): Promise<boolean> {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", COVER_SCRIPT, ...(topMost ? ["-TopMost"] : [])];
  const output = (await promisify(execFile)("powershell.exe", args, { encoding: "utf8" })).stdout.trim();
  console.log(`cover topmost=${topMost}: ${output}`);
  return output.startsWith("notch above");
}

void app.whenReady().then(async () => {
  const notch = new NotchWindow({
    preloadPath: "",
    loadPage: (win) => win.loadURL("data:text/html,<body style='margin:0;background:#000'></body>"),
    session: "windows",
    bridge: null,
    loadKwin: async () => false,
    unloadKwin: async () => {},
    getMainWindow: () => null,
  });
  notch.applySettings({ ...DEFAULT_NOTCH_SETTINGS, mode: "on" });
  await notch.ready;
  const results = [await notchAboveCover(false), await notchAboveCover(true)];
  notch.destroy();
  app.exit(results.every(Boolean) ? 0 : 1);
});
