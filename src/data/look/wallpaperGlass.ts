import type { CSSProperties } from "react";
import { useTheme } from "next-themes";
import { useHasCustomBackground } from "./lookStore";

const GLASS: CSSProperties = {
  background: "linear-gradient(rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.08)), rgba(10, 10, 10, 0.35)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  ["--glass-pill-bg" as string]: "linear-gradient(135deg, rgba(0, 0, 0, 0.247) 0%, rgba(0, 0, 0, 0.190) 100%)",
  ["--glass-pill-bg-hover" as string]: "linear-gradient(135deg, rgba(0, 0, 0, 0.397) 0%, rgba(0, 0, 0, 0.303) 100%)",
  ["--glass-pill-border" as string]: "none",
  ["--glass-blur" as string]: "22px",
  ["--glass-prominent-bg" as string]: "rgba(255, 255, 255, 0.84)",
};

export function wallpaperGlass(wallpaper: boolean, dark: boolean): CSSProperties | undefined {
  return wallpaper && dark ? GLASS : undefined;
}

export function useWallpaperGlass(): CSSProperties | undefined {
  const wallpaper = useHasCustomBackground();
  const { resolvedTheme } = useTheme();
  return wallpaperGlass(wallpaper, resolvedTheme === "dark");
}
