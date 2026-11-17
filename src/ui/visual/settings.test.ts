import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("visual settings", () => {
  it("starts off, on the karaoke view, in random mode, with no own scene", async () => {
    const { visualSettings } = await import("./settings");
    expect(visualSettings()).toEqual({ enabled: false, stage: false, template: "random", scene: null, toured: false, chosen: false });
  });

  it("remembers each choice across reloads", async () => {
    const first = await import("./settings");
    const scene = { background: "duo", atmosphere: [], centrepiece: null, lyrics: "kinetic" };
    first.setVisualSettings({ enabled: true, stage: true, template: "own", scene, toured: true, chosen: true });
    vi.resetModules();
    const second = await import("./settings");
    expect(second.visualSettings()).toEqual({ enabled: true, stage: true, template: "own", scene, toured: true, chosen: true });
  });

  it("makes a scene picked in the studio the player's scene, even after random mode", async () => {
    const { chooseScene, setVisualSettings, visualSettings } = await import("./settings");
    const scene = { background: "glass", atmosphere: [], centrepiece: null, lyrics: "wipe" };
    setVisualSettings({ template: "random" });
    chooseScene(scene);
    expect(visualSettings()).toMatchObject({ template: "own", scene });
  });

  it("ignores a stored value it cannot read", async () => {
    localStorage.setItem("nuvo.visual", "{not json");
    const { visualSettings } = await import("./settings");
    expect(visualSettings().enabled).toBe(false);
  });

  it("drops a stored scene that is not a scene", async () => {
    localStorage.setItem("nuvo.visual", JSON.stringify({ scene: { background: 3 } }));
    const { visualSettings } = await import("./settings");
    expect(visualSettings().scene).toBeNull();
  });

  it("tells subscribers about a change", async () => {
    const { setVisualSettings, subscribeVisualSettings } = await import("./settings");
    const seen = vi.fn();
    subscribeVisualSettings(seen);
    setVisualSettings({ stage: true });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
