import type { Template } from "../schema";

export const ridgeline: Template = {
  id: "ridgeline",
  name: "visual.template.ridgeline",
  family: "signal",
  background: { shader: "paper", params: { ink: 1, tint: 0 } },
  layers: [
    { shader: "ridgeline", params: { lines: 42, height: { base: 0.2, bind: [{ feature: "level", amount: 0.08 }] }, width: 0.0011, near: 0.16, far: 0.62 } },
    { shader: "type", params: { tone: 1, opacity: 0.92 } },
  ],
  grain: 0.04,
  lyrics: {
    animation: "flow",
    style: {
      mode: "line",
      voices: [{ family: "ui", weight: 600, italic: false, upper: false }],
      size: 0.058,
      leading: 1.12,
      align: "left",
      motion: "rise",
    },
  },

  layouts: {
    tall: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.08, 0.08, 0.84, 0.2] },
    wide: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.07, 0.08, 0.6, 0.18] },
    square: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.08, 0.08, 0.84, 0.18] },
  },
  liveSafe: true,
};
