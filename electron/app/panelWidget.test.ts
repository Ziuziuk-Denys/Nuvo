// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { enablePanelWidget, GNOME_UUID, installPanelWidget, openExtensionsApp, panelFilesPresent, panelInstallAllowed, panelTarget } from "./panelWidget";

const REPO_DESKTOP = path.resolve(import.meta.dirname, "..", "..", "desktop");
const temps: string[] = [];

function temp(): string {
  const base = path.join(homedir(), ".cache");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(path.join(base, "nuvo-panel-test-"));
  temps.push(dir);
  return dir;
}

/** Resources with a stand-in GNOME zip, so the test does not depend on `pnpm panel:pack`. */
function resources(): string {
  const dir = temp();
  mkdirSync(path.join(dir, "dist"));
  writeFileSync(path.join(dir, "dist", `${GNOME_UUID}.shell-extension.zip`), "zip");
  mkdirSync(path.join(dir, "plasma", "quest.nuvo.panel"), { recursive: true });
  return dir;
}

function recorder(fail: (file: string, args: string[]) => string | null = () => null) {
  const calls: string[] = [];
  const exec = async (file: string, args: string[]) => {
    const line = [file, ...args].join(" ");
    calls.push(line);
    const failure = fail(file, args);
    if (failure) throw Object.assign(new Error(failure), failure === "ENOENT" ? { code: "ENOENT" } : {});
    return "";
  };
  return { calls, exec };
}

/** Install deps with a pending marker in its own temp folder. */
function deps(exec: ReturnType<typeof recorder>["exec"], dir = resources()) {
  return { resources: dir, configHome: temp(), exec, pendingFile: path.join(temp(), "pending"), allowed: true };
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("panelTarget", () => {
  it("matches the desktop's own panel", () => {
    expect(panelTarget("gnome-wayland", { XDG_CURRENT_DESKTOP: "ubuntu:GNOME" })).toBe("gnome");
    expect(panelTarget("kde-wayland", { XDG_CURRENT_DESKTOP: "KDE" })).toBe("plasma");
    expect(panelTarget("hyprland", { XDG_CURRENT_DESKTOP: "Hyprland" })).toBe("waybar");
    expect(panelTarget("sway", {})).toBe("waybar");
    expect(panelTarget("other-wayland", { XDG_CURRENT_DESKTOP: "niri" })).toBe("waybar");
    expect(panelTarget("x11", { XDG_CURRENT_DESKTOP: "XFCE" })).toBeNull();
  });
});

describe("installPanelWidget", () => {
  it("GNOME: installs the zip and enables it when the shell already knows it", async () => {
    const dir = resources();
    const { calls, exec } = recorder();
    const options = deps(exec, dir);
    writeFileSync(options.pendingFile, "");
    expect(await installPanelWidget("gnome", options)).toEqual({ ok: true, next: "ready" });
    expect(calls).toEqual([
      `gnome-extensions install --force ${path.join(dir, "dist", `${GNOME_UUID}.shell-extension.zip`)}`,
      `gnome-extensions enable ${GNOME_UUID}`,
    ]);
    expect(existsSync(options.pendingFile)).toBe(false);
  });

  it("GNOME: a new extension waits for the next login, and no shell setting is ever written", async () => {
    const { calls, exec } = recorder((_file, args) => (args[0] === "enable" ? "Extension does not exist" : null));
    const options = deps(exec);
    expect(await installPanelWidget("gnome", options)).toEqual({ ok: true, next: "relogin" });
    expect(calls.map((call) => call.split(" ").slice(0, 2).join(" "))).toEqual(["gnome-extensions install", "gnome-extensions enable"]);
    expect(calls.some((call) => call.startsWith("gsettings") || call.startsWith("dconf"))).toBe(false);
    expect(existsSync(options.pendingFile)).toBe(true);
  });

  it("GNOME: Turn on only enables, and clears the pending mark once the shell takes it", async () => {
    const refused = recorder(() => "Extension does not exist");
    const options = deps(refused.exec);
    expect(await enablePanelWidget(options)).toEqual({ ok: true, next: "relogin" });
    expect(refused.calls).toEqual([`gnome-extensions enable ${GNOME_UUID}`]);
    expect(existsSync(options.pendingFile)).toBe(true);
    const taken = recorder();
    expect(await enablePanelWidget({ ...options, exec: taken.exec })).toEqual({ ok: true, next: "ready" });
    expect(taken.calls).toEqual([`gnome-extensions enable ${GNOME_UUID}`]);
    expect(existsSync(options.pendingFile)).toBe(false);
    expect(await enablePanelWidget({ ...options, exec: recorder(() => "ENOENT").exec })).toEqual({ ok: false, error: "missing-tool" });
  });

  it("a profile with moved folders gets no install at all", async () => {
    const { calls, exec } = recorder();
    for (const target of ["gnome", "plasma", "waybar"] as const) {
      expect(await installPanelWidget(target, { ...deps(exec, REPO_DESKTOP), allowed: false })).toEqual({ ok: false, error: "manual" });
    }
    expect(calls).toEqual([]);
  });

  it("Plasma: upgrades, or installs the first time", async () => {
    const { calls, exec } = recorder((_f, args) => (args[2] === "--upgrade" ? "not installed" : null));
    expect(await installPanelWidget("plasma", deps(exec))).toEqual({ ok: true, next: "add-widget" });
    expect(calls.map((c) => c.split(" ")[3])).toEqual(["--upgrade", "--install"]);
    expect(calls.every((call) => call.startsWith("kpackagetool6 --type Plasma/Applet"))).toBe(true);
  });

  it("Waybar: copies the module next to the config, executable, with a snippet that points there", async () => {
    const config = temp();
    const { calls, exec } = recorder();
    const result = await installPanelWidget("waybar", { ...deps(exec, REPO_DESKTOP), configHome: config });
    const target = path.join(config, "waybar", "nuvo");
    expect(result).toMatchObject({ ok: true, next: "add-module" });
    expect(calls).toEqual([]);
    expect(statSync(path.join(target, "nuvo-waybar")).mode & 0o777).toBe(0o755);
    expect(statSync(path.join(target, "style.css")).isFile()).toBe(true);
    const snippet = (result as { snippet: string }).snippet;
    expect(snippet).toContain(`"exec": "${target}/nuvo-waybar follow"`);
    expect(snippet).not.toContain("~/");
  });

  it("reports missing files and missing tools instead of throwing", async () => {
    const empty = temp();
    expect(panelFilesPresent("gnome", empty)).toBe(false);
    expect(await installPanelWidget("gnome", deps(recorder().exec, empty))).toEqual({ ok: false, error: "missing-files" });
    const { exec } = recorder(() => "ENOENT");
    expect(await installPanelWidget("plasma", deps(exec))).toEqual({ ok: false, error: "missing-tool" });
  });
});

describe("panelInstallAllowed", () => {
  it("allows only the default folders under HOME", () => {
    expect(panelInstallAllowed({}, "/home/u")).toBe(true);
    expect(panelInstallAllowed({ XDG_CONFIG_HOME: "/home/u/.config/", XDG_DATA_HOME: "/home/u/.local/share" }, "/home/u")).toBe(true);
    expect(panelInstallAllowed({ XDG_CONFIG_HOME: "/home/u/.cache/test/config" }, "/home/u")).toBe(false);
    expect(panelInstallAllowed({ XDG_DATA_HOME: "/tmp/profile/data" }, "/home/u")).toBe(false);
  });
});

describe("openExtensionsApp", () => {
  it("starts the native app, else its desktop entry", async () => {
    const started: string[] = [];
    const launch = (ok: string) => async (file: string, args: string[]) => {
      started.push([file, ...args].join(" "));
      return file === ok;
    };
    expect(await openExtensionsApp(launch("gnome-extensions-app"))).toBe(true);
    expect(await openExtensionsApp(launch("gtk-launch"))).toBe(true);
    expect(await openExtensionsApp(launch("none"))).toBe(false);
    expect(started).toEqual([
      "gnome-extensions-app",
      "gnome-extensions-app",
      "gtk-launch org.gnome.Extensions",
      "gnome-extensions-app",
      "gtk-launch org.gnome.Extensions",
    ]);
  });
});
