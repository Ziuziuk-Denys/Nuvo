import { expect, it } from "vitest";
import { SCENE_TOUR } from "./steps";

it("shows the way back to karaoke right after the welcome, before the editor", () => {
  expect(SCENE_TOUR.map((step) => step.target)).toEqual([
    null,
    "look-switch",
    "scene-edit",
    "studio-browser",
    "studio-player",
    "studio-inspector",
    "studio-timeline",
    "studio-export",
    "studio-use",
  ]);
});
