import { useEffect, useState } from "react";
import { useGround } from "../light/useGround";
import { contrastRatio, parseColor } from "../ports/color";
import { wallpaperKind } from "../ports/settings";

const COLS = 12;
const ROWS = 8;
const READABLE = 4.5;
const STEP = 0.02;
const MOST = 0.7;
const SPARED = 0.15;
// the captions over a wallpaper, see [data-wallpaper] in Shell.module.css
const CAPTION = 0.86;

const rgb = (channels: readonly number[]) => `rgb(${channels.map(Math.round).join(", ")})`;

export function dimFloor(pixels: Uint8ClampedArray, ink: string, ground: string): number {
  const { r, g, b } = parseColor(ink);
  const under = parseColor(ground);
  const caption = `rgba(${r}, ${g}, ${b}, ${CAPTION})`;
  const cells: number[][] = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) cells.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  cells.sort((one, two) => contrastRatio(caption, rgb(one)) - contrastRatio(caption, rgb(two)));
  const hardest = cells[Math.floor(cells.length * SPARED)];
  let dim = 0;
  const dimmed = () => rgb([under.r, under.g, under.b].map((channel, i) => hardest[i] + (channel - hardest[i]) * dim));
  while (dim < MOST && contrastRatio(caption, dimmed()) < READABLE) dim += STEP;
  return Math.min(MOST, dim);
}

function firstFrame(src: string): Promise<HTMLImageElement | HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    if (wallpaperKind(src) !== "video") {
      const picture = Object.assign(new Image(), { crossOrigin: "anonymous", onload: () => resolve(picture), onerror: reject });
      picture.src = src;
      return;
    }
    const video = Object.assign(document.createElement("video"), {
      crossOrigin: "anonymous",
      muted: true,
      onloadeddata: () => resolve(video),
      onerror: reject,
    });
    video.src = src;
  });
}

async function wallpaperPixels(src: string): Promise<Uint8ClampedArray> {
  const picture = await firstFrame(src);
  const canvas = Object.assign(document.createElement("canvas"), { width: COLS, height: ROWS });
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas 2d context unavailable");
  context.imageSmoothingQuality = "high";
  context.drawImage(picture, 0, 0, COLS, ROWS);
  return context.getImageData(0, 0, COLS, ROWS).data;
}

export function useWallpaperFloor(src: string): number {
  const ground = useGround();
  const [floor, setFloor] = useState(0);
  useEffect(() => {
    let live = true;
    wallpaperPixels(src).then(
      (pixels) => {
        const ink = getComputedStyle(document.documentElement).getPropertyValue("--n-ink").trim();
        if (live && ink) setFloor(dimFloor(pixels, ink, ground));
      },
      () => live && setFloor(0),
    );
    return () => {
      live = false;
    };
  }, [src, ground]);
  return floor;
}
