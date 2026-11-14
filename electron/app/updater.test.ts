import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_EVERY_MS,
  createBackend,
  FIRST_CHECK_MS,
  parseFeed,
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
  WAKE_GAP_MS,
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
    installOnQuit: vi.fn(),
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

  it("downloads in the background and installs on request", async () => {
    const { updater, backend, views } = setup();
    await updater.check();
    expect(views.map((v) => [v.phase, v.percent])).toEqual([
      ["checking", undefined],
      ["downloading", 0],
      ["downloading", 40],
      ["downloading", 100],
      ["ready", undefined],
    ]);
    expect(updater.view()).toEqual({ phase: "ready", mode: "install", version: "1.2.0" });
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.install()).toBe(true);
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("does not install before the download is done", async () => {
    const { updater, backend } = setup({ backend: { check: vi.fn(async () => null) } });
    await updater.check();
    expect(updater.install()).toBe(false);
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
  });

  it("says it is up to date and checks again hours later", async () => {
    const check = vi.fn(async () => null);
    const { updater } = setup({ backend: { check } });
    updater.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(updater.view()).toEqual({ phase: "latest", mode: "install" });
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - 1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("shows a failed check and retries sooner each time, up to a cap", async () => {
    const check = vi.fn(async () => Promise.reject(new Error("ENOTFOUND")));
    const { updater } = setup({ backend: { check } });
    updater.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(updater.view().phase).toBe("error");
    let waited = 0;
    for (let retry = 0; waited < RETRY_MAX_MS * 3; retry++) {
      const delay = Math.min(RETRY_FIRST_MS * 2 ** retry, RETRY_MAX_MS);
      await vi.advanceTimersByTimeAsync(delay);
      waited += delay;
      expect(check).toHaveBeenCalledTimes(retry + 2);
    }
  });

  it("goes back to the normal interval once the network is back", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null);
    const { updater } = setup({ backend: { check } });
    updater.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS + RETRY_FIRST_MS);
    expect(updater.view().phase).toBe("latest");
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("reports a failed download and keeps nothing to install", async () => {
    const { updater } = setup({
      backend: { download: vi.fn(async () => Promise.reject(new Error("reset"))) },
    });
    await updater.check();
    expect(updater.view()).toEqual({ phase: "error", mode: "install" });
    expect(updater.install()).toBe(false);
  });

  it("checks after waking only when the last check is old", async () => {
    const check = vi.fn(async () => null);
    const { updater } = setup({ backend: { check } });
    await updater.check();
    updater.wake();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(check).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + WAKE_GAP_MS);
    updater.wake();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("only notifies where it cannot install", async () => {
    const { updater, backend } = setup({ mode: "notify" });
    await updater.check();
    expect(updater.view()).toEqual({ phase: "available", mode: "notify", version: "1.2.0" });
    expect(backend.download).not.toHaveBeenCalled();
    expect(updater.install()).toBe(false);
  });

  it("refuses a version that is not plain semver", async () => {
    const { updater, backend } = setup({ backend: { check: vi.fn(async () => ({ version: "<b>1</b>" })) } });
    await updater.check();
    expect(updater.view().phase).toBe("error");
    expect(backend.download).not.toHaveBeenCalled();
  });

  it("never checks in development", async () => {
    const { updater, backend } = setup({ mode: "off" });
    updater.start();
    await updater.check();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(backend.check).not.toHaveBeenCalled();
    expect(updater.view().phase).toBe("off");
  });

  it("checks on request even with background checks switched off", async () => {
    const { updater, backend } = setup({ enabled: false, backend: { check: vi.fn(async () => null) } });
    updater.start();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(backend.check).not.toHaveBeenCalled();
    await updater.check();
    expect(updater.view().phase).toBe("latest");
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(backend.check).toHaveBeenCalledTimes(1);
  });

  it("checks soon after being switched on and stops when switched off", async () => {
    const { backend, setEnabled } = setup({ enabled: false, backend: { check: vi.fn(async () => null) } });
    setEnabled(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(backend.check).toHaveBeenCalledTimes(1);
    setEnabled(false);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(backend.check).toHaveBeenCalledTimes(1);
  });

  it("drops a downloaded update and its install on quit when switched off", async () => {
    const { updater, backend, setEnabled } = setup();
    await updater.check();
    setEnabled(false);
    expect(updater.view()).toEqual({ phase: "idle", mode: "install" });
    expect(backend.installOnQuit).toHaveBeenLastCalledWith(false);
    expect(updater.install()).toBe(false);
  });

  it("drops a download that finishes after the switch went off", async () => {
    let finish!: () => void;
    const download = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { updater, backend, setEnabled } = setup({ backend: { download } });
    const running = updater.check();
    await vi.advanceTimersByTimeAsync(0);
    setEnabled(false);
    finish();
    await running;
    expect(updater.view()).toEqual({ phase: "idle", mode: "install" });
    expect(backend.installOnQuit).toHaveBeenLastCalledWith(false);
  });

  it("runs one check at a time", async () => {
    const { updater, backend } = setup({ backend: { check: vi.fn(async () => null) } });
    await Promise.all([updater.check(), updater.check()]);
    expect(backend.check).toHaveBeenCalledTimes(1);
  });
});

describe("updateMode", () => {
  it("installs with the Windows installer and as an AppImage, notifies elsewhere, and is off in development", () => {
    const base = { packaged: true, appImage: false, installed: false };
    expect(updateMode({ ...base, platform: "win32", installed: true })).toBe("install");
    expect(updateMode({ ...base, platform: "win32" })).toBe("notify");
    expect(updateMode({ ...base, platform: "linux", appImage: true })).toBe("install");
    expect(updateMode({ ...base, platform: "linux" })).toBe("notify");
    expect(updateMode({ ...base, platform: "darwin" })).toBe("notify");
    expect(updateMode({ ...base, platform: "win32", installed: true, packaged: false })).toBe("off");
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

  const noTag = async () => Promise.reject(new Error("no tag"));

  it("turns off every automatic behaviour", () => {
    const updater = fake();
    createBackend(updater, noTag);
    expect([updater.autoDownload, updater.autoInstallOnAppQuit, updater.allowPrerelease, updater.allowDowngrade]).toEqual([false, false, false, false]);
  });

  it("maps check, progress and install", async () => {
    const updater = fake();
    const backend = createBackend(updater, noTag);
    expect(await backend.check()).toEqual({ version: "2.0.0" });
    const seen: number[] = [];
    await backend.download((p) => seen.push(p));
    expect(seen).toEqual([50]);
    expect(updater.listeners).toHaveLength(0);
    backend.installOnQuit(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    backend.quitAndInstall();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("arms the install on quit before the download finishes, and disarms it when the download fails", async () => {
    const updater = fake();
    let armedDuringDownload = false;
    updater.downloadUpdate = async () => {
      armedDuringDownload = updater.autoInstallOnAppQuit;
    };
    const backend = createBackend(updater, noTag);
    await backend.download(() => undefined);
    expect(armedDuringDownload).toBe(true);
    updater.downloadUpdate = async () => Promise.reject(new Error("reset"));
    await expect(backend.download(() => undefined)).rejects.toThrow("reset");
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it("reads the full feed again only when the latest tag moved", async () => {
    const updater = fake();
    const checkForUpdates = vi.fn(async () => ({ isUpdateAvailable: false, updateInfo: { version: "2.0.0" } }));
    updater.checkForUpdates = checkForUpdates;
    let tag = "v2.0.0";
    const backend = createBackend(updater, async () => tag);
    expect(await backend.check()).toBeNull();
    expect(await backend.check()).toBeNull();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    tag = "v2.1.0";
    await backend.check();
    expect(checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("falls back to the full feed when the tag cannot be read", async () => {
    const updater = fake();
    const checkForUpdates = vi.fn(async () => ({ isUpdateAvailable: false, updateInfo: { version: "2.0.0" } }));
    updater.checkForUpdates = checkForUpdates;
    const backend = createBackend(updater, noTag);
    await backend.check();
    await backend.check();
    expect(checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
