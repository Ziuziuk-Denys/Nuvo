import { fontFor } from "./type/raster";

// the Nuvo mark, drawn in a 256 box with the shape inside 32..224
const MARK_PATH =
  "M32 62 A30 30 0 0 1 62 32 L87.92 32 A14 14 0 0 1 100.04 39 L130.14 91.14 A16 16 0 0 0 160 83.14 L160 50 A18 18 0 0 1 178 32 L194 32 A30 30 0 0 1 224 62 L224 194 A30 30 0 0 1 194 224 L168.08 224 A14 14 0 0 1 155.96 217 L125.86 164.86 A16 16 0 0 0 96 172.86 L96 206 A18 18 0 0 1 78 224 L62 224 A30 30 0 0 1 32 194 Z";
const MARK_BOX = 192;
const MARK_OFFSET = 32;
const SIZE_SHARE = 0.038;
const BOTTOM_SHARE = 0.045;

export interface WatermarkPlace {
  centreX: number;
  bottom: number;
  size: number;
}

export function watermarkLayout(width: number, height: number): WatermarkPlace {
  const size = Math.round(Math.min(width, height) * SIZE_SHARE);
  return { centreX: width / 2, bottom: Math.round(height * (1 - BOTTOM_SHARE)), size };
}

type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawWatermark(ctx: Ctx2d, width: number, height: number): void {
  const { centreX, bottom, size } = watermarkLayout(width, height);
  const title = "Made with Nuvo";
  const site = "nuvo.quest";
  const markSize = size * 0.66;
  const gap = size * 0.24;
  const titleFont = fontFor({ family: "ui", weight: 700, italic: false, upper: false }, size * 0.46);
  const siteFont = fontFor({ family: "ui", weight: 500, italic: false, upper: false }, size * 0.4);
  ctx.save();
  ctx.font = titleFont;
  const titleWidth = ctx.measureText(title).width;
  ctx.font = siteFont;
  const siteWidth = ctx.measureText(site).width;
  const siteGap = size * 0.32;
  const left = centreX - (markSize + gap + titleWidth + siteGap + siteWidth) / 2;
  const middle = bottom - size / 2;

  const paintSign = () => {
    ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    ctx.save();
    ctx.translate(left, middle - markSize / 2);
    ctx.scale(markSize / MARK_BOX, markSize / MARK_BOX);
    ctx.translate(-MARK_OFFSET, -MARK_OFFSET);
    ctx.fill(new Path2D(MARK_PATH));
    ctx.restore();
    ctx.textBaseline = "middle";
    ctx.font = titleFont;
    ctx.fillText(title, left + markSize + gap, middle);
    ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
    ctx.font = siteFont;
    ctx.fillText(site, left + markSize + gap + titleWidth + siteGap, middle + size * 0.02);
  };
  // a wide soft shadow for depth, then a tight one that outlines the letters on white
  ctx.shadowColor = "rgba(0, 0, 0, 0.32)";
  ctx.shadowBlur = size * 0.5;
  ctx.shadowOffsetY = size * 0.04;
  paintSign();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = size * 0.1;
  ctx.shadowOffsetY = 0;
  paintSign();
  ctx.restore();
}
