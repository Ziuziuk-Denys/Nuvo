// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  LEGACY_LOOK_KEY,
  LOOK_DEFAULTS,
  LOOK_KEY,
  LOOK_VERSION,
  MAX_WALLPAPER_BLUR,
  MAX_WALLPAPER_DIM,
  MIN_WALLPAPER_BLUR,
  RETIRED_PRESETS,
  migrateLegacyLook,
  migratePresetId,
} from "./lookStore";
import { PRESET_IDS } from "./presets";

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("look store migration", () => {
  it("keeps every old field and ignores the panel blocks", () => {
    const old = JSON.stringify({
      state: {
        preset: "frost",
        coverGlow: false,
        accentFromCover: true,
        backgroundImage: "data:image/png;base64,AA",
        backgroundDim: 50,
        backgroundBlur: 20,
        themeBeforePreset: "light",
        sidebar: { opacity: 50, blur: 10, dim: 8 },
      },
      version: 0,
    });
    expect(migrateLegacyLook(old)).toEqual({
      preset: "frost",
      coverGlow: false,
      accentFromCover: true,
      backgroundImage: "data:image/png;base64,AA",
      backgroundDim: 50,
      backgroundBlur: 20,
      backgroundFit: "cover",
      themeBeforePreset: "light",
    });
  });

  it("an invalid field falls back alone, out-of-range numbers are clamped", () => {
    const old = JSON.stringify({ state: { preset: "nope", backgroundDim: 250, backgroundBlur: -4, coverGlow: false, backgroundImage: "javascript:1" } });
    expect(migrateLegacyLook(old)).toEqual({ ...LOOK_DEFAULTS, coverGlow: false, backgroundDim: MAX_WALLPAPER_DIM, backgroundBlur: MIN_WALLPAPER_BLUR });
    expect(migrateLegacyLook(JSON.stringify({ state: { backgroundBlur: 99 } })).backgroundBlur).toBe(MAX_WALLPAPER_BLUR);
  });

  it("a broken old blob keeps defaults without throwing", () => {
    expect(migrateLegacyLook("{not json")).toEqual(LOOK_DEFAULTS);
    expect(migrateLegacyLook(null)).toEqual(LOOK_DEFAULTS);
  });
});

describe("retired presets", () => {
  it("every old id lands on a current preset, current ids stay, anything else is dropped", () => {
    expect(RETIRED_PRESETS).toEqual({
      editor: "ink",
      orbit: "frost",
      vinyl: "amber",
      cosmos: "velvet",
      sunset: "dusk",
      amethyst: "velvet",
      y2k: "blossom",
      cassette: "amber",
      marshmallow: "blossom",
      indigo: "nuvo",
    });
    for (const id of Object.values(RETIRED_PRESETS)) expect(PRESET_IDS).toContain(id);
    for (const id of PRESET_IDS) expect(migratePresetId(id)).toBe(id);
    expect(migratePresetId("vinyl")).toBe("amber");
    expect(migratePresetId("marshmallow")).toBe("blossom");
    expect(migratePresetId("toString")).toBeNull();
    expect(migratePresetId(7)).toBeNull();
  });

  it("an old blob with a retired preset is read into its new one", () => {
    expect(migrateLegacyLook(JSON.stringify({ state: { preset: "cassette" } })).preset).toBe("amber");
  });

  it("a stored version 1 look moves to the new preset and keeps the rest", async () => {
    localStorage.setItem(LOOK_KEY, JSON.stringify({ state: { ...LOOK_DEFAULTS, preset: "sunset", backgroundDim: 30 }, version: 1 }));
    const { useLookStore } = await import("./lookStore");
    expect(useLookStore.getState()).toMatchObject({ preset: "dusk", backgroundDim: 30 });
  });

  it("a current version look with a preset retired since is read into its new one", async () => {
    localStorage.setItem(LOOK_KEY, JSON.stringify({ state: { ...LOOK_DEFAULTS, preset: "marshmallow", backgroundDim: 20 }, version: 2 }));
    const { useLookStore } = await import("./lookStore");
    expect(useLookStore.getState()).toMatchObject({ preset: "blossom", backgroundDim: 20 });
  });
});

describe("look store", () => {
  it("on first start the old key is read once into the new one and removed", async () => {
    localStorage.setItem(LEGACY_LOOK_KEY, JSON.stringify({ state: { preset: "amber", backgroundBlur: 22 }, version: 0 }));
    const { useLookStore } = await import("./lookStore");
    expect(useLookStore.getState()).toMatchObject({ preset: "amber", backgroundBlur: 22 });
    expect(localStorage.getItem(LEGACY_LOOK_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(LOOK_KEY)!).state.preset).toBe("amber");
  });

  it("an existing new key wins over a leftover old one", async () => {
    localStorage.setItem(LOOK_KEY, JSON.stringify({ state: { ...LOOK_DEFAULTS, preset: "velvet" }, version: 2 }));
    localStorage.setItem(LEGACY_LOOK_KEY, JSON.stringify({ state: { preset: "amber" } }));
    const { useLookStore } = await import("./lookStore");
    expect(useLookStore.getState().preset).toBe("velvet");
  });

  it("setters clamp, and reset removes the wallpaper and its sliders but keeps the look", async () => {
    const { useLookStore } = await import("./lookStore");
    const store = useLookStore.getState();
    store.setPreset("ink");
    store.setCoverGlow(false);
    store.setAccentFromCover(true);
    store.setBackgroundImage("data:image/png;base64,AA");
    store.setBackgroundBlur(-4);
    store.setBackgroundFit("contain");
    store.setBackgroundDim(250);
    expect(useLookStore.getState()).toMatchObject({ backgroundBlur: MIN_WALLPAPER_BLUR, backgroundDim: MAX_WALLPAPER_DIM });
    useLookStore.getState().resetAll();
    expect(useLookStore.getState()).toMatchObject({
      preset: "ink",
      coverGlow: false,
      accentFromCover: true,
      backgroundImage: null,
      backgroundBlur: LOOK_DEFAULTS.backgroundBlur,
      backgroundDim: LOOK_DEFAULTS.backgroundDim,
      backgroundFit: "cover",
    });
  });

  it("keeps a stored copy or an old inline picture and drops anything else on load", async () => {
    const saved = (backgroundImage: string) => JSON.stringify({ state: { backgroundImage, backgroundFit: "stretch" }, version: LOOK_VERSION });
    const copy = "nuvo-core://local/wallpaper/0b7c63c8-1d0a-4c3e-9f55-2a8e7d1b4c11.webm";
    for (const [stored, kept] of [
      [copy, copy],
      ["data:image/gif;base64,R0lG", "data:image/gif;base64,R0lG"],
      ["file:///home/u/clip.webm", null],
      ["nuvo-core://local/v1/me", null],
    ]) {
      localStorage.setItem(LOOK_KEY, saved(stored!));
      vi.resetModules();
      const { useLookStore } = await import("./lookStore");
      expect(useLookStore.getState()).toMatchObject({ backgroundImage: kept, backgroundFit: "cover" });
    }
  });

  it("tells main to delete its copy when the wallpaper is removed", async () => {
    const clearWallpaper = vi.fn(async () => undefined);
    Object.assign(window, { nuvoShell: { clearWallpaper } });
    const { useLookStore } = await import("./lookStore");
    useLookStore.getState().setBackgroundImage("data:image/png;base64,AA");
    useLookStore.getState().setBackgroundImage(null);
    expect(clearWallpaper).not.toHaveBeenCalled();
    useLookStore.getState().setBackgroundImage("nuvo-core://local/wallpaper/0b7c63c8-1d0a-4c3e-9f55-2a8e7d1b4c11.png");
    useLookStore.getState().resetAll();
    expect(clearWallpaper).toHaveBeenCalledOnce();
    Object.assign(window, { nuvoShell: undefined });
  });
});
