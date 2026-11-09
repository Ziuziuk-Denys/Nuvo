// Set up only after the user's click; writes only the user's own extension or widget folders
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NotchSession } from "../notch/session";
import type { Exec } from "./compositor";

export type PanelTarget = "gnome" | "plasma" | "waybar";
export const GNOME_UUID = "nuvo-panel@nuvo.quest";
const GNOME_ZIP = path.join("dist", `${GNOME_UUID}.shell-extension.zip`);
const PLASMA_DIR = path.join("plasma", "quest.nuvo.panel");
const WAYBAR_DIR = "waybar";
const TIMEOUT_MS = 15_000;

export type PanelNext = "ready" | "relogin" | "add-widget" | "add-module";
export type PanelInstallResult = { ok: true; next: PanelNext; snippet?: string } | { ok: false; error: string };

export function panelTarget(session: NotchSession, env: Record<string, string | undefined>): PanelTarget | null {
  const desktop = (env.XDG_CURRENT_DESKTOP ?? "").toUpperCase();
  if (desktop.includes("GNOME")) return "gnome";
  if (desktop.includes("KDE")) return "plasma";
  if (session === "hyprland" || session === "sway" || session === "other-wayland") return "waybar";
  return null;
}

export interface PanelDeps {
  resources: string;
  configHome: string;
  exec: Exec;
  pendingFile: string;
}

// A moved XDG_CONFIG_HOME or XDG_DATA_HOME makes desktop tools and the settings daemon disagree
export function panelInstallAllowed(env: Record<string, string | undefined>, home: string): boolean {
  const same = (value: string | undefined, fallback: string) => !value || path.resolve(value) === path.resolve(home, fallback);
  return same(env.XDG_CONFIG_HOME, ".config") && same(env.XDG_DATA_HOME, path.join(".local", "share"));
}

export function panelSource(target: PanelTarget, resources: string): string {
  return path.join(resources, { gnome: GNOME_ZIP, plasma: PLASMA_DIR, waybar: WAYBAR_DIR }[target]);
}

export function panelFilesPresent(target: PanelTarget, resources: string): boolean {
  return existsSync(panelSource(target, resources));
}

/** The shell's own enable call; the shell keeps its extension list, Nuvo never edits it. */
async function enableGnome({ exec, pendingFile }: Pick<PanelDeps, "exec" | "pendingFile">): Promise<PanelNext> {
  try {
    await exec("gnome-extensions", ["enable", GNOME_UUID], TIMEOUT_MS);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    // On Wayland the shell sees a new extension only after the next login
    await writeFile(pendingFile, "");
    return "relogin";
  }
  await rm(pendingFile, { force: true });
  return "ready";
}

async function installGnome(deps: PanelDeps): Promise<PanelNext> {
  await deps.exec("gnome-extensions", ["install", "--force", panelSource("gnome", deps.resources)], TIMEOUT_MS);
  return enableGnome(deps);
}

export async function enablePanelWidget(deps: Pick<PanelDeps, "exec" | "pendingFile">): Promise<PanelInstallResult> {
  try {
    return { ok: true, next: await enableGnome(deps) };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return { ok: false, error: missing ? "missing-tool" : String((error as Error).message ?? error).slice(0, 300) };
  }
}

async function installPlasma({ resources, exec }: PanelDeps): Promise<PanelNext> {
  const dir = path.join(resources, PLASMA_DIR);
  try {
    await exec("kpackagetool6", ["--type", "Plasma/Applet", "--upgrade", dir], TIMEOUT_MS);
  } catch {
    await exec("kpackagetool6", ["--type", "Plasma/Applet", "--install", dir], TIMEOUT_MS);
  }
  return "add-widget";
}

async function installWaybar({ resources, configHome }: PanelDeps): Promise<{ next: PanelNext; snippet: string }> {
  const target = path.join(configHome, "waybar", "nuvo");
  await mkdir(target, { recursive: true });
  await cp(path.join(resources, WAYBAR_DIR), target, { recursive: true, force: true });
  await chmod(path.join(target, "nuvo-waybar"), 0o755);
  const snippet = await readFile(path.join(target, "config.jsonc"), "utf8");
  return { next: "add-module", snippet: snippet.replaceAll("~/.config/waybar/nuvo", target) };
}

export async function installPanelWidget(target: PanelTarget, deps: PanelDeps & { allowed: boolean }): Promise<PanelInstallResult> {
  if (!deps.allowed) return { ok: false, error: "manual" };
  if (!panelFilesPresent(target, deps.resources)) return { ok: false, error: "missing-files" };
  try {
    if (target === "gnome") return { ok: true, next: await installGnome(deps) };
    if (target === "plasma") return { ok: true, next: await installPlasma(deps) };
    return { ok: true, ...(await installWaybar(deps)) };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return { ok: false, error: missing ? "missing-tool" : String((error as Error).message ?? error).slice(0, 300) };
  }
}

export type Launch = (file: string, args: string[]) => Promise<boolean>;

export async function openExtensionsApp(launch: Launch): Promise<boolean> {
  return (await launch("gnome-extensions-app", [])) || launch("gtk-launch", ["org.gnome.Extensions"]);
}
