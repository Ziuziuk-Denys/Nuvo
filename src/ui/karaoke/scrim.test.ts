import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCRIM } from "./scrim";

type Rgb = [number, number, number];

const css = fs.readFileSync(path.join(import.meta.dirname, "Karaoke.module.css"), "utf8");

function inkAlpha(token: string): number {
  const value = new RegExp(`${token}:\\s*([^;]+);`).exec(css)?.[1].trim();
  if (value === "#fff") return 1;
  const alpha = /rgba\(255, 255, 255, ([0-9.]+)\)/.exec(value ?? "")?.[1];
  if (!alpha) throw new Error(`${token} is no longer white: ${value}`);
  return Number(alpha);
}

const over = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((value, i) => value * alpha + under[i] * (1 - alpha)) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const WHITE: Rgb = [255, 255, 255];
const FRAMES: Record<string, Rgb> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  "ice cyan": [0, 224, 255],
  "warm yellow": [255, 214, 0],
  "hot pink": [255, 64, 160],
};

describe("controls over a scene", () => {
  it.each(Object.entries(FRAMES))("read on a %s frame: text at AA, icons at 3:1", (_name, frame) => {
    const backdrop = over([...SCRIM.rgb], SCRIM.alpha, frame);
    for (const token of ["--k-ink", "--k-ink-2", "--k-ink-3"]) {
      expect(contrast(over(WHITE, inkAlpha(token), backdrop), backdrop), token).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(WHITE, backdrop)).toBeGreaterThanOrEqual(3);
  });
});
