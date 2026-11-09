import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateNotchSettings } from "./notchSettingsStore";

const KEY = "nuvo_notch_settings_v1";

async function freshStore() {
  vi.resetModules();
  const { useNotchSettingsStore } = await import("./notchSettingsStore");
  return useNotchSettingsStore.getState();
}

afterEach(() => localStorage.clear());

describe("Notch settings", () => {
  it("are off on a fresh install", async () => {
    expect((await freshStore()).mode).toBe("off");
  });

  it("turn the old automatic default off and keep the rest", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { mode: "auto", expandOn: "click", showLyrics: false, pulseOnTrackChange: true, display: "primary" }, version: 0 }),
    );
    const settings = await freshStore();
    expect(settings).toMatchObject({ mode: "off", expandOn: "click", showLyrics: false, display: "primary" });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ version: 1, state: { mode: "off" } });
  });

  it("keep a Notch the user switched on", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { mode: "on", expandOn: "hover", showLyrics: true, pulseOnTrackChange: true, display: "follow" }, version: 0 }),
    );
    expect((await freshStore()).mode).toBe("on");
  });

  it("keep automatic once it was chosen after the update", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { mode: "auto", expandOn: "hover", showLyrics: true, pulseOnTrackChange: true, display: "follow" }, version: 1 }),
    );
    expect((await freshStore()).mode).toBe("auto");
  });

  it("migrate only the mode", () => {
    expect(migrateNotchSettings({ mode: "off" }, 0)).toEqual({ mode: "off" });
    expect(migrateNotchSettings(undefined, 0)).toEqual({});
    expect(migrateNotchSettings({ mode: "auto" }, 1)).toEqual({ mode: "auto" });
  });
});
