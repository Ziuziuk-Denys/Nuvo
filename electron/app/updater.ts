export type UpdatePhase = "off" | "idle" | "checking" | "latest" | "error" | "downloading" | "ready" | "available";
export type UpdateMode = "install" | "notify" | "off";

export interface UpdateView {
  phase: UpdatePhase;
  mode: UpdateMode;
  version?: string;
  percent?: number;
}

export const FIRST_CHECK_MS = 15_000;
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
export const RETRY_FIRST_MS = 60_000;
export const RETRY_MAX_MS = 30 * 60 * 1000;
export const WAKE_GAP_MS = 30 * 60 * 1000;

// Unsigned macOS builds cannot be replaced by Squirrel.Mac, a deb install would need root, and the Windows zip has no installer to update
export function updateMode(input: { platform: NodeJS.Platform; packaged: boolean; appImage: boolean; installed: boolean }): UpdateMode {
  if (!input.packaged) return "off";
  if ((input.platform === "win32" && input.installed) || (input.platform === "linux" && input.appImage)) return "install";
  return "notify";
}

const SLUG = /^[A-Za-z0-9._-]{1,100}$/;

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
  check(): Promise<{ version: string } | null>;
  download(onProgress: (percent: number) => void): Promise<void>;
  installOnQuit(on: boolean): void;
  quitAndInstall(): void;
}

export interface UpdaterDeps {
  backend: UpdateBackend;
  mode: UpdateMode;
  enabled: () => boolean;
  emit: (view: UpdateView) => void;
  log: (message: string, error?: unknown) => void;
}

export class Updater {
  private phase: UpdatePhase;
  private version: string | undefined;
  private percent: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private lastCheck = 0;
  // bumped when updates are switched off, so a check in flight drops its result
  private epoch = 0;
  private lastSent = "";

  constructor(private readonly deps: UpdaterDeps) {
    this.phase = deps.mode === "off" ? "off" : "idle";
    this.lastSent = JSON.stringify(this.view());
  }

  view(): UpdateView {
    const view: UpdateView = { phase: this.phase, mode: this.deps.mode };
    if (this.version !== undefined && (this.phase === "downloading" || this.phase === "ready" || this.phase === "available")) view.version = this.version;
    if (this.phase === "downloading" && this.percent !== undefined) view.percent = this.percent;
    return view;
  }

  start(): void {
    this.schedule(FIRST_CHECK_MS);
  }

  wake(): void {
    if (Date.now() - this.lastCheck >= WAKE_GAP_MS) this.schedule(FIRST_CHECK_MS);
  }

  setEnabled(on: boolean): void {
    if (this.deps.mode === "off") return;
    if (on) return this.schedule(FIRST_CHECK_MS);
    this.stopTimer();
    if (this.phase === "checking" || this.phase === "downloading" || this.phase === "ready" || this.phase === "available") {
      this.epoch++;
      this.version = this.percent = undefined;
      this.deps.backend.installOnQuit(false);
      this.set("idle");
    }
  }

  install(): boolean {
    if (this.phase !== "ready" || this.deps.mode !== "install") return false;
    this.deps.backend.quitAndInstall();
    return true;
  }

  async check(): Promise<void> {
    if (!this.checkable()) return;
    this.stopTimer();
    this.lastCheck = Date.now();
    const epoch = this.epoch;
    this.set("checking");
    try {
      const found = await this.deps.backend.check();
      if (epoch !== this.epoch) return;
      if (!found) {
        this.failures = 0;
        this.set("latest");
        return this.schedule(CHECK_EVERY_MS);
      }
      if (!validVersion(found.version)) throw new Error("the feed names no plain version");
      this.version = found.version;
      if (this.deps.mode === "notify") return this.set("available");
      this.percent = 0;
      this.set("downloading");
      await this.deps.backend.download((percent) => {
        if (epoch !== this.epoch) return;
        this.percent = Math.max(0, Math.min(100, Math.floor(percent)));
        this.set("downloading");
      });
      if (epoch !== this.epoch) return;
      this.failures = 0;
      this.set("ready");
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.deps.log("[update] check failed", error);
      this.version = this.percent = undefined;
      this.set("error");
      this.schedule(Math.min(RETRY_FIRST_MS * 2 ** this.failures++, RETRY_MAX_MS));
    }
  }

  private checkable(): boolean {
    return this.phase === "idle" || this.phase === "latest" || this.phase === "error";
  }

  private schedule(delayMs: number): void {
    this.stopTimer();
    if (!this.checkable() || !this.deps.enabled()) return;
    this.timer = setTimeout(() => void this.check(), delayMs);
    this.timer.unref?.();
  }

  private stopTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
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
export function createBackend(updater: AutoUpdaterLike, latestTag: () => Promise<string>): UpdateBackend {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  // the release feed weighs about 45 KB and the latest tag half a kilobyte, so the feed is read again only after a new release
  let settledTag: string | undefined;
  return {
    async check() {
      const tag = await latestTag().catch(() => undefined);
      if (tag !== undefined && tag === settledTag) return null;
      const result = await updater.checkForUpdates();
      if (result?.isUpdateAvailable) return { version: result.updateInfo.version };
      settledTag = tag;
      return null;
    },
    async download(onProgress) {
      const listener = (progress: { percent: number }) => onProgress(progress.percent);
      updater.on("download-progress", listener);
      // electron-updater adds its quit handler when a download finishes, and only if this is already on
      updater.autoInstallOnAppQuit = true;
      try {
        await updater.downloadUpdate();
      } catch (error) {
        updater.autoInstallOnAppQuit = false;
        throw error;
      } finally {
        updater.off("download-progress", listener);
      }
    },
    installOnQuit(on) {
      updater.autoInstallOnAppQuit = on;
    },
    quitAndInstall() {
      updater.quitAndInstall(false, true);
    },
  };
}
