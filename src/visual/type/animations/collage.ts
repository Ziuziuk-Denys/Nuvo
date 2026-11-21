import type { Voice } from "../../template/schema";
import { fontFor } from "../raster";
import { hash, isStressed, phraseAt, type Ctx } from "./kit";
import type { LyricAnimation } from "./types";

const CAPS: Voice = { family: "condensed", weight: 800, italic: false, upper: true };
const ITALIC: Voice = { family: "serif", weight: 400, italic: true, upper: false };
const SCRIPT: Voice = { family: "script", weight: 400, italic: false, upper: false };
const FRAME_MS = 1000 / 30;
const PUNCH_MS = 2 * FRAME_MS;
const FLICKER_MS = 9 * FRAME_MS;
const GHOST_MS = 400;

interface Placed {
  text: string;
  stressed: boolean;
  size: number;
  cx: number;
  y: number;
}

function place(ctx: Ctx, texts: string[], stressed: boolean[], width: number, height: number, centreY: number): Placed[] {
  const unit = Math.min(width, height);
  const rows: { items: { text: string; stressed: boolean; size: number; width: number }[]; height: number }[] = [];
  let open: (typeof rows)[number] | null = null;
  texts.forEach((text, i) => {
    if (stressed[i]) {
      const upper = text.toUpperCase();
      ctx.font = fontFor(CAPS, 100);
      const size = Math.min(0.32 * unit, (0.9 * width * 100) / ctx.measureText(upper).width);
      ctx.font = fontFor(CAPS, size);
      rows.push({ items: [{ text: upper, stressed: true, size, width: ctx.measureText(upper).width }], height: size * 0.88 });
      open = null;
      return;
    }
    const size = 0.085 * unit;
    ctx.font = fontFor(ITALIC, size);
    if (!open) {
      open = { items: [], height: size * 1.2 };
      rows.push(open);
    }
    open.items.push({ text, stressed: false, size, width: ctx.measureText(text).width });
  });
  const total = rows.reduce((sum, row) => sum + row.height, 0);
  let top = centreY - total / 2;
  const out: Placed[] = [];
  for (const row of rows) {
    const space = row.items[0].size * 0.3;
    const rowWidth = row.items.reduce((sum, item) => sum + item.width, 0) + space * (row.items.length - 1);
    let x = (width - rowWidth) / 2;
    for (const item of row.items) {
      out.push({ text: item.text, stressed: item.stressed, size: item.size, cx: x + item.width / 2, y: top + row.height * 0.85 });
      x += item.width + space;
    }
    top += row.height;
  }
  return out;
}

export const collage: LyricAnimation = {
  id: "collage",
  leadMs: 50,
  weight: 3,
  zone: "full",
  draw({ ctx, lines, nowMs, width, height, box, pulse }) {
    const signals = {
      flash: 0,
      strobe: pulse.level > 0.55 ? 1 : 0,
      blackout: pulse.cutAgeMs < FRAME_MS && hash(pulse.cuts) < 0.15 ? 1 : 0,
    };
    const phrase = phraseAt(lines, nowMs);
    if (!phrase || phrase.shown.length === 0) return signals;
    const texts = phrase.shown.map((word) => word.text.trim()).slice(-4);
    const offset = phrase.shown.length - texts.length;
    const stressed = texts.map((text, i) => isStressed(text, offset + i === phrase.words.length - 1));
    const placed = place(ctx, texts, stressed, width, height, box.y + box.height / 2);

    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.textAlign = "center";
    placed.forEach((item, i) => {
      const age = nowMs - phrase.shown[offset + i].fromMs;
      ctx.save();
      ctx.translate(item.cx, item.y - item.size * 0.35);
      if (item.stressed) {
        if (age < PUNCH_MS) ctx.scale(1.6, 1.6);
        const face = age < FLICKER_MS ? (Math.floor(age / FRAME_MS) + i) % 3 : 0;
        if (face === 0) {
          ctx.font = fontFor(CAPS, item.size);
          ctx.fillText(item.text, 0, item.size * 0.35);
        } else if (face === 1) {
          ctx.font = fontFor(SCRIPT, item.size * 0.7);
          ctx.lineWidth = Math.max(1, item.size * 0.012);
          ctx.strokeText(item.text.toLowerCase(), 0, item.size * 0.3);
        } else {
          ctx.font = fontFor(ITALIC, item.size * 0.62);
          ctx.fillText(item.text.toLowerCase(), 0, item.size * 0.25);
        }
      } else {
        ctx.font = fontFor(ITALIC, item.size);
        ctx.fillText(item.text, 0, item.size * 0.35);
        const ghost = Math.max(0, 1 - age / GHOST_MS);
        if (ghost > 0) {
          ctx.font = fontFor(SCRIPT, item.size * 1.15);
          ctx.globalAlpha = 0.45 * ghost;
          ctx.fillText(item.text, item.size * 0.35, item.size * 0.2);
          ctx.globalAlpha = 0.3 * ghost;
          ctx.fillText(item.text, -item.size * 0.3, item.size * 0.55);
        }
      }
      ctx.restore();
    });
    return signals;
  },
};
