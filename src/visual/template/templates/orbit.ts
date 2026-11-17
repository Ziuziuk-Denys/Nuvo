import type { Template } from "../schema";

export const orbit: Template = {
  id: "orbit",
  name: "visual.template.orbit",
  family: "signal",
  background: { shader: "flow", params: { speed: 0.5, dim: 0.26, bloom: 0, zoom: 1.2 } },
  layers: [
    { shader: "specks", params: { density: 0.14, size: 1, drift: 1 } },
    { shader: "orbit", params: { radius: 0.19, amp: 0.17, gap: 0.011, width: 0.0011, lobes: 0.7 } },
    { shader: "disc", params: { radius: 0.17, pulse: 0.025, shadow: 0.5 } },
    { shader: "type", params: { tone: 1, opacity: 0.9 } },
  ],
  grain: 0.04,
  lyrics: {
    animation: "flow",
    style: {
      mode: "line",
      voices: [{ family: "ui", weight: 600, italic: false, upper: false }],
      size: 0.05,
      leading: 1.12,
      align: "centre",
      motion: "rise",
    },
  },

  layouts: {
    tall: { focus: [0.5, 0.57], scale: 1, lyricBox: [0.08, 0.76, 0.84, 0.14] },
    wide: { focus: [0.5, 0.52], scale: 0.85, lyricBox: [0.2, 0.84, 0.6, 0.12] },
    square: { focus: [0.5, 0.55], scale: 0.85, lyricBox: [0.1, 0.84, 0.8, 0.12] },
  },
  liveSafe: true,
};
