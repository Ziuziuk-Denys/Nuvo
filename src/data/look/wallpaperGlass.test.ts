import { describe, expect, it } from "vitest";
import { wallpaperGlass } from "./wallpaperGlass";

describe("wallpaper glass", () => {
  it("turns a surface into tinted, blurred glass over a wallpaper in dark mode", () => {
    const style = wallpaperGlass(true, true) as Record<string, string>;
    expect(style.background).toBe("linear-gradient(rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.08)), rgba(10, 10, 10, 0.35)");
    expect(style.backdropFilter).toBe("blur(20px)");
    expect(style["--glass-blur"]).toBe("22px");
  });

  it("leaves the surface alone without a wallpaper or in light mode", () => {
    expect(wallpaperGlass(false, true)).toBeUndefined();
    expect(wallpaperGlass(true, false)).toBeUndefined();
  });
});
