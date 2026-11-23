import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, screen } from "electron";
import { DEFAULT_NOTCH_SETTINGS } from "../../src/notch/contracts";
import { NotchWindow } from "../../electron/notch/window";

const PRESS_SCRIPT = process.env.NUVO_PRESS_SCRIPT ?? "";
const SETTLE_MS = 1500;

const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

async function press(x: number, y: number): Promise<void> {
  const scale = screen.getPrimaryDisplay().scaleFactor;
  const at = [x, y].map((value) => String(Math.round(value * scale)));
  await promisify(execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PRESS_SCRIPT, "-X", at[0], "-Y", at[1]]);
}

void app.whenReady().then(async () => {
  const main = new BrowserWindow({ width: 600, height: 400 });
  const notch = new NotchWindow({
    preloadPath: "",
    loadPage: (win) => win.loadURL("data:text/html,<body style='margin:0;background:%23000' onload='presses=0' onmousedown='presses++'></body>"),
    session: "windows",
    bridge: null,
    loadKwin: async () => false,
    unloadKwin: async () => {},
    getMainWindow: () => main,
  });
  notch.applySettings(DEFAULT_NOTCH_SETTINGS);
  await notch.ready;

  const { bounds } = screen.getPrimaryDisplay();
  const presses: number[] = [];
  for (let shown = 0; shown < 3; shown++) {
    main.minimize();
    await settle();
    await press(bounds.x + bounds.width / 2, bounds.y + 16);
    presses.push((await notch.webContents?.executeJavaScript("presses")) as number);
    main.restore();
    await settle();
  }
  console.log(`presses after each show: ${presses.join(", ")}`);
  notch.destroy();
  app.exit(presses.join() === "1,2,3" ? 0 : 1);
});
