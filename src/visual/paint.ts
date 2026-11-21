import type { Line } from "@/lyrics";
import type { Stage } from "./render/stage";
import type { Features } from "./signal/features";
import type { Aspect, Template } from "./template/schema";
import { ANIMATIONS } from "./type/animations";
import { QUIET, type LyricAnimation } from "./type/animations/types";
import type { TextRaster } from "./type/raster";

// about two frames pass between drawing a frame and seeing it
export const DISPLAY_LEAD_MS = 33;

export function lyricsTime(atMs: number, animation: LyricAnimation, displayLeadMs: number): number {
  return atMs + animation.leadMs + displayLeadMs;
}

export interface PaintOptions {
  reduced?: boolean;
  displayLeadMs?: number;
}

export function paint(
  stage: Stage,
  raster: TextRaster | null,
  template: Template,
  aspect: Aspect,
  lines: Line[],
  atMs: number,
  features: Features,
  options: PaintOptions = {},
): void {
  const pulse = stage.step(atMs, features);
  let signals = QUIET;
  const animation = template.lyrics ? ANIMATIONS[template.lyrics.animation] : undefined;
  if (animation && raster) {
    raster.ctx.clearRect(0, 0, raster.width, raster.height);
    // the raster outlives a style change, so no alignment or transform may carry over to the next style
    raster.ctx.save();
    signals = animation.draw({
      ctx: raster.ctx,
      lines,
      nowMs: lyricsTime(atMs, animation, options.displayLeadMs ?? 0),
      width: raster.width,
      height: raster.height,
      box: raster.box(template.layouts[aspect].lyricBox),
      style: template.lyrics!.style,
      scale: (template.lyrics!.scale ?? 1) * (template.text?.size ?? 1),
      pulse,
    });
    raster.ctx.restore();
    stage.setText(raster.canvas);
  } else stage.setText(null);
  stage.render(signals, options.reduced ?? false);
}
