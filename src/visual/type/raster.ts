import type { Voice } from "../template/schema";
import type { Ctx } from "./animations/kit";
import type { Box, Measure } from "./layout";

const FAMILIES: Record<Voice["family"], string> = {
  ui: `"Nuvo Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif`,
  condensed: `"Nuvo Condensed", "Arial Narrow", sans-serif`,
  serif: `"Nuvo Serif", Georgia, serif`,
  neutral: `"Nuvo Neutral", Arial, Helvetica, sans-serif`,
  rounded: `"Nuvo Rounded", system-ui, sans-serif`,
  script: `"Nuvo Script", cursive`,
};

export function fontFor(voice: Voice, size: number): string {
  const stretch = voice.family === "condensed" ? "extra-condensed " : "";
  return `${voice.italic ? "italic " : ""}${voice.weight} ${stretch}${size.toFixed(2)}px ${FAMILIES[voice.family]}`;
}

export interface TextRaster {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: Ctx;
  width: number;
  height: number;
  measure: Measure;
  box(fraction: [number, number, number, number]): Box;
}

export function createTextRaster(width: number, height: number): TextRaster {
  const canvas =
    typeof OffscreenCanvas === "undefined" ? Object.assign(document.createElement("canvas"), { width, height }) : new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d") as Ctx;
  return {
    canvas,
    ctx,
    width,
    height,
    measure: (text, size, voice) => {
      ctx.font = fontFor(voice, size);
      return ctx.measureText(text).width;
    },
    box: ([x, y, w, h]) => ({ x: x * width, y: y * height, width: w * width, height: h * height }),
  };
}
