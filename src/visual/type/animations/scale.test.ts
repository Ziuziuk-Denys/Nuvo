import { describe, expect, it } from "vitest";
import type { Line } from "@/lyrics";
import { sceneOf } from "../../template/scene";
import { ANIMATIONS } from ".";
import type { Ctx } from "./kit";

const LINES: Line[] = [{ text: "say it louder tonight", fromMs: 0, toMs: 4000, companion: false, instrumental: false }];

function drawn(lyrics: string, background: string, scale: number, width: number, height: number) {
  const template = sceneOf({ background, atmosphere: [], centrepiece: null, lyrics }).template;
  let px = 0;
  let shift = 0;
  let stretch = 1;
  const saved: [number, number][] = [];
  const sizes: number[] = [];
  const spans: { left: number; right: number }[] = [];
  const ctx = {
    set font(value: string) {
      px = Number(/([\d.]+)px/.exec(value)![1]);
    },
    get font() {
      return `${px}px`;
    },
    textAlign: "start",
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    measureText: (text: string) => ({ width: text.length * px * 0.5 }),
    fillText(text: string, x: number) {
      const width = text.length * px * 0.5 * stretch;
      const left = shift + (ctx.textAlign === "center" ? x * stretch - width / 2 : x * stretch);
      sizes.push(px * stretch);
      spans.push({ left, right: left + width });
    },
    strokeText() {},
    save() {
      saved.push([shift, stretch]);
    },
    restore() {
      [shift, stretch] = saved.pop() ?? [0, 1];
    },
    translate(x: number) {
      shift += x * stretch;
    },
    scale(x: number) {
      stretch *= x;
    },
    beginPath() {},
    rect() {},
    clip() {},
    clearRect() {},
  };
  const [bx, by, bw, bh] = template.layouts.wide.lyricBox;
  ANIMATIONS[template.lyrics!.animation].draw({
    ctx: ctx as unknown as Ctx,
    lines: LINES,
    nowMs: 3900,
    width,
    height,
    box: { x: bx * width, y: by * height, width: bw * width, height: bh * height },
    style: template.lyrics!.style,
    scale: (template.lyrics!.scale ?? 1) * scale,
    pulse: { cuts: 0, cutAgeMs: 0, drive: 0, onset: 0, level: 0 },
  });
  return { mean: sizes.reduce((sum, size) => sum + size, 0) / sizes.length, spans };
}

describe("text size", () => {
  const styles: [string, string][] = [
    ["line", "night"],
    ["paper", "black"],
    ["kinetic", "black"],
    ["collage", "ascii"],
    ["wipe", "glass"],
    ["poster", "print"],
  ];

  it("draws every style larger at a bigger text size", () => {
    for (const [lyrics, background] of styles) {
      expect(drawn(lyrics, background, 1.3, 1920, 1080).mean, lyrics).toBeGreaterThan(drawn(lyrics, background, 1, 1920, 1080).mean);
    }
  });

  it("still keeps the largest text inside the frame", () => {
    for (const [lyrics, background] of styles) {
      for (const [width, height] of [
        [1100, 705],
        [1080, 1920],
      ]) {
        for (const span of drawn(lyrics, background, 1.5, width, height).spans) {
          expect(span.left, `${lyrics} ${width}x${height}`).toBeGreaterThanOrEqual(-0.5);
          expect(span.right, `${lyrics} ${width}x${height}`).toBeLessThanOrEqual(width + 0.5);
        }
      }
    }
  });
});
