import type { Template } from "../schema";

export const paper: Template = {
  id: "paper",
  name: "visual.template.paper",
  family: "type",
  background: { shader: "paper", params: { ink: 0, tint: 0, fibre: 0, vignette: 0 } },
  layers: [{ shader: "type", params: { tone: 0, mono: 1 } }],
  grain: 0,
  lyrics: { animation: "paper" },

  layouts: {
    tall: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.09, 0.14, 0.82, 0.5] },
    wide: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.08, 0.14, 0.6, 0.66] },
    square: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.09, 0.11, 0.82, 0.66] },
  },
  liveSafe: false,
};
