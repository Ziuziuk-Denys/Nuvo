import type { SurfaceState } from "../../src/engine/types";
import type { Exec } from "./compositor";

export const PROBE_INTERVAL_MS = 60_000;
export const PROBE_TIMEOUT_MS = 2000;
export const REBUILD_DEBOUNCE_MS = 250;
export const TITLE_MAX = 60;

export type TrayItemId = "title" | "toggle" | "next" | "previous" | "like" | "separator" | "show" | "resetAppearance" | "quit";

export interface TrayMenuItem {
  id: TrayItemId;
  label: string;
  enabled: boolean;
  kind: "item" | "separator";
}

export interface TrayLabels {
  nothingPlaying: string;
  unknownTitle: string;
  play: string;
  pause: string;
  next: string;
  previous: string;
  like: string;
  unlike: string;
  show: string;
  resetAppearance: string;
  quit: string;
}

export const TRAY_LABELS_EN: TrayLabels = {
  nothingPlaying: "Nothing playing",
  unknownTitle: "Unknown title",
  play: "Play",
  pause: "Pause",
  next: "Next",
  previous: "Previous",
  like: "Like",
  unlike: "Unlike",
  show: "Show Nuvo",
  resetAppearance: "Reset appearance (safe mode)",
  quit: "Quit Nuvo",
};

function cutTitle(text: string): string {
  return text.length <= TITLE_MAX ? text : `${text.slice(0, TITLE_MAX - 1)}…`;
}

export function trayMenu(state: SurfaceState, labels: TrayLabels = TRAY_LABELS_EN): TrayMenuItem[] {
  const hasTrack = state.trackId !== null;
  const playing = hasTrack && (state.status === "playing" || state.status === "loading");
  const title = hasTrack ? cutTitle(`${state.title || labels.unknownTitle} - ${state.artists}`) : labels.nothingPlaying;
  return [
    { id: "title", label: title, enabled: false, kind: "item" },
    { id: "toggle", label: playing ? labels.pause : labels.play, enabled: hasTrack, kind: "item" },
    { id: "next", label: labels.next, enabled: hasTrack, kind: "item" },
    { id: "previous", label: labels.previous, enabled: hasTrack, kind: "item" },
    { id: "like", label: state.liked ? labels.unlike : labels.like, enabled: hasTrack, kind: "item" },
    { id: "separator", label: "", enabled: true, kind: "separator" },
    { id: "show", label: labels.show, enabled: true, kind: "item" },
    { id: "resetAppearance", label: labels.resetAppearance, enabled: true, kind: "item" },
    { id: "quit", label: labels.quit, enabled: true, kind: "item" },
  ];
}

export function menuKey(state: SurfaceState): string {
  return [state.trackId, state.status === "playing" || state.status === "loading", state.liked, state.title, state.artists].join("|");
}

export type TrayIconStyle = "mono-on-dark" | "mono-on-light" | "app";

// GNOME's bar and the Plasma panel draw tray icons as one-colour glyphs; GNOME's bar is always dark
export function trayIconStyle(desktop: string, darkTheme: boolean): TrayIconStyle {
  const names = desktop.toUpperCase().split(":");
  if (names.some((name) => name === "GNOME" || name.endsWith("-GNOME") || name === "UNITY")) return "mono-on-dark";
  if (names.includes("KDE")) return darkTheme ? "mono-on-dark" : "mono-on-light";
  return "app";
}

export async function probeWatcher(exec: Exec): Promise<boolean> {
  try {
    const out = await exec(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.DBus",
        "--object-path",
        "/org/freedesktop/DBus",
        "--method",
        "org.freedesktop.DBus.NameHasOwner",
        "org.kde.StatusNotifierWatcher",
      ],
      PROBE_TIMEOUT_MS,
    );
    return out.trim() === "(true,)";
  } catch {
    return false;
  }
}

export interface TrayHost {
  create(onActivate: () => void): { setMenu(items: TrayMenuItem[]): void; destroy(): void };
  onClick(id: TrayItemId): void;
  /** Called when availability changes (the window must never stay hidden with no tray). */
  availabilityChanged(available: boolean): void;
  activate(): void;
}

export class TrayController {
  private handle: ReturnType<TrayHost["create"]> | null = null;
  private available = false;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private key: string | null = null;
  private state: SurfaceState | null = null;

  constructor(
    private readonly host: TrayHost,
    private readonly probe: () => Promise<boolean>,
    private readonly labels: () => TrayLabels = () => TRAY_LABELS_EN,
  ) {}

  get isAvailable(): boolean {
    return this.available;
  }

  async start(): Promise<void> {
    await this.check();
    this.probeTimer = setInterval(() => void this.check(), PROBE_INTERVAL_MS);
  }

  async check(): Promise<void> {
    const available = await this.probe();
    if (available === this.available) return;
    this.available = available;
    if (available) {
      this.handle = this.host.create(() => this.host.activate());
      this.key = null;
      if (this.state) this.render(this.state);
    } else {
      this.handle?.destroy();
      this.handle = null;
    }
    this.host.availabilityChanged(available);
  }

  update(state: SurfaceState): void {
    this.state = state;
    if (menuKey(state) === this.key) return;
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      if (this.state) this.render(this.state);
    }, REBUILD_DEBOUNCE_MS);
  }

  private render(state: SurfaceState): void {
    this.key = menuKey(state);
    this.handle?.setMenu(trayMenu(state, this.labels()));
  }

  dispose(): void {
    if (this.probeTimer) clearInterval(this.probeTimer);
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.handle?.destroy();
    this.handle = null;
  }
}
