// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENTRY_SIZES, entryTarget, entryText, execArgument, syncDesktopEntry, systemEntryExists } from "./desktopEntry";

const temps: string[] = [];
function temp(): string {
  const base = path.join(homedir(), ".cache");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(path.join(base, "nuvo-entry-test-"));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(appImage = "/opt/apps/Nuvo-0.2.10-linux-x86_64.AppImage") {
  const home = temp();
  const system = path.join(home, "system");
  const refreshCache = vi.fn(async () => undefined);
  const deps = { env: { APPIMAGE: appImage, XDG_DATA_DIRS: system }, home, icon: (size: number) => Buffer.from(`png${size}`), refreshCache };
  const entry = path.join(home, ".local", "share", "applications", "quest.nuvo.Nuvo.desktop");
  const icon = (size: number) => path.join(home, ".local", "share", "icons", "hicolor", `${size}x${size}`, "apps", "quest.nuvo.Nuvo.png");
  return { home, system, deps, entry, icon, refreshCache };
}

describe("entryTarget", () => {
  it("is the AppImage path on the real profile only", () => {
    expect(entryTarget({ APPIMAGE: "/a/Nuvo.AppImage" }, "/home/u")).toBe("/a/Nuvo.AppImage");
    expect(entryTarget({ APPIMAGE: "/a/Nuvo.AppImage", XDG_DATA_HOME: "/home/u/.local/share/" }, "/home/u")).toBe("/a/Nuvo.AppImage");
    expect(entryTarget({ APPIMAGE: "/a/Nuvo.AppImage", XDG_DATA_HOME: "/home/u/.cache/test/data" }, "/home/u")).toBeNull();
    expect(entryTarget({}, "/home/u")).toBeNull();
  });
});

describe("entry text", () => {
  it("quotes the path as one Exec argument and names the icon and window class after the app id", () => {
    expect(execArgument("/home/u/Apps/Nuvo.AppImage")).toBe('"/home/u/Apps/Nuvo.AppImage"');
    expect(execArgument('/x/a b$"%`\\.AppImage')).toBe('"/x/a b\\\\$\\\\"%%\\\\`\\\\\\\\.AppImage"');
    const text = entryText("/home/u/My Apps/Nuvo.AppImage");
    expect(text).toContain('Exec="/home/u/My Apps/Nuvo.AppImage" --no-sandbox %U\n');
    expect(text).toContain("Icon=quest.nuvo.Nuvo\n");
    expect(text).toContain("StartupWMClass=quest.nuvo.Nuvo\n");
  });

  it("finds a package's own entry in XDG_DATA_DIRS", () => {
    const seen: string[] = [];
    const exists = (file: string) => (seen.push(file), file === "/usr/share/applications/quest.nuvo.Nuvo.desktop");
    expect(systemEntryExists({}, exists)).toBe(true);
    expect(seen[0]).toBe("/usr/local/share/applications/quest.nuvo.Nuvo.desktop");
    expect(systemEntryExists({ XDG_DATA_DIRS: "/opt/share" }, exists)).toBe(false);
  });
});

describe("syncDesktopEntry", () => {
  it("writes the entry and every icon size once, rewrites Exec when the AppImage moves, and removes only its own files", async () => {
    const { deps, entry, icon, refreshCache } = setup();
    expect(await syncDesktopEntry(true, deps)).toBe("written");
    expect(readFileSync(entry, "utf8")).toContain('Exec="/opt/apps/Nuvo-0.2.10-linux-x86_64.AppImage"');
    for (const size of ENTRY_SIZES) expect(readFileSync(icon(size), "utf8")).toBe(`png${size}`);
    expect(refreshCache).toHaveBeenCalledTimes(1);
    expect(await syncDesktopEntry(true, deps)).toBe("current");

    const moved = { ...deps, env: { ...deps.env, APPIMAGE: "/home/u/Nuvo.AppImage" } };
    expect(await syncDesktopEntry(true, moved)).toBe("written");
    expect(readFileSync(entry, "utf8")).toContain('Exec="/home/u/Nuvo.AppImage"');

    expect(await syncDesktopEntry(false, moved)).toBe("removed");
    expect(existsSync(entry)).toBe(false);
    expect(ENTRY_SIZES.some((size) => existsSync(icon(size)))).toBe(false);
    expect(await syncDesktopEntry(false, moved)).toBe("current");
  });

  it("leaves a system package's entry to it and drops a stale one of its own", async () => {
    const { deps, system, entry } = setup();
    await syncDesktopEntry(true, deps);
    mkdirSync(path.join(system, "applications"), { recursive: true });
    writeFileSync(path.join(system, "applications", "quest.nuvo.Nuvo.desktop"), "[Desktop Entry]\n");
    expect(await syncDesktopEntry(true, deps)).toBe("skipped");
    expect(existsSync(entry)).toBe(false);
  });

  it("never replaces or removes an entry the user made", async () => {
    const { deps, entry } = setup();
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, "[Desktop Entry]\nName=Mine\n");
    expect(await syncDesktopEntry(true, deps)).toBe("skipped");
    expect(await syncDesktopEntry(false, deps)).toBe("current");
    expect(readFileSync(entry, "utf8")).toBe("[Desktop Entry]\nName=Mine\n");
  });

  it("does nothing outside an AppImage or on a profile with a moved data folder", async () => {
    const { deps, home, entry } = setup();
    expect(await syncDesktopEntry(true, { ...deps, env: { XDG_DATA_DIRS: deps.env.XDG_DATA_DIRS } })).toBe("skipped");
    expect(await syncDesktopEntry(true, { ...deps, env: { ...deps.env, XDG_DATA_HOME: path.join(home, "elsewhere") } })).toBe("skipped");
    expect(existsSync(entry)).toBe(false);
    expect(existsSync(path.join(home, "elsewhere"))).toBe(false);
  });
});
