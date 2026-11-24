import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useLookStore } from "./lookStore";
import { getPreset, presetIconSrc, presetSmallIconSrc, resolvePresetMode } from "./presets";

const ICON_SIZE = 512;
const SMALL_SIZE = 96;

export async function iconPng(src: string, size = ICON_SIZE): Promise<string> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(image, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}

// Drawing takes 40-160 ms on the main thread, so it waits until after the first paint
function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback !== "function") {
    run();
    return () => undefined;
  }
  const handle = requestIdleCallback(run, { timeout: 3000 });
  return () => cancelIdleCallback(handle);
}

export function useAppIconSync(): void {
  const preset = useLookStore((s) => s.preset);
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const mode = resolvePresetMode(getPreset(preset), resolvedTheme === "light" ? "light" : "dark");
    let live = true;
    const cancel = whenIdle(() => {
      Promise.all([iconPng(presetIconSrc(preset, mode)), iconPng(presetSmallIconSrc(preset, mode), SMALL_SIZE)])
        .then(([png, small]) => {
          if (!live || !png || !small) return;
          void window.nuvoShell?.applyIcon(png, { stock: preset === "nuvo", small }).catch(() => undefined);
          let favicon = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
          if (!favicon) {
            favicon = document.createElement("link");
            favicon.rel = "icon";
            document.head.appendChild(favicon);
          }
          favicon.href = png;
        })
        .catch(() => undefined);
    });
    return () => {
      live = false;
      cancel();
    };
  }, [preset, resolvedTheme]);
}
