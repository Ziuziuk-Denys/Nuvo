import { describe, expect, it } from "vitest";
import type { Features } from "../signal/features";
import { evaluate } from "./bindings";
import { pickTemplate } from "./pick";
import { validateTemplate, type ShaderSpec, type Template } from "./schema";

const silent: Features = {
  bands: new Float32Array(64),
  bass: 0,
  mid: 0,
  high: 0,
  level: 0,
  flux: 0,
  onset: 0,
  beat: 0,
  beatConfidence: 0,
  beatMs: 0,
  wave: new Float32Array(512),
};

const SHADERS: Record<string, ShaderSpec> = {
  flow: { params: { speed: { min: 0, max: 2, value: 1 } } },
  rings: { params: { reach: { min: 0, max: 1, value: 0.5 }, width: { min: 0, max: 0.1, value: 0.01 } } },
};

const FRAME = { focus: [0.5, 0.5] as [number, number], scale: 1, lyricBox: [0.1, 0.1, 0.8, 0.8] as [number, number, number, number] };

function template(id: string, overrides: Partial<Template> = {}): Template {
  return {
    id,
    name: `visual.template.${id}`,
    family: "signal",
    background: { shader: "flow", params: {} },
    layers: [{ shader: "rings", params: { reach: { base: 0.4, bind: [{ feature: "bass", amount: 0.5 }] } } }],
    grain: 0.04,
    lyrics: null,
    layouts: { wide: FRAME, tall: FRAME, square: FRAME },
    liveSafe: true,
    ...overrides,
  };
}

describe("bindings", () => {
  it("adds each bound feature to the base", () => {
    const value = evaluate(
      {
        base: 0.2,
        bind: [
          { feature: "bass", amount: 0.5 },
          { feature: "onset", amount: 0.1 },
        ],
      },
      { ...silent, bass: 0.8, onset: 1 },
      false,
    );
    expect(value).toBeCloseTo(0.2 + 0.4 + 0.1);
  });

  it("squares the feature on a square curve", () => {
    expect(evaluate({ base: 0, bind: [{ feature: "level", amount: 1, curve: "square" }] }, { ...silent, level: 0.5 }, false)).toBeCloseTo(0.25);
  });

  it("opens a gate only above one half", () => {
    const gate = { base: 0, bind: [{ feature: "flux" as const, amount: 1, curve: "gate" as const }] };
    expect(evaluate(gate, { ...silent, flux: 0.49 }, false)).toBe(0);
    expect(evaluate(gate, { ...silent, flux: 0.51 }, false)).toBe(1);
  });

  it("calms every reaction when motion is reduced", () => {
    expect(evaluate({ base: 0.2, bind: [{ feature: "bass", amount: 1 }] }, { ...silent, bass: 1 }, true)).toBeCloseTo(0.2 + 0.35);
  });

  it("passes a plain number through", () => {
    expect(evaluate(0.7, silent, false)).toBe(0.7);
  });
});

describe("template validation", () => {
  it("accepts a well formed template", () => {
    expect(validateTemplate(template("rings"), SHADERS)).toEqual([]);
  });

  it("names an unknown shader", () => {
    const errors = validateTemplate(template("bad", { layers: [{ shader: "bars", params: {} }] }), SHADERS);
    expect(errors).toEqual(["bad: unknown shader bars"]);
  });

  it("names an unknown parameter and an out of range base", () => {
    const errors = validateTemplate(template("bad", { layers: [{ shader: "rings", params: { glow: 1, width: 0.5 } }] }), SHADERS);
    expect(errors).toEqual(["bad: rings has no parameter glow", "bad: rings.width 0.5 is outside 0..0.1"]);
  });
});

describe("seeded pick", () => {
  const pool = [template("glow"), template("ink"), template("orbit"), template("ridgeline"), template("paper", { liveSafe: false })];

  it("gives the same template for the same track every time", () => {
    const first = pickTemplate("local:track-42", pool, true).id;
    for (let i = 0; i < 5; i++) expect(pickTemplate("local:track-42", pool, true).id).toBe(first);
  });

  it("does not depend on pool order", () => {
    const reversed = [...pool].reverse();
    expect(pickTemplate("yt:abc", reversed, true).id).toBe(pickTemplate("yt:abc", pool, true).id);
  });

  it("spreads different tracks across the pool", () => {
    const picked = new Set(Array.from({ length: 40 }, (_, i) => pickTemplate(`track-${i}`, pool, true).id));
    expect(picked.size).toBeGreaterThanOrEqual(4);
  });

  it("skips templates that need word timing when the track has none", () => {
    for (let i = 0; i < 40; i++) expect(pickTemplate(`track-${i}`, pool, false).id).not.toBe("paper");
  });
});
