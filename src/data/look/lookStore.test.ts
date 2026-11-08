// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { LEGACY_LOOK_KEY, LOOK_DEFAULTS, LOOK_KEY, MAX_WALLPAPER_BLUR, MAX_WALLPAPER_DIM, MIN_WALLPAPER_BLUR, migrateLegacyLook } from "./lookStore";

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("look store migration", () => {
  it("keeps every old field and ignores the panel blocks", () => {
    const old = JSON.stringify({
      state: {
        preset: "orbit",
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
      preset: "orbit",
      coverGlow: false,
      accentFromCover: true,
      backgroundImage: "data:image/png;base64,AA",
      backgroundDim: 50,
      backgroundBlur: 20,
      themeBeforePreset: "light",
    });
  });

  it("an invalid field falls back alone, out-of-range numbers are clamped", () => {
    const old = JSON.stringify({ state: { preset: "nope", backgroundDim: 250, backgroundBlur: 1, coverGlow: false, backgroundImage: "javascript:1" } });
    expect(migrateLegacyLook(old)).toEqual({ ...LOOK_DEFAULTS, coverGlow: false, backgroundDim: MAX_WALLPAPER_DIM, backgroundBlur: MIN_WALLPAPER_BLUR });
    expect(migrateLegacyLook(JSON.stringify({ state: { backgroundBlur: 99 } })).backgroundBlur).toBe(MAX_WALLPAPER_BLUR);
  });

  it("a broken old blob keeps defaults without throwing", () => {
    expect(migrateLegacyLook("{not json")).toEqual(LOOK_DEFAULTS);
    expect(migrateLegacyLook(null)).toEqual(LOOK_DEFAULTS);
  });
});

describe("look store", () => {
  it("on first start the old key is read once into the new one and removed", async () => {
    localStorage.setItem(LEGACY_LOOK_KEY, JSON.stringify({ state: { preset: "vinyl", backgroundBlur: 22 }, version: 0 }));
    const { useLookStore } = await import("./lookStore");
    expect(useLookStore.getState()).toMatchObject({ preset: "vinyl", backgroundBlur: 22 });
    expect(localStorage.getItem(LEGACY_LOOK_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(LOOK_KEY)!).state.preset).toBe("vinyl");
  });

  it("an existing new key wins over a leftover old one", async () => {
    localStorage.setItem(LOOK_KEY, JSON.stringify({ state: { ...LOOK_DEFAULTS, preset: "cosmos" }, version: 1 }));
    localStorage.setItem(LEGACY_LOOK_KEY, JSON.stringify({ state: { preset: "vinyl" } }));
    const { useLookStore } = await import("./lookStore");
    expect(useLookStore.getState().preset).toBe("cosmos");
  });

  it("setters clamp, and reset removes the wallpaper and its sliders but keeps the look", async () => {
    const { useLookStore } = await import("./lookStore");
    const store = useLookStore.getState();
    store.setPreset("editor");
    store.setCoverGlow(false);
    store.setAccentFromCover(true);
    store.setBackgroundImage("data:image/png;base64,AA");
    store.setBackgroundBlur(1);
    store.setBackgroundDim(250);
    expect(useLookStore.getState()).toMatchObject({ backgroundBlur: MIN_WALLPAPER_BLUR, backgroundDim: MAX_WALLPAPER_DIM });
    useLookStore.getState().resetAll();
    expect(useLookStore.getState()).toMatchObject({
      preset: "editor",
      coverGlow: false,
      accentFromCover: true,
      backgroundImage: null,
      backgroundBlur: LOOK_DEFAULTS.backgroundBlur,
      backgroundDim: LOOK_DEFAULTS.backgroundDim,
    });
  });
});
