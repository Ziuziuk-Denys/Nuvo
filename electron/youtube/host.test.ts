// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { WorkerHost, type WorkerWindow } from "./host";
import { startYoutubeService } from "./service";
import { evalInThread } from "./worker/solver";
import { fetchInterpreter, INTERPRETER_MAX_BYTES } from "./script";
import { MinuteLimit, validateJob } from "./validate";
import { WORKER_URL, fromWorkerMainFrame, lockDownWorkerContents, lockDownWorkerSession, workerWindowOptions } from "./window";

/** A fake of the few Electron main APIs the service touches. */
const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const listeners = new Map<string, (...args: any[]) => unknown>();
  const others: Array<{ session: unknown; isCurrentlyAudible(): boolean }> = [];
  let nextId = 100;

  class FakeContents {
    readonly id = nextId++;
    readonly mainFrame = { url: "https://www.youtube.com/robots.txt" };
    readonly events = new Map<string, (...args: any[]) => void>();
    openHandler: (() => unknown) | null = null;
    muted = false;
    sent: Array<{ id: number; op: string; args: unknown }> = [];
    constructor(readonly session: unknown) {}
    on(name: string, listener: (...args: any[]) => void) {
      this.events.set(name, listener);
    }
    setWindowOpenHandler(handler: () => unknown) {
      this.openHandler = handler;
    }
    setAudioMuted(muted: boolean) {
      this.muted = muted;
    }
    send(_channel: string, job: { id: number; op: string; args: unknown }) {
      this.sent.push(job);
    }
    isCurrentlyAudible() {
      return false;
    }
  }

  class BrowserWindow {
    static all: BrowserWindow[] = [];
    readonly webContents: FakeContents;
    destroyed = false;
    loaded = "";
    closed: Array<() => void> = [];
    constructor(readonly options: any) {
      this.webContents = new FakeContents(options.webPreferences.session);
      BrowserWindow.all.push(this);
    }
    loadURL(url: string) {
      this.loaded = url;
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
    on(_name: "closed", listener: () => void) {
      this.closed.push(listener);
    }
  }

  return {
    handlers,
    listeners,
    others,
    BrowserWindow,
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => unknown) => handlers.set(channel, handler),
      on: (channel: string, listener: (...args: any[]) => unknown) => listeners.set(channel, listener),
      removeHandler: (channel: string) => handlers.delete(channel),
      removeAllListeners: (channel: string) => listeners.delete(channel),
    },
    net: { fetch: async () => new Response("interpreter") },
    webContents: {
      getAllWebContents: () => [...BrowserWindow.all.map((window) => window.webContents), ...others],
    },
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electron.BrowserWindow,
  ipcMain: electron.ipcMain,
  net: electron.net,
  webContents: electron.webContents,
}));

class FakeWindow implements WorkerWindow {
  static next = 1;
  readonly contentsId = FakeWindow.next++;
  jobs: Array<{ id: number; op: string; args: unknown }> = [];
  destroyed = false;
  private closed: Array<() => void> = [];
  private failed: Array<(reason: string) => void> = [];
  send(_channel: "nuvo-yt:job", job: { id: number; op: string; args: unknown }) {
    this.jobs.push(job);
  }
  destroy() {
    this.destroyed = true;
  }
  onClosed(listener: () => void) {
    this.closed.push(listener);
  }
  onLoadFailed(listener: (reason: string) => void) {
    this.failed.push(listener);
  }
  close() {
    this.closed.forEach((listener) => listener());
  }
  failLoad() {
    this.failed.forEach((listener) => listener("ERR_FAILED"));
  }
}

let windows: FakeWindow[];
let host: WorkerHost;

beforeEach(() => {
  vi.useFakeTimers();
  windows = [];
  host = new WorkerHost(() => {
    const window = new FakeWindow();
    windows.push(window);
    return window;
  });
});

afterEach(() => vi.useRealTimers());

/** Lets the host send the job, then answers it from the current window. */
async function answer(value: unknown, index = 0) {
  await vi.advanceTimersByTimeAsync(0);
  const window = windows.at(-1)!;
  const job = window.jobs[index];
  host.done(window.contentsId, { id: job.id, value });
}

describe("worker host", () => {
  it("one hidden window starts on demand; the request resolves after the ready signal", async () => {
    const pending = host.request("content-token", {
      identifier: "vidAAAAAAA1",
    });
    expect(windows).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(windows[0].jobs).toHaveLength(0);
    host.hello(windows[0].contentsId);
    await answer("TOKEN");
    await expect(pending).resolves.toBe("TOKEN");
    const partition = { id: "persist:nuvo-yt" } as never;
    const options = workerWindowOptions(partition, "/app/youtube-worker.cjs");
    expect(options.show).toBe(false);
    expect(options.webPreferences).toMatchObject({
      session: partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    expect(WORKER_URL).toBe("https://www.youtube.com/robots.txt");
  });

  it("the ready state is true only while a started window has said hello", async () => {
    await expect(host.request("ready", {})).resolves.toBe(false);
    expect(windows).toHaveLength(0);
    const token = host.request("content-token", { identifier: "vidAAAAAAA1" });
    await expect(host.request("ready", {})).resolves.toBe(false);
    host.hello(windows[0].contentsId);
    await expect(host.request("ready", {})).resolves.toBe(true);
    await answer("T");
    await token;
    await vi.advanceTimersByTimeAsync(180_000);
    await expect(host.request("ready", {})).resolves.toBe(false);
  });

  it("reused within 3 min of the last answer, destroyed after, recreated later", async () => {
    const first = host.request("content-token", { identifier: "a" });
    host.hello(windows[0].contentsId);
    await answer("1");
    await first;
    await vi.advanceTimersByTimeAsync(179_000);
    expect(windows[0].destroyed).toBe(false);
    const second = host.request("content-token", { identifier: "b" });
    await answer("2", 1);
    await second;
    expect(windows).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(179_000);
    expect(windows[0].destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(windows[0].destroyed).toBe(true);
    void host.request("content-token", { identifier: "c" });
    expect(windows).toHaveLength(2);
  });

  it("never closes while a request is in flight", async () => {
    void host.request("player-transform", { playerId: "abcd", n: ["x"] }).catch(() => undefined);
    host.hello(windows[0].contentsId);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(windows[0].destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(windows[0].destroyed).toBe(false);
    // Only the 45 s op timeout (not the idle close) may end it.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(windows[0].destroyed).toBe(true);
  });

  it("no ready signal within 20 s rejects worker-start and destroys the window", async () => {
    const pending = host.request("content-token", { identifier: "a" });
    const check = expect(pending).rejects.toMatchObject({
      code: "worker-start",
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await check;
    expect(windows[0].destroyed).toBe(true);
  });

  it("a load failure rejects waiting requests at once", async () => {
    const pending = host.request("content-token", { identifier: "a" });
    const check = expect(pending).rejects.toMatchObject({
      code: "worker-start",
    });
    windows[0].failLoad();
    await check;
  });

  it("closing the window rejects every pending request", async () => {
    const a = host.request("content-token", { identifier: "a" });
    const b = host.request("tv-identity", {});
    host.hello(windows[0].contentsId);
    await vi.advanceTimersByTimeAsync(0);
    const checks = [expect(a).rejects.toMatchObject({ code: "worker-closed" }), expect(b).rejects.toMatchObject({ code: "worker-closed" })];
    windows[0].close();
    await Promise.all(checks);
  });

  it("answers from another webContents are ignored", async () => {
    let settled = false;
    void host.request("content-token", { identifier: "a" }).then(() => (settled = true));
    host.hello(windows[0].contentsId);
    await vi.advanceTimersByTimeAsync(0);
    host.done(9999, { id: windows[0].jobs[0].id, value: "forged" });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
  });

  it("review focus: a late answer after the timeout is ignored", async () => {
    const pending = host.request("content-token", { identifier: "a" });
    host.hello(windows[0].contentsId);
    const check = expect(pending).rejects.toMatchObject({
      code: "worker-timeout",
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await check;
    const job = windows[0].jobs[0];
    expect(() => host.done(windows[0].contentsId, { id: job.id, value: "late" })).not.toThrow();
    const next = host.request("content-token", { identifier: "b" });
    host.hello(windows[1].contentsId);
    await answer("fresh", 0);
    await expect(next).resolves.toBe("fresh");
  });

  it("a bad identifier is refused before any window starts", async () => {
    await expect(host.request("content-token", { identifier: "x".repeat(1025) })).rejects.toMatchObject({ code: "bad-input" });
    await expect(host.request("content-token", { identifier: "a/b" })).rejects.toMatchObject({ code: "bad-input" });
    expect(windows).toHaveLength(0);
  });

  it("too many values or a short player id is bad-input", async () => {
    await expect(
      host.request("player-transform", {
        playerId: "abcd",
        n: Array.from({ length: 17 }, () => "x"),
      }),
    ).rejects.toMatchObject({ code: "bad-input" });
    // The worker's own limit is 16 per list; main refuses anything more before a window starts.
    expect(
      validateJob("player-transform", {
        playerId: "abcd",
        n: Array.from({ length: 16 }, () => "x"),
        sig: Array.from({ length: 16 }, () => "y"),
      }),
    ).not.toBeNull();
    expect(
      validateJob("player-transform", {
        playerId: "abcd",
        sig: Array.from({ length: 17 }, () => "y"),
      }),
    ).toBeNull();
    await expect(host.request("player-transform", { playerId: "abc", n: [] })).rejects.toMatchObject({ code: "bad-input" });
    expect(
      validateJob("player-transform", {
        playerId: "abcd",
        n: ["a-b_c"],
        sig: ["AOq0QJ8w=="],
      }),
    ).not.toBeNull();
    expect(validateJob("unknown-op", {})).toBeNull();
  });

  it("unanswered requests time out per op", async () => {
    const token = host.request("content-token", { identifier: "a" });
    const identity = host.request("tv-identity", {});
    const transform = host.request("player-transform", { playerId: "abcd" });
    host.hello(windows[0].contentsId);
    const checks = [token, identity, transform].map((p) =>
      p.then(
        () => "ok",
        (e: { code: string }) => e.code,
      ),
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(checks[0]).resolves.toBe("worker-timeout");
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(checks[1]).resolves.toBe("worker-timeout");
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(checks[2]).resolves.toBe("worker-timeout");
  });
});

describe("interpreter download and limits", () => {
  it("only https on the two Google hosts, 2xx only", async () => {
    const fetchFn = vi.fn(async () => new Response("js"));
    await expect(fetchInterpreter("http://www.google.com/x", fetchFn)).rejects.toThrow("bad-input");
    await expect(fetchInterpreter("https://evil.example/x", fetchFn)).rejects.toThrow("bad-input");
    await expect(fetchInterpreter("https://www.gstatic.com/x", fetchFn)).resolves.toBe("js");
    await expect(fetchInterpreter("https://www.google.com/x", async () => new Response("", { status: 404 }))).rejects.toThrow("404");
  });

  it("10.6.3 content tokens are limited to 60 a minute", () => {
    let now = 0;
    const limit = new MinuteLimit(60, () => now);
    for (let i = 0; i < 60; i += 1) expect(limit.take()).toBe(true);
    expect(limit.take()).toBe(false);
    now = 60_001;
    expect(limit.take()).toBe(true);
  });
});

describe("fix round 1: host", () => {
  it("rejects an answer with the wrong shape", async () => {
    const pending = host.request("content-token", { identifier: "a" });
    const check = expect(pending).rejects.toMatchObject({ code: "bad-answer" });
    host.hello(windows[0].contentsId);
    await answer({ not: "a string" });
    await check;
  });

  it("accepts well-formed tv-identity and player-transform answers", async () => {
    const identity = host.request("tv-identity", {});
    host.hello(windows[0].contentsId);
    const value = {
      token: "t",
      livingRoomId: "l",
      visitor: "v",
      version: "1",
      scriptId: "s",
      signatureTimestamp: 20_000,
    };
    await answer(value);
    await expect(identity).resolves.toEqual(value);
    const transform = host.request("player-transform", {
      playerId: "abcd",
      n: ["a"],
      sig: ["b"],
    });
    await answer({ signatureTimestamp: 1, n: ["x"], sig: ["y"] }, 1);
    await expect(transform).resolves.toEqual({
      signatureTimestamp: 1,
      n: ["x"],
      sig: ["y"],
    });
  });

  it("refuses a transform answer whose lists do not match the request", async () => {
    const transform = host.request("player-transform", {
      playerId: "abcd",
      n: ["a"],
    });
    const check = expect(transform).rejects.toMatchObject({
      code: "bad-answer",
    });
    host.hello(windows[0].contentsId);
    await answer({ signatureTimestamp: 1, n: [], sig: [] });
    await check;
  });

  it("refuses a TV identity without a signature timestamp", async () => {
    const identity = host.request("tv-identity", {});
    const check = expect(identity).rejects.toMatchObject({
      code: "bad-answer",
    });
    host.hello(windows[0].contentsId);
    await answer({
      token: "t",
      livingRoomId: "l",
      visitor: "v",
      version: "1",
      scriptId: "s",
    });
    await check;
  });

  it("stays open while keepOpen holds and closes once it stops", async () => {
    let playing = true;
    const kept = new WorkerHost(
      () => {
        const window = new FakeWindow();
        windows.push(window);
        return window;
      },
      undefined,
      undefined,
      () => playing,
    );
    const first = kept.request("content-token", { identifier: "a" });
    kept.hello(windows[0].contentsId);
    await vi.advanceTimersByTimeAsync(0);
    kept.done(windows[0].contentsId, { id: windows[0].jobs[0].id, value: "1" });
    await first;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(windows[0].destroyed).toBe(false);
    playing = false;
    // Closes about 3 minutes after the pause, checked every 15 s.
    await vi.advanceTimersByTimeAsync(165_000);
    expect(windows[0].destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(windows[0].destroyed).toBe(true);
  });

  it("caps error strings from the worker", async () => {
    const pending = host.request("content-token", { identifier: "a" });
    const check = pending.then(
      () => "",
      (e: Error) => e.message,
    );
    host.hello(windows[0].contentsId);
    await vi.advanceTimersByTimeAsync(0);
    host.done(windows[0].contentsId, {
      id: windows[0].jobs[0].id,
      error: "x".repeat(5000),
    });
    expect((await check).length).toBeLessThanOrEqual(500);
  });

  it("refuses new requests when too many are pending", async () => {
    const held: Promise<unknown>[] = [];
    for (let i = 0; i < 64; i += 1) held.push(host.request("tv-identity", {}).catch(() => undefined));
    await expect(host.request("tv-identity", {})).rejects.toMatchObject({
      code: "worker-busy",
    });
    host.dispose();
    await Promise.all(held);
  });

  it("limits content tokens to 60 a minute", async () => {
    const results: unknown[] = [];
    for (let i = 0; i < 61; i += 1) results.push(host.request("content-token", { identifier: "a" }).catch((e) => e));
    await vi.advanceTimersByTimeAsync(0);
    host.hello(windows[0].contentsId);
    await vi.advanceTimersByTimeAsync(0);
    host.dispose();
    const settled = await Promise.all(results);
    expect(settled.filter((e) => (e as { code?: string }).code === "worker-busy")).toHaveLength(1);
  });

  it("an op timeout tears the worker down, fails the others and restarts later", async () => {
    const a = host.request("content-token", { identifier: "a" });
    const b = host.request("player-transform", { playerId: "abcd" });
    host.hello(windows[0].contentsId);
    const checks = [expect(a).rejects.toMatchObject({ code: "worker-timeout" }), expect(b).rejects.toMatchObject({ code: "worker-timeout" })];
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.all(checks);
    expect(windows[0].destroyed).toBe(true);
    void host.request("content-token", { identifier: "c" });
    expect(windows).toHaveLength(2);
  });

  it("a load failure after the ready signal does not tear down", async () => {
    void host.request("content-token", { identifier: "a" });
    host.hello(windows[0].contentsId);
    windows[0].failLoad();
    expect(windows[0].destroyed).toBe(false);
  });
});

describe("fix round 1: window lockdown", () => {
  it("denies navigation, window.open and every permission", () => {
    const handlers = new Map<string, (event: { preventDefault(): void }) => void>();
    let openHandler: (() => { action: string }) | null = null;
    lockDownWorkerContents({
      on: (name: string, handler: never) => handlers.set(name, handler),
      setWindowOpenHandler: (handler: never) => (openHandler = handler),
    });
    for (const name of ["will-navigate", "will-redirect", "will-frame-navigate"]) {
      const event = { preventDefault: vi.fn() };
      handlers.get(name)!(event);
      expect(event.preventDefault).toHaveBeenCalled();
    }
    expect(openHandler!()).toEqual({ action: "deny" });

    let request: (...args: unknown[]) => void = () => undefined;
    let check: () => boolean = () => true;
    let device: () => boolean = () => true;
    let download: (event: { preventDefault(): void }) => void = () => undefined;
    lockDownWorkerSession({
      setPermissionRequestHandler: (h: never) => (request = h),
      setPermissionCheckHandler: (h: never) => (check = h),
      setDevicePermissionHandler: (h: never) => (device = h),
      on: (_name: "will-download", h: never) => (download = h),
    });
    const downloadEvent = { preventDefault: vi.fn() };
    download(downloadEvent);
    expect(downloadEvent.preventDefault).toHaveBeenCalled();
    const callback = vi.fn();
    request(null, "media", callback);
    expect(callback).toHaveBeenCalledWith(false);
    expect(check()).toBe(false);
    expect(device()).toBe(false);
  });

  it("accepts messages only from the worker's own main frame", () => {
    const mainFrame = {};
    const event = (id: number, frame: unknown) => ({
      sender: { id, mainFrame },
      senderFrame: frame,
    });
    expect(fromWorkerMainFrame(event(5, mainFrame), 5)).toBe(true);
    expect(fromWorkerMainFrame(event(6, mainFrame), 5)).toBe(false);
    expect(fromWorkerMainFrame(event(5, {}), 5)).toBe(false);
    expect(fromWorkerMainFrame(event(5, null), 5)).toBe(false);
  });
});

describe("fix round 1: interpreter download", () => {
  const redirect = (location: string) => new Response("", { status: 302, headers: { location } });

  it("fetches with manual redirects and re-checks every hop", async () => {
    const fetchFn = vi.fn(async (url: string) => (url === "https://www.google.com/a" ? redirect("https://www.gstatic.com/b") : new Response("ok")));
    await expect(fetchInterpreter("https://www.google.com/a", fetchFn)).resolves.toBe("ok");
    expect((fetchFn.mock.calls[0] as unknown[])[1]).toMatchObject({
      redirect: "manual",
    });
    await expect(fetchInterpreter("https://www.google.com/a", async () => redirect("https://evil.example/x"))).rejects.toThrow("bad-input");
    await expect(fetchInterpreter("https://www.google.com/a", async () => redirect("http://www.google.com/x"))).rejects.toThrow("bad-input");
    await expect(fetchInterpreter("https://www.google.com/a", async () => redirect("/loop"))).rejects.toThrow("redirect");
  });

  it("stops reading at the size cap", async () => {
    const big = "x".repeat(INTERPRETER_MAX_BYTES + 1);
    await expect(
      fetchInterpreter(
        "https://www.google.com/a",
        async () =>
          new Response(big, {
            headers: { "content-length": String(big.length) },
          }),
      ),
    ).rejects.toThrow("too large");
    const streamed = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1_000_000));
        },
      }),
    );
    await expect(fetchInterpreter("https://www.google.com/a", async () => streamed)).rejects.toThrow("too large");
  });
});

describe("service: what main starts", () => {
  const partition = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    on: vi.fn(),
  };
  // The service lives next to this test; main loads the app from ../dist/index.html beside the bundle.
  const indexUrl = pathToFileURL(path.join(import.meta.dirname, "../dist/index.html")).href;
  const appFrame = { url: `${indexUrl}#/library` };
  const app = {
    sender: { id: 1, mainFrame: appFrame, session: {} },
    senderFrame: appFrame,
  };
  let service: { dispose(): void };

  beforeEach(() => {
    electron.BrowserWindow.all = [];
    electron.others.length = 0;
    service = startYoutubeService({
      partition: partition as never,
      log: () => undefined,
    });
  });
  afterEach(() => service.dispose());

  const call = (event: unknown, op: string, args: unknown) =>
    electron.handlers.get("nuvo-yt:call")!(event, {
      op,
      args,
    }) as Promise<unknown>;
  const worker = () => electron.BrowserWindow.all.at(-1)!;
  const fromWorker = (frame?: unknown) => {
    const contents = worker().webContents;
    return {
      sender: contents,
      senderFrame: frame === undefined ? contents.mainFrame : frame,
    };
  };
  const hello = () => electron.listeners.get("nuvo-yt:hello")!(fromWorker());
  const reply = (value: unknown, index = 0) =>
    electron.listeners.get("nuvo-yt:done")!(fromWorker(), {
      id: worker().webContents.sent[index].id,
      value,
    });

  it("builds a sandboxed, muted, locked-down worker on a locked-down partition", async () => {
    expect(partition.setPermissionRequestHandler).toHaveBeenCalled();
    expect(partition.setPermissionCheckHandler).toHaveBeenCalled();
    expect(partition.setDevicePermissionHandler).toHaveBeenCalled();
    expect(partition.on).toHaveBeenCalledWith("will-download", expect.any(Function));
    void call(app, "content-token", { identifier: "a" }).catch(() => undefined);
    const window = worker();
    expect(window.options.webPreferences).toMatchObject({
      session: partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    expect(window.options.webPreferences.preload).toMatch(/youtube-worker\.cjs$/);
    expect(window.loaded).toBe("https://www.youtube.com/robots.txt");
    expect(window.webContents.muted).toBe(true);
    expect(window.webContents.openHandler!()).toEqual({ action: "deny" });
    for (const name of ["will-navigate", "will-redirect", "will-frame-navigate"]) {
      const event = { preventDefault: vi.fn() };
      window.webContents.events.get(name)!(event);
      expect(event.preventDefault).toHaveBeenCalled();
    }
  });

  it("serves the app's main frame through the worker's main frame only", async () => {
    const token = call(app, "content-token", { identifier: "a" });
    // A subframe of the worker cannot signal ready or answer.
    electron.listeners.get("nuvo-yt:hello")!(fromWorker({}));
    await vi.advanceTimersByTimeAsync(0);
    expect(worker().webContents.sent).toHaveLength(0);
    hello();
    await vi.advanceTimersByTimeAsync(0);
    electron.listeners.get("nuvo-yt:done")!(fromWorker({}), {
      id: worker().webContents.sent[0].id,
      value: "forged",
    });
    reply("token");
    await expect(token).resolves.toBe("token");
  });

  it("refuses callers that are not the app's own main frame", async () => {
    const otherPage = { url: "file:///tmp/other.html" };
    void call(app, "content-token", { identifier: "a" }).catch(() => undefined);
    const refused = [
      fromWorker(),
      { sender: { id: 2, mainFrame: {}, session: partition }, senderFrame: {} },
      { ...app, senderFrame: { url: "file:///x" } },
      {
        sender: { id: 4, mainFrame: otherPage },
        senderFrame: otherPage,
      },
      {
        sender: { id: 3, mainFrame: { url: "https://evil.example/" } },
        senderFrame: { url: "https://evil.example/" },
      },
    ];
    for (const event of refused) {
      (event.sender as { mainFrame: unknown }).mainFrame ??= event.senderFrame;
      await expect(call(event, "content-token", { identifier: "a" })).rejects.toThrow("bad-input");
    }
  });

  it("downloads the interpreter only for the worker's main frame", async () => {
    void call(app, "content-token", { identifier: "a" }).catch(() => undefined);
    const script = electron.handlers.get("nuvo-yt:script")!;
    const url = "https://www.google.com/js/bg/x.js";
    await expect(script(fromWorker(), url)).resolves.toBe("interpreter");
    await expect(script(fromWorker({}), url)).rejects.toThrow("bad-input");
    await expect(script(app, url)).rejects.toThrow("bad-input");
  });

  it("a hung worker cannot hang anything: the op timeout destroys it and the next call starts afresh", async () => {
    const transform = call(app, "player-transform", {
      playerId: "abcd",
      n: ["x"],
    });
    const check = expect(transform).rejects.toThrow("worker-timeout");
    hello();
    // The worker never answers, as when its solver spins in a synchronous loop.
    await vi.advanceTimersByTimeAsync(45_000);
    await check;
    expect(worker().destroyed).toBe(true);
    // The next call starts a fresh worker.
    void call(app, "content-token", { identifier: "b" }).catch(() => undefined);
    expect(electron.BrowserWindow.all).toHaveLength(2);
  });

  it("stays open while the app plays audio and closes once it stops", async () => {
    let audible = true;
    electron.others.push({ session: {}, isCurrentlyAudible: () => audible });
    const token = call(app, "content-token", { identifier: "a" });
    hello();
    await vi.advanceTimersByTimeAsync(0);
    reply("token");
    await token;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(worker().destroyed).toBe(false);
    audible = false;
    await vi.advanceTimersByTimeAsync(165_000);
    expect(worker().destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(worker().destroyed).toBe(true);
  });

  it("dispose removes every channel and destroys the worker", () => {
    void call(app, "content-token", { identifier: "a" }).catch(() => undefined);
    service.dispose();
    expect(worker().destroyed).toBe(true);
    for (const channel of ["nuvo-yt:call", "nuvo-yt:script"]) expect(electron.handlers.has(channel)).toBe(false);
    for (const channel of ["nuvo-yt:hello", "nuvo-yt:done"]) expect(electron.listeners.has(channel)).toBe(false);
  });
});

describe("solver thread: hard per-call limit", () => {
  class FakeThread {
    static last: FakeThread;
    terminated = false;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message: string }) => void) | null = null;
    posted: unknown[] = [];
    constructor(readonly url: string) {
      FakeThread.last = this;
    }
    postMessage(data: unknown) {
      this.posted.push(data);
    }
    terminate() {
      this.terminated = true;
    }
  }

  beforeEach(() => vi.stubGlobal("Worker", FakeThread));
  afterEach(() => vi.unstubAllGlobals());

  it("terminates a script that never answers, as a synchronous loop would", async () => {
    const result = evalInThread("for (;;) {}", 5000);
    const check = expect(result).rejects.toThrow("timed out");
    expect(FakeThread.last.posted).toEqual(["for (;;) {}"]);
    await vi.advanceTimersByTimeAsync(5000);
    await check;
    expect(FakeThread.last.terminated).toBe(true);
  });

  it("returns the script's answer and ends the thread", async () => {
    const result = evalInThread("return { n: 'x' }");
    FakeThread.last.onmessage!({ data: { ok: true, value: { n: "x" } } });
    await expect(result).resolves.toEqual({ n: "x" });
    expect(FakeThread.last.terminated).toBe(true);
    const failed = evalInThread("throw 1");
    FakeThread.last.onmessage!({ data: { ok: false, message: "1" } });
    await expect(failed).rejects.toThrow("1");
  });
});

describe("fix round 1: solver thread", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("revokes the blob URL when the thread cannot start", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("worker-src refused");
        }
      },
    );
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await expect(evalInThread("return {}")).rejects.toThrow("worker-src refused");
    expect(revoke).toHaveBeenCalledTimes(1);
    revoke.mockRestore();
  });
});

describe("fix round 1: sandboxed preload", () => {
  it("worker modules import no Node built-ins (a sandboxed preload has none)", () => {
    const dir = path.join(import.meta.dirname, "worker");
    const sources = readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(sources).toContain("transform.ts");
    for (const name of sources) expect(readFileSync(path.join(dir, name), "utf8"), name).not.toMatch(/from "node:|require\("node:/);
  });
});
