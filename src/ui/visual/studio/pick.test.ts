import { describe, expect, it } from "vitest";
import { partsFor, type Selection } from "../../ports/visual";
import { applyPick } from "./pick";

const part = (id: string) =>
  [...partsFor("background"), ...partsFor("atmosphere"), ...partsFor("centrepiece"), ...partsFor("lyrics")].find((item) => item.id === id)!;
const base: Selection = { background: "night", atmosphere: [], centrepiece: null, lyrics: "line" };

describe("picking a part in the studio", () => {
  it("adds and removes an effect", () => {
    const added = applyPick(base, part("dust"), 3);
    expect(added.selection?.atmosphere).toEqual(["dust"]);
    expect(applyPick(added.selection!, part("dust"), 3).selection?.atmosphere).toEqual([]);
  });

  it("refuses a second weather and says why, instead of doing nothing", () => {
    const result = applyPick({ ...base, atmosphere: ["rain"] }, part("snow"), 3);
    expect(result.selection).toBeNull();
    expect(result.notice).toEqual({ key: "visual.studio.pick_weather" });
  });

  it("refuses an effect that would make the scene too heavy", () => {
    const heavy: Selection = { background: "night", atmosphere: ["dust", "film"], centrepiece: "emblem", lyrics: "kinetic" };
    const result = applyPick(heavy, part("streak"), 3);
    expect(result.selection).toBeNull();
    expect(result.notice?.key).toBe("visual.studio.pick_heavy");
  });

  it("refuses a fourth effect", () => {
    const result = applyPick({ ...base, lyrics: null, atmosphere: ["dust", "film", "streak"] }, part("rain"), 3);
    expect(result.selection).toBeNull();
    expect(result.notice).toEqual({ key: "visual.studio.effects_full", values: { max: "3" } });
  });

  it("switches the background a text style needs and says so", () => {
    const result = applyPick(base, part("wipe"), 3);
    expect(result.selection).toMatchObject({ background: "glass", lyrics: "wipe" });
    expect(result.notice).toEqual({ key: "visual.studio.pick_background", values: { part: "wipe", background: "glass" } });
  });

  it("stores what the scene really shows, so the tile and the scene agree", () => {
    const result = applyPick({ ...base, lyrics: "kinetic" }, part("emblem"), 3);
    expect(result.selection?.centrepiece).toBe("emblem");
    expect(result.selection?.lyrics).toBe("line");
    expect(result.notice).toEqual({ key: "visual.studio.pick_calm", values: { part: "kinetic", calm: "line" } });
  });
});
