import { afterEach, describe, expect, it, vi } from "vitest";
import { APPLY_TIMEOUT_MS, countsAsFailedStart, DEFAULT_APPEARANCE, isShiftAtStart, StartWatch, type AppearanceFlags } from "./appearanceSafeMode";

function memory(initial: AppearanceFlags = DEFAULT_APPEARANCE) {
  let flags = { ...initial };
  const writes: AppearanceFlags[] = [];
  return {
    store: { get: () => flags, set: (next: AppearanceFlags) => void writes.push((flags = next)) },
    flags: () => flags,
    writes,
  };
}

describe("appearance safe mode", () => {
  it("Shift in the first two seconds and the tray force safe mode; nothing else is touched", () => {
    expect(isShiftAtStart({ type: "keyDown", key: "Shift" }, 1500)).toBe(true);
    expect(isShiftAtStart({ type: "keyDown", key: "Shift" }, 2500)).toBe(false);
    expect(isShiftAtStart({ type: "keyUp", key: "Shift" }, 100)).toBe(false);
    expect(isShiftAtStart({ type: "keyDown", key: "a" }, 100)).toBe(false);
    const m = memory();
    new StartWatch(m.store).forceSafe();
    expect(m.flags()).toEqual({ safe: true, failedStarts: 0 });
  });

  it("two crashed starts in a row set safe mode; one does not", () => {
    const m = memory();
    const watch = new StartWatch(m.store);
    watch.loadStarted();
    watch.failed();
    watch.failed(); // did-fail-load and render-process-gone of the same load count once
    expect(m.flags()).toEqual({ safe: false, failedStarts: 1 });
    watch.loadStarted();
    watch.failed();
    expect(m.flags()).toEqual({ safe: true, failedStarts: 2 });
  });

  it("a ready start resets the count; a crash after ready does not count", () => {
    const m = memory({ safe: false, failedStarts: 1 });
    const watch = new StartWatch(m.store);
    watch.loadStarted();
    watch.ready();
    expect(m.flags()).toEqual({ safe: false, failedStarts: 0 });
    watch.failed();
    expect(m.flags()).toEqual({ safe: false, failedStarts: 0 });
    watch.loadStarted();
    watch.ready();
    expect(m.writes).toHaveLength(1);
  });

  it("only a real main-frame failure counts: an aborted load (Shift reload, navigation) and sub-frames do not", () => {
    expect(countsAsFailedStart(-3, true)).toBe(false);
    expect(countsAsFailedStart(-105, false)).toBe(false);
    expect(countsAsFailedStart(-105, true)).toBe(true);
    expect(countsAsFailedStart(-6, true)).toBe(true);
  });
});

describe("hang watchdog", () => {
  afterEach(() => vi.useRealTimers());

  it("a renderer that starts applying and never reports ready counts as one failed start", () => {
    vi.useFakeTimers();
    const m = memory();
    const watch = new StartWatch(m.store);
    watch.loadStarted();
    watch.applying();
    vi.advanceTimersByTime(APPLY_TIMEOUT_MS - 1);
    expect(m.flags().failedStarts).toBe(0);
    vi.advanceTimersByTime(1);
    expect(m.flags()).toEqual({ safe: false, failedStarts: 1 });
    watch.ready(); // a late ready of the same load changes nothing
    expect(m.flags().failedStarts).toBe(1);
  });

  it("ready in time, a new load or a crash cancels the watchdog without counting twice", () => {
    vi.useFakeTimers();
    const m = memory({ safe: false, failedStarts: 1 });
    const watch = new StartWatch(m.store);
    watch.loadStarted();
    watch.applying();
    watch.ready();
    vi.advanceTimersByTime(APPLY_TIMEOUT_MS * 2);
    expect(m.flags()).toEqual({ safe: false, failedStarts: 0 });
    watch.loadStarted();
    watch.applying();
    watch.failed();
    vi.advanceTimersByTime(APPLY_TIMEOUT_MS * 2);
    expect(m.flags().failedStarts).toBe(1);
    watch.loadStarted();
    watch.applying();
    watch.loadStarted();
    vi.advanceTimersByTime(APPLY_TIMEOUT_MS * 2);
    expect(m.flags().failedStarts).toBe(1);
  });
});
