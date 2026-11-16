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
  it("defaults to automatic mode", async () => {
    expect((await freshStore()).mode).toBe("auto");
  });

  it("keeps the automatic mode from older settings", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { mode: "auto", expandOn: "click", showLyrics: false, pulseOnTrackChange: true, display: "primary" }, version: 0 }),
    );
    const settings = await freshStore();
    expect(settings).toMatchObject({ mode: "auto", expandOn: "click", showLyrics: false, display: "primary" });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ version: 2, state: { mode: "auto" } });
  });

  it("restores Auto for settings disabled by the previous default migration", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { mode: "off", expandOn: "hover", showLyrics: true, pulseOnTrackChange: true, display: "follow" }, version: 1 }),
    );
    const settings = await freshStore();
    expect(settings.mode).toBe("auto");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ version: 2, state: { mode: "auto" } });
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
    expect(migrateNotchSettings(undefined, 0)).toEqual({});
    expect(migrateNotchSettings({ mode: "auto" }, 0)).toEqual({ mode: "auto" });
    expect(migrateNotchSettings({ mode: "off" }, 1)).toEqual({ mode: "auto" });
    expect(migrateNotchSettings({ mode: "off" }, 2)).toEqual({ mode: "off" });
  });
});
