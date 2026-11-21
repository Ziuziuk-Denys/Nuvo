import { expect, it } from "vitest";
import en from "../../../i18n/locales/en.json";
import ru from "../../../i18n/locales/ru.json";
import { kinetic } from "../../../visual/type/animations/kinetic";
import type { Ctx } from "../../../visual/type/animations/kit";
import { DEMO_LINE_MS, demoLines } from "./demoLines";
import { choiceBox } from "./LookChoice";

interface Glyph {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function recorder() {
  const glyphs: Glyph[] = [];
  const clips: number[][] = [];
  let at = { x: 0, y: 0, sx: 1, sy: 1 };
  const stack: (typeof at)[] = [];
  const ctx = {
    font: "10px sans-serif",
    fillStyle: "",
    textAlign: "",
    globalAlpha: 1,
    globalCompositeOperation: "",
    measureText(text: string) {
      return { width: text.length * Number(/([\d.]+)px/.exec(this.font)![1]) * 0.62 };
    },
    save: () => stack.push({ ...at }),
    restore: () => {
      at = stack.pop()!;
    },
    beginPath: () => {},
    rect: (x: number, y: number, width: number, height: number) => clips.push([x, y, width, height]),
    clip: () => {},
    translate: (x: number, y: number) => {
      at = { ...at, x: at.x + x * at.sx, y: at.y + y * at.sy };
    },
    scale: (sx: number, sy: number) => {
      at = { ...at, sx: at.sx * sx, sy: at.sy * sy };
    },
    fillText(text: string, _x: number, y: number) {
      const size = Number(/([\d.]+)px/.exec(this.font)![1]);
      const half = (this.measureText(text).width * at.sx) / 2;
      const baseline = at.y + y * at.sy;
      glyphs.push({ left: at.x - half, right: at.x + half, top: baseline - 0.75 * size * at.sy, bottom: baseline + 0.2 * size * at.sy });
    },
  };
  return { ctx: ctx as unknown as Ctx, glyphs, clips };
}

const SIZES = [
  { width: 1100, height: 705, ui: 1, pixels: 1 },
  { width: 1200, height: 780, ui: 1, pixels: 1 },
  { width: 1920, height: 1080, ui: 1, pixels: 1 },
  { width: 1100, height: 705, ui: 1.5, pixels: 1.5 },
];
const BAR_PX = 78;
const BAR_BOTTOM_PX = 42;

for (const [name, texts] of [
  ["en", [en.visual.choice.demo_1, en.visual.choice.demo_2, en.visual.choice.demo_3]],
  ["ru", [ru.visual.choice.demo_1, ru.visual.choice.demo_2, ru.visual.choice.demo_3]],
] as const) {
  it.each(SIZES)(`keeps the ${name} demo line inside the box above the prompt at $width x $height, scale $ui`, ({ width, height, ui, pixels }) => {
    const barTop = height - BAR_BOTTOM_PX - BAR_PX * ui;
    const [fx, fy, fw, fh] = choiceBox(height, barTop);
    const w = width * pixels;
    const h = height * pixels;
    const box = { x: fx * w, y: fy * h, width: fw * w, height: fh * h };
    expect(box.y + box.height).toBeLessThanOrEqual(barTop * pixels);
    const lines = demoLines([...texts]);
    for (const line of lines) {
      const settled = line.words!.at(-1)!.fromMs + 700;
      expect(settled).toBeLessThan(line.fromMs + DEMO_LINE_MS);
      const { ctx, glyphs, clips } = recorder();
      kinetic.draw({ ctx, lines, nowMs: settled, width: w, height: h, box, pulse: { cuts: 0, cutAgeMs: 0, drive: 0, onset: 0, level: 0 } });
      expect(clips).toEqual([[box.x, box.y, box.width, box.height]]);
      expect(glyphs.length).toBeGreaterThan(0);
      for (const glyph of glyphs) {
        expect(glyph.left).toBeGreaterThanOrEqual(box.x - 1);
        expect(glyph.right).toBeLessThanOrEqual(box.x + box.width + 1);
        expect(glyph.top).toBeGreaterThanOrEqual(box.y - 1);
        expect(glyph.bottom).toBeLessThanOrEqual(box.y + box.height + 1);
      }
    }
  });
}
