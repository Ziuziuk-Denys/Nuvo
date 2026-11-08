/** Shutdown, sleep blocker, crash policy, app icon and Chromium storage. */
import { default as fs } from "node:fs";
import { default as os } from "node:os";
import { default as path } from "node:path";
import type { Status } from "../../src/engine/types";

export const QUIT_HANDSHAKE_MS = 800;
export const WATCHDOG_MS = 4000;
export const STEP_TIMEOUT_MS = 1000;
/** Reserved for the daemon step: core-host's stop (EOF, SIGTERM at 1.5 s, SIGKILL 1 s later) plus slack, inside the watchdog. */
export const DAEMON_BUDGET_MS = 2700;
export const CRASH_WINDOW_MS = 60_000;
export const ICON_SIZES = [16, 32, 48, 64, 128, 256, 512];
export const ICON_CACHE_TIMEOUT_MS = 5000;

export interface ShutdownDeps {
  /** Sends `app:before-quit` and resolves on `app:quit-ready`; null when no renderer is alive. */
  askRenderer(deadlineMs: number): Promise<void> | null;
  steps: Array<[name: string, run: () => void | Promise<void>]>;
  quit(): void;
  exit(code: number): void;
  log(message: string, error?: unknown): void;
}

/** One idempotent shutdown with a quit handshake and a watchdog. */
export class Shutdown {
  private started: Promise<void> | null = null;
  quitting = false;

  constructor(private readonly deps: ShutdownDeps) {}

  run(): Promise<void> {
    if (this.started) return this.started;
    this.quitting = true;
    const watchdog = setTimeout(() => this.deps.exit(0), WATCHDOG_MS);
    watchdog.unref?.();
    const startedAt = Date.now();
    this.started = (async () => {
      let ready: Promise<void> | null = null;
      try {
        ready = this.deps.askRenderer(QUIT_HANDSHAKE_MS);
      } catch (error) {
        this.deps.log("[shutdown] renderer handshake failed", error);
      }
      if (ready) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise((resolve) => (timer = setTimeout(resolve, QUIT_HANDSHAKE_MS)));
        await Promise.race([ready.catch(() => undefined), timeout]);
        clearTimeout(timer);
      }
      // the daemon stop (stdin EOF) always goes last
      const steps = [...this.deps.steps.filter(([name]) => name !== "daemon"), ...this.deps.steps.filter(([name]) => name === "daemon")];
      // other steps may only wait until the daemon's reserved budget begins; the daemon may use the rest of the watchdog
      const daemonFrom = startedAt + WATCHDOG_MS - DAEMON_BUDGET_MS;
      for (const [name, step] of steps) {
        // 100 ms of slack leaves the quit call ahead of the watchdog
        const waitMs = name === "daemon" ? startedAt + WATCHDOG_MS - 100 - Date.now() : Math.min(STEP_TIMEOUT_MS, daemonFrom - Date.now());
        if (waitMs <= 0) {
          // out of time: the step still starts, nobody waits for it
          Promise.resolve()
            .then(step)
            .catch((error) => this.deps.log(`[shutdown] ${name} failed`, error));
          continue;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const hung = new Promise<void>((resolve) => (timer = setTimeout(() => (this.deps.log(`[shutdown] ${name} timed out`), resolve()), waitMs)));
          await Promise.race([Promise.resolve().then(step), hung]);
        } catch (error) {
          this.deps.log(`[shutdown] ${name} failed`, error);
        } finally {
          clearTimeout(timer);
        }
      }
      try {
        this.deps.quit();
      } catch {
        this.deps.exit(0);
      }
    })();
    return this.started;
  }
}

export interface BlockerApi {
  start(type: "prevent-display-sleep"): number;
  stop(id: number): void;
}

/** One display-sleep blocker while the relayed status is playing or loading. */
export class SleepBlocker {
  private id: number | null = null;
  constructor(private readonly api: BlockerApi) {}

  update(status: Status): void {
    const want = status === "playing" || status === "loading";
    if (want && this.id === null) this.id = this.api.start("prevent-display-sleep");
    if (!want) this.release();
  }

  release(): void {
    if (this.id === null) return;
    this.api.stop(this.id);
    this.id = null;
  }
}

/** Reload once after a renderer crash; a second crash within 60 s leaves the window as it is. */
export class CrashPolicy {
  private lastReload = -Infinity;
  constructor(private readonly now: () => number) {}

  shouldReload(): boolean {
    if (this.now() - this.lastReload < CRASH_WINDOW_MS) return false;
    this.lastReload = this.now();
    return true;
  }
}

export interface IconDeps {
  packaged: boolean;
  platform: NodeJS.Platform;
  dataHome: string;
  iconName: string;
  /** Scales a PNG to a square size (Electron `nativeImage` in production). */
  scale(png: Buffer, size: number): Buffer;
  refreshCache(themeDir: string): Promise<void>;
  setWindowIcon(png: Buffer): void;
}

/** Window icon always; in a packaged Linux build also the freedesktop theme icon. Jobs run one after another. */
export class IconInstaller {
  private queue: Promise<void> = Promise.resolve();
  private lastBytes: Buffer | null = null;

  constructor(private readonly deps: IconDeps) {}

  private file(size: number): string {
    return path.join(this.deps.dataHome, "icons", "hicolor", `${size}x${size}`, "apps", `${this.deps.iconName}.png`);
  }

  apply(pngDataUrl: string, stock: boolean): Promise<void> {
    const job = this.queue.then(() => this.run(pngDataUrl, stock));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async run(pngDataUrl: string, stock: boolean): Promise<void> {
    const png = Buffer.from(pngDataUrl.slice("data:image/png;base64,".length), "base64");
    this.deps.setWindowIcon(png);
    if (!this.deps.packaged || this.deps.platform !== "linux") return;
    const themeDir = path.join(this.deps.dataHome, "icons", "hicolor");
    if (stock) {
      let removed = 0;
      for (const size of ICON_SIZES) {
        try {
          fs.unlinkSync(this.file(size));
          removed += 1;
        } catch {
          // not installed
        }
      }
      this.lastBytes = null;
      if (removed > 0) await this.deps.refreshCache(themeDir).catch(() => undefined);
      return;
    }
    if (this.lastBytes?.equals(png)) return;
    for (const size of ICON_SIZES) {
      fs.mkdirSync(path.dirname(this.file(size)), { recursive: true });
      // A half-written icon is what the desktop would keep showing after a crash here.
      const temporary = `${this.file(size)}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, size === 512 ? png : this.deps.scale(png, size));
      fs.renameSync(temporary, this.file(size));
    }
    this.lastBytes = png;
    await this.deps.refreshCache(themeDir).catch(() => undefined);
  }
}

export function directorySize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else {
      try {
        total += fs.statSync(full).size;
      } catch {
        // vanished while counting
      }
    }
  }
  return total;
}

export interface ChromiumUsage {
  httpCacheBytes: number;
  codeCacheBytes: number;
  localStorageBytes: number;
  indexedDbBytes: number;
  serviceWorkerBytes: number;
  blobBytes: number;
  path: string;
}

export async function chromiumUsage(userData: string, sessionCacheSize: () => Promise<number>): Promise<ChromiumUsage> {
  const cachePath = path.join(userData, "Cache");
  try {
    const sessionBytes = await sessionCacheSize();
    return {
      httpCacheBytes: Math.max(sessionBytes, directorySize(cachePath)),
      codeCacheBytes: directorySize(path.join(userData, "Code Cache")),
      localStorageBytes: directorySize(path.join(userData, "Local Storage")),
      indexedDbBytes: directorySize(path.join(userData, "IndexedDB")),
      serviceWorkerBytes: directorySize(path.join(userData, "Service Worker")),
      blobBytes: directorySize(path.join(userData, "blob_storage")),
      path: cachePath,
    };
  } catch {
    return { httpCacheBytes: 0, codeCacheBytes: 0, localStorageBytes: 0, indexedDbBytes: 0, serviceWorkerBytes: 0, blobBytes: 0, path: cachePath };
  }
}

/** `shell:reveal` accepts an absolute path inside downloads, home or the last save location. */
export function revealTarget(target: unknown, roots: { home: string; downloads: string; lastSave: string | null }): { path: string; folder: boolean } | null {
  if (typeof target !== "string" || !path.isAbsolute(target)) return null;
  const resolved = path.resolve(target);
  const inside = [roots.downloads, roots.home, roots.lastSave]
    .filter((r): r is string => Boolean(r))
    .some((root) => resolved === root || resolved.startsWith(`${path.resolve(root)}${path.sep}`));
  if (!inside) return null;
  if (fs.existsSync(resolved)) return { path: resolved, folder: false };
  const parent = path.dirname(resolved);
  return fs.existsSync(parent) ? { path: parent, folder: true } : null;
}

export const homeRoots = (downloads: string, lastSave: string | null) => ({ home: os.homedir(), downloads, lastSave });
