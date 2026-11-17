import type { Template } from "../schema";

export const columns: Template = {
  id: "columns",
  name: "visual.template.columns",
  family: "type",
  background: { shader: "columns", params: { count: 4, levels: 3, flicker: 0.7, outline: 1.6 } },
  layers: [],
  grain: 0.06,
  lyrics: { animation: "collage" },

  layouts: {
    tall: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.05, 0.3, 0.9, 0.42] },
    wide: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.08, 0.18, 0.84, 0.64] },
    square: { focus: [0.5, 0.5], scale: 1, lyricBox: [0.06, 0.2, 0.88, 0.6] },
  },
  liveSafe: false,
};
