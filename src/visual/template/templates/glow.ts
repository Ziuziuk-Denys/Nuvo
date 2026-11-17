import type { Template } from "../schema";

export const glow: Template = {
  id: "glow",
  name: "visual.template.glow",
  family: "cover",
  background: {
    shader: "flow",
    params: {
      speed: 1,
      dim: { base: 0.5, bind: [{ feature: "level", amount: 0.12 }] },
      bloom: { base: 0.1, bind: [{ feature: "bass", amount: 0.55 }] },
      zoom: 1.6,
    },
  },
  layers: [{ shader: "type", params: { tone: 1 } }],
  grain: 0.035,
  lyrics: {
    animation: "flow",
    style: {
      mode: "line",
      voices: [{ family: "ui", weight: 700, italic: false, upper: false }],
      size: 0.082,
      leading: 1.12,
      align: "left",
      motion: "rise",
    },
  },

  layouts: {
    tall: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.08, 0.6, 0.84, 0.28] },
    wide: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.07, 0.56, 0.62, 0.34] },
    square: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.08, 0.58, 0.84, 0.32] },
  },
  liveSafe: true,
};
