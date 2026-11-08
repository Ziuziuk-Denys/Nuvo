import type { Act, Chapter, Step, TargetId } from "./chapters";

/* What a chapter can do on screen. TourLayer implements it on the real window, tests use a recording fake */
export interface TourStage {
  /** Closes what the last chapter opened and takes its outline and callout away */
  clear: () => void;
  /** Takes the last step's callout away; the scene stays */
  clearStep: () => void;
  act: (act: Act) => Promise<void>;
  /** Waits a moment for the target to mount; false when it never does */
  find: (target: TargetId) => Promise<boolean>;
  /** The outline and the callout of a step */
  show: (step: Step) => void;
}

export type StepResult = "shown" | "missing" | "missing-chapter" | "stopped";

/*
  Plays one step: on entering the chapter (fresh) its scene first, then the step's own act, its outline and callout.
  Every await is a point where the user may have moved on, so the run stops as soon as alive() turns false
*/
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
