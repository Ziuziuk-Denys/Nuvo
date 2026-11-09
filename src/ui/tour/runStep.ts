import type { Act, Chapter, Step, TargetId } from "./chapters";

export interface TourStage {
  clear: () => void;
  clearStep: () => void;
  act: (act: Act) => Promise<void>;
  find: (target: TargetId) => Promise<boolean>;
  show: (step: Step) => void;
}

export type StepResult = "shown" | "missing" | "missing-chapter" | "stopped";

// Every await may outlive the step: stop as soon as alive() turns false
export async function runStep(chapter: Chapter, index: number, stage: TourStage, alive: () => boolean, fresh: boolean): Promise<StepResult> {
  const step = chapter.steps[index];
  if (fresh) stage.clear();
  else stage.clearStep();

  if (fresh && chapter.needs && !(await stage.find(chapter.needs))) return alive() ? "missing-chapter" : "stopped";

  for (const act of [...(fresh ? chapter.scene : []), ...(step?.act ?? [])]) {
    if (!alive()) return "stopped";
    await stage.act(act);
  }
  if (!alive()) return "stopped";
  if (!step) return "missing";
  let shown: Step = step;
  if (!(await stage.find(step.target))) {
    if (!alive()) return "stopped";
    if (!step.alt || !(await stage.find(step.alt.target))) return alive() ? "missing" : "stopped";
    shown = { ...step, ...step.alt };
  }
  if (!alive()) return "stopped";

  stage.show(shown);
  return "shown";
}
