import type { Side } from "../../tour/chapters";

export interface SceneTourStep {
  target: string | null;
  text: string;
  side?: Side;
  press?: boolean;
}

export const SCENE_TOUR: SceneTourStep[] = [
  { target: null, text: "intro" },
  { target: "look-switch", text: "switch", side: "below" },
  { target: "scene-edit", text: "edit", side: "below", press: true },
  { target: "studio-browser", text: "browser", side: "right" },
  { target: "studio-player", text: "player", side: "right" },
  { target: "studio-inspector", text: "inspector", side: "left" },
  { target: "studio-timeline", text: "timeline", side: "above" },
  { target: "studio-export", text: "export", side: "below" },
  { target: "studio-use", text: "use", side: "below", press: true },
];
