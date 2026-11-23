import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { createInterface } from "node:readline";
import { app, BrowserWindow, screen } from "electron";
import { DEFAULT_NOTCH_SETTINGS, type NotchAction } from "../../src/notch/contracts";
import { NotchWindow, registerNotchIpc } from "../../electron/notch/window";

const ROOT = process.env.NUVO_ROOT ?? "";
const SHOWS = 3;
const SETTLE_MS = 1500;
const TRACK = { id: "t", title: "Title", artist: "Artist", coverUrl: null, durationMs: 200_000 };
const STEPS = [".play", ".dislike", ".like", ".deck-cover", ".deck-next", ".deck-cover", ".plus", ".add-rows .row", ".plus"];
const EXPECTED = ["togglePlay", "dislike", "like", "addToPlaylist"];
const PAGES = ["now", "now", "now", "lyrics", "upNext", "now", "add", "add", "now"];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mouse = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "e2e", "windows", "mouse.ps1")], {
  stdio: ["pipe", "pipe", "inherit"],
});
const answers = createInterface({ input: mouse.stdout });

async function tell(line: string): Promise<void> {
  mouse.stdin.write(`${line}\n`);
  await once(answers, "line");
}

async function probe(): Promise<string[]> {
  const main = new BrowserWindow({ width: 600, height: 400 });
  const actions: NotchAction[] = [];
  const notch = new NotchWindow({
    preloadPath: path.join(ROOT, "dist-electron", "preload-notch.cjs"),
    loadPage: (win) => win.loadFile(path.join(ROOT, "dist", "index.html"), { hash: "/notch" }),
    session: "windows",
    bridge: null,
    loadKwin: async () => false,
    unloadKwin: async () => {},
    getMainWindow: () => main,
  });
  registerNotchIpc(notch, { onAction: (action) => actions.push(action) });
  notch.setState({ track: TRACK, status: "playing", positionMs: 0, sampledAt: Date.now(), liked: false, upNext: [{ ...TRACK, id: "u" }] });
  notch.setLyrics({ trackId: "t", lines: [{ timeMs: 0, text: "Line" }] });
  notch.setPlaylists({ items: [{ id: "p", title: "Playlist", coverUrl: null, trackCount: 1 }], outcome: null });
  notch.applySettings(DEFAULT_NOTCH_SETTINGS);
  await notch.ready;

  const { bounds, scaleFactor } = screen.getPrimaryDisplay();
  const page = notch.webContents!;
  const run = <T>(script: string) => page.executeJavaScript(script) as Promise<T>;
  const move = (x: number, y: number) => tell(`move ${Math.round(x * scaleFactor)} ${Math.round(y * scaleFactor)}`);
  const problems: string[] = [];
  for (let show = 1; show <= SHOWS; show++) {
    actions.length = 0;
    main.minimize();
    await wait(SETTLE_MS);
    const origin = BrowserWindow.fromWebContents(page)!.getBounds();
    await move(origin.x + origin.width / 2, origin.y + 12);
    await wait(SETTLE_MS);
    for (const [index, selector] of STEPS.entries()) {
      const at = await run<{ x: number; y: number }>(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      await move(origin.x + at.x, origin.y + at.y);
      await wait(150);
      await tell("press");
      await wait(500);
      const view = await run<string>(`document.querySelector(".expanded").dataset.view`);
      if (view !== PAGES[index]) problems.push(`show ${show}: ${selector} led to ${view}, not ${PAGES[index]}`);
    }
    const seen = actions.map((action) => action.type);
    if (seen.join() !== EXPECTED.join()) problems.push(`show ${show}: ${seen.join() || "no actions"}`);
    await move(bounds.x + 20, bounds.y + bounds.height - 20);
    main.restore();
    await wait(SETTLE_MS);
  }
  notch.destroy();
  return problems;
}

void app
  .whenReady()
  .then(probe)
  .catch((error) => [String(error)])
  .then((problems) => {
    console.log(problems.length ? problems.join("\n") : `every press landed over ${SHOWS} shows`);
    mouse.kill();
    app.exit(problems.length ? 1 : 0);
  });
