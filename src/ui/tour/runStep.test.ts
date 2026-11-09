import { describe, expect, it } from "vitest";
import type { Act, Chapter, TargetId } from "./chapters";
import { runStep, type TourStage } from "./runStep";

function recordingStage(present: TargetId[], onAct?: (act: Act) => void) {
  const log: string[] = [];
  const stage: TourStage = {
    clear: () => log.push("clear"),
    clearStep: () => log.push("clearStep"),
    act: async (act) => {
      log.push(`act:${act.kind}:${"target" in act ? act.target : "path" in act ? act.path : act.section}`);
      onAct?.(act);
    },
    find: async (target) => {
      log.push(`find:${target}`);
      return present.includes(target);
    },
    show: (step) => log.push(`show:${step.target}:${step.text}`),
  };
  return { stage, log };
}

const chapter: Chapter = {
  id: "sound",
  needs: "sound-button",
  scene: [{ kind: "press", target: "sound-button" }],
  steps: [
    { target: "sound-panel", text: "eq", act: [{ kind: "press", target: "sound-eq" }] },
    { target: "sound-panel", text: "speed", act: [{ kind: "press", target: "sound-speed" }] },
  ],
};

const always = () => true;

describe("runStep", () => {
  it("on entering a chapter clears the last scene, checks what it needs, sets its scene, then shows the step", async () => {
    const { stage, log } = recordingStage(["sound-button", "sound-panel"]);
    expect(await runStep(chapter, 0, stage, always, true)).toBe("shown");
    expect(log).toEqual(["clear", "find:sound-button", "act:press:sound-button", "act:press:sound-eq", "find:sound-panel", "show:sound-panel:eq"]);
  });

  it("a later step of the same chapter keeps the scene and plays only its own act", async () => {
    const { stage, log } = recordingStage(["sound-button", "sound-panel"]);
    expect(await runStep(chapter, 1, stage, always, false)).toBe("shown");
    expect(log).toEqual(["clearStep", "act:press:sound-speed", "find:sound-panel", "show:sound-panel:speed"]);
  });

  it("reports a chapter whose needed target is missing before touching the window", async () => {
    const { stage, log } = recordingStage([]);
    expect(await runStep(chapter, 0, stage, always, true)).toBe("missing-chapter");
    expect(log).toEqual(["clear", "find:sound-button"]);
  });

  it("reports a step whose target never mounts and shows nothing", async () => {
    const { stage, log } = recordingStage(["sound-button"]);
    expect(await runStep(chapter, 0, stage, always, true)).toBe("missing");
    expect(log.some((line) => line.startsWith("show"))).toBe(false);
  });

  it("stops at once when the user has moved on mid-scene", async () => {
    let alive = true;
    const { stage, log } = recordingStage(["sound-button", "sound-panel"], () => {
      alive = false;
    });
    expect(await runStep(chapter, 0, stage, () => alive, true)).toBe("stopped");
    expect(log).toEqual(["clear", "find:sound-button", "act:press:sound-button"]);
  });

  it("a step whose target is not there shows its stand-in with the stand-in's text", async () => {
    const home: Chapter = { id: "home", scene: [], steps: [{ target: "mixes", text: "mixes", alt: { target: "home-start", text: "home_start" } }] };
    const { stage, log } = recordingStage(["home-start"]);
    expect(await runStep(home, 0, stage, always, true)).toBe("shown");
    expect(log).toEqual(["clear", "find:mixes", "find:home-start", "show:home-start:home_start"]);
    expect(await runStep(home, 0, recordingStage([]).stage, always, true)).toBe("missing");
  });
});
