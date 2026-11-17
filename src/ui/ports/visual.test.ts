import { describe, expect, it } from "vitest";
import { sceneOf, SCENES, templateFor } from "./visual";

const keys = Array.from({ length: 40 }, (_, i) => `track-${i}`);
const sceneIds = new Set(SCENES.map((scene) => scene.id));

describe("the template a song gets", () => {
  it("in random mode is always one of the curated scenes, with or without word timing", () => {
    for (const timed of [true, false]) {
      for (const key of keys) expect(sceneIds.has(templateFor("random", key, timed, null).id)).toBe(true);
    }
  });

  it("in own mode is the owner's scene", () => {
    const scene = SCENES.find((item) => item.id === "glass")!.selection;
    expect(templateFor("own", "track-1", false, scene)).toEqual(sceneOf(scene).template);
  });
});
