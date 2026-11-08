import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { PREFS_KEY, loadPrefs } from "./persist";
import { createHarness, MemoryStorage } from "./test/harness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("quality and transition prefs", () => {
  it("defaults to normal quality", () => {
    expect(loadPrefs(new MemoryStorage()).bestQuality).toBe(false);
  });

  it("repairs a wrong type to the default", () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFS_KEY, JSON.stringify({ bestQuality: "yes" }));
    expect(loadPrefs(storage).bestQuality).toBe(false);
  });

  it("best quality survives a restart and shows in the view", () => {
    const storage = new MemoryStorage();
    createHarness({ storage }).engine.setBestQuality(true);
    const again = createHarness({ storage });
    expect(again.engine.getView().bestQuality).toBe(true);
  });

  it("crossfade is clamped to 0-12 whole seconds and persisted", () => {
    const storage = new MemoryStorage();
    const h = createHarness({ storage });
    h.engine.setCrossfade(30);
    expect(h.engine.crossfadeSeconds).toBe(12);
    h.engine.setCrossfade(4.4);
    expect(createHarness({ storage }).engine.crossfadeSeconds).toBe(4);
    storage.setItem(PREFS_KEY, JSON.stringify({ crossfadeSeconds: -3 }));
    expect(loadPrefs(storage).crossfadeSeconds).toBe(0);
  });
});
