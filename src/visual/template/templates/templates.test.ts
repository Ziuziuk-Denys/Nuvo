import { describe, expect, it } from "vitest";
import { SHADERS } from "../../render/shaders/library";
import { validateTemplate } from "../schema";
import { PRESETS, TEMPLATES } from "./index";

describe("shipped templates", () => {
  it.each([...TEMPLATES, ...PRESETS].map((template) => [template.id, template] as const))("%s is valid", (_, template) => {
    expect(validateTemplate(template, SHADERS)).toEqual([]);
  });

  it("have unique ids", () => {
    const all = [...TEMPLATES, ...PRESETS];
    expect(new Set(all.map((template) => template.id)).size).toBe(all.length);
  });
});
