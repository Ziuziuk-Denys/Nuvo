import type { Template } from "../schema";

export const ink: Template = {
  id: "ink",
  name: "visual.template.ink",
  family: "signal",
  background: { shader: "paper", params: { ink: 0, tint: 0.7 } },
  layers: [
    {
      shader: "ink",
      params: {
        radius: { base: 0.28, bind: [{ feature: "bass", amount: 0.07 }] },
        amp: { base: 0.16, bind: [{ feature: "level", amount: 0.22 }] },
        keep: 0.95,
        pressure: { base: 0.45, bind: [{ feature: "onset", amount: 0.9 }] },
        width: 0.0016,
        tone: 0,
        spin: 0.15,
      },
    },
    { shader: "disc", params: { radius: 0.085, pulse: 0.03, shadow: 0.35 } },
    { shader: "type", params: { tone: 0, opacity: 0.85 } },
  ],
  grain: 0.05,
  lyrics: {
    animation: "flow",
    style: {
      mode: "line",
      voices: [{ family: "serif", weight: 400, italic: true, upper: false }],
      size: 0.055,
      leading: 1.1,
      align: "centre",
      motion: "rise",
    },
  },

  layouts: {
    tall: { focus: [0.5, 0.56], scale: 1, lyricBox: [0.1, 0.76, 0.8, 0.14] },
    wide: { focus: [0.5, 0.56], scale: 0.82, lyricBox: [0.2, 0.84, 0.6, 0.12] },
    square: { focus: [0.5, 0.56], scale: 0.85, lyricBox: [0.12, 0.83, 0.76, 0.13] },
  },
  liveSafe: true,
};
