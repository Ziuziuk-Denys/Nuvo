// @vitest-environment node
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { checkCoreHealth, createCoreHost, type CoreHostOptions, type CoreStatus } from "./core-host";

class FakeChild extends EventEmitter {
  stdin = { end: vi.fn(() => queueMicrotask(() => this.emit("exit", 0, null))) };
  kill = vi.fn((signal: string) => queueMicrotask(() => this.emit("exit", null, signal)));
}

// true = "ok", false = no answer, a string = that /health status
function setup(health: (attempt: number) => boolean | string, overrides: Partial<Pick<CoreHostOptions, "spawn" | "checkHealth" | "sleep">> = {}) {
  const children: FakeChild[] = [];
  const statuses: CoreStatus[] = [];
  let clock = 0;
  let healthCalls = 0;
  const spawn = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child as unknown as ChildProcess;
  });
  const sleeps: number[] = [];
  const host = createCoreHost({
    binaryPath: "/bin/nuvo-core",
    socketPath: "/run/nuvo/core.sock",
    env: { HOME: "/home/u" },
    onStatus: (s) => statuses.push(s),
    spawn,
    checkHealth: async () => {
      const answer = health(healthCalls++);
      return answer === true ? "ok" : answer === false ? null : answer;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    ...overrides,
  });
  return { host, spawn, children, statuses, sleeps, advance: (ms: number) => (clock += ms) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("core host", () => {
  it("passes token and socket to the daemon and becomes ready", async () => {
    const { host, spawn, statuses } = setup((n) => n >= 2);
    await host.start();
    expect(statuses).toEqual(["starting", "ready"]);
    const [, , options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string>; stdio: string[]; windowsHide: boolean; detached: boolean },
    ];
    expect(options.windowsHide).toBe(true);
    expect(options.detached).toBe(false);
    expect(options.env.NUVO_CORE_TOKEN).toBe(host.token);
    expect(host.token).toMatch(/^[0-9a-f]{64}$/);
    expect(options.env.NUVO_CORE_SOCKET).toBe("/run/nuvo/core.sock");
    expect(options.env.NUVO_CORE_EXIT_ON_STDIN_EOF).toBe("1");
    expect(options.env.HOME).toBe("/home/u");
    expect(options.stdio[0]).toBe("pipe");
    await expect(host.whenReady()).resolves.toBe(true);
  });

  it("restarts after a crash with backoff", async () => {
    const { host, spawn, children, statuses } = setup(() => true);
    await host.start();
    children[0].emit("exit", 1, null);
    await flush();
    expect(statuses).toEqual(["starting", "ready", "restarting", "ready"]);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("gives up after a fourth crash within a minute", async () => {
    const { host, children, statuses } = setup(() => true);
    await host.start();
    for (let i = 0; i < 4; i++) {
      children[i].emit("exit", 1, null);
      await flush();
    }
    expect(statuses.at(-1)).toBe("failed");
    expect(children).toHaveLength(4);
    await expect(host.whenReady()).resolves.toBe(false);
  });

  it("forgets crashes older than a minute", async () => {
    const { host, children, statuses, advance } = setup(() => true);
    await host.start();
    for (let i = 0; i < 4; i++) {
      advance(61_000);
      children[i].emit("exit", 1, null);
      await flush();
    }
    expect(statuses).not.toContain("failed");
  });

  it("kills a daemon that never answers and counts it as a crash", async () => {
    const { host, children, statuses } = setup(() => false);
    await host.start();
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
    await flush();
    expect(statuses).toContain("restarting");
  });

  it("waits up to 2 minutes for a daemon that answers starting, then becomes ready", async () => {
    const { host, children, statuses, sleeps } = setup((n) => (n < 200 ? "starting" : true));
    await host.start();
    expect(statuses).toEqual(["starting", "ready"]);
    expect(children[0].kill).not.toHaveBeenCalled();
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThan(5000);
    expect(sleeps.at(-1)).toBe(500);
  });

  it("keeps the 50 ms poll while a starting daemon opens the library in its first 5 s", async () => {
    const { host, statuses, sleeps } = setup((n) => (n < 1 ? false : n < 3 ? "starting" : true));
    await host.start();
    expect(statuses).toEqual(["starting", "ready"]);
    expect(sleeps).toEqual([50, 50, 50]);
  });

  it("kills a daemon still starting after 2 minutes and declares failure without restarting", async () => {
    const { host, children, statuses, sleeps } = setup(() => "starting");
    await host.start();
    await flush();
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
    const waited = sleeps.reduce((a, b) => a + b, 0);
    expect(waited).toBeGreaterThanOrEqual(120_000);
    expect(waited).toBeLessThan(121_000);
    expect(statuses).toEqual(["starting", "failed"]);
    expect(children).toHaveLength(1);
    await expect(host.whenReady()).resolves.toBe(false);
  });

  it("still gives up after 5 s on a daemon that never answers", async () => {
    const { host, children, sleeps } = setup(() => false);
    await host.start();
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
    // 50 ms polls for 5 s; the 500 ms after them is the restart delay
    expect(sleeps.filter((ms) => ms === 50)).toHaveLength(100);
  });

  it("stop closes stdin and does not restart", async () => {
    const { host, spawn, children } = setup(() => true);
    await host.start();
    await host.stop();
    expect(children[0].stdin.end).toHaveBeenCalled();
    await flush();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("treats a spawn error as a crash", async () => {
    const { host, children, statuses } = setup(() => false);
    const started = host.start();
    children[0].emit("error", new Error("ENOENT"));
    await started;
    await flush();
    expect(statuses).toContain("restarting");
  });

  it("stop during starting resolves whenReady with false", async () => {
    const { host } = setup(() => false, { checkHealth: () => new Promise<string | null>(() => {}) });
    const ready = host.whenReady();
    void host.start();
    await host.stop();
    await expect(ready).resolves.toBe(false);
  });

  it("survives a second error event", async () => {
    const { host, children } = setup(() => true);
    await host.start();
    children[0].emit("error", new Error("first"));
    expect(() => children[0].emit("error", new Error("second"))).not.toThrow();
    await flush();
  });

  it("treats a throwing spawn as a crash and eventually fails", async () => {
    const throwing = vi.fn(() => {
      throw new Error("EACCES");
    });
    const { host, statuses } = setup(() => true, { spawn: throwing });
    await host.start();
    await flush();
    expect(statuses).toContain("restarting");
    expect(statuses.at(-1)).toBe("failed");
    expect(throwing).toHaveBeenCalledTimes(4);
  });

  it("escalates to SIGKILL when the daemon ignores SIGTERM", async () => {
    vi.useFakeTimers();
    try {
      const { host, children } = setup(() => true);
      await host.start();
      children[0].stdin.end = vi.fn();
      children[0].kill = vi.fn();
      const stopped = host.stop();
      await vi.advanceTimersByTimeAsync(1499);
      expect(children[0].kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(children[0].kill).toHaveBeenCalledWith("SIGTERM");
      expect(children[0].kill).not.toHaveBeenCalledWith("SIGKILL");
      await vi.advanceTimersByTimeAsync(1000);
      expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
      await stopped;
    } finally {
      vi.useRealTimers();
    }
  });

  it("a restart timer pending before stop cannot launch after a later start", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, spawn, children } = setup(() => true, { sleep: () => gate });
    await host.start();
    children[0].emit("exit", 1, null);
    await flush();
    await host.stop();
    await host.start();
    release();
    await flush();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("start is a no-op while running", async () => {
    const { host, spawn } = setup(() => true);
    await host.start();
    await host.start();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("uses 500, 2000 and 5000 ms restart delays", async () => {
    const { host, children, sleeps } = setup(() => true);
    await host.start();
    for (let i = 0; i < 3; i++) {
      children[i].emit("exit", 1, null);
      await flush();
    }
    expect(sleeps).toEqual([500, 2000, 5000]);
  });

  it("gives each host its own token", () => {
    expect(setup(() => true).host.token).not.toBe(setup(() => true).host.token);
  });
});

describe("checkCoreHealth", () => {
  it("returns the status field, or null without a usable answer", async () => {
    const dir = fs.mkdtempSync(path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), "nuvo-health-"));
    const socketPath = path.join(dir, "core.sock");
    let reply = { code: 200, body: '{"status":"starting","locked":false}' };
    const server = http.createServer((req, res) => {
      res.writeHead(req.headers.authorization === "Bearer t" ? reply.code : 401);
      res.end(reply.body);
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      await expect(checkCoreHealth(socketPath, "t")).resolves.toBe("starting");
      reply = { code: 200, body: '{"status":"ok","locked":true}' };
      await expect(checkCoreHealth(socketPath, "t")).resolves.toBe("ok");
      await expect(checkCoreHealth(socketPath, "wrong")).resolves.toBeNull();
      reply = { code: 200, body: "not json" };
      await expect(checkCoreHealth(socketPath, "t")).resolves.toBeNull();
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
    await expect(checkCoreHealth(socketPath, "t")).resolves.toBeNull();
  });
});
