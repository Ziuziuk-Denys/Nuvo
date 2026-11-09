import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";

export type CoreStatus = "starting" | "ready" | "restarting" | "failed";

export interface CoreHostOptions {
  binaryPath: string;
  socketPath: string;
  /** the caller must pass the full process.env; it is not merged here */
  env: NodeJS.ProcessEnv;
  onStatus: (status: CoreStatus) => void;
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  checkHealth?: (socketPath: string, token: string) => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface CoreHost {
  /** per-launch bearer token; only main ever sees it */
  readonly token: string;
  start(): Promise<void>;
  whenReady(): Promise<boolean>;
  getStatus(): CoreStatus;
  stop(): Promise<void>;
}

const READY_POLL_MS = 50;
const STARTING_POLL_MS = 500;
// a daemon that never answers is dead after 5 s; one that answers "starting" (keyring prompt) gets 2 min
const READY_TIMEOUT_MS = 5000;
const BOOT_TIMEOUT_MS = 120_000;
const RESTART_DELAYS_MS = [500, 2000, 5000];
const FAILURE_WINDOW_MS = 60_000;
// stop: EOF, SIGTERM at 1.5 s, SIGKILL 1 s later, all inside main's 2.7 s daemon shutdown budget
const STOP_GRACE_MS = 1500;
const KILL_GRACE_MS = 1000;

export function checkCoreHealth(socketPath: string, token: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.request({ socketPath, path: "/health", headers: { authorization: `Bearer ${token}` }, timeout: 1000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const status = (JSON.parse(body) as { status?: unknown }).status;
          resolve(typeof status === "string" ? status : null);
        } catch {
          resolve(null);
        }
      });
      res.on("error", () => resolve(null));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end();
  });
}

export function createCoreHost(options: CoreHostOptions): CoreHost {
  const spawn = options.spawn ?? nodeSpawn;
  const checkHealth = options.checkHealth ?? checkCoreHealth;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const token = randomBytes(32).toString("hex");

  let child: ChildProcess | null = null;
  let stopping = false;
  let running = false;
  // bumped by start() and stop() so stale restart timers and health loops do nothing
  let generation = 0;
  let status: CoreStatus = "starting";
  let crashes: number[] = [];
  let waiters: Array<(ready: boolean) => void> = [];

  const resolveWaiters = (ready: boolean) => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve(ready);
  };

  const setStatus = (next: CoreStatus) => {
    status = next;
    options.onStatus(next);
    if (next === "ready" || next === "failed") resolveWaiters(next === "ready");
  };

  const onCrash = async (gen: number) => {
    if (gen !== generation || stopping) return;
    const t = now();
    crashes = crashes.filter((at) => t - at < FAILURE_WINDOW_MS);
    crashes.push(t);
    if (crashes.length > RESTART_DELAYS_MS.length) {
      console.error("[core] nuvo-core keeps crashing, giving up");
      running = false;
      setStatus("failed");
      return;
    }
    setStatus("restarting");
    await sleep(RESTART_DELAYS_MS[crashes.length - 1]);
    if (gen === generation && !stopping) await launch(gen);
  };

  const launch = async (gen: number) => {
    let proc: ChildProcess;
    try {
      proc = spawn(options.binaryPath, [], {
        env: {
          ...options.env,
          NUVO_CORE_TOKEN: token,
          NUVO_CORE_SOCKET: options.socketPath,
          NUVO_CORE_EXIT_ON_STDIN_EOF: "1",
        },
        // stdin stays open as a lifeline: when Electron dies the pipe closes and the daemon exits
        stdio: ["pipe", "ignore", "inherit"],
        windowsHide: true,
        detached: false,
      });
    } catch (err) {
      console.error("[core] failed to spawn nuvo-core:", err);
      child = null;
      void onCrash(gen);
      return;
    }
    child = proc;
    let exited = false;
    const handleExit = () => {
      if (exited) return;
      exited = true;
      if (child !== proc) return;
      child = null;
      void onCrash(gen);
    };
    proc.once("exit", handleExit);
    proc.on("error", (err) => {
      console.error("[core] nuvo-core error:", err);
      handleExit();
    });

    const startedAt = now();
    let deadline = startedAt + READY_TIMEOUT_MS;
    let alive = false;
    while (now() < deadline) {
      if (exited || child !== proc) return;
      const health = await checkHealth(options.socketPath, token);
      if (health === "ok") {
        if (gen === generation && child === proc) setStatus("ready");
        return;
      }
      if (health !== null && !alive) {
        alive = true;
        deadline = startedAt + BOOT_TIMEOUT_MS;
      }
      // a normal library open takes tens of ms; only a daemon still starting after 5 s (keyring prompt) is polled slowly
      await sleep(alive && now() - startedAt >= READY_TIMEOUT_MS ? STARTING_POLL_MS : READY_POLL_MS);
    }
    if (gen !== generation || child !== proc) return;
    if (alive) {
      // restarting would only bring the same keyring prompt back, so stop supervising instead
      console.error("[core] nuvo-core did not finish starting in 2 minutes, giving up");
      child = null;
      running = false;
      proc.kill("SIGKILL");
      setStatus("failed");
      return;
    }
    console.error("[core] nuvo-core did not answer in time");
    proc.kill("SIGKILL");
  };

  return {
    token,
    async start() {
      if (running) return;
      running = true;
      stopping = false;
      generation += 1;
      setStatus("starting");
      await launch(generation);
    },
    whenReady() {
      if (status === "ready") return Promise.resolve(true);
      if (status === "failed") return Promise.resolve(false);
      return new Promise((resolve) => waiters.push(resolve));
    },
    getStatus: () => status,
    async stop() {
      stopping = true;
      running = false;
      generation += 1;
      resolveWaiters(false);
      const proc = child;
      child = null;
      if (!proc) return;
      let finish: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      proc.once("exit", finish);
      proc.stdin?.end();
      const termTimer = setTimeout(() => {
        proc.kill("SIGTERM");
        killTimer = setTimeout(() => {
          proc.kill("SIGKILL");
          finish();
        }, KILL_GRACE_MS);
      }, STOP_GRACE_MS);
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      await done;
      clearTimeout(termTimer);
      clearTimeout(killTimer);
    },
  };
}
