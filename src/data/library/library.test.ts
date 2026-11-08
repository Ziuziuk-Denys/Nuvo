import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { retryWhileFailed } from "./library";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("retryWhileFailed", () => {
  it("tries again at each delay while the library is still failed, then stops", () => {
    let failed = true;
    const again = vi.fn(() => {
      if (again.mock.calls.length === 2) failed = false;
    });
    retryWhileFailed(() => failed, again, [100, 200, 400]);
    expect(again).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(again).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(again).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(again).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last delay", () => {
    const again = vi.fn();
    retryWhileFailed(() => true, again, [10, 10]);
    vi.advanceTimersByTime(1000);
    expect(again).toHaveBeenCalledTimes(2);
  });

  it("does nothing when nothing failed", () => {
    const again = vi.fn();
    retryWhileFailed(() => false, again, [10]);
    vi.advanceTimersByTime(1000);
    expect(again).not.toHaveBeenCalled();
  });
});
