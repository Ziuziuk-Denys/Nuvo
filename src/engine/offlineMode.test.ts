// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOfflineMode, offlineMode } from "./offlineMode";
import { skipText } from "./stateLine";
import { MemoryStorage } from "./test/harness";

describe("offline mode", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("starts off, keeps its value across restarts and tells listeners", () => {
    const mode = createOfflineMode(storage);
    const heard = vi.fn();
    mode.subscribe(heard);
    expect(mode.isOn()).toBe(false);
    mode.set(true);
    expect(mode.isOn()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    mode.set(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(createOfflineMode(storage).isOn()).toBe(true);
    mode.set(false);
    expect(createOfflineMode(storage).isOn()).toBe(false);
  });

  it("names offline mode, not the network, when it stopped a track", () => {
    expect(skipText("Song", "offline")).toBe("Song skipped. You are offline.");
    offlineMode.set(true);
    expect(skipText("Song", "offline")).toBe("Song skipped. Offline mode is on.");
    offlineMode.set(false);
  });
});
