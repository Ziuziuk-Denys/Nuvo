import { describe, expect, it } from "vitest";
import { PARTS } from "./parts";
import { WEIGHT_BUDGET, partsFor, sceneOf } from "./scene";

describe("own scene", () => {
  it("builds a balanced template and reports its weight", () => {
    const scene = sceneOf({ background: "night", atmosphere: ["snow"], centrepiece: null, lyrics: "line" });
    expect(scene.template.background.shader).toBe("flow");
    expect(scene.weight).toBe(3);
    expect(scene.issues).toEqual([]);
  });

  it("calms the lyrics under a centrepiece and says so", () => {
    const scene = sceneOf({ background: "night", atmosphere: [], centrepiece: "emblem", lyrics: "kinetic" });
    expect(scene.issues).toContain("busy");
    expect(scene.selection.lyrics).toBe("line");
    expect(scene.weight).toBeLessThanOrEqual(WEIGHT_BUDGET);
  });

  it("puts small lyrics in the lower third and big ones in the centre", () => {
    const lower = sceneOf({ background: "night", atmosphere: [], centrepiece: null, lyrics: "whisper" });
    const centre = sceneOf({ background: "duo", atmosphere: [], centrepiece: null, lyrics: "kinetic" });
    expect(lower.template.layouts.tall.lyricBox[1]).toBeGreaterThan(0.6);
    expect(centre.template.layouts.tall.lyricBox[1]).toBeLessThan(0.5);
  });

  it("lists every part of a slot", () => {
    expect(partsFor("background").length).toBe(PARTS.filter((part) => part.slot === "background").length);
    expect(partsFor("lyrics").every((part) => part.slot === "lyrics")).toBe(true);
  });
});
