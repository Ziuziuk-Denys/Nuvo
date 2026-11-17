import type { Line } from "@/lyrics";
import { estimateWords, layoutWords } from "../layout";
import { fontFor } from "../raster";
import { easeOutCubic } from "./kit";
import { QUIET, type LyricAnimation } from "./types";

const HOLD_MS = 600;
const FOG_MS = 1600;
const SWAP_MS = 500;
const MIN_STROKE_MS = 260;

export const wipe: LyricAnimation = {
  id: "wipe",
  leadMs: 150,
  weight: 2,
  zone: "centre",
  draw({ ctx, lines, nowMs, width, height, box, style }) {
    if (!style) return QUIET;
    let current = -1;
    for (let i = 0; i < lines.length && lines[i].fromMs <= nowMs; i++) current = i;
    if (current < 0) return QUIET;
    const line = lines[current];
    const shown: [Line, number][] = [[line, 1 - easeOutCubic(Math.max(0, nowMs - line.toMs - HOLD_MS) / FOG_MS)]];
    if (current > 0 && nowMs - line.fromMs < SWAP_MS) shown.push([lines[current - 1], 1 - (nowMs - line.fromMs) / SWAP_MS]);
    const sized = { ...style, size: style.size * Math.min(width, height) };
    const measure = (text: string, size: number, voice: (typeof style.voices)[number]) => {
      ctx.font = fontFor(voice, size);
      return ctx.measureText(text).width;
    };
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.lineJoin = "round";
    for (const [source, alpha] of shown) {
      if (alpha <= 0) continue;
      const words = estimateWords(source);
      const runs = layoutWords(
        words.map((word) => ({ ...word, age: nowMs - word.fromMs })),
        box,
        measure,
        sized,
      );
      runs.forEach((run, i) => {
        const word = words[i];
        const reveal = easeOutCubic((nowMs - word.fromMs) / Math.max(MIN_STROKE_MS, (word.toMs - word.fromMs) * 0.8));
        if (reveal <= 0) return;
        ctx.save();
        ctx.font = fontFor(style.voices[run.voice]!, run.size);
        const wordWidth = ctx.measureText(run.text).width;
        ctx.beginPath();
        ctx.rect(run.x - run.size * 0.1, run.y - run.size * 1.1, (wordWidth + run.size * 0.2) * reveal, run.size * 1.5);
        ctx.clip();
        ctx.globalAlpha = alpha;
        ctx.lineWidth = run.size * 0.07;
        ctx.strokeText(run.text, run.x, run.y);
        ctx.fillText(run.text, run.x, run.y);
        ctx.restore();
      });
    }
    return QUIET;
  },
};
