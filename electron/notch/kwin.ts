import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PLUGIN = "nuvo-notch";

async function gdbus(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args);
  return stdout;
}

function call(objectPath: string, method: string, ...args: string[]): string[] {
  return ["call", "--session", "--dest", "org.kde.KWin", "--object-path", objectPath, "--method", method, ...args];
}

/** Unloads the Notch script; errors are ignored (KWin gone or script never loaded). */
export async function unloadKwinScript(run: (cmd: string, args: string[]) => Promise<string> = gdbus): Promise<void> {
  await run("gdbus", call("/Scripting", "org.kde.kwin.Scripting.unloadScript", PLUGIN)).catch(() => "");
}

export async function loadKwinScript(
  script: string,
  run: (cmd: string, args: string[]) => Promise<string> = gdbus,
  dir = path.join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "nuvo"),
): Promise<boolean> {
  try {
    const file = path.join(dir, "notch-kwin.js");
    await mkdir(dir, { recursive: true });
    await writeFile(file, script);
    await unloadKwinScript(run);
    const loaded = await run("gdbus", call("/Scripting", "org.kde.kwin.Scripting.loadScript", file, PLUGIN));
    const id = /int32 (\d+)/.exec(loaded)?.[1];
    if (!id) return false;
    await run("gdbus", call(`/Scripting/Script${id}`, "org.kde.kwin.Script.run"));
    return true;
  } catch (error) {
    console.warn("[notch] KWin script failed:", error);
    return false;
  }
}
