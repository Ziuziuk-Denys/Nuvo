import { describe, expect, it } from "vitest";
import { PARTS } from "./parts";

describe("parts catalogue", () => {
  it("has unique ids across slots", () => {
    expect(new Set(PARTS.map((part) => part.id)).size).toBe(PARTS.length);
  });

  it("only requires backgrounds that exist", () => {
    const backgrounds = new Set(PARTS.filter((part) => part.slot === "background").map((part) => part.id));
    for (const part of PARTS) for (const id of part.requires ?? []) expect(backgrounds.has(id)).toBe(true);
  });
});

describe("editor controls", () => {
  it("name only real parameters of the part's own shaders", async () => {
    const { SHADERS } = await import("../render/shaders/library");
    for (const part of PARTS) {
      for (const control of part.controls ?? []) {
        const [shader, name] = control.split(".");
        expect(
          part.layers.some((layer) => layer.shader === shader),
          `${part.id} ${control}`,
        ).toBe(true);
        expect(SHADERS[shader].params[name], `${part.id} ${control}`).toBeDefined();
      }
    }
  });
});
