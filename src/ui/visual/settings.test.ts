import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("visual settings", () => {
  it("starts off, on the karaoke view, in random mode, with no own scene", async () => {
    const { visualSettings } = await import("./settings");
    expect(visualSettings()).toEqual({ enabled: false, stage: false, template: "random", scene: null, media: null, toured: false, chosen: false });
  });

  it("remembers each choice across reloads", async () => {
    const first = await import("./settings");
    const scene = { background: "duo", atmosphere: [], centrepiece: null, lyrics: "kinetic" };
    const media = { url: "nuvo-core://local/scene-media/0b7c63c8-1d0a-4c3e-9f55-2a8e7d1b4c11.webm", kind: "video" as const };
    first.setVisualSettings({ enabled: true, stage: true, template: "own", scene, media, toured: true, chosen: true });
    vi.resetModules();
    const second = await import("./settings");
    expect(second.visualSettings()).toEqual({ enabled: true, stage: true, template: "own", scene, media, toured: true, chosen: true });
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

  it("drops stored media that is not Nuvo's own copy", async () => {
    for (const url of ["https://example.com/a.mp4", "blob:file:///x", "nuvo-core://local/scene-media/../a.mp4", 3]) {
      localStorage.setItem("nuvo.visual", JSON.stringify({ media: { url, kind: "video" } }));
      vi.resetModules();
      const { visualSettings } = await import("./settings");
      expect(visualSettings().media).toBeNull();
    }
  });

  it("keeps a scene's text look and cleans one it cannot trust", async () => {
    const scene = { background: "night", atmosphere: [], centrepiece: null, lyrics: "line" };
    localStorage.setItem("nuvo.visual", JSON.stringify({ scene: { ...scene, text: { size: 1.2, ink: [1, 0.5, 0] } } }));
    const { visualSettings } = await import("./settings");
    expect(visualSettings().scene?.text).toEqual({ size: 1.2, ink: [1, 0.5, 0] });
    vi.resetModules();
    localStorage.setItem("nuvo.visual", JSON.stringify({ scene: { ...scene, text: { size: 40, ink: "<script>" } } }));
    const again = await import("./settings");
    expect(again.visualSettings().scene?.text).toEqual({ size: 1.5, ink: "auto" });
  });

  it("tells subscribers about a change", async () => {
    const { setVisualSettings, subscribeVisualSettings } = await import("./settings");
    const seen = vi.fn();
    subscribeVisualSettings(seen);
    setVisualSettings({ stage: true });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
