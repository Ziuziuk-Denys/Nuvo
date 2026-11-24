import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/data/color/contrast";
import presetTokens from "@/data/look/presetTokens.json";
import { likesCoverSvg, likesCoverTones } from "./likesCover";

describe("likes cover", () => {
  it("sets a white heart on a muted accent in a light theme", () => {
    const tones = likesCoverTones("#4a69b0", "#f4f7ff");
    expect(tones[1]).toBe("#546998");
    expect(tones[4]).toBe("#ffffff");
  });

  it("sets an accent heart on a deep wall in a dark theme", () => {
    const tones = likesCoverTones("#afc8f7", "#101320");
    expect(tones[3]).toBe("#afc8f7");
  });

  it("draws a readable heart in every preset", () => {
    for (const preset of Object.values(presetTokens)) {
      for (const tokens of Object.values(preset.tokens)) {
        const [, wall, , heart] = likesCoverTones(tokens["n-accent"], tokens["n-field"]);
        expect(contrastRatio(heart, wall)).toBeGreaterThan(3);
      }
    }
  });

  it("encodes a self-contained svg", () => {
    const svg = decodeURIComponent(likesCoverSvg(likesCoverTones("#afc8f7", "#101320")).split(",").slice(1).join(","));
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 512 512"/);
    expect(svg).toContain('href="data:image/webp;base64,');
    expect(svg.match(/type="table"/g)).toHaveLength(3);
  });
});
