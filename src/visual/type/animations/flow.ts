import { layoutWords, lineWords, visibleWords } from "../layout";
import { fontFor } from "../raster";
import { easeOutCubic } from "./kit";
import { QUIET, type LyricAnimation } from "./types";

const SETTLE_MS = 180;
const RISE_MS = 320;

export const flow: LyricAnimation = {
  id: "flow",
  leadMs: 120,
  weight: 1,
  zone: "lower",
  draw({ ctx, lines, nowMs, width, height, box, style, scale = 1 }) {
    if (!style) return QUIET;
    const words = style.mode === "line" ? lineWords(lines, nowMs) : visibleWords(lines, nowMs);
    const measure = (text: string, size: number, voice: (typeof style.voices)[number]) => {
      ctx.font = fontFor(voice, size);
      return ctx.measureText(text).width;
    };
    const runs = layoutWords(words, box, measure, { ...style, size: style.size * Math.min(width, height) * scale });
    const motionMs = style.motion === "settle" ? SETTLE_MS : style.motion === "rise" ? RISE_MS : 0;
    ctx.fillStyle = "#fff";
    for (const run of runs) {
      const progress = motionMs ? easeOutCubic(run.age / motionMs) : 1;
      ctx.save();
      ctx.font = fontFor(style.voices[run.voice]!, run.size);
      if (style.motion === "settle") {
        const scale = 1 + 0.16 * (1 - progress);
        const centreX = run.x + ctx.measureText(run.text).width / 2;
        const centreY = run.y - run.size * 0.35;
        ctx.translate(centreX, centreY);
        ctx.scale(scale, scale);
        ctx.translate(-centreX, -centreY);
      } else if (style.motion === "rise") {
        ctx.globalAlpha = progress;
        ctx.translate(0, (1 - progress) * run.size * 0.28);
      }
      ctx.fillText(run.text, run.x, run.y);
      ctx.restore();
    }
    return QUIET;
  },
};
