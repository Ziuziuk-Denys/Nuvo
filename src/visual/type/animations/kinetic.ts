import type { Voice } from "../../template/schema";
import type { Box } from "../layout";
import { fontFor } from "../raster";
import { easeOutCubic, easeOutExpo, hash, isStressed, lerp, phraseAt, shutterTimes, type Ctx } from "./kit";
import type { LyricAnimation } from "./types";

const CAPS: Voice = { family: "condensed", weight: 900, italic: false, upper: true };
const SMALL: Voice = { family: "rounded", weight: 900, italic: false, upper: false };
const SHUTTER_MS = 26;
const SAMPLES = 7;
const ENTER_BIG_MS = 260;
const ENTER_SMALL_MS = 200;
const MOVE_MS = 260;
const EXIT_MS = 180;
const SETTLED_MS = 600;

interface Slot {
  text: string;
  voice: Voice;
  size: number;
  cx: number;
  y: number;
}

const MEASURE_WIDTH = 0.86;
const MEASURE_HEIGHT = 0.86;
const BOX_FILL = 0.94;
const DESCENT = 0.1;

function layout(ctx: Ctx, texts: string[], stressed: boolean[], width: number, height: number, box: Box, scale: number): Slot[] {
  const unit = Math.min(width, height) * scale;
  const small = 0.085 * unit;
  const measure = Math.min(MEASURE_WIDTH * width, BOX_FILL * box.width);
  const rows: { slots: Omit<Slot, "cx" | "y">[]; height: number; used: number }[] = [];
  let open: (typeof rows)[number] | null = null;
  texts.forEach((raw, i) => {
    const voice = stressed[i] ? CAPS : SMALL;
    const text = voice.upper ? raw.toUpperCase() : raw;
    if (stressed[i]) {
      ctx.font = fontFor(voice, 100);
      const size = Math.min(0.36 * unit, (measure * scale * 100) / ctx.measureText(text).width);
      rows.push({ slots: [{ text, voice, size }], height: size * 0.9, used: 0 });
      open = null;
      return;
    }
    ctx.font = fontFor(voice, small);
    const wordWidth = Math.min(ctx.measureText(text).width, measure);
    const needed = open && open.slots.length ? open.used + small * 0.28 + wordWidth : wordWidth;
    // small words wrap onto a new row instead of running past the frame
    if (!open || needed > measure) {
      open = { slots: [], height: small * 1.1, used: 0 };
      rows.push(open);
    }
    open.used = open.slots.length ? open.used + small * 0.28 + wordWidth : wordWidth;
    open.slots.push({ text, voice, size: wordWidth < ctx.measureText(text).width ? (small * measure) / ctx.measureText(text).width : small });
  });
  // a long phrase on a short frame scales down as one block, so the stack never leaves the frame
  // descenders such as Д and у hang below the last row
  const stacked = rows.reduce((sum, row) => sum + row.height, 0) + 0.22 * small * (rows.length - 1) + DESCENT * rows.at(-1)!.slots[0].size;
  const fit = Math.min(1, Math.min(MEASURE_HEIGHT * height, BOX_FILL * box.height) / stacked);
  if (fit < 1) {
    for (const row of rows) {
      row.height *= fit;
      for (const slot of row.slots) slot.size *= fit;
    }
  }
  const gap = 0.22 * small * fit;
  const total = rows.reduce((sum, row) => sum + row.height, 0) + gap * (rows.length - 1);
  let top = box.y + (box.height - total) / 2;
  const out: Slot[] = [];
  for (const row of rows) {
    const widths = row.slots.map((slot) => {
      ctx.font = fontFor(slot.voice, slot.size);
      return ctx.measureText(slot.text).width;
    });
    const space = row.slots[0].size * 0.28;
    const rowWidth = widths.reduce((sum, w) => sum + w, 0) + space * (row.slots.length - 1);
    let x = box.x + (box.width - rowWidth) / 2;
    const baseline = top + row.height * 0.86;
    row.slots.forEach((slot, i) => {
      out.push({ ...slot, cx: x + widths[i] / 2, y: baseline });
      x += widths[i] + space;
    });
    top += row.height + gap;
  }
  return out;
}

export const kinetic: LyricAnimation = {
  id: "kinetic",
  leadMs: 90,
  weight: 3,
  zone: "full",
  draw({ ctx, lines, nowMs, width, height, box, pulse, scale = 1 }) {
    const signals = { flash: 0.05 * pulse.onset, strobe: 0, blackout: 0 };
    const phrase = phraseAt(lines, nowMs);
    if (!phrase || phrase.shown.length === 0) return signals;
    const texts = phrase.words.map((word) => word.text.trim());
    const stressed = texts.map((text, i) => isStressed(text, i === texts.length - 1));
    const centreX = box.x + box.width / 2;
    const centreY = box.y + box.height / 2;
    const layouts = new Map<number, Slot[]>();
    const layoutFor = (count: number) => {
      if (!layouts.has(count)) layouts.set(count, layout(ctx, texts.slice(0, count), stressed, width, height, box, scale));
      return layouts.get(count)!;
    };
    const lastFrom = phrase.shown.at(-1)!.fromMs;
    const moving = nowMs - lastFrom < SETTLED_MS || phrase.endedMs > 0;
    const times = moving ? shutterTimes(nowMs, SHUTTER_MS, SAMPLES) : [nowMs];
    const seed = phrase.line.fromMs;

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.globalCompositeOperation = "lighter";
    for (const time of times) {
      const count = phrase.words.filter((word) => word.fromMs <= time).length;
      if (count === 0) continue;
      const now = layoutFor(count);
      const before = count > 1 ? layoutFor(count - 1) : now;
      const newest = phrase.words[count - 1];
      const move = easeOutExpo((time - newest.fromMs) / MOVE_MS);
      const push = 1 + 0.1 * Math.exp(-(time - newest.fromMs) / 500);
      const exit = easeOutCubic(Math.max(0, time - phrase.line.toMs) / EXIT_MS);
      for (let i = 0; i < count; i++) {
        const slot = now[i];
        const age = time - phrase.words[i].fromMs;
        let cx = i < count - 1 ? lerp(before[i].cx, slot.cx, move) : slot.cx;
        let y = i < count - 1 ? lerp(before[i].y, slot.y, move) : slot.y;
        let scale = 1;
        let squash = 1;
        let alpha = Math.min(1, age / 30);
        if (stressed[i]) {
          const p = easeOutExpo(age / ENTER_BIG_MS);
          scale = lerp(1.9, 1, p);
          squash = lerp(0.55, 1, p);
          y += lerp(0.2 * height, 0, p);
        } else {
          const p = easeOutExpo(age / ENTER_SMALL_MS);
          if (hash(seed + i) < 0.5) cx += lerp(0.1 * width, 0, p);
          else y += lerp(-0.08 * height, 0, p);
        }
        cx = centreX + (cx - centreX) * push;
        y = centreY + (y - centreY) * push;
        scale *= Math.sqrt(push) * (1 - 0.08 * exit);
        y -= 0.04 * height * exit;
        alpha *= 1 - exit;
        if (alpha <= 0) continue;
        ctx.save();
        ctx.globalAlpha = alpha / times.length;
        ctx.font = fontFor(slot.voice, slot.size);
        ctx.textAlign = "center";
        ctx.translate(cx, y - slot.size * 0.35);
        ctx.scale(scale, scale * squash);
        ctx.fillText(slot.text, 0, slot.size * 0.35);
        ctx.restore();
      }
    }
    ctx.restore();
    return signals;
  },
};
