/** Background updates: check on start and every few hours, download quietly, install only when the user asks. */

export type UpdatePhase = "off" | "idle" | "downloading" | "ready" | "available";
/** install: download and replace; notify: only tell and link to the release page; off: no updates here. */
export type UpdateMode = "install" | "notify" | "off";

export interface UpdateView {
  phase: UpdatePhase;
  mode: UpdateMode;
  version?: string;
  percent?: number;
}

export const FIRST_CHECK_MS = 15_000;
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/**
 * Unsigned macOS builds cannot be replaced by Squirrel.Mac, and a deb install would need root, so
 * only Windows and AppImage install themselves. A development run never updates.
 */
export function updateMode(input: { platform: NodeJS.Platform; packaged: boolean; appImage: boolean }): UpdateMode {
  if (!input.packaged) return "off";
  if (input.platform === "win32" || (input.platform === "linux" && input.appImage)) return "install";
  return "notify";
}

const SLUG = /^[A-Za-z0-9._-]{1,100}$/;

/** `owner` and `repo` of the GitHub feed in the `app-update.yml` that electron-builder writes from the build config. */
export function parseFeed(yaml: string): { owner: string; repo: string } | null {
  const value = (key: string) => yaml.match(new RegExp(`^${key}:[ \\t]*['"]?([^'"\\r\\n]*?)['"]?[ \\t]*$`, "m"))?.[1];
  const provider = value("provider");
  const owner = value("owner");
  const repo = value("repo");
  if (provider !== "github" || !owner || !repo || !SLUG.test(owner) || !SLUG.test(repo)) return null;
  return { owner, repo };
}

export const releasePageUrl = (feed: { owner: string; repo: string }): string => `https://github.com/${feed.owner}/${feed.repo}/releases/latest`;

/** A version from the feed is shown in the UI, so only plain semver is accepted. */
export function validVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,5}\.\d{1,5}\.\d{1,5}(-[0-9A-Za-z.-]{1,32})?$/.test(value);
}

export interface UpdateBackend {
  /** The newer version on the feed, or null. Rejects when the feed cannot be reached. */
  check(): Promise<{ version: string } | null>;
  download(onProgress: (percent: number) => void): Promise<void>;
  quitAndInstall(): void;
}

export interface UpdaterDeps {
  backend: UpdateBackend;
  mode: UpdateMode;
  /** the Settings switch, read at every check */
  enabled: () => boolean;
  emit: (view: UpdateView) => void;
  log: (message: string, error?: unknown) => void;
}

export class Updater {
  private phase: UpdatePhase;
  private version: string | undefined;
  private percent: number | undefined;
  private busy = false;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  // bumped when updates are switched off, so a check in flight drops its result
  private epoch = 0;
  private lastSent = "";

  constructor(private readonly deps: UpdaterDeps) {
    this.phase = deps.mode === "off" || !deps.enabled() ? "off" : "idle";
    this.lastSent = JSON.stringify(this.view());
  }

  view(): UpdateView {
    const view: UpdateView = { phase: this.phase, mode: this.deps.mode };
    if (this.version !== undefined && (this.phase === "downloading" || this.phase === "ready" || this.phase === "available")) view.version = this.version;
    if (this.phase === "downloading" && this.percent !== undefined) view.percent = this.percent;
    return view;
  }

  start(): void {
    if (this.deps.mode === "off" || this.phase === "off") return;
    this.schedule();
  }

  setEnabled(on: boolean): void {
    if (this.deps.mode === "off") return;
    if (!on) {
      this.epoch++;
      this.stopTimers();
      this.version = this.percent = undefined;
      this.busy = false;
      this.set("off");
    } else if (this.phase === "off") {
      this.set("idle");
      this.schedule();
    }
  }

  /** Restarts into the new version; only after the user pressed the control and only when it is downloaded. */
  install(): boolean {
    if (this.phase !== "ready" || this.deps.mode !== "install") return false;
    this.deps.backend.quitAndInstall();
    return true;
  }

  async check(): Promise<void> {
    if (this.busy || this.phase !== "idle") return;
    this.busy = true;
    const epoch = this.epoch;
    try {
      const found = await this.deps.backend.check();
      if (epoch !== this.epoch || !found || !validVersion(found.version)) return;
      this.version = found.version;
      if (this.deps.mode === "notify") return this.set("available");
      this.percent = 0;
      this.set("downloading");
      await this.deps.backend.download((percent) => {
        if (epoch !== this.epoch) return;
        this.percent = Math.max(0, Math.min(100, Math.floor(percent)));
        this.set("downloading");
      });
      if (epoch === this.epoch) this.set("ready");
    } catch (error) {
      // offline or a bad feed: stay quiet and try again at the next interval
      if (epoch !== this.epoch) return;
      this.deps.log("[update] check failed", error);
      this.version = this.percent = undefined;
      this.set("idle");
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }

  private schedule(): void {
    this.stopTimers();
    const first = setTimeout(() => void this.check(), FIRST_CHECK_MS);
    const every = setInterval(() => void this.check(), CHECK_EVERY_MS);
    first.unref?.();
    every.unref?.();
    this.timers = [first, every];
  }

  private stopTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers = [];
  }

  private set(phase: UpdatePhase): void {
    this.phase = phase;
    const view = this.view();
    const key = JSON.stringify(view);
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.deps.emit(view);
  }
}

/** The part of electron-updater's `autoUpdater` this module uses. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  checkForUpdates(): Promise<{
    isUpdateAvailable?: boolean;
    updateInfo: { version: string };
  } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  off(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
}

/** Requests go through Electron's `net` on the default session, so the app's proxy settings apply to them too. */
export function createBackend(updater: AutoUpdaterLike): UpdateBackend {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  return {
    async check() {
      const result = await updater.checkForUpdates();
      return result?.isUpdateAvailable ? { version: result.updateInfo.version } : null;
    },
    async download(onProgress) {
      const listener = (progress: { percent: number }) => onProgress(progress.percent);
      updater.on("download-progress", listener);
      try {
        await updater.downloadUpdate();
      } finally {
        updater.off("download-progress", listener);
      }
    },
    quitAndInstall() {
      updater.quitAndInstall(false, true);
    },
  };
}
