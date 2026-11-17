import type { Template } from "../schema";

export const kinetic: Template = {
  id: "kinetic",
  name: "visual.template.kinetic",
  family: "type",
  background: { shader: "duo", params: { bright: 0.95, wave: { base: 0.001, bind: [{ feature: "bass", amount: 0.003 }] }, pulse: 0.08 } },
  layers: [],
  grain: 0.02,
  lyrics: { animation: "kinetic" },
  layouts: {
    tall: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.06, 0.2, 0.88, 0.6] },
    wide: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.1, 0.1, 0.8, 0.8] },
    square: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.06, 0.1, 0.88, 0.8] },
  },
  liveSafe: false,
};
