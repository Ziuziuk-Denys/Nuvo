import type { Selection } from "../compose";
import { sceneOf } from "../scene";
import type { Template } from "../schema";
import { columns } from "./columns";
import { glow } from "./glow";
import { ink } from "./ink";
import { kinetic } from "./kinetic";
import { orbit } from "./orbit";
import { paper } from "./paper";
import { ridgeline } from "./ridgeline";

export const DEFAULT_TEMPLATE = glow;
export const TEMPLATES: Template[] = [glow, paper, columns, kinetic, ink, ridgeline, orbit];

export const SCENES: { id: string; selection: Selection }[] = [
  {
    id: "kinetic-ice",
    selection: { background: "duo", atmosphere: [], centrepiece: null, lyrics: "kinetic", colors: { a: [0, 0.88, 1], b: [0.04, 0.06, 0.19] } },
  },
  { id: "emblem", selection: { background: "dusk", atmosphere: ["dust", "streak"], centrepiece: "emblem", lyrics: null } },
  { id: "ascii", selection: { background: "ascii", atmosphere: [], centrepiece: null, lyrics: "collage" } },
  { id: "glass", selection: { background: "glass", atmosphere: [], centrepiece: null, lyrics: "wipe" } },
  { id: "film", selection: { background: "still", atmosphere: ["film"], centrepiece: null, lyrics: "whisper" } },
  { id: "kinetic-lens", selection: { background: "still", atmosphere: [], centrepiece: null, lyrics: "lens", params: { still: { "still.dim": 0.8 } } } },
  { id: "kinetic-glitch", selection: { background: "still", atmosphere: [], centrepiece: null, lyrics: "glitch", params: { still: { "still.dim": 0.45 } } } },
  { id: "kinetic-chrome", selection: { background: "night", atmosphere: ["dust"], centrepiece: null, lyrics: "chrome-type" } },
  {
    id: "kinetic-3d",
    selection: { background: "night", atmosphere: ["dust"], centrepiece: null, lyrics: "extrude", params: { extrude: { "treat.depth": 0.6 } } },
  },
  {
    id: "kinetic-rain",
    selection: { background: "still", atmosphere: ["rain"], centrepiece: null, lyrics: "kinetic", params: { still: { "still.dim": 0.55 } } },
  },
  { id: "snowfall", selection: { background: "night", atmosphere: ["snow", "dust"], centrepiece: null, lyrics: "line" } },
  { id: "rain", selection: { background: "night", atmosphere: ["rain"], centrepiece: "disc", lyrics: "whisper" } },
];

export const PRESETS: Template[] = SCENES.map((scene) => sceneOf(scene.selection, scene.id).template);
