import { app, BrowserWindow, nativeImage } from "electron";
import { IDLE_STATE } from "../../electron/app/relay";
import { THUMBAR_ICON_SIZES, THUMBAR_LABELS_EN, thumbarButtons, thumbarIconFile, type ThumbarIcon } from "../../electron/app/thumbar";

const ICONS: ThumbarIcon[] = ["previous", "play", "pause", "next", "like", "liked"];
const TRIES = 10;
const RETRY_MS = 200;

void app.whenReady().then(async () => {
  const problems: string[] = [];
  for (const icon of ICONS) {
    for (const size of THUMBAR_ICON_SIZES) {
      const image = nativeImage.createFromPath(thumbarIconFile(process.cwd(), icon, size));
      if (image.getSize().width !== size) problems.push(`${icon}-${size}.png does not load at ${size} px`);
    }
  }
  const win = new BrowserWindow({ width: 480, height: 320 });
  await win.loadURL("data:text/html,<title>Nuvo thumbar check</title>");
  const buttons = thumbarButtons({ ...IDLE_STATE, trackId: "t", status: "playing" }, THUMBAR_LABELS_EN).map((button) => ({
    icon: nativeImage.createFromPath(thumbarIconFile(process.cwd(), button.icon, 16)),
    tooltip: button.tooltip,
    click: () => {},
  }));
  // the taskbar takes buttons only once it has made the window's button
  let set = false;
  for (let tries = 0; tries < TRIES && !set; tries++) {
    set = win.setThumbarButtons(buttons);
    if (!set) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  if (!set) problems.push("the taskbar refused the buttons");
  if (!win.setThumbarButtons([])) problems.push("the taskbar refused to clear the buttons");
  console.log(problems.length > 0 ? problems.join("\n") : `set ${buttons.length} buttons and cleared them`);
  app.exit(problems.length > 0 ? 1 : 0);
});
