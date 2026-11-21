import { describe, expect, it, vi } from "vitest";
import type { Line } from "@/lyrics";
import { DISPLAY_LEAD_MS, lyricsTime, paint } from "./paint";
import type { Stage } from "./render/stage";
import { BANDS, WAVE } from "./signal/features";
import { sceneOf } from "./template/scene";
import { ANIMATIONS } from "./type/animations";
import type { TextRaster } from "./type/raster";

describe("lyrics timing", () => {
  it("draws every animation ahead by the time its entrance needs to become readable", () => {
    for (const animation of Object.values(ANIMATIONS)) {
      expect(animation.leadMs).toBeGreaterThan(0);
      expect(animation.leadMs).toBeLessThanOrEqual(200);
      expect(lyricsTime(10_000, animation, 0)).toBe(10_000 + animation.leadMs);
    }
  });

  it("adds the display delay on screen, but not in an exported file", () => {
    const flow = ANIMATIONS.flow;
    expect(lyricsTime(10_000, flow, DISPLAY_LEAD_MS) - lyricsTime(10_000, flow, 0)).toBe(DISPLAY_LEAD_MS);
    expect(DISPLAY_LEAD_MS).toBeGreaterThan(0);
  });
});

describe("text state", () => {
  function fakeRaster() {
    const stack: { textAlign: string }[] = [];
    const aligns: string[] = [];
    const ctx = {
      textAlign: "start",
      font: "",
      fillStyle: "",
      strokeStyle: "",
      globalAlpha: 1,
      lineWidth: 1,
      save() {
        stack.push({ textAlign: this.textAlign });
      },
      restore() {
        Object.assign(this, stack.pop());
      },
      measureText: (text: string) => ({ width: text.length * 20 }),
      fillText() {
        aligns.push(ctx.textAlign);
      },
      strokeText() {},
      clearRect() {},
      translate() {},
      scale() {},
      beginPath() {},
      rect() {},
      clip() {},
    };
    const raster = { canvas: {}, ctx, width: 1080, height: 1920, measure: () => 0, box: () => ({ x: 86, y: 730, width: 907, height: 461 }) };
    return { raster: raster as unknown as TextRaster, aligns };
  }

  it("leaves no text alignment from one style to the next", () => {
    const stage = { step: () => ({ cuts: 0, cutAgeMs: 0, drive: 0, onset: 0, level: 0 }), setText() {}, render() {} } as unknown as Stage;
    const { raster, aligns } = fakeRaster();
    const lines: Line[] = [{ text: "говорит как нужна", fromMs: 0, toMs: 3000, companion: false, instrumental: false }];
    const features = {
      bands: new Float32Array(BANDS),
      bass: 0,
      mid: 0,
      high: 0,
      level: 0,
      flux: 0,
      onset: 0,
      beat: 0,
      beatConfidence: 0,
      beatMs: 500,
      wave: new Float32Array(WAVE),
    };
    const poster = sceneOf({ background: "print", atmosphere: [], centrepiece: null, lyrics: "poster" }).template;
    const paper = sceneOf({ background: "black", atmosphere: [], centrepiece: null, lyrics: "paper" }).template;
    paint(stage, raster, poster, "tall", lines, 1000, features);
    aligns.length = 0;
    paint(stage, raster, paper, "tall", lines, 1000, features);
    expect(aligns.length).toBeGreaterThan(0);
    expect(new Set(aligns)).toEqual(new Set(["start"]));
  });
});

describe("text size", () => {
  it("hands every style its own scale times the chosen text size", () => {
    const stage = { step: () => ({ cuts: 0, cutAgeMs: 0, drive: 0, onset: 0, level: 0 }), setText() {}, render() {} } as unknown as Stage;
    const ctx = { clearRect() {}, save() {}, restore() {} };
    const raster = {
      canvas: {},
      ctx,
      width: 100,
      height: 100,
      measure: () => 0,
      box: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    } as unknown as TextRaster;
    const features = {
      bands: new Float32Array(BANDS),
      bass: 0,
      mid: 0,
      high: 0,
      level: 0,
      flux: 0,
      onset: 0,
      beat: 0,
      beatConfidence: 0,
      beatMs: 500,
      wave: new Float32Array(WAVE),
    };
    const template = sceneOf({ background: "night", atmosphere: [], centrepiece: null, lyrics: "lens", text: { size: 1.4, ink: "auto" } }).template;
    const draw = vi.spyOn(ANIMATIONS.kinetic, "draw").mockReturnValue({ flash: 0, strobe: 0, blackout: 0 });
    paint(stage, raster, template, "wide", [], 0, features);
    expect(draw.mock.calls[0][0].scale).toBeCloseTo(0.75 * 1.4);
    draw.mockRestore();
  });
});
