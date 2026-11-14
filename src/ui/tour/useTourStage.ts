import { useMemo, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { useModalStore } from "../ports/navigation";
import { navigateWithTransition } from "../shell/navigate";
import type { Step, TargetId } from "./chapters";
import type { TourStage } from "./runStep";
import { targetElement } from "./targets";

const FIND_FRAMES = 60;
const PAGE_SETTLE_MS = 480;
const PANEL_SETTLE_MS = 320;

const pause = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));
const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

function currentPath(): string {
  return window.location.hash.replace(/^#/, "").split("?")[0] || "/";
}

function closePanels(): void {
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  useModalStore.getState().closeSettings();
  useModalStore.getState().closeSearch();
}

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
        } else if (act.kind === "palette") {
          useModalStore.getState().openSearch();
          await pause(PANEL_SETTLE_MS);
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
