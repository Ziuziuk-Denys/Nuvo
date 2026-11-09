// GNOME and KDE on Wayland match a window to its .desktop file by app_id: no entry, no icon
import fs from "node:fs";
import path from "node:path";
import { APP_ID } from "./mainWindow";

export const ENTRY_SIZES = [16, 32, 48, 64, 128, 256, 512] as const;
/** Marks the file as Nuvo's own, so removing never touches an entry the user or a package made. */
const MARK = "X-Nuvo-AppImage=true";

export interface DesktopEntryDeps {
  env: Record<string, string | undefined>;
  home: string;
  icon(size: number): Buffer;
  refreshCache(themeDir: string): Promise<void>;
}

export function entryTarget(env: Record<string, string | undefined>, home: string): string | null {
  const dataHome = env.XDG_DATA_HOME;
  if (dataHome && path.resolve(dataHome) !== path.resolve(home, ".local", "share")) return null;
  return env.APPIMAGE || null;
}

export function systemEntryExists(env: Record<string, string | undefined>, exists: (file: string) => boolean = fs.existsSync): boolean {
  const dirs = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
  return dirs.some((dir) => exists(path.join(dir, "applications", `${APP_ID}.desktop`)));
}

export function execArgument(file: string): string {
  const quoted = `"${file.replace(/[\\"`$]/g, (char) => `\\${char}`)}"`;
  return quoted.replace(/\\/g, "\\\\").replace(/%/g, "%%");
}

export function entryText(appImage: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Nuvo",
    "GenericName=Music Player",
    "Comment=Local-first music player",
    // the same flags as the entry inside the AppImage: its sandbox helper cannot be setuid there
    `Exec=${execArgument(appImage)} --no-sandbox %U`,
    `TryExec=${appImage}`,
    `Icon=${APP_ID}`,
    "Terminal=false",
    "Categories=AudioVideo;Audio;Player;",
    "Keywords=music;player;audio;lyrics;playlist;",
    "MimeType=x-scheme-handler/nuvo;",
    `StartupWMClass=${APP_ID}`,
    "SingleMainWindow=true",
    "X-GNOME-UsesNotifications=true",
    MARK,
    "",
  ].join("\n");
}

function paths(home: string) {
  const data = path.join(home, ".local", "share");
  const theme = path.join(data, "icons", "hicolor");
  return {
    entry: path.join(data, "applications", `${APP_ID}.desktop`),
    theme,
    icon: (size: number) => path.join(theme, `${size}x${size}`, "apps", `${APP_ID}.png`),
  };
}

function ours(file: string): boolean {
  try {
    return fs.readFileSync(file, "utf8").split("\n").includes(MARK);
  } catch {
    return false;
  }
}

function writeAtomic(file: string, bytes: Buffer | string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, file);
}

async function remove(deps: DesktopEntryDeps): Promise<boolean> {
  const where = paths(deps.home);
  if (!ours(where.entry)) return false;
  fs.rmSync(where.entry, { force: true });
  for (const size of ENTRY_SIZES) fs.rmSync(where.icon(size), { force: true });
  await deps.refreshCache(where.theme).catch(() => undefined);
  return true;
}

export async function syncDesktopEntry(on: boolean, deps: DesktopEntryDeps): Promise<"written" | "current" | "removed" | "skipped"> {
  const appImage = entryTarget(deps.env, deps.home);
  if (!appImage) return "skipped";
  if (!on || systemEntryExists(deps.env)) {
    const removed = await remove(deps);
    return on ? "skipped" : removed ? "removed" : "current";
  }
  const where = paths(deps.home);
  const text = entryText(appImage);
  let current: string | null = null;
  try {
    current = fs.readFileSync(where.entry, "utf8");
  } catch {}
  // a hand-made entry under the same name is the user's, never replaced
  if (current !== null && !current.split("\n").includes(MARK)) return "skipped";
  const iconsPresent = ENTRY_SIZES.every((size) => fs.existsSync(where.icon(size)));
  if (current === text && iconsPresent) return "current";
  for (const size of ENTRY_SIZES) writeAtomic(where.icon(size), deps.icon(size));
  writeAtomic(where.entry, text);
  await deps.refreshCache(where.theme).catch(() => undefined);
  return "written";
}
