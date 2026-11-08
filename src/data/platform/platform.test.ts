import { describe, expect, it, vi, afterEach } from "vitest";
import { applyWindowVisibility, isWindowVisible, onWindowVisibilityChange } from "./visibility";
import { acquireEscapeGuard, isEscapeGuarded } from "./escape";
import { LOG_LIMIT, clearLog, log, recentLog } from "./log";
import { installErrorHandlers } from "./errors";
import { APP_VERSION } from "./version";
import { DEBOUNCE_MS, debouncedStorage } from "./debouncedStorage";

afterEach(() => {
  clearLog();
  applyWindowVisibility(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("window visibility", () => {
  it("follows the shell signal and stops after unsubscribe", () => {
    const seen: boolean[] = [];
    const stop = onWindowVisibilityChange((visible) => seen.push(visible));
    applyWindowVisibility(false);
    expect(isWindowVisible()).toBe(false);
    applyWindowVisibility(true);
    stop();
    applyWindowVisibility(false);
    expect(seen).toEqual([false, true]);
  });
});

describe("escape guard", () => {
  it("holds while any guard is held; a double release counts once", () => {
    const first = acquireEscapeGuard();
    const second = acquireEscapeGuard();
    first();
    first();
    expect(isEscapeGuarded()).toBe(true);
    second();
    expect(isEscapeGuarded()).toBe(false);
  });
});

describe("log", () => {
  it("keeps the last 200 entries, oldest first, and prints errors", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (let i = 0; i < LOG_LIMIT + 5; i += 1) log("info", "test", `entry ${i}`);
    log("error", "boot", "broke");
    const lines = recentLog();
    expect(lines).toHaveLength(LOG_LIMIT);
    expect(lines[0]).toMatch(/ info test entry 6$/);
    expect(lines.at(-1)).toMatch(/ error boot broke$/);
    expect(error).toHaveBeenCalledWith("[boot] broke");
  });

  it("logs window errors and rejections, ignores the ResizeObserver notice, and uninstalls", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const uninstall = installErrorHandlers(window);
    window.dispatchEvent(new ErrorEvent("error", { message: "ResizeObserver loop completed with undelivered notifications." }));
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejection, "reason", { value: new Error("late") });
    window.dispatchEvent(rejection);
    uninstall();
    window.dispatchEvent(new ErrorEvent("error", { message: "after" }));
    expect(recentLog().map((line) => line.split(" ").slice(1).join(" "))).toEqual(["error window boom", "error window late"]);
  });
});

describe("version and storage", () => {
  it("the build version comes from package.json", async () => {
    const pkg = (await import("../../../package.json")).default as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("writes to localStorage once per second with the last value", () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    debouncedStorage.setItem("k", "1");
    debouncedStorage.setItem("k", "2");
    expect(debouncedStorage.getItem("k")).toBe("2");
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("k")).toBe("2");
  });

  it("flush writes pending values at once and cancels the timer", () => {
    vi.useFakeTimers();
    debouncedStorage.setItem("f", "1");
    debouncedStorage.flush();
    expect(localStorage.getItem("f")).toBe("1");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(setItem).not.toHaveBeenCalled();
  });
});
