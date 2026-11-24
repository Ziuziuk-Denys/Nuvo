import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow, nativeImage } from "electron";
import { ICON_FRAMES, writeIco } from "../../electron/app/windowIcon";

// each frame has its own flat colour, so the one Windows took can be told from its pixels
const shade = (at: number) => 20 + at * 25;

function frame(size: number, at: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([shade(at), 0, 0, 255], i);
  return nativeImage.createFromBitmap(pixels, { width: size, height: size }).toPNG();
}

async function check(): Promise<void> {
  const problems: string[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-ico-"));
  const ico = writeIco(dir, ICON_FRAMES.map(frame));
  if (nativeImage.createFromPath(ico).isEmpty()) problems.push("the written ico does not load");
  if (nativeImage.createFromPath(path.join(process.cwd(), "build", "icons", "nuvo.ico")).isEmpty()) problems.push("build/icons/nuvo.ico does not load");
  const win = new BrowserWindow({ width: 480, height: 320 });
  await win.loadURL("data:text/html,<title>Nuvo icon check</title>");
  win.setIcon(ico);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const handle = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  // the window's own thread answers the question, so this one must stay free
  const { stdout: out } = await promisify(execFile)(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(process.cwd(), "e2e", "windows", "icon.ps1"), handle],
    { encoding: "utf8", timeout: 60_000 },
  );
  console.log(out.trim());
  const got = new Map(
    out
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(" "))
      .map(([kind, size, blue]) => [kind, { size: Number(size), blue: Number(blue) }]),
  );
  for (const [kind, size] of [
    ["small", 16],
    ["big", 32],
  ] as const) {
    const seen = got.get(kind);
    if (!seen) problems.push(`the window has no ${kind} icon`);
    else if (seen.size !== size || Math.abs(seen.blue - shade(ICON_FRAMES.indexOf(size))) > 2)
      problems.push(`the ${kind} icon is ${JSON.stringify(seen)}, not the ${size} px frame`);
  }
  console.log(problems.length > 0 ? problems.join("\n") : "the window shows the 16 and 32 px frames of its ico");
  app.exit(problems.length > 0 ? 1 : 0);
}

void app.whenReady().then(() =>
  check().catch((error: unknown) => {
    console.log(String(error));
    app.exit(1);
  }),
);
