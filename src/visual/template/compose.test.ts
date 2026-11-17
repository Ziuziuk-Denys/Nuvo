import { describe, expect, it } from "vitest";
import { balance, compose, type Part, type Selection } from "./compose";

const FRAME = { focus: [0.5, 0.5] as [number, number], scale: 1, lyricBox: [0.1, 0.6, 0.8, 0.3] as [number, number, number, number] };
const LAYOUTS = { tall: FRAME, wide: FRAME, square: FRAME };

const PARTS: Part[] = [
  { id: "cover", slot: "background", weight: 1, zone: "full", ink: "light", layers: [{ shader: "flow", params: {} }] },
  { id: "white", slot: "background", weight: 1, zone: "full", ink: "dark", layers: [{ shader: "paper", params: {} }] },
  { id: "duo", slot: "background", weight: 1, zone: "full", ink: "light", drawsText: true, layers: [{ shader: "duo", params: {} }] },
  { id: "snow", slot: "atmosphere", weight: 2, zone: "full", group: "weather", back: true, layers: [{ shader: "snow", params: {} }] },
  { id: "rain", slot: "atmosphere", weight: 2, zone: "full", group: "weather", back: true, layers: [{ shader: "rain", params: {} }] },
  { id: "film", slot: "atmosphere", weight: 1, zone: "full", mono: 1, impact: 0.8, layers: [{ shader: "film", params: {} }] },
  { id: "glass", slot: "atmosphere", weight: 3, zone: "full", layers: [{ shader: "glass", params: {} }] },
  {
    id: "orbit",
    slot: "centrepiece",
    weight: 3,
    zone: "centre",
    layers: [
      { shader: "orbit", params: { amp: 0.17 } },
      { shader: "disc", params: { radius: 0.17 } },
    ],
  },
  { id: "line", slot: "lyrics", weight: 1, zone: "lower", animation: "flow", layers: [] },
  { id: "kinetic", slot: "lyrics", weight: 3, zone: "full", animation: "kinetic", calm: "line", layers: [] },
  { id: "paper", slot: "lyrics", weight: 2, zone: "full", animation: "paper", calm: "line", layers: [] },
  { id: "lens", slot: "lyrics", weight: 3, zone: "full", animation: "kinetic", drawsText: true, layers: [{ shader: "treat", params: { mode: 0 } }] },
  { id: "pair", slot: "lyrics", weight: 2, zone: "full", animation: "flow", requires: ["duo", "white"], layers: [] },
];

const pick = (selection: Partial<Selection>): Selection => ({ background: "cover", atmosphere: [], centrepiece: null, lyrics: null, ...selection });

describe("balance", () => {
  it("accepts a light scene untouched", () => {
    const result = balance(pick({ atmosphere: ["film"], lyrics: "line" }), PARTS);
    expect(result.issues).toEqual([]);
    expect(result.fixed).toEqual(pick({ atmosphere: ["film"], lyrics: "line" }));
  });

  it("calms heavy lyrics under a centrepiece", () => {
    const result = balance(pick({ centrepiece: "orbit", lyrics: "paper" }), PARTS);
    expect(result.issues).toContain("busy");
    expect(result.fixed.lyrics).toBe("line");
  });

  it("keeps one weather at a time", () => {
    const result = balance(pick({ atmosphere: ["snow", "rain"] }), PARTS);
    expect(result.issues).toContain("weather");
    expect(result.fixed.atmosphere).toEqual(["snow"]);
  });

  it("drops the last atmospheres until the weight fits", () => {
    const result = balance(pick({ atmosphere: ["glass", "snow", "film"] }), PARTS);
    expect(result.issues).toContain("heavy");
    expect(result.fixed.atmosphere).toEqual(["glass", "snow"]);
  });

  it("brings a background the lyric style accepts", () => {
    expect(balance(pick({ lyrics: "pair" }), PARTS).fixed.background).toBe("duo");
    expect(balance(pick({ background: "white", lyrics: "pair" }), PARTS).fixed.background).toBe("white");
  });
});

describe("compose", () => {
  const shaders = (template: { background: { shader: string }; layers: { shader: string }[] }) => [
    template.background.shader,
    ...template.layers.map((layer) => layer.shader),
  ];

  it("puts weather behind the centrepiece and film over the text", () => {
    const template = compose("mine", pick({ atmosphere: ["rain", "film"], centrepiece: "orbit", lyrics: "line" }), PARTS, LAYOUTS);
    expect(shaders(template)).toEqual(["flow", "rain", "orbit", "disc", "type", "film"]);
    expect(template.lyrics?.animation).toBe("flow");
  });

  it("adds no text layer when the background draws the text itself", () => {
    expect(shaders(compose("k", pick({ background: "duo", lyrics: "kinetic" }), PARTS, LAYOUTS))).toEqual(["duo"]);
    expect(shaders(compose("k", pick({ background: "cover", lyrics: "kinetic" }), PARTS, LAYOUTS))).toEqual(["flow", "type"]);
  });

  it("adds no text layer when the lyric style shades the text itself", () => {
    expect(shaders(compose("l", pick({ background: "cover", lyrics: "lens" }), PARTS, LAYOUTS))).toEqual(["flow", "treat"]);
  });

  it("applies setting overrides to a part's first layer or to a named shader", () => {
    const template = compose("s", pick({ centrepiece: "orbit", params: { orbit: { amp: 0.3, "disc.radius": 0.2 } } }), PARTS, LAYOUTS);
    expect(template.layers[0].params.amp).toBe(0.3);
    expect(template.layers[1].params.radius).toBe(0.2);
  });

  it("carries custom colours", () => {
    const colors = { a: [1, 0, 0] as [number, number, number], b: [0, 0, 0.2] as [number, number, number] };
    expect(compose("c", pick({ background: "duo", colors }), PARTS, LAYOUTS).colors).toEqual(colors);
  });

  it("turns the scene monochrome when a part asks for it", () => {
    expect(compose("t", pick({ atmosphere: ["film"] }), PARTS, LAYOUTS).mono).toBe(1);
    expect(compose("t", pick({}), PARTS, LAYOUTS).mono).toBe(0);
  });

  it("takes the strongest hit impact of the chosen parts", () => {
    expect(compose("t", pick({ atmosphere: ["film"] }), PARTS, LAYOUTS).impact).toBe(0.8);
    expect(compose("t", pick({}), PARTS, LAYOUTS).impact).toBe(0);
  });

  it("inks text dark on a light background and light on a dark one", () => {
    const tone = (background: string) =>
      compose("t", pick({ background, lyrics: "line" }), PARTS, LAYOUTS).layers.find((layer) => layer.shader === "type")!.params.tone;
    expect(tone("white")).toBe(0);
    expect(tone("cover")).toBe(1);
  });
});
