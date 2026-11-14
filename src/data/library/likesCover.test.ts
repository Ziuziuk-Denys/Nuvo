import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/data/color/contrast";
import presetTokens from "@/data/look/presetTokens.json";
import { likesCoverColors, likesCoverSvg } from "./likesCover";

describe("likes cover", () => {
  it("puts the accent under light lines in a light theme", () => {
    expect(likesCoverColors("#4a69b0", "#f4f7ff")).toEqual({ ground: "#4a69b0", line: "#f4f7ff" });
  });

  it("keeps a deep ground lit by the accent in a dark theme", () => {
    const { ground, line } = likesCoverColors("#afc8f7", "#101320");
    expect(line).toBe("#afc8f7");
    expect(ground).not.toBe("#101320");
    expect(contrastRatio(line, ground)).toBeGreaterThan(4);
  });

  it("draws a readable heart in every preset", () => {
    for (const preset of Object.values(presetTokens)) {
      for (const tokens of Object.values(preset.tokens)) {
        const { ground, line } = likesCoverColors(tokens["n-accent"], tokens["n-field"]);
        expect(contrastRatio(line, ground)).toBeGreaterThan(3);
      }
    }
  });

  it("encodes a self-contained svg", () => {
    const svg = decodeURIComponent(likesCoverSvg({ ground: "#000000", line: "#ffffff" }).split(",")[1]);
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 64 64"/);
    expect(svg.match(/<use /g)).toHaveLength(7);
  });
});
