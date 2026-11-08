import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_EVERY_MS,
  createBackend,
  FIRST_CHECK_MS,
  parseFeed,
  releasePageUrl,
  Updater,
  updateMode,
  validVersion,
  type AutoUpdaterLike,
  type UpdateBackend,
  type UpdateMode,
  type UpdateView,
} from "./updater";

function setup(
  over: {
    mode?: UpdateMode;
    enabled?: boolean;
    backend?: Partial<UpdateBackend>;
  } = {},
) {
  const views: UpdateView[] = [];
  let enabled = over.enabled ?? true;
  const backend: UpdateBackend = {
    check: vi.fn(async () => ({ version: "1.2.0" })),
    download: vi.fn(async (onProgress: (percent: number) => void) => {
      onProgress(40.7);
      onProgress(100);
    }),
    quitAndInstall: vi.fn(),
    ...over.backend,
  };
  const updater = new Updater({
    backend,
    mode: over.mode ?? "install",
    enabled: () => enabled,
    emit: (v) => views.push(v),
    log: vi.fn(),
  });
  return {
    updater,
    backend,
    views,
    setEnabled: (on: boolean) => ((enabled = on), updater.setEnabled(on)),
  };
}

describe("Updater", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("downloads in the background and waits for the user", async () => {
    const { updater, backend, views } = setup();
    await updater.check();
    expect(views.map((v) => [v.phase, v.percent])).toEqual([
      ["downloading", 0],
      ["downloading", 40],
      ["downloading", 100],
      ["ready", undefined],
    ]);
    expect(updater.view()).toEqual({
      phase: "ready",
      mode: "install",
      version: "1.2.0",
    });
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.install()).toBe(true);
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("does not install before the download is done", async () => {
    const { updater, backend } = setup({
      backend: { check: vi.fn(async () => null) },
    });
    await updater.check();
    expect(updater.install()).toBe(false);
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
  });

  it("stays idle when there is nothing newer", async () => {
    const { updater, views } = setup({
      backend: { check: vi.fn(async () => null) },
    });
    await updater.check();
    expect(updater.view().phase).toBe("idle");
    expect(views).toEqual([]);
  });

  it("is silent offline and tries again at the next interval", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("ENOTFOUND")).mockResolvedValue(null);
    const { updater, views } = setup({ backend: { check } });
    updater.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(views).toEqual([]);
    expect(updater.view().phase).toBe("idle");
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("returns to idle without a message when the download fails", async () => {
    const { updater } = setup({
      backend: {
        download: vi.fn(async () => Promise.reject(new Error("reset"))),
      },
    });
    await updater.check();
    expect(updater.view()).toEqual({ phase: "idle", mode: "install" });
  });

  it("only notifies where it cannot install", async () => {
    const { updater, backend } = setup({ mode: "notify" });
    await updater.check();
    expect(updater.view()).toEqual({
      phase: "available",
      mode: "notify",
      version: "1.2.0",
    });
    expect(backend.download).not.toHaveBeenCalled();
    expect(updater.install()).toBe(false);
  });

  it("ignores a version that is not plain semver", async () => {
    const { updater } = setup({
      backend: { check: vi.fn(async () => ({ version: "<b>1</b>" })) },
    });
    await updater.check();
    expect(updater.view().phase).toBe("idle");
  });

  it("never checks in development or while switched off", async () => {
    const dev = setup({ mode: "off" });
    dev.updater.start();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(dev.backend.check).not.toHaveBeenCalled();
    const off = setup({ enabled: false });
    off.updater.start();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(off.backend.check).not.toHaveBeenCalled();
    expect(off.updater.view().phase).toBe("off");
  });

  it("checks soon after being switched on and stops when switched off", async () => {
    const { updater, backend, setEnabled } = setup({
      enabled: false,
      backend: { check: vi.fn(async () => null) },
    });
    setEnabled(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(backend.check).toHaveBeenCalledTimes(1);
    setEnabled(false);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(backend.check).toHaveBeenCalledTimes(1);
    expect(updater.view().phase).toBe("off");
  });

  it("drops a download that finishes after the switch went off", async () => {
    let finish!: () => void;
    const download = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { updater, setEnabled } = setup({ backend: { download } });
    const running = updater.check();
    await vi.advanceTimersByTimeAsync(0);
    setEnabled(false);
    finish();
    await running;
    expect(updater.view()).toEqual({ phase: "off", mode: "install" });
  });

  it("runs one check at a time", async () => {
    const { updater, backend } = setup({
      backend: { check: vi.fn(async () => null) },
    });
    await Promise.all([updater.check(), updater.check()]);
    expect(backend.check).toHaveBeenCalledTimes(1);
  });
});

describe("updateMode", () => {
  it("installs on Windows and AppImage, notifies elsewhere, and is off in development", () => {
    const packaged = true;
    expect(updateMode({ platform: "win32", packaged, appImage: false })).toBe("install");
    expect(updateMode({ platform: "linux", packaged, appImage: true })).toBe("install");
    expect(updateMode({ platform: "linux", packaged, appImage: false })).toBe("notify");
    expect(updateMode({ platform: "darwin", packaged, appImage: false })).toBe("notify");
    expect(updateMode({ platform: "win32", packaged: false, appImage: false })).toBe("off");
  });
});

describe("feed and version validators", () => {
  it("reads the GitHub feed written from the build config", () => {
    const yaml = "owner: Ziuziuk-Denys\nrepo: nuvo\nprovider: github\nupdaterCacheDirName: nuvo-updater\n";
    expect(parseFeed(yaml)).toEqual({ owner: "Ziuziuk-Denys", repo: "nuvo" });
    expect(releasePageUrl({ owner: "Ziuziuk-Denys", repo: "nuvo" })).toBe("https://github.com/Ziuziuk-Denys/nuvo/releases/latest");
  });

  it("refuses other providers and odd names", () => {
    expect(parseFeed("provider: generic\nurl: https://example.com\n")).toBeNull();
    expect(parseFeed("provider: github\nowner: a/b\nrepo: nuvo\n")).toBeNull();
    expect(parseFeed("provider: github\nowner: a\nrepo: ../x\n")).toBeNull();
    expect(parseFeed("provider: github\nowner: a\n")).toBeNull();
  });

  it("accepts plain semver only", () => {
    expect(["1.2.3", "10.0.0-beta.1"].every(validVersion)).toBe(true);
    expect(["", "1.2", "v1.2.3", "1.2.3 <x>", 3, null].some(validVersion)).toBe(false);
  });
});

describe("createBackend", () => {
  function fake(): AutoUpdaterLike & {
    listeners: Array<(p: { percent: number }) => void>;
  } {
    const listeners: Array<(p: { percent: number }) => void> = [];
    return {
      listeners,
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowPrerelease: true,
      allowDowngrade: true,
      checkForUpdates: async () => ({
        isUpdateAvailable: true,
        updateInfo: { version: "2.0.0" },
      }),
      downloadUpdate: async () => listeners.forEach((l) => l({ percent: 50 })),
      quitAndInstall: vi.fn(),
      on: (_event, listener) => listeners.push(listener),
      off: (_event, listener) => listeners.splice(listeners.indexOf(listener), 1),
    };
  }

  it("turns off every automatic behaviour", () => {
    const updater = fake();
    createBackend(updater);
    expect([updater.autoDownload, updater.autoInstallOnAppQuit, updater.allowPrerelease, updater.allowDowngrade]).toEqual([false, false, false, false]);
  });

  it("maps check, progress and install", async () => {
    const updater = fake();
    const backend = createBackend(updater);
    expect(await backend.check()).toEqual({ version: "2.0.0" });
    const seen: number[] = [];
    await backend.download((p) => seen.push(p));
    expect(seen).toEqual([50]);
    expect(updater.listeners).toHaveLength(0);
    backend.quitAndInstall();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
});
