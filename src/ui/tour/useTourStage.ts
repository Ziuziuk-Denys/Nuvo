import { useMemo, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { useModalStore } from "../ports/navigation";
import { navigateWithTransition } from "../shell/navigate";
import type { Step, TargetId } from "./chapters";
import type { TourStage } from "./runStep";
import { targetElement } from "./targets";

/* How long a target may take to mount: a page transition, a popover pouring out of its button */
const FIND_FRAMES = 60;
const PAGE_SETTLE_MS = 480;
const PANEL_SETTLE_MS = 320;

const pause = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));
const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

function currentPath(): string {
  return window.location.hash.replace(/^#/, "").split("?")[0] || "/";
}

/* A press on the page outside every overlay: the player's popover and the queue drawer close the way a click would close them */
function closePanels(): void {
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  useModalStore.getState().closeSettings();
}

/*
  The stage the chapters play on. It only opens pages and panels the user could open themselves;
  the step on screen is the state the layer draws its outline and callout from
*/
export function useTourStage(navigate: NavigateFunction): { stage: TourStage; shown: Step | null } {
  const [shown, setShown] = useState<Step | null>(null);

  const stage = useMemo<TourStage>(
    () => ({
      clear: () => {
        closePanels();
        setShown(null);
      },
      clearStep: () => setShown(null),
      act: async (act) => {
        if (act.kind === "route") {
          if (currentPath() === act.path) return;
          navigateWithTransition(navigate, act.path);
          await pause(PAGE_SETTLE_MS);
        } else if (act.kind === "settings") {
          useModalStore.getState().openSettingsSection(act.section);
          await pause(PAGE_SETTLE_MS);
        } else {
          const element = await waitFor(act.target);
          if (element?.getAttribute("aria-selected") === "true" || element?.getAttribute("aria-expanded") === "true") return;
          element?.click();
          await pause(PANEL_SETTLE_MS);
        }
      },
      find: async (target) => (await waitFor(target)) !== null,
      show: (step) => setShown(step),
    }),
    [navigate],
  );

  return { stage, shown };
}

async function waitFor(target: TargetId): Promise<HTMLElement | null> {
  for (let frame = 0; frame < FIND_FRAMES; frame += 1) {
    const element = targetElement(target);
    if (element) {
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      return element;
    }
    await nextFrame();
  }
  return null;
}
