import { describe, expect, it } from "vitest";
import { NEUTRAL, type CoverLight } from "./readLight";
import { AT, between, lightState, turnsColour } from "./scene";

const VIEW = { width: 1440, height: 900 };
const HERO = { x: 600, y: 300, width: 200, height: 200 };
const BLUE: CoverLight = { ...NEUTRAL, key: [0.2, 0.3, 0.7], from: [0.5, -0.4] };

const read = (state: Float32Array, name: keyof typeof AT) => [...state.subarray(AT[name][0], AT[name][0] + AT[name][1])];

describe("lightState", () => {
  it("aims the room's lamp at the hero from the cover's bright side", () => {
    const state = lightState("room", VIEW, BLUE, HERO);
    expect(read(state, "lamp")[0]).toBeGreaterThan(700);
    expect(read(state, "aim")[1]).toBeCloseTo(370);
    expect(read(state, "emit")).toEqual([0]);
  });

  it("makes the cover the only lamp of karaoke at rest", () => {
    const awake = lightState("karaoke", VIEW, BLUE, { ...HERO, x: 200 }, true);
    const rest = lightState("karaoke", VIEW, BLUE, { ...HERO, x: 200 }, false);
    expect(read(awake, "power")[0]).toBeGreaterThan(0);
    expect(read(rest, "power")).toEqual([0]);
    expect(read(rest, "screen")).toEqual([300, 400, 100, 100]);
  });

  it("lights both sides of the room from a cover in the middle", () => {
    const both = (x: number) => read(lightState("karaoke", VIEW, BLUE, { ...HERO, x }, false), "both")[0];
    expect([both(200), both(620)]).toEqual([0, 1]);
    expect(both(480)).toBeGreaterThan(0);
  });

  it("keeps dark and bright covers at a similar brightness in karaoke", () => {
    const at = (value: number) => read(lightState("karaoke", VIEW, { ...BLUE, cells: BLUE.cells.map(() => value) }, HERO, false), "emit")[0] * value;
    expect(at(0.6) / at(0.04)).toBeLessThan(1.5);
  });

  it("stays dimmer on walls than in rooms", () => {
    const power = (scene: "room" | "wall" | "calm") => read(lightState(scene, VIEW, BLUE, null), "power")[0];
    expect(power("room")).toBeGreaterThan(power("wall"));
    expect(power("wall")).toBeGreaterThan(power("calm"));
  });
});

describe("between", () => {
  const from = lightState("room", VIEW, NEUTRAL, HERO);
  const to = lightState("room", VIEW, BLUE, HERO);

  it("starts and ends exactly on the two lights", () => {
    expect(between(from, to, 0, new Float32Array(from.length))).toEqual(from);
    const end = between(from, to, 1, new Float32Array(from.length));
    end.forEach((value, i) => expect(value).toBeCloseTo(to[i], 4));
  });

  it("dims and lifts the lamp while the colour turns, not while it only moves", () => {
    const middle = between(from, to, 0.5, new Float32Array(from.length));
    expect(read(middle, "power")[0]).toBeLessThan(read(to, "power")[0]);
    const moved = lightState("room", VIEW, NEUTRAL, { ...HERO, y: 340 });
    expect(turnsColour(from, moved)).toBe(false);
    expect(read(between(from, moved, 0.5, new Float32Array(from.length)), "power")).toEqual(read(from, "power"));
  });
});
